"""Tests for app.tools.deep_research.DeepResearchTool -- a brand-new, STANDALONE
research tool that shares no code path with app/tools/write_research_paper.py (see that
module's own docstring for the full separation argument). Follows
tests/test_write_research_paper_tool.py's own convention: real DB (Postgres), real
document-upload pipeline, but every external network boundary (the direct provider call,
and -- except in the one live_smoke test -- web_search/research_fetch) is mocked.

Section on proving true separation from write_research_paper.py, not just asserting it:
test_deep_research_module_never_imports_paper_machinery does a real import-graph
assertion (static AST parse of the module source, not "it happened not to crash"), and
test_deep_research_never_triggers_a_latex_compile monkeypatches
app.services.latex_compile.compile_latex to raise if it's ever called during a real,
successful deep_research run.
"""

import ast
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.db.models import Document, User
from app.providers.base import ChatProvider, ChatTurn, StreamEvent, TextDelta, ToolSpec
from app.services import documents as documents_service
from app.tools import deep_research as dr
from app.tools.deep_research import DeepResearchTool, FetchedSource

_GROUNDING_REAL_SOURCE_TEXT = (
    "Global installed solar photovoltaic capacity reached approximately 1,600 gigawatts "
    "by the end of 2023, roughly quadrupling over the preceding six years, driven by "
    "falling module prices and supportive government policy."
)


class _FakeReportProvider(ChatProvider):
    """Scripted single-shot provider double -- deep_research makes exactly ONE direct
    provider call (no per-section fan-out, unlike write_research_paper.py's
    _draft_section), so this just returns one fixed reply regardless of the prompt."""

    def __init__(self, reply: str):
        self._reply = reply
        self.prompts_seen: list[str] = []

    async def stream_chat(
        self, messages: list[ChatTurn], model: str, tools: list[ToolSpec] | None = None
    ) -> AsyncIterator[StreamEvent]:
        self.prompts_seen.append(messages[0].content)
        yield TextDelta(self._reply)


@pytest_asyncio.fixture
async def research_user(db_session):
    # plan="pro": deep_research is gated to Pro (see PRO_ONLY_MESSAGE), same pattern as
    # write_research_paper's own paper_user fixture.
    user = User(keycloak_sub=f"test-deep-research-{uuid.uuid4()}", plan="pro")
    db_session.add(user)
    await db_session.commit()

    yield user

    docs = (await db_session.execute(select(Document).where(Document.user_id == user.id))).scalars().all()
    for doc in docs:
        await documents_service.delete_document(db_session, doc)
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


# ---------------------------------------------------------------------------
# Real separation from write_research_paper.py -- proven, not just asserted.
# ---------------------------------------------------------------------------


def test_deep_research_module_never_imports_paper_machinery():
    """Static AST assertion, not a behavioral coincidence: deep_research.py's own
    import statements never name app.services.paper_templates, app.services.
    bibliography, or app.services.latex_compile, anywhere (plain `import x`, `from x
    import y`, or a submodule of x)."""
    source = Path(dr.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source, filename=dr.__file__)
    banned = ("paper_templates", "bibliography", "latex_compile")

    imported_names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported_names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported_names.add(node.module)

    for name in imported_names:
        for banned_name in banned:
            assert banned_name not in name, f"deep_research.py must not import {name!r} (contains {banned_name!r})"


async def test_deep_research_never_triggers_a_latex_compile(research_user, monkeypatch):
    """Runtime companion to the static import-graph test above: even a real, successful
    deep_research call never reaches app.services.latex_compile.compile_latex."""
    import app.services.latex_compile as latex_compile_module

    def _fail_if_called(*args, **kwargs):
        raise AssertionError("deep_research must never compile LaTeX")

    monkeypatch.setattr(latex_compile_module, "compile_latex", _fail_if_called)

    sources = [
        FetchedSource(key="s1", url="https://en.wikipedia.org/wiki/Solar_A", title="Solar Report", text=_GROUNDING_REAL_SOURCE_TEXT, truncated=False),
        FetchedSource(key="s2", url="https://en.wikipedia.org/wiki/Solar_B", title="Solar History", text=_GROUNDING_REAL_SOURCE_TEXT, truncated=False),
    ]

    async def fake_gather(topic, *, session_id, user_id):
        return sources

    monkeypatch.setattr(dr, "_gather_sources", fake_gather)
    fake_provider = _FakeReportProvider("Solar capacity is growing \\cite{s1}.")
    monkeypatch.setattr(dr, "get_provider", lambda **kwargs: (fake_provider, "fake-model"))

    result = await DeepResearchTool().run(topic="solar power", user_id=str(research_user.id))
    assert result.startswith('Deep research on "solar power"')


