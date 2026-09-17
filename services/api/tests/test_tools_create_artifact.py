"""Tests for the Artifacts feature (app/tools/create_artifact.py + app/services/
artifact_build.py).

Follows tests/test_gamification.py's conventions: throwaway `User` rows created and
deleted per test, never student1's real data, and every row this suite creates is
removed again in the fixture's teardown -- including the MinIO object and the
DocumentChunk rows an artifact Document brings with it.

The provider call (the persona stage) and the artifact-runner call (the opencode stage)
are both substituted here -- a unit test must not spend real money or take three minutes.
The REAL end-to-end path (a real persona call, a real opencode run inside the real
container, real HTML, a real stored Document) is exercised by the `live_smoke`-marked
test at the bottom, the same split this codebase already uses for sandbox-runner and the
OpenRouter catalog.
"""

import uuid

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.db.models import Document, DocumentChunk, User
from app.providers.base import TextDelta
from app.services import artifact_build
from app.tools import create_artifact as artifact_tool
from app.tools.create_artifact import (
    ARTIFACT_KINDS,
    FOCUS_MODE_MESSAGE,
    NO_CREDIT_MESSAGE,
    PRO_ONLY_MESSAGE,
    CreateArtifactTool,
    _parse_brief,
    _sanitize_filename,
)

VALID_HTML = (
    "<!DOCTYPE html><html><head><style>body{font-family:system-ui}</style></head>"
    "<body><h1>Nitrogen Cycle</h1><script>document.title='x'</script></body></html>"
)


# ---------------------------------------------------------------------------
# Fixtures: throwaway users only.
# ---------------------------------------------------------------------------


async def _cleanup_user(db_session, user_id: uuid.UUID) -> None:
    doc_ids = (
        (await db_session.execute(select(Document.id).where(Document.user_id == user_id)))
        .scalars()
        .all()
    )
    if doc_ids:
        await db_session.execute(delete(DocumentChunk).where(DocumentChunk.document_id.in_(doc_ids)))
    await db_session.execute(delete(Document).where(Document.user_id == user_id))
    await db_session.execute(delete(User).where(User.id == user_id))
    await db_session.commit()


@pytest_asyncio.fixture
async def pro_user(db_session):
    """A Pro user with real credit left -- the only shape that reaches a real build."""
    user = User(
        keycloak_sub=f"test-artifact-pro-{uuid.uuid4()}",
        plan="pro",
        credits_used_cents=0,
        topup_credits_cents=0,
    )
    db_session.add(user)
    await db_session.flush()
    await db_session.commit()
    yield user
    await _cleanup_user(db_session, user.id)


@pytest_asyncio.fixture
async def free_user(db_session):
    user = User(keycloak_sub=f"test-artifact-free-{uuid.uuid4()}", plan="free")
    db_session.add(user)
    await db_session.flush()
    await db_session.commit()
    yield user
    await _cleanup_user(db_session, user.id)


class _FakeProvider:
    """Stands in for a real OpenRouter stream_chat, including the `last_usage` attribute
    app/providers/openai_compatible.py sets and the tool's metering reads."""

    def __init__(self, text: str, usage: dict | None = None):
        self._text = text
        self.last_usage = usage if usage is not None else {"prompt_tokens": 800, "completion_tokens": 400}
        self.calls: list[list] = []

    async def stream_chat(self, messages, model, tools=None):
        self.calls.append(messages)
        yield TextDelta(self._text)


def _patch_pipeline(monkeypatch, *, brief_text: str, build_result: artifact_build.ArtifactBuildResult):
    provider = _FakeProvider(brief_text)
    monkeypatch.setattr(artifact_tool, "get_provider", lambda: (provider, "deepseek/deepseek-v4-flash-0731"))

    calls: list[tuple[str, str]] = []

    async def fake_build(brief: str, model: str, transport=None):
        calls.append((brief, model))
        return build_result

    monkeypatch.setattr(artifact_tool, "build_artifact", fake_build)

    charged: list[tuple] = []

    async def fake_record(user_id, model_id, prompt_tokens, completion_tokens):
        charged.append((user_id, model_id, prompt_tokens, completion_tokens))
        return 7

    monkeypatch.setattr(artifact_tool.billing_service, "record_frontier_usage", fake_record)
    return provider, calls, charged


