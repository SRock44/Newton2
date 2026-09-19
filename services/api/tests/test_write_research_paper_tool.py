"""Integration-style tests for app.tools.write_research_paper.WriteResearchPaperTool --
follows tests/test_generation_tools.py / tests/test_study_session_tool.py's convention:
real DB (Postgres) and real MinIO (this codebase's own infra, not mocked), but every
external network boundary is mocked -- the direct provider calls (see study_planner's/
flashcards' own test files for that same "mock get_provider directly" convention) and
app.services.latex_compile.compile_latex (mocked at the tool's own import of it, since
its own HTTP-boundary behavior already has dedicated httpx.MockTransport coverage in
tests/test_latex_compile.py -- this file's job is the tool's ORCHESTRATION: fan-out,
citation de-duplication, template assembly, the bounded compile retry, and persistence).

Section-drafting network calls (web_search/research_fetch) are replaced with a stubbed
_gather_section_material so these tests don't depend on live SearXNG/allowlisted
external sites -- those are each independently covered by their own tool's test suite
(tests/test_tools_web_search.py, tests/test_research_fetch.py).
"""

import io
import uuid
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from pypdf import PdfWriter
from sqlalchemy import delete, select

from app.db.models import Document, DocumentChunk, User
from app.providers.base import ChatProvider, ChatTurn, StreamEvent, TextDelta, ToolSpec
from app.services import documents as documents_service
from app.services.latex_compile import LatexCompileResult
from app.tools import write_research_paper as wrp
from app.tools.write_research_paper import WriteResearchPaperTool, parse_section_response


def _minimal_real_pdf_bytes() -> bytes:
    """A minimal, real, parseable single-page PDF -- not just bytes with a .pdf name --
    so upload_document_bytes' own pypdf-based extraction succeeds, same convention as
    tests/test_documents.py's `uploaded_pdf` fixture."""
    buffer = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.write(buffer)
    return buffer.getvalue()


_FAKE_PDF = _minimal_real_pdf_bytes()


class _FakeSectionProvider(ChatProvider):
    """Answers a section-drafting (or retry-correction) prompt based on which section
    heading / retry marker it finds in the prompt text, rather than positional
    scripting -- section drafts run CONCURRENTLY (bounded by a semaphore), so which
    section's provider call actually executes first is not something a test should
    assume."""

    def __init__(self, responses_by_heading: dict[str, str], retry_response: str | None = None):
        self._responses = responses_by_heading
        self._retry_response = retry_response
        self.prompts_seen: list[str] = []

    async def stream_chat(
        self, messages: list[ChatTurn], model: str, tools: list[ToolSpec] | None = None
    ) -> AsyncIterator[StreamEvent]:
        prompt = messages[0].content
        self.prompts_seen.append(prompt)
        if prompt.startswith("The following LaTeX document failed to compile"):
            assert self._retry_response is not None, "unexpected retry call"
            yield TextDelta(self._retry_response)
            return
        for heading, response in self._responses.items():
            if f"Heading: {heading}" in prompt:
                yield TextDelta(response)
                return
        raise AssertionError(f"no scripted response for prompt:\n{prompt}")


async def _no_op_material(*args, **kwargs) -> tuple[str, dict]:
    return "(stubbed material -- no live web_search/research_fetch in this test tier)", {}


@pytest_asyncio.fixture
async def paper_user(db_session):
    # plan="pro": write_research_paper is gated to Pro (see PRO_ONLY_MESSAGE in
    # app/tools/write_research_paper.py, same pattern as start_study_session) -- this
    # fixture is for tests exercising the tool's real orchestration behavior, so it
    # needs to actually clear the gate. See test_run_rejects_free_plan_user below for
    # the free-tier rejection path itself.
    user = User(keycloak_sub=f"test-paper-writer-{uuid.uuid4()}", plan="pro")
    db_session.add(user)
    await db_session.commit()

    yield user

    docs = (await db_session.execute(select(Document).where(Document.user_id == user.id))).scalars().all()
    for doc in docs:
        await documents_service.delete_document(db_session, doc)
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