def test_deep_research_is_registered_alongside_write_research_paper():
    from app.tools.registry import get_tool_specs

    names = {t.name for t in get_tool_specs()}
    assert "deep_research" in names
    assert "write_research_paper" in names  # both coexist, neither replaces the other


# ---------------------------------------------------------------------------
# Pure functions
# ---------------------------------------------------------------------------


def test_extract_candidate_sources_keeps_only_allowlisted_https_urls():
    search_text = (
        "Search results for 'x':\n"
        "1. Wikipedia: Photosynthesis\n"
        "   https://en.wikipedia.org/wiki/Photosynthesis\n"
        "   A snippet about photosynthesis.\n"
        "2. Some Blog\n"
        "   https://not-allowlisted-example.com/post\n"
        "   Not allowlisted.\n"
        "3. arXiv Paper\n"
        "   https://arxiv.org/abs/1234.5678\n"
        "   An abstract.\n"
    )
    candidates = dr._extract_candidate_sources(search_text, limit=10)
    urls = [url for _title, url in candidates]
    assert "https://en.wikipedia.org/wiki/Photosynthesis" in urls
    assert "https://arxiv.org/abs/1234.5678" in urls
    assert not any("not-allowlisted-example.com" in u for u in urls)


def test_extract_candidate_sources_dedupes_and_respects_limit():
    search_text = (
        "Search results for 'x':\n"
        "1. A\n   https://en.wikipedia.org/wiki/A\n   snippet\n"
        "2. A again\n   https://en.wikipedia.org/wiki/A\n   snippet\n"
        "3. B\n   https://en.wikipedia.org/wiki/B\n   snippet\n"
    )
    candidates = dr._extract_candidate_sources(search_text, limit=1)
    assert len(candidates) == 1
    assert candidates[0][1] == "https://en.wikipedia.org/wiki/A"


def test_sanitize_filename_strips_unsafe_characters_and_bounds_length():
    assert dr._sanitize_filename("What/is: the *evidence*?") == "Whatis the evidence"
    assert dr._sanitize_filename("   ") == "deep-research"
    assert len(dr._sanitize_filename("x" * 200)) <= 80


def test_rewrite_citations_for_display_maps_known_keys_to_numbers_and_flags_unknown():
    sources = [
        FetchedSource(key="s1", url="https://en.wikipedia.org/wiki/A", title="A", text="t", truncated=False),
        FetchedSource(key="s2", url="https://en.wikipedia.org/wiki/B", title="B", text="t", truncated=False),
    ]
    prose = "First claim \\cite{s1}. Second claim \\cite{s2}. Bogus claim \\cite{ghost}."
    rewritten = dr._rewrite_citations_for_display(prose, sources)
    assert "[1]" in rewritten
    assert "[2]" in rewritten
    assert "[unverified citation]" in rewritten
    assert "\\cite" not in rewritten


def test_sources_footer_is_built_only_from_real_fetched_sources():
    sources = [
        FetchedSource(key="s1", url="https://en.wikipedia.org/wiki/A", title="Source A", text="t", truncated=False),
        FetchedSource(key="s2", url="https://en.wikipedia.org/wiki/B", title="Source B", text="t", truncated=False),
    ]
    footer = dr._sources_footer(sources)
    assert footer.startswith("## Sources consulted")
    assert "1. Source A — https://en.wikipedia.org/wiki/A" in footer
    assert "2. Source B — https://en.wikipedia.org/wiki/B" in footer


def test_grounding_sources_with_hallucination_check_adds_zero_url_entry_for_unknown_keys():
    sources = [FetchedSource(key="s1", url="https://en.wikipedia.org/wiki/A", title="A", text="t", truncated=False)]
    prose = "Real claim \\cite{s1}. Invented claim \\cite{ghost}."
    grounding_sources = dr._grounding_sources_with_hallucination_check(prose, sources)
    by_key = {s["key"]: s for s in grounding_sources}
    assert by_key["s1"]["url"] == "https://en.wikipedia.org/wiki/A"
    assert by_key["ghost"]["url"] == ""


# ---------------------------------------------------------------------------
# Validation / gating
# ---------------------------------------------------------------------------


async def test_run_rejects_missing_user():
    result = await DeepResearchTool().run(topic="anything", user_id=None)
    assert result.startswith("Error:")


async def test_run_rejects_empty_topic(research_user):
    result = await DeepResearchTool().run(topic="   ", user_id=str(research_user.id))
    assert result.startswith("Error:")