def _ok_result(html: str = VALID_HTML) -> artifact_build.ArtifactBuildResult:
    return artifact_build.ArtifactBuildResult(
        html=html,
        success=True,
        timed_out=False,
        log="ok",
        input_tokens=11000,
        output_tokens=2400,
        attempts=1,
        problems=[],
    )


# ---------------------------------------------------------------------------
# Pure helpers.
# ---------------------------------------------------------------------------


def test_parse_brief_extracts_the_title_line_and_strips_it_from_the_brief():
    title, brief = _parse_brief("TITLE: Nitrogen Cycle\n\nWHO: a bio student.", "diagram", "fallback")
    assert title == "Nitrogen Cycle"
    assert brief == "WHO: a bio student."
    assert "TITLE:" not in brief


def test_parse_brief_falls_back_to_the_students_own_words_with_no_title_line():
    title, brief = _parse_brief("WHO: a bio student.", "diagram", "the nitrogen cycle please")
    assert title == "the nitrogen cycle please"
    assert brief == "WHO: a bio student."


def test_sanitize_filename_strips_path_separators_from_a_model_supplied_title():
    assert "/" not in _sanitize_filename("../../etc/passwd")
    assert "\\" not in _sanitize_filename("a\\b")
    assert _sanitize_filename("") == "artifact"


def test_every_declared_kind_has_a_real_distinct_persona_prompt():
    prompts = {k: artifact_tool._PERSONA_PROMPTS[k] for k in ARTIFACT_KINDS}
    assert len(prompts) == 4
    # Genuinely distinct, not a template with the kind name substituted in.
    assert len(set(prompts.values())) == 4
    for kind, prompt in prompts.items():
        assert len(prompt) > 1500, f"{kind} persona is too thin to be real expertise"
        assert "TITLE:" in prompt  # every persona carries the shared output contract


def test_personas_encode_kind_specific_expertise_not_generic_filler():
    p = artifact_tool._PERSONA_PROMPTS
    assert "zero" in p["chart"].lower()  # bar charts start at zero
    assert "arrow" in p["diagram"].lower()  # arrows are claims
    assert "slide" in p["slideshow"].lower()
    assert "slider" in p["interactive"].lower()
    # ...and each one's specific rule is NOT in the others.
    assert "bar charts start at zero" in p["chart"].lower()
    assert "bar charts start at zero" not in p["diagram"].lower()


# ---------------------------------------------------------------------------
# Gating -- the real, established mechanism, not a new one.
# ---------------------------------------------------------------------------


async def test_free_plan_is_refused_with_the_pro_only_message(free_user, monkeypatch):
    _, calls, charged = _patch_pipeline(monkeypatch, brief_text="x", build_result=_ok_result())
    result = await CreateArtifactTool().run(kind="diagram", prompt="the nitrogen cycle", user_id=str(free_user.id))
    assert result == PRO_ONLY_MESSAGE
    # Nothing was spent: no persona call, no build, no charge.
    assert calls == []
    assert charged == []


async def test_focus_mode_is_refused_even_for_a_pro_user(pro_user, db_session, monkeypatch):
    pro_user.focus_mode_enabled = True
    await db_session.commit()
    _, calls, charged = _patch_pipeline(monkeypatch, brief_text="x", build_result=_ok_result())

    result = await CreateArtifactTool().run(kind="chart", prompt="plot this", user_id=str(pro_user.id))
    assert result == FOCUS_MODE_MESSAGE
    assert calls == []
    assert charged == []


async def test_pro_user_with_no_credit_left_is_refused_before_spending(pro_user, db_session, monkeypatch):
    from app.core.config import get_settings

    pro_user.credits_used_cents = get_settings().pro_monthly_credit_cents + 1
    pro_user.topup_credits_cents = 0
    await db_session.commit()
    _, calls, charged = _patch_pipeline(monkeypatch, brief_text="x", build_result=_ok_result())

    result = await CreateArtifactTool().run(kind="chart", prompt="plot this", user_id=str(pro_user.id))
    assert result == NO_CREDIT_MESSAGE
    assert calls == []


async def test_an_unknown_kind_is_refused_before_any_work():
    result = await CreateArtifactTool().run(kind="sculpture", prompt="x", user_id=str(uuid.uuid4()))
    assert "unsupported artifact kind" in result


async def test_no_user_id_is_an_honest_error():
    assert "no signed-in user" in await CreateArtifactTool().run(kind="diagram", prompt="x")


# ---------------------------------------------------------------------------
# The happy path: persona -> brief -> build -> stored Document -> fenced block.
# ---------------------------------------------------------------------------


