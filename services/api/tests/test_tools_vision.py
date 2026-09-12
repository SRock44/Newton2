import json
import uuid

import httpx

from app.core.config import Settings
from app.tools import vision as vision_module
from app.tools.registry import run_tool
from app.tools.vision import VisionTool

_FAKE_PNG = b"\x89PNG\r\n\x1a\nfake-but-good-enough-for-a-unit-test"


def _mock_transport(handler):
    return httpx.MockTransport(handler)


async def test_run_errors_clearly_with_no_session_id():
    tool = VisionTool()
    result = await tool.run(image_id="whatever", session_id=None)
    assert result.startswith("Error:")
    assert "session" in result.lower()


async def test_run_errors_clearly_when_openrouter_not_configured(monkeypatch):
    monkeypatch.setattr(vision_module, "get_settings", lambda: Settings(openrouter_api_key=None))
    tool = VisionTool()
    result = await tool.run(image_id="whatever", session_id=str(uuid.uuid4()))
    assert result.startswith("Error:")
    assert "isn't configured" in result.lower()


async def test_run_errors_clearly_when_image_id_unknown(monkeypatch):
    monkeypatch.setattr(
        vision_module, "get_settings", lambda: Settings(openrouter_api_key="fake-key")
    )
    tool = VisionTool()
    result = await tool.run(image_id="does-not-exist", session_id=str(uuid.uuid4()))
    assert result.startswith("Error:")
    assert "does-not-exist" in result


async def test_run_sends_the_image_and_returns_the_model_text(monkeypatch):
    session_id = str(uuid.uuid4())

    async def fake_get_image_for_session(sid, image_id):
        assert sid == session_id
        assert image_id == "img-1"
        return _FAKE_PNG, "image/png"

    monkeypatch.setattr(vision_module, "get_image_for_session", fake_get_image_for_session)
    monkeypatch.setattr(
        vision_module,
        "get_settings",
        lambda: Settings(openrouter_api_key="fake-key", openrouter_vision_model="fake/vision-model"),
    )

    seen_request = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen_request["auth"] = request.headers.get("authorization")
        seen_request["body"] = request.content
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "This is 2x + 3 = 7, so x = 2."}}]},
        )

    tool = VisionTool(transport=_mock_transport(handler))
    result = await tool.run(image_id="img-1", session_id=session_id)

    assert result == "This is 2x + 3 = 7, so x = 2."
    assert seen_request["auth"] == "Bearer fake-key"
    payload = json.loads(seen_request["body"])
    assert payload["model"] == "fake/vision-model"
    content_blocks = payload["messages"][0]["content"]
    assert content_blocks[0]["type"] == "text"
    assert content_blocks[1]["type"] == "image_url"
    assert content_blocks[1]["image_url"]["url"].startswith("data:image/png;base64,")


async def test_run_returns_error_string_on_http_failure(monkeypatch):
    session_id = str(uuid.uuid4())

    async def fake_get_image_for_session(sid, image_id):
        return _FAKE_PNG, "image/png"

    monkeypatch.setattr(vision_module, "get_image_for_session", fake_get_image_for_session)
    monkeypatch.setattr(
        vision_module, "get_settings", lambda: Settings(openrouter_api_key="fake-key")
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="upstream unavailable")

    tool = VisionTool(transport=_mock_transport(handler))
    result = await tool.run(image_id="img-1", session_id=session_id)
    assert result.startswith("Error:")


async def test_run_returns_error_string_on_unexpected_response_shape(monkeypatch):
    session_id = str(uuid.uuid4())

    async def fake_get_image_for_session(sid, image_id):
        return _FAKE_PNG, "image/png"

    monkeypatch.setattr(vision_module, "get_image_for_session", fake_get_image_for_session)
    monkeypatch.setattr(
        vision_module, "get_settings", lambda: Settings(openrouter_api_key="fake-key")
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unexpected": "shape"})

    tool = VisionTool(transport=_mock_transport(handler))
    result = await tool.run(image_id="img-1", session_id=session_id)
    assert result.startswith("Error:")


# ---- registry-level: session_id threading ----------------------------------------


async def test_run_tool_passes_session_id_through_to_vision_but_not_other_tools(monkeypatch):
    """The mechanism in app/tools/registry.py that threads session_id only into tools
    that declare it — proven here directly against the real registry and real VisionTool
    (with its own network call mocked), rather than just trusting the reflection logic."""
    session_id = str(uuid.uuid4())
    seen = {}

    async def fake_get_image_for_session(sid, image_id):
        seen["session_id"] = sid
        return _FAKE_PNG, "image/png"

    monkeypatch.setattr(vision_module, "get_image_for_session", fake_get_image_for_session)
    monkeypatch.setattr(
        vision_module, "get_settings", lambda: Settings(openrouter_api_key="fake-key")
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    # swap in a tool instance with the mocked transport, same name so the registry finds it
    from app.tools import registry as registry_module

    registry_module._TOOLS["read_image"] = VisionTool(transport=_mock_transport(handler))
    try:
        result = await run_tool("read_image", {"image_id": "img-1"}, session_id=session_id)
    finally:
        registry_module._TOOLS["read_image"] = VisionTool()

    assert result == "ok"
    assert seen["session_id"] == session_id

    # a tool that doesn't declare session_id must not receive it as an unexpected kwarg
    calc_result = await run_tool("calculator", {"expression": "2 + 2"}, session_id=session_id)
    assert not calc_result.startswith("Error: bad arguments")
    assert "4" in calc_result