async def test_run_rejects_a_free_plan_user_before_any_web_call(db_session, monkeypatch):
    """deep_research is gated to Pro (see PRO_ONLY_MESSAGE) -- real, non-free cost: a
    real web_search + up to CANDIDATE_URL_LIMIT research_fetch calls + one direct
    provider call. A free-plan user gets a clear message, and _gather_sources (the only
    place this tool makes a real web call) must never even be reached."""
    user = User(keycloak_sub=f"test-deep-research-free-{uuid.uuid4()}", plan="free")
    db_session.add(user)
    await db_session.commit()
    try:
        def _fail_if_called(*args, **kwargs):
            raise AssertionError("must not gather real web sources for a free-tier user")

        monkeypatch.setattr(dr, "_gather_sources", _fail_if_called)

        result = await DeepResearchTool().run(topic="anything", user_id=str(user.id))

        assert result == dr.PRO_ONLY_MESSAGE
        assert not result.startswith("Error:")
    finally:
        await db_session.execute(delete(User).where(User.id == user.id))
        await db_session.commit()


async def test_run_refuses_with_fewer_than_two_real_sources_and_never_calls_the_provider(
    research_user, monkeypatch
):
    """Mirrors app/services/synthesis.py's synthesize_sources' own discipline: fewer
    than MIN_SOURCES_REQUIRED real fetched sources -> an honest refusal, and the
    provider is NEVER called (no fabricated report from too little material)."""

    async def fake_gather(topic, *, session_id, user_id):
        return [
            FetchedSource(
                key="s1", url="https://en.wikipedia.org/wiki/Only", title="Only One Source",
                text="some real fetched text", truncated=False,
            )
        ]

    monkeypatch.setattr(dr, "_gather_sources", fake_gather)

    def _fail_if_called(**kwargs):
        raise AssertionError("must not call the LLM with fewer than two real sources")

    monkeypatch.setattr(dr, "get_provider", _fail_if_called)

    result = await DeepResearchTool().run(topic="a narrow topic", user_id=str(research_user.id))
    assert "couldn't find enough real material" in result.lower()
    assert "Only One Source" in result


async def test_run_honest_message_with_zero_sources_found(research_user, monkeypatch):
    async def fake_gather(topic, *, session_id, user_id):
        return []

    monkeypatch.setattr(dr, "_gather_sources", fake_gather)

    def _fail_if_called(**kwargs):
        raise AssertionError("must not call the LLM with zero real sources")

    monkeypatch.setattr(dr, "get_provider", _fail_if_called)

    result = await DeepResearchTool().run(topic="an obscure topic", user_id=str(research_user.id))
    assert "couldn't find enough real material" in result.lower()


# ---------------------------------------------------------------------------
# Full success path -- one grounded + one ungrounded citation, real Document row.
# ---------------------------------------------------------------------------


async def test_run_writes_a_report_and_creates_a_real_document_with_grounding(
    research_user, db_session, monkeypatch
):
    sources = [
        FetchedSource(
            key="s1", url="https://en.wikipedia.org/wiki/Solar_A", title="Solar Capacity Report",
            text=_GROUNDING_REAL_SOURCE_TEXT, truncated=False,
        ),
        FetchedSource(
            key="s2", url="https://en.wikipedia.org/wiki/Solar_B", title="Solar History",
            text=_GROUNDING_REAL_SOURCE_TEXT, truncated=False,
        ),
    ]

    async def fake_gather(topic, *, session_id, user_id):
        return sources

    monkeypatch.setattr(dr, "_gather_sources", fake_gather)

    prose = (
        "Solar capacity has grown rapidly, quadrupling in six years to reach about 1,600 "
        "gigawatts, driven by cheaper panels and government policy \\cite{s1}. "
        "Solar panels were first invented in 1839 by Edmond Becquerel \\cite{s2}. "
        "An unsupported extra claim from nowhere \\cite{ghost}."
    )
    fake_provider = _FakeReportProvider(prose)
    monkeypatch.setattr(dr, "get_provider", lambda **kwargs: (fake_provider, "fake-model"))

    result = await DeepResearchTool().run(topic="solar power growth", user_id=str(research_user.id))

    assert result.startswith('Deep research on "solar power growth"')
    assert "2 real source(s)" in result
    assert "Citation grounding check" in result
    assert "Solar History" in result  # the ungrounded one, named honestly
    assert "don't correspond to a source Newton actually fetched" in result  # hallucinated "ghost"
    assert "[1]" in result and "[2]" in result
    assert "\\cite" not in result
    assert "## Sources consulted" in result
    assert "https://en.wikipedia.org/wiki/Solar_A" in result
    assert "https://en.wikipedia.org/wiki/Solar_B" in result

    docs = (await db_session.execute(select(Document).where(Document.user_id == research_user.id))).scalars().all()
    assert len(docs) == 1
    document = docs[0]
    assert document.filename.endswith(".md")
    assert document.mime_type == "text/markdown"

    saved_text = await documents_service.get_document_text(document)
    assert "## Sources consulted" in saved_text
    assert "https://en.wikipedia.org/wiki/Solar_A" in saved_text
    assert "[1]" in saved_text