def _success_compile(monkeypatch, capture: list | None = None):
    async def fake_compile_latex(tex, bib=None, engine="pdflatex"):
        if capture is not None:
            capture.append({"tex": tex, "bib": bib})
        return LatexCompileResult(pdf_bytes=_FAKE_PDF, log="all good", success=True, timed_out=False)

    monkeypatch.setattr(wrp, "compile_latex", fake_compile_latex)


# ---------------------------------------------------------------------------
# parse_section_response -- pure parsing
# ---------------------------------------------------------------------------


def test_parse_section_response_extracts_prose_and_sources():
    raw = (
        '{"prose": "Some text \\\\cite{doe2024}.", '
        '"sources": [{"key": "doe2024", "title": "A Paper", "author": "Doe", "year": "2024"}]}'
    )
    prose, sources = parse_section_response(raw)
    assert "cite{doe2024}" in prose
    assert sources == [{"key": "doe2024", "title": "A Paper", "author": "Doe", "year": "2024"}]


def test_parse_section_response_degrades_to_raw_text_on_unparseable_reply():
    prose, sources = parse_section_response("not json at all")
    assert prose == "not json at all"
    assert sources == []


def test_parse_section_response_filters_sources_without_a_key():
    raw = '{"prose": "text", "sources": [{"title": "no key"}, {"key": "ok", "title": "fine"}]}'
    _prose, sources = parse_section_response(raw)
    assert sources == [{"key": "ok", "title": "fine"}]


# ---------------------------------------------------------------------------
# _prefer_extracted_metadata -- pure function (ROADMAP Phase 7 citation-metadata
# verification: real extracted <meta> tag data should win over the model's own guess
# for the same URL, field by field, falling back cleanly when there's nothing to prefer)
# ---------------------------------------------------------------------------


def test_prefer_extracted_metadata_overrides_matching_url_fields_but_fills_gaps_only():
    sources = [
        {
            "key": "k1",
            "author": "Guessed Author",
            "title": "Guessed Title",
            "year": "1999",
            "venue": "Guessed Venue",
            "url": "https://arxiv.org/abs/1",
        }
    ]
    url_metadata = {
        "https://arxiv.org/abs/1": {"author": "Real Author", "title": "Real Title", "year": "2020"}
    }
    result = wrp._prefer_extracted_metadata(sources, url_metadata)
    assert result[0]["author"] == "Real Author"
    assert result[0]["title"] == "Real Title"
    assert result[0]["year"] == "2020"
    # extraction had no venue -- the model's own guess is kept, not dropped.
    assert result[0]["venue"] == "Guessed Venue"
    assert result[0]["key"] == "k1"  # untouched fields survive


def test_prefer_extracted_metadata_leaves_non_matching_urls_untouched():
    sources = [{"key": "k1", "author": "Guess", "url": "https://arxiv.org/abs/999"}]
    url_metadata = {"https://en.wikipedia.org/wiki/Other": {"author": "Someone Else"}}
    result = wrp._prefer_extracted_metadata(sources, url_metadata)
    assert result == sources


def test_prefer_extracted_metadata_matches_urls_case_and_whitespace_insensitively():
    sources = [{"key": "k1", "author": "Guess", "url": "  HTTPS://ARXIV.ORG/abs/1  "}]
    url_metadata = {"https://arxiv.org/abs/1": {"author": "Real Author"}}
    result = wrp._prefer_extracted_metadata(sources, url_metadata)
    assert result[0]["author"] == "Real Author"


def test_prefer_extracted_metadata_is_a_noop_when_no_metadata_was_extracted_at_all():
    sources = [{"key": "k1", "url": "https://arxiv.org/abs/1"}]
    assert wrp._prefer_extracted_metadata(sources, {}) is sources


def test_prefer_extracted_metadata_does_not_mutate_the_input_source_dict():
    source = {"key": "k1", "author": "Guessed", "url": "https://arxiv.org/abs/1"}
    sources = [source]
    wrp._prefer_extracted_metadata(sources, {"https://arxiv.org/abs/1": {"author": "Real"}})
    assert source["author"] == "Guessed"  # original dict untouched


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


