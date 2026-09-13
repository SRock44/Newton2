import httpx

from app.core.config import Settings
from app.providers import registry as registry_module
from app.providers.anthropic_provider import AnthropicProvider
from app.providers.base import ChatTurn, TextDelta, ToolCallRequest
from app.providers.echo import EchoProvider
from app.providers.openai_compatible import OpenAICompatibleProvider
from app.providers.registry import get_provider

# These monkeypatch app.providers.registry.get_settings with an explicitly-constructed
# Settings instance rather than reading the real deployment's env vars — deliberately,
# so the fallback-priority *logic* is tested deterministically regardless of whether
# this particular environment happens to have a real provider key configured (e.g. a
# dev box with OPENROUTER_API_KEY set for real use must not make this test flaky).


def test_get_provider_falls_back_to_echo_with_no_keys_configured(monkeypatch):
    fake_settings = Settings(groq_api_key=None, openrouter_api_key=None)
    monkeypatch.setattr(registry_module, "get_settings", lambda: fake_settings)

    provider, model = get_provider()
    assert isinstance(provider, EchoProvider)
    assert model == "echo-dev"


def test_get_provider_uses_openrouter_when_only_that_is_configured(monkeypatch):
    fake_settings = Settings(
        groq_api_key=None, openrouter_api_key="fake-or-key", openrouter_model="some/model"
    )
    monkeypatch.setattr(registry_module, "get_settings", lambda: fake_settings)

    provider, model = get_provider()
    assert isinstance(provider, OpenAICompatibleProvider)
    assert provider.base_url == "https://openrouter.ai/api/v1"
    assert provider.api_key == "fake-or-key"  # unwrapped from SecretStr, not leaked in repr
    assert model == "some/model"


def test_get_provider_prefers_groq_over_openrouter_when_both_configured(monkeypatch):
    fake_settings = Settings(
        groq_api_key="fake-groq-key", groq_model="llama-x", openrouter_api_key="fake-or-key"
    )
    monkeypatch.setattr(registry_module, "get_settings", lambda: fake_settings)

    provider, model = get_provider()
    assert isinstance(provider, OpenAICompatibleProvider)
    assert provider.base_url == "https://api.groq.com/openai/v1"
    assert model == "llama-x"


def test_get_provider_prefers_byok_anthropic_over_everything(monkeypatch):
    fake_settings = Settings(groq_api_key="fake-groq-key", openrouter_api_key="fake-or-key")
    monkeypatch.setattr(registry_module, "get_settings", lambda: fake_settings)

    provider, model = get_provider(byok_anthropic_key="fake-anthropic-key")
    assert isinstance(provider, AnthropicProvider)


def test_settings_repr_never_exposes_the_actual_secret_value():
    # Regression test: pydantic's default repr used to print API keys and the MinIO
    # secret in plain text, which is exactly what leaked one into a test failure
    # message during development. SecretStr keeps them out of repr/str entirely.
    settings = Settings(groq_api_key="super-secret-value")
    assert "super-secret-value" not in repr(settings)
    assert "super-secret-value" not in str(settings)


async def test_echo_provider_streams_expected_content():
    provider = EchoProvider()
    message = "what is a derivative?"

    events = [e async for e in provider.stream_chat([ChatTurn(role="user", content=message)], "echo-dev")]

    assert all(isinstance(e, TextDelta) for e in events)
    full = "".join(e.text for e in events)
    assert full == f"[echo/no-provider-configured] you said: {message} "


async def test_echo_provider_handles_no_user_message():
    provider = EchoProvider()

    events = [
        e async for e in provider.stream_chat([ChatTurn(role="system", content="setup only")], "echo-dev")
    ]

    full = "".join(e.text for e in events)
    assert full == "[echo/no-provider-configured] (empty message) "


async def test_echo_provider_never_calls_tools_even_when_offered():
    from app.providers.base import ToolSpec

    provider = EchoProvider()
    tools = [ToolSpec(name="calculator", description="test", parameters={"type": "object"})]

    events = [
        e async for e in provider.stream_chat([ChatTurn(role="user", content="2+2")], "echo-dev", tools=tools)
    ]

    assert all(isinstance(e, TextDelta) for e in events)


# ---- OpenAICompatibleProvider.stream_chat: mocked-transport SSE parsing, incl. the
# stream_options usage chunk this provider needs for app/services/billing.py's
# credit-ledger math (see app/agents/tutor.py's is_frontier accounting). ----------------


def _mock_transport(handler):
    return httpx.MockTransport(handler)


async def test_stream_chat_requests_usage_and_captures_it_after_text_deltas():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = request.content.decode()
        body = (
            'data: {"choices": [{"delta": {"content": "Hi"}}]}\n\n'
            'data: {"choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 3}}\n\n'
            "data: [DONE]\n\n"
        )
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    provider = OpenAICompatibleProvider(
        base_url="https://example.test/v1", api_key="key", transport=_mock_transport(handler)
    )
    assert provider.last_usage is None  # nothing sent yet

    events = [e async for e in provider.stream_chat([ChatTurn(role="user", content="hi")], "some-model")]

    assert len(events) == 1
    assert isinstance(events[0], TextDelta)
    assert events[0].text == "Hi"
    assert '"include_usage":true' in seen["body"]
    assert provider.last_usage == {"prompt_tokens": 12, "completion_tokens": 3}


async def test_stream_chat_handles_tool_calls_alongside_a_trailing_usage_chunk():
    def handler(request: httpx.Request) -> httpx.Response:
        body = (
            'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_1", '
            '"type": "function", "function": {"name": "calculator", "arguments": ""}}]}}]}\n\n'
            'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": '
            '{"arguments": "{\\"expression\\": \\"2+2\\"}"}}]}}]}\n\n'
            'data: {"choices": [], "usage": {"prompt_tokens": 5, "completion_tokens": 1}}\n\n'
            "data: [DONE]\n\n"
        )
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    provider = OpenAICompatibleProvider(
        base_url="https://example.test/v1", api_key="key", transport=_mock_transport(handler)
    )
    events = [e async for e in provider.stream_chat([ChatTurn(role="user", content="2+2?")], "some-model")]

    assert len(events) == 1
    assert isinstance(events[0], ToolCallRequest)
    assert events[0].calls[0].name == "calculator"
    assert events[0].calls[0].arguments == {"expression": "2+2"}
    assert provider.last_usage == {"prompt_tokens": 5, "completion_tokens": 1}


async def test_stream_chat_resets_last_usage_at_the_start_of_every_call():
    def handler_with_usage(request: httpx.Request) -> httpx.Response:
        body = 'data: {"choices": [], "usage": {"prompt_tokens": 1, "completion_tokens": 1}}\n\ndata: [DONE]\n\n'
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    def handler_without_usage(request: httpx.Request) -> httpx.Response:
        body = 'data: {"choices": [{"delta": {"content": "ok"}}]}\n\ndata: [DONE]\n\n'
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    provider = OpenAICompatibleProvider(
        base_url="https://example.test/v1", api_key="key", transport=_mock_transport(handler_with_usage)
    )
    _ = [e async for e in provider.stream_chat([ChatTurn(role="user", content="hi")], "m")]
    assert provider.last_usage == {"prompt_tokens": 1, "completion_tokens": 1}

    provider._transport = _mock_transport(handler_without_usage)
    _ = [e async for e in provider.stream_chat([ChatTurn(role="user", content="hi again")], "m")]
    assert provider.last_usage is None  # this response never sent a usage chunk