async def test_successful_build_stores_a_real_artifact_document_and_returns_a_fenced_block(
    pro_user, db_session, monkeypatch
):
    provider, calls, charged = _patch_pipeline(
        monkeypatch,
        brief_text="TITLE: Nitrogen Cycle\n\nWHO: a first-year bio student.",
        build_result=_ok_result(),
    )

    result = await CreateArtifactTool().run(
        kind="diagram", prompt="show me the nitrogen cycle", user_id=str(pro_user.id)
    )

    # The persona ran, with the kind's own system prompt.
    assert len(provider.calls) == 1
    assert provider.calls[0][0].role == "system"
    assert provider.calls[0][0].content == artifact_tool._PERSONA_PROMPTS["diagram"]
    assert provider.calls[0][1].content == "show me the nitrogen cycle"

    # The brief -- not the raw student prompt -- is what reached the coding agent.
    assert len(calls) == 1
    built_brief, built_model = calls[0]
    assert "first-year bio student" in built_brief
    assert "TITLE:" not in built_brief
    assert built_model == "deepseek/deepseek-v4-flash-0731"

    # A real Document row, kind="artifact", with the real HTML bytes in MinIO.
    doc = (
        await db_session.execute(select(Document).where(Document.user_id == pro_user.id))
    ).scalar_one()
    assert doc.kind == "artifact"
    assert doc.filename == "Nitrogen Cycle.html"
    assert doc.mime_type == "text/html"

    from app.services.documents import get_document_raw

    assert (await get_document_raw(doc)).decode("utf-8") == VALID_HTML

    # The tool result is the fenced block the Tutor relays verbatim, carrying only the id.
    assert result.startswith("```newton-artifact\n")
    assert result.endswith("\n```")
    import json

    payload = json.loads(result.removeprefix("```newton-artifact\n").removesuffix("\n```"))
    assert payload["document_id"] == str(doc.id)
    assert payload["title"] == "Nitrogen Cycle"
    assert payload["kind"] == "diagram"
    assert VALID_HTML not in result  # the page itself never goes back into the model's context


async def test_the_rag_text_is_a_description_not_the_markup(pro_user, db_session, monkeypatch):
    _patch_pipeline(
        monkeypatch,
        brief_text="TITLE: Nitrogen Cycle\n\nWHO: a first-year bio student.",
        build_result=_ok_result(),
    )
    await CreateArtifactTool().run(kind="diagram", prompt="nitrogen cycle", user_id=str(pro_user.id))

    doc = (await db_session.execute(select(Document).where(Document.user_id == pro_user.id))).scalar_one()
    chunks = (
        (await db_session.execute(select(DocumentChunk).where(DocumentChunk.document_id == doc.id)))
        .scalars()
        .all()
    )
    assert chunks, "an artifact should still be retrievable via RAG in a later session"
    joined = "\n".join(c.content for c in chunks)
    assert "first-year bio student" in joined
    assert "<style>" not in joined  # the markup is deliberately NOT what gets indexed


async def test_real_token_spend_is_charged_to_the_credit_ledger(pro_user, monkeypatch):
    _, _, charged = _patch_pipeline(
        monkeypatch, brief_text="TITLE: T\n\nbrief", build_result=_ok_result()
    )
    await CreateArtifactTool().run(kind="chart", prompt="plot it", user_id=str(pro_user.id))

    assert len(charged) == 1
    user_id, model_id, prompt_tokens, completion_tokens = charged[0]
    assert user_id == pro_user.id
    # BOTH stages are billed: the persona call (800/400) plus the agent run (11000/2400).
    assert prompt_tokens == 800 + 11000
    assert completion_tokens == 400 + 2400


async def test_a_failed_build_still_charges_what_was_really_spent(pro_user, db_session, monkeypatch):
    failed = artifact_build.ArtifactBuildResult(
        html=None,
        success=False,
        timed_out=False,
        log="agent log",
        input_tokens=5000,
        output_tokens=900,
        attempts=2,
        problems=["The file references at least one external URL."],
    )
    _, _, charged = _patch_pipeline(monkeypatch, brief_text="TITLE: T\n\nbrief", build_result=failed)

    result = await CreateArtifactTool().run(kind="chart", prompt="plot it", user_id=str(pro_user.id))

    # Honest failure, surfacing the validator's real complaint -- never a false success.
    assert "didn't pass validation" in result
    assert "external URL" in result
    assert not result.startswith("```newton-artifact")
    # ...and those tokens really were billed to this app by OpenRouter, so they're charged.
    assert charged[0][2] == 800 + 5000
    # No Document row for a build that never produced anything.
    assert (
        await db_session.execute(select(Document).where(Document.user_id == pro_user.id))
    ).scalars().all() == []