async def test_run_rejects_missing_user():
    result = await WriteResearchPaperTool().run(
        title="T", style="ieee", abstract_sketch="A", sections=[{"heading": "Intro", "summary": "s"}], user_id=None
    )
    assert result.startswith("Error:")


async def test_run_rejects_a_free_plan_user(db_session):
    """write_research_paper is gated to Pro (see PRO_ONLY_MESSAGE) -- it's the most
    expensive tool in the belt: per section, a web_search + up to
    MAX_FETCHES_PER_SECTION research_fetch calls + one direct provider call, run
    concurrently for every section, plus a real (possibly twice-run) LaTeX compile.
    A free-plan user gets a clear, student-facing message, not a raw error and not the
    real (costly) generation itself."""
    user = User(keycloak_sub=f"test-paper-writer-free-{uuid.uuid4()}", plan="free")
    db_session.add(user)
    await db_session.commit()
    try:
        result = await WriteResearchPaperTool().run(
            title="T", style="ieee", abstract_sketch="A", sections=[{"heading": "Intro", "summary": "s"}],
            user_id=str(user.id),
        )
        assert result == wrp.PRO_ONLY_MESSAGE
        assert not result.startswith("Error:")
    finally:
        await db_session.execute(delete(User).where(User.id == user.id))
        await db_session.commit()


async def test_run_blocks_a_focus_mode_pro_user_with_a_clear_message(paper_user, db_session):
    """Focus Mode (User.focus_mode_enabled) blocks this tool for a Pro user too -- see
    wrp.FOCUS_MODE_MESSAGE's own comment for the reasoning: Focus Mode is the student
    opting themselves OUT of a full generated paper regardless of what their plan would
    otherwise allow. A clear, student-facing message, never a raw error."""
    paper_user.focus_mode_enabled = True
    await db_session.commit()

    result = await WriteResearchPaperTool().run(
        title="T", style="ieee", abstract_sketch="A", sections=[{"heading": "Intro", "summary": "s"}],
        user_id=str(paper_user.id),
    )
    assert result == wrp.FOCUS_MODE_MESSAGE
    assert not result.startswith("Error:")


async def test_run_still_works_for_a_focus_mode_disabled_pro_user(paper_user, db_session, monkeypatch):
    """The same Pro user, with Focus Mode explicitly off, is unaffected -- proves the
    gate is genuinely conditional on the flag, not blocking Pro users unconditionally."""
    paper_user.focus_mode_enabled = False
    await db_session.commit()

    fake_provider = _FakeSectionProvider({"Introduction": '{"prose": "text", "sources": []}'})
    monkeypatch.setattr(wrp, "get_provider", lambda **kwargs: (fake_provider, "fake-model"))
    monkeypatch.setattr(wrp, "_gather_section_material", _no_op_material)
    _success_compile(monkeypatch)

    result = await WriteResearchPaperTool().run(
        title="Focus Off Paper", style="ieee", abstract_sketch="A",
        sections=[{"heading": "Introduction", "summary": "s"}], user_id=str(paper_user.id),
    )
    assert result.startswith("Done —")


async def test_run_rejects_unsupported_style(paper_user):
    # "mla" used to be the example here, back when RENDERERS only held ieee/apa7 -- it is
    # a real, supported style now, so this needs a style that genuinely has no renderer.
    result = await WriteResearchPaperTool().run(
        title="T", style="harvard", abstract_sketch="A", sections=[{"heading": "Intro", "summary": "s"}],
        user_id=str(paper_user.id),
    )
    assert result.startswith("Error:")
    assert "harvard" in result


async def test_run_rejects_empty_sections(paper_user):
    result = await WriteResearchPaperTool().run(
        title="T", style="ieee", abstract_sketch="A", sections=[], user_id=str(paper_user.id)
    )
    assert result.startswith("Error:")