async def test_run_reports_all_grounded_when_every_citation_is_supported(research_user, monkeypatch):
    sources = [
        FetchedSource(
            key="s1", url="https://en.wikipedia.org/wiki/Solar_A", title="Solar Capacity Report",
            text=_GROUNDING_REAL_SOURCE_TEXT, truncated=False,
        ),
    ]

    async def fake_gather(topic, *, session_id, user_id):
        return sources

    monkeypatch.setattr(dr, "_gather_sources", fake_gather)
    prose = (
        "Solar capacity has grown rapidly, quadrupling in six years to reach about 1,600 "
        "gigawatts, driven by cheaper panels and government policy \\cite{s1}."
    )
    monkeypatch.setattr(dr, "get_provider", lambda **kwargs: (_FakeReportProvider(prose), "fake-model"))

    result = await DeepResearchTool().run(topic="solar capacity growth", user_id=str(research_user.id))
    assert "all 1 checkable citation(s) were verified" in result


# ---------------------------------------------------------------------------
# Registry-level threading
# ---------------------------------------------------------------------------


async def test_run_tool_threads_user_id_through_to_deep_research(research_user, monkeypatch):
    from app.tools.registry import run_tool

    sources = [
        FetchedSource(key="s1", url="https://en.wikipedia.org/wiki/A", title="A", text="real text about a topic here", truncated=False),
        FetchedSource(key="s2", url="https://en.wikipedia.org/wiki/B", title="B", text="real text about a topic here", truncated=False),
    ]

    async def fake_gather(topic, *, session_id, user_id):
        return sources

    monkeypatch.setattr(dr, "_gather_sources", fake_gather)
    monkeypatch.setattr(dr, "get_provider", lambda **kwargs: (_FakeReportProvider("A claim \\cite{s1}."), "fake-model"))

    result = await run_tool(
        "deep_research", {"topic": "some topic"}, session_id="unused", user_id=str(research_user.id)
    )
    assert result.startswith('Deep research on "some topic"')


# ---------------------------------------------------------------------------
# Real, UNMOCKED web_search/research_fetch pipeline -- excluded from the hermetic CI
# run (see pytest.ini), meant to be run manually against the real deployed stack. Only
# the direct provider call is scripted (deterministic assertions), exactly like
# test_write_research_paper_tool.py's own live_smoke test mocks its section provider
# but leaves compile_latex live.
# ---------------------------------------------------------------------------


@pytest.mark.live_smoke
async def test_deep_research_real_end_to_end_pipeline(research_user, db_session, monkeypatch):
    captured: list[list[FetchedSource]] = []
    original_gather = dr._gather_sources

    async def _spy_gather(topic, *, session_id, user_id):
        result = await original_gather(topic, session_id=session_id, user_id=user_id)
        captured.append(result)
        return result

    monkeypatch.setattr(dr, "_gather_sources", _spy_gather)

    # s1 is guaranteed to be the first real source's key regardless of how many were
    # actually found (fetch order always starts at s1); s99 is guaranteed to never be a
    # real assigned key (MAX_SOURCES=6), so it's a deterministic hallucinated citation.
    fake_provider = _FakeReportProvider(
        "Photosynthesis converts light energy into chemical energy in plants \\cite{s1}. "
        "An invented, unsupported claim with no real source \\cite{s99}."
    )
    monkeypatch.setattr(dr, "get_provider", lambda **kwargs: (fake_provider, "fake-model"))

    result = await DeepResearchTool().run(
        topic="how does photosynthesis work in plants", user_id=str(research_user.id)
    )

    assert result.startswith("Deep research on"), result
    assert len(captured) == 1
    real_sources = captured[0]
    assert len(real_sources) >= dr.MIN_SOURCES_REQUIRED, "real web_search/research_fetch found too few real sources"

    assert "Citation grounding check" in result
    assert "don't correspond to a source Newton actually fetched" in result  # the s99 hallucination

    docs = (await db_session.execute(select(Document).where(Document.user_id == research_user.id))).scalars().all()
    assert len(docs) == 1
    document = docs[0]
    assert document.filename.endswith(".md")

    # The code-guaranteed footer matches EXACTLY what was actually fetched -- not a
    # subset, not something the model claimed.
    saved_text = await documents_service.get_document_text(document)
    assert "## Sources consulted" in saved_text
    for source in real_sources:
        assert source.url in saved_text
        assert source.title in saved_text