async def test_a_timeout_is_reported_as_a_timeout_not_a_validation_failure(pro_user, monkeypatch):
    timed_out = artifact_build.ArtifactBuildResult(
        html=None, success=False, timed_out=True, log="", input_tokens=0, output_tokens=0, attempts=1
    )
    _patch_pipeline(monkeypatch, brief_text="TITLE: T\n\nbrief", build_result=timed_out)
    result = await CreateArtifactTool().run(kind="slideshow", prompt="explain", user_id=str(pro_user.id))
    assert "ran out of time" in result


# ---------------------------------------------------------------------------
# The artifact-runner client: never raises, same contract as latex_compile.
# ---------------------------------------------------------------------------


async def test_build_artifact_parses_a_real_response():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/build-artifact"
        import json as _json

        body = _json.loads(request.content)
        assert body["brief"] == "the brief"
        assert body["model"] == "deepseek/deepseek-v4-flash-0731"
        return httpx.Response(
            200,
            json={
                "html": VALID_HTML,
                "success": True,
                "timed_out": False,
                "log": "l",
                "input_tokens": 12,
                "output_tokens": 3,
                "attempts": 1,
                "problems": [],
            },
        )

    result = await artifact_build.build_artifact(
        "the brief", "deepseek/deepseek-v4-flash-0731", transport=httpx.MockTransport(handler)
    )
    assert result.success is True
    assert result.html == VALID_HTML
    assert (result.input_tokens, result.output_tokens) == (12, 3)


async def test_build_artifact_never_raises_on_a_transport_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    result = await artifact_build.build_artifact(
        "b", "m", transport=httpx.MockTransport(handler)
    )
    assert result.success is False
    assert result.html is None
    assert "could not reach artifact-runner" in result.log


async def test_build_artifact_never_raises_on_a_5xx():
    result = await artifact_build.build_artifact(
        "b", "m", transport=httpx.MockTransport(lambda r: httpx.Response(500))
    )
    assert result.success is False
    assert result.timed_out is False


# ---------------------------------------------------------------------------
# The real thing. Excluded from the hermetic CI run -- it spends real money and takes
# minutes. See pytest.ini's `live_smoke` marker.
# ---------------------------------------------------------------------------


@pytest.mark.live_smoke
async def test_live_real_artifact_build_end_to_end(pro_user, db_session):
    """A REAL persona call and a REAL opencode run in the real artifact-runner container,
    producing real HTML stored as a real Document row. No mocks anywhere."""
    result = await CreateArtifactTool().run(
        kind="diagram",
        prompt="Show the three parts of a neuron - dendrites, cell body, axon - and what each does.",
        user_id=str(pro_user.id),
    )
    assert result.startswith("```newton-artifact\n"), result

    doc = (await db_session.execute(select(Document).where(Document.user_id == pro_user.id))).scalar_one()
    assert doc.kind == "artifact"

    from app.services.documents import get_document_raw

    html = (await get_document_raw(doc)).decode("utf-8")
    assert "<html" in html.lower()
    assert "<!doctype" in html.lower()
    assert len(html) > 500

    # Genuinely self-contained. Checked the way the runner's own validator checks it --
    # by looking for an external RESOURCE reference -- not by grepping for the substring
    # "http://", which a first draft of this test did and which false-failed on
    # `xmlns="http://www.w3.org/2000/svg"`: the SVG namespace URI is an identifier, never
    # fetched, and appears in essentially every inline SVG ever written.
    import re as _re

    assert not _re.search(r"""(?:src|href)\s*=\s*["']\s*(?:https?:)?//""", html, _re.IGNORECASE)
    assert not _re.search(r"""url\(\s*["']?\s*(?:https?:)?//""", html, _re.IGNORECASE)
    assert not _re.search(r"\b(?:fetch\s*\(|XMLHttpRequest|importScripts\s*\()", html)
    # And nothing that would throw inside the app's sandbox="allow-scripts" iframe.
    assert not _re.search(r"\b(?:localStorage|sessionStorage|document\.cookie)\b", html)