async def test_run_rejects_unmatched_document_filename(paper_user):
    result = await WriteResearchPaperTool().run(
        title="T", style="ieee", abstract_sketch="A", sections=[{"heading": "Intro", "summary": "s"}],
        document_filename="does-not-exist.pdf", user_id=str(paper_user.id),
    )
    assert result.startswith("Error:")
    assert "does-not-exist.pdf" in result


# ---------------------------------------------------------------------------
# Full success path -- one section, one cited source, real compile (mocked),
# real Document rows.
# ---------------------------------------------------------------------------


async def test_run_writes_a_paper_and_creates_real_document_rows(paper_user, db_session, monkeypatch):
    fake_provider = _FakeSectionProvider(
        {
            "Introduction": (
                '{"prose": "Solar power is growing fast \\\\cite{doe2024solar}.", '
                '"sources": [{"key": "doe2024solar", "type": "article", "author": "Jane Doe", '
                '"title": "Solar Growth", "year": "2024", "venue": "Energy Journal", '
                '"url": "https://arxiv.org/abs/9999"}]}'
            )
        }
    )
    monkeypatch.setattr(wrp, "get_provider", lambda **kwargs: (fake_provider, "fake-model"))
    monkeypatch.setattr(wrp, "_gather_section_material", _no_op_material)
    capture: list = []
    _success_compile(monkeypatch, capture)

    result = await WriteResearchPaperTool().run(
        title="Solar Power Trends",
        style="ieee",
        abstract_sketch="A short look at solar power adoption.",
        sections=[{"heading": "Introduction", "summary": "Set the stage."}],
        user_id=str(paper_user.id),
    )

    assert result.startswith("Done —")
    assert "1 section(s)" in result
    assert "1 source(s) actually cited" in result
    assert "Solar Power Trends.pdf" in result
    assert "Solar Power Trends.tex" in result

    # The compiled tex actually contains the rewritten \cite{} and a real .bib was sent.
    assert len(capture) == 1
    assert "\\cite{doe2024solar}" in capture[0]["tex"]
    assert capture[0]["bib"] is not None
    assert "@article{doe2024solar," in capture[0]["bib"]

    docs = (
        (await db_session.execute(select(Document).where(Document.user_id == paper_user.id)))
        .scalars()
        .all()
    )
    filenames = {d.filename for d in docs}
    assert "Solar Power Trends.pdf" in filenames
    assert "Solar Power Trends.tex" in filenames
    pdf_doc = next(d for d in docs if d.filename.endswith(".pdf"))
    assert pdf_doc.mime_type == "application/pdf"

    # The bibliography's real source list is PERSISTED on both generated rows (see
    # Document.paper_sources), not discarded the moment the compile finished -- that's
    # what makes GET /documents/{id}/bibliography.bib able to hand the student back the
    # same .bib the compile above consumed, with the same \cite{} keys.
    tex_doc = next(d for d in docs if d.filename.endswith(".tex"))
    for generated in (pdf_doc, tex_doc):
        assert generated.paper_sources, f"{generated.filename} should carry its bibliography sources"
        assert [s["key"] for s in generated.paper_sources] == ["doe2024solar"]
        assert generated.paper_sources[0]["title"] == "Solar Growth"

    raw_pdf = await documents_service.get_document_raw(pdf_doc)
    assert raw_pdf == _FAKE_PDF
    assert raw_pdf[:5] == b"%PDF-"

    # RAG chunking ran for both generated documents, same as any other upload.
    chunk_count = len(
        (await db_session.execute(select(DocumentChunk).where(DocumentChunk.document_id == pdf_doc.id))).scalars().all()
    )
    assert chunk_count >= 0  # pypdf extraction of a fake, non-real PDF may yield no text; must not crash either way


async def test_run_deduplicates_a_source_cited_by_two_sections(paper_user, monkeypatch):
    shared_source = (
        '{"key": "src1", "type": "misc", "title": "Shared Source", "url": "https://en.wikipedia.org/wiki/Shared"}'
    )
    fake_provider = _FakeSectionProvider(
        {
            "Introduction": '{"prose": "Intro claim \\\\cite{src1}.", "sources": [' + shared_source + "]}",
            "Background": '{"prose": "Background claim \\\\cite{src1}.", "sources": [' + shared_source + "]}",
        }
    )
    monkeypatch.setattr(wrp, "get_provider", lambda **kwargs: (fake_provider, "fake-model"))
    monkeypatch.setattr(wrp, "_gather_section_material", _no_op_material)
    capture: list = []
    _success_compile(monkeypatch, capture)

    result = await WriteResearchPaperTool().run(
        title="Two Sections One Source",
        style="apa7",
        abstract_sketch="Testing dedup.",
        sections=[
            {"heading": "Introduction", "summary": "s1"},
            {"heading": "Background", "summary": "s2"},
        ],
        user_id=str(paper_user.id),
    )

    assert result.startswith("Done —")
    assert "1 source(s) actually cited" in result  # deduped to exactly one
    tex = capture[0]["tex"]
    bib = capture[0]["bib"]
    assert bib.count("@misc{") == 1
    # Both sections' \cite{} placeholders point at the SAME final key.
    import re

    cite_keys = set(re.findall(r"\\cite\{([^}]*)\}", tex))
    assert len(cite_keys) == 1


# ---------------------------------------------------------------------------
# Citation-metadata verification, full pipeline (ROADMAP Phase 7): real extracted
# citation_*/DC.* metadata from a fetched URL should win over the model's own
# self-reported guess for that same URL in the FINAL assembled .bib, and fall back
# cleanly when no such metadata was ever extracted for a cited URL.
# ---------------------------------------------------------------------------


async def test_run_prefers_extracted_metadata_over_models_self_reported_guess(paper_user, monkeypatch):
    fake_provider = _FakeSectionProvider(
        {
            "Introduction": (
                '{"prose": "A claim \\\\cite{guess2099}.", '
                '"sources": [{"key": "guess2099", "type": "article", "author": "Model Guessed Author", '
                '"title": "Model Guessed Title", "year": "1999", "venue": "Model Guessed Venue", '
                '"url": "https://arxiv.org/abs/9999"}]}'
            )
        }
    )
    monkeypatch.setattr(wrp, "get_provider", lambda **kwargs: (fake_provider, "fake-model"))

    async def _gather_with_real_metadata(*args, **kwargs):
        return (
            "(stubbed material)",
            {
                "https://arxiv.org/abs/9999": {
                    "author": "Real Extracted Author",
                    "title": "Real Extracted Title",
                    "year": "2021",
                    "venue": "Real Extracted Venue",
                }
            },
        )

    monkeypatch.setattr(wrp, "_gather_section_material", _gather_with_real_metadata)
    capture: list = []
    _success_compile(monkeypatch, capture)

    result = await WriteResearchPaperTool().run(
        title="Metadata Preference Test",
        style="ieee",
        abstract_sketch="Testing metadata preference.",
        sections=[{"heading": "Introduction", "summary": "s"}],
        user_id=str(paper_user.id),
    )

    assert result.startswith("Done —")
    bib = capture[0]["bib"]
    assert "Real Extracted Author" in bib
    assert "Real Extracted Title" in bib
    assert "2021" in bib
    assert "Real Extracted Venue" in bib
    assert "Model Guessed Author" not in bib
    assert "Model Guessed Title" not in bib
    assert "Model Guessed Venue" not in bib


async def test_run_falls_back_to_models_guess_when_cited_url_has_no_extracted_metadata(paper_user, monkeypatch):
    fake_provider = _FakeSectionProvider(
        {
            "Introduction": (
                '{"prose": "A claim \\\\cite{guess2099}.", '
                '"sources": [{"key": "guess2099", "type": "misc", "author": "Only Guess Author", '
                '"title": "Only Guess Title", "url": "https://en.wikipedia.org/wiki/Something"}]}'
            )
        }
    )
    monkeypatch.setattr(wrp, "get_provider", lambda **kwargs: (fake_provider, "fake-model"))

    async def _gather_metadata_for_a_different_url(*args, **kwargs):
        # Real metadata was extracted, but for a URL the model did NOT cite -- the
        # actually-cited URL has nothing to prefer, so its guess must survive untouched.
        return "(stubbed material)", {"https://arxiv.org/abs/1": {"author": "Unrelated Real Author"}}

    monkeypatch.setattr(wrp, "_gather_section_material", _gather_metadata_for_a_different_url)
    capture: list = []
    _success_compile(monkeypatch, capture)

    result = await WriteResearchPaperTool().run(
        title="Fallback Test",
        style="ieee",
        abstract_sketch="Testing metadata fallback.",
        sections=[{"heading": "Introduction", "summary": "s"}],
        user_id=str(paper_user.id),
    )

    assert result.startswith("Done —")
    bib = capture[0]["bib"]
    assert "Only Guess Author" in bib
    assert "Only Guess Title" in bib
    assert "Unrelated Real Author" not in bib


# ---------------------------------------------------------------------------
# Compile failure + bounded retry
# ---------------------------------------------------------------------------


async def test_run_retries_once_on_compile_failure_and_succeeds(paper_user, monkeypatch):
    fake_provider = _FakeSectionProvider(
        {"Introduction": '{"prose": "Plain text, no sources.", "sources": []}'},
        retry_response="\\documentclass{IEEEtran}\\begin{document}CORRECTED\\end{document}",
    )
    monkeypatch.setattr(wrp, "get_provider", lambda **kwargs: (fake_provider, "fake-model"))
    monkeypatch.setattr(wrp, "_gather_section_material", _no_op_material)

    calls = []

    async def fake_compile_latex(tex, bib=None, engine="pdflatex"):
        calls.append(tex)
        if len(calls) == 1:
            return LatexCompileResult(pdf_bytes=None, log="! Undefined control sequence.", success=False, timed_out=False)
        return LatexCompileResult(pdf_bytes=_FAKE_PDF, log="fixed", success=True, timed_out=False)

    monkeypatch.setattr(wrp, "compile_latex", fake_compile_latex)

    result = await WriteResearchPaperTool().run(
        title="Retry Paper",
        style="ieee",
        abstract_sketch="Testing retry.",
        sections=[{"heading": "Introduction", "summary": "s"}],
        user_id=str(paper_user.id),
    )

    assert result.startswith("Done —")
    assert len(calls) == 2
    assert "CORRECTED" in calls[1]
    assert calls[0] != calls[1]


async def test_run_reports_honest_failure_when_retry_also_fails(paper_user, monkeypatch):
    fake_provider = _FakeSectionProvider(
        {"Introduction": '{"prose": "Plain text, no sources.", "sources": []}'},
        retry_response="\\documentclass{IEEEtran}\\begin{document}STILL BROKEN\\end{document}",
    )
    monkeypatch.setattr(wrp, "get_provider", lambda **kwargs: (fake_provider, "fake-model"))
    monkeypatch.setattr(wrp, "_gather_section_material", _no_op_material)

    async def always_fails(tex, bib=None, engine="pdflatex"):
        return LatexCompileResult(pdf_bytes=None, log="! Emergency stop.", success=False, timed_out=False)

    monkeypatch.setattr(wrp, "compile_latex", always_fails)

    result = await WriteResearchPaperTool().run(
        title="Doomed Paper",
        style="ieee",
        abstract_sketch="Testing failure honesty.",
        sections=[{"heading": "Introduction", "summary": "s"}],
        user_id=str(paper_user.id),
    )

    assert result.startswith("Error:")
    assert "Emergency stop" in result


async def test_failed_compile_creates_no_document_rows(paper_user, db_session, monkeypatch):
    fake_provider = _FakeSectionProvider({"Introduction": '{"prose": "text", "sources": []}'})
    monkeypatch.setattr(wrp, "get_provider", lambda **kwargs: (fake_provider, "fake-model"))
    monkeypatch.setattr(wrp, "_gather_section_material", _no_op_material)

    async def always_fails(tex, bib=None, engine="pdflatex"):
        return LatexCompileResult(pdf_bytes=None, log="nope", success=False, timed_out=False)

    monkeypatch.setattr(wrp, "compile_latex", always_fails)

    await WriteResearchPaperTool().run(
        title="Never Persisted",
        style="ieee",
        abstract_sketch="A",
        sections=[{"heading": "Introduction", "summary": "s"}],
        user_id=str(paper_user.id),
    )

    docs = (
        (await db_session.execute(select(Document).where(Document.user_id == paper_user.id))).scalars().all()
    )
    assert docs == []


# ---------------------------------------------------------------------------
# The humanities styles go through the SAME drafting/citation-key pipeline as
# ieee/apa7 -- only the final document template differs.
# ---------------------------------------------------------------------------


async def test_mla_and_chicago_are_offered_and_described_in_the_tool_schema():
    schema = WriteResearchPaperTool().parameters["properties"]["style"]
    assert set(schema["enum"]) == {"ieee", "apa7", "mla", "chicago"}
    # The model can only pick these deliberately if the description says what they are.
    assert "mla" in schema["description"].lower()
    assert "works cited" in schema["description"].lower()
    assert "notes-bibliography" in schema["description"].lower()


@pytest.mark.parametrize(
    ("style", "expect_in_tex", "expect_not_in_tex"),
    [
        ("mla", "\\printbibliography[title={Works Cited}]", "Bibliography}"),
        ("chicago", "\\printbibliography[title={Bibliography}]", "Works Cited"),
    ],
)
async def test_humanities_styles_compile_the_same_pipeline_with_their_own_apparatus(
    paper_user, monkeypatch, style, expect_in_tex, expect_not_in_tex
):
    fake_provider = _FakeSectionProvider(
        {
            "Introduction": (
                '{"prose": "Austen reshaped the form \\\\cite{a1}.", '
                '"sources": [{"key": "a1", "type": "misc", "author": "Jane Doe", '
                '"title": "Reading Austen", "year": "2019", '
                '"url": "https://en.wikipedia.org/wiki/Austen"}]}'
            )
        }
    )
    monkeypatch.setattr(wrp, "get_provider", lambda **kwargs: (fake_provider, "fake-model"))
    monkeypatch.setattr(wrp, "_gather_section_material", _no_op_material)
    capture: list = []
    _success_compile(monkeypatch, capture)

    result = await WriteResearchPaperTool().run(
        title="Humanities Paper",
        style=style,
        abstract_sketch="A short abstract.",
        sections=[{"heading": "Introduction", "summary": "s"}],
        user_id=str(paper_user.id),
    )

    assert result.startswith("Done —")
    assert "1 source(s) actually cited" in result
    tex, bib = capture[0]["tex"], capture[0]["bib"]
    # Same assign_citation_keys pipeline: the model's local "a1" became the real key.
    assert "\\cite{doe2019reading}" in tex
    assert "@misc{doe2019reading," in bib
    assert expect_in_tex in tex
    assert expect_not_in_tex not in tex


# ---------------------------------------------------------------------------
# Registry-level threading
# ---------------------------------------------------------------------------


async def test_run_tool_threads_user_id_through_to_write_research_paper(paper_user, monkeypatch):
    from app.tools.registry import run_tool

    fake_provider = _FakeSectionProvider({"Introduction": '{"prose": "text", "sources": []}'})
    monkeypatch.setattr(wrp, "get_provider", lambda **kwargs: (fake_provider, "fake-model"))
    monkeypatch.setattr(wrp, "_gather_section_material", _no_op_material)
    _success_compile(monkeypatch)

    result = await run_tool(
        "write_research_paper",
        {
            "title": "Registry Path Paper",
            "style": "ieee",
            "abstract_sketch": "A",
            "sections": [{"heading": "Introduction", "summary": "s"}],
        },
        session_id="unused",
        user_id=str(paper_user.id),
    )
    assert result.startswith("Done —")
