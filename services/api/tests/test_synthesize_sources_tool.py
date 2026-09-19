"""synthesize_sources -- the cross-document comparison tool built on the SAME
document-RAG infrastructure flashcard/practice-exam/study-plan generation already use
(app.tools.document_resolution.resolve_document, app.memory.rag), extended so retrieval
draws REAL chunks from EACH relevant document instead of an undifferentiated top-k
across a merged pool. Documents are created directly against a fresh, isolated user
(same pattern as test_generation_tools.py's free_user_with_document) and chunked via the
REAL app.memory.rag.store_document_chunks pipeline -- real fastembed embeddings, no
mocked retrieval -- so these tests never touch MinIO/HTTP upload at all (this tool never
calls get_document_text, only chunk retrieval). Only the final LLM synthesis call is
scripted, exactly like test_generation_tools.py mocks get_provider for flashcard/exam/
plan generation."""

import uuid

import pytest_asyncio
from sqlalchemy import delete, select

from app.db.models import Document, DocumentChunk, User
from app.memory.rag import store_document_chunks
from app.services import synthesis as synthesis_service
from app.tools.registry import get_tool_specs, run_tool
from app.tools.synthesize_sources import SynthesizeSourcesTool
from tests.fakes import ScriptedToolCallingProvider


@pytest_asyncio.fixture
async def synth_user(db_session):
    user = User(keycloak_sub=f"test-synth-{uuid.uuid4()}", plan="free")
    db_session.add(user)
    await db_session.commit()

    yield user

    await db_session.execute(
        delete(DocumentChunk).where(
            DocumentChunk.document_id.in_(select(Document.id).where(Document.user_id == user.id))
        )
    )
    await db_session.execute(delete(Document).where(Document.user_id == user.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


async def _make_document(db_session, user_id, filename: str, content: str) -> Document:
    """Real Document + real chunked/embedded DocumentChunk rows, via the SAME
    app.memory.rag.store_document_chunks pipeline an upload/note goes through --
    skipping only the MinIO raw-bytes round trip, which nothing this tool calls ever
    reads (it works entirely off DocumentChunk rows)."""
    document = Document(user_id=user_id, filename=filename, mime_type="text/plain", minio_key="unused")
    db_session.add(document)
    await db_session.flush()
    await store_document_chunks(db_session, document.id, content)
    await db_session.commit()
    return document


def test_synthesize_sources_is_registered():
    names = {t.name for t in get_tool_specs()}
    assert "synthesize_sources" in names


# ---------------------------------------------------------------------------
# Real per-document retrieval: proves each source gets genuine representation, not just
# an undifferentiated top-k across a merged pool that a longer/closer document could
# dominate.
# ---------------------------------------------------------------------------


async def test_gather_excerpts_pulls_real_chunks_from_every_document_even_when_one_dominates(
    db_session, synth_user
):
    marker_a = f"aristotlemarker{uuid.uuid4().hex[:8]}"
    marker_b = f"platomarker{uuid.uuid4().hex[:8]}"

    # Document A: long, made of many chunks, all closely on-topic -- the kind of source
    # that would crowd out everything else in a single merged top-k.
    paragraph = (
        f"Aristotle's virtue ethics ({marker_a}) holds that moral character is built "
        "through habituated practice of the virtues, aiming at eudaimonia. "
    )
    long_content = paragraph * 40  # several thousand characters -> several real chunks
    doc_a = await _make_document(db_session, synth_user.id, "aristotle-ethics.txt", long_content)

    # Document B: short, effectively a single chunk, on the same general topic.
    short_content = (
        f"Plato's theory of forms ({marker_b}) argues that true virtue comes from "
        "knowledge of the eternal Forms, not habituated practice."
    )
    doc_b = await _make_document(db_session, synth_user.id, "plato-forms.txt", short_content)

    # Sanity: document A really did produce multiple chunks (the dominance scenario this
    # test is guarding against).
    a_chunks = (
        (await db_session.execute(select(DocumentChunk).where(DocumentChunk.document_id == doc_a.id)))
        .scalars()
        .all()
    )
    assert len(a_chunks) > 1

    documents = await synthesis_service._discover_documents_by_topic(
        db_session, synth_user.id, "virtue ethics and moral character"
    )
    found_ids = {d.id for d in documents}
    assert doc_a.id in found_ids and doc_b.id in found_ids

    excerpts = await synthesis_service._gather_excerpts(
        db_session, synth_user.id, [doc_a, doc_b], "virtue ethics and moral character"
    )
    by_filename = {e.filename: e for e in excerpts}
    assert "aristotle-ethics.txt" in by_filename
    assert "plato-forms.txt" in by_filename
    # Document B's real content made it into its own excerpt slot -- never silently
    # dropped because document A had more/closer chunks overall.
    assert any(marker_b in chunk for chunk in by_filename["plato-forms.txt"].chunks)
    assert any(marker_a in chunk for chunk in by_filename["aristotle-ethics.txt"].chunks)


# ---------------------------------------------------------------------------
# End-to-end tool behavior: attribution to specific real sources.
# ---------------------------------------------------------------------------


async def test_synthesize_sources_by_explicit_names_attributes_points_to_both_real_sources(
    db_session, synth_user, monkeypatch
):
    marker_a = f"kantmarker{uuid.uuid4().hex[:8]}"
    marker_b = f"millmarker{uuid.uuid4().hex[:8]}"
    await _make_document(
        db_session,
        synth_user.id,
        "kant-deontology.txt",
        f"Kant ({marker_a}) argues that the morality of an action depends on duty and "
        "the categorical imperative, not its consequences.",
    )
    await _make_document(
        db_session,
        synth_user.id,
        "mill-utilitarianism.txt",
        f"Mill ({marker_b}) argues that the morality of an action depends entirely on "
        "its consequences -- specifically, the total happiness it produces.",
    )

    canned = (
        "## Agreement\nBoth sources concern the basis of moral action.\n\n"
        "## Disagreement\nkant-deontology.txt grounds morality in duty, while "
        "mill-utilitarianism.txt grounds it in consequences.\n\n"
        "## How they connect\nmill-utilitarianism.txt's consequentialism is a direct "
        "rejection of the duty-based view in kant-deontology.txt."
    )
    fake = ScriptedToolCallingProvider([[canned]])
    monkeypatch.setattr(synthesis_service, "get_provider", lambda **kwargs: (fake, "fake-model"))

    result = await SynthesizeSourcesTool().run(
        document_names=["kant-deontology.txt", "mill-utilitarianism.txt"],
        user_id=str(synth_user.id),
    )

    # The response names BOTH real sources -- not just the one that happened to embed
    # closest to the query, and not a single document pretending to be several.
    assert "kant-deontology.txt" in result
    assert "mill-utilitarianism.txt" in result
    assert "Sources consulted:" in result
    footer = result.split("Sources consulted:")[1]
    assert "kant-deontology.txt" in footer
    assert "mill-utilitarianism.txt" in footer

    # Real grounding: the prompt actually SENT to the model contains each source's own
    # real (marker-bearing) text, not a fabricated stand-in.
    sent_prompt = fake.calls_seen[0]["messages"][1].content
    assert marker_a in sent_prompt
    assert marker_b in sent_prompt
    assert "=== Source: kant-deontology.txt ===" in sent_prompt
    assert "=== Source: mill-utilitarianism.txt ===" in sent_prompt


async def test_synthesize_sources_by_topic_discovers_and_uses_both_real_documents(
    db_session, synth_user, monkeypatch
):
    marker_a = f"tariffmarker{uuid.uuid4().hex[:8]}"
    marker_b = f"embargomarker{uuid.uuid4().hex[:8]}"
    await _make_document(
        db_session,
        synth_user.id,
        "article-tariffs.txt",
        f"This article ({marker_a}) argues tariffs protect domestic manufacturing jobs "
        "in the short term but raise consumer prices.",
    )
    await _make_document(
        db_session,
        synth_user.id,
        "article-embargoes.txt",
        f"This article ({marker_b}) argues trade embargoes are a blunter tool than "
        "tariffs, hurting both sides with less targeted economic pressure.",
    )

    canned = (
        "Both article-tariffs.txt and article-embargoes.txt discuss trade policy "
        "tools; article-embargoes.txt frames itself against the narrower tool "
        "discussed in article-tariffs.txt."
    )
    fake = ScriptedToolCallingProvider([[canned]])
    monkeypatch.setattr(synthesis_service, "get_provider", lambda **kwargs: (fake, "fake-model"))

    result = await SynthesizeSourcesTool().run(topic="trade policy tools", user_id=str(synth_user.id))

    assert "article-tariffs.txt" in result
    assert "article-embargoes.txt" in result
    sent_prompt = fake.calls_seen[0]["messages"][1].content
    assert marker_a in sent_prompt
    assert marker_b in sent_prompt


# ---------------------------------------------------------------------------
# Honest degradation -- never fabricate a multi-source synthesis from fewer than two
# real documents.
# ---------------------------------------------------------------------------


async def test_synthesize_sources_refuses_with_only_one_real_document(db_session, synth_user, monkeypatch):
    await _make_document(db_session, synth_user.id, "solo-article.txt", "A single real article about geology.")

    # No provider should even be reached -- degrade before ever calling the model.
    def _fail_if_called(**kwargs):
        raise AssertionError("must not call the LLM with fewer than two real sources")

    monkeypatch.setattr(synthesis_service, "get_provider", _fail_if_called)

    result = await SynthesizeSourcesTool().run(document_names=["solo-article.txt"], user_id=str(synth_user.id))

    assert "one real matching document" in result.lower()
    assert "solo-article.txt" in result
    assert not result.startswith("##")  # never a fabricated structured synthesis


async def test_synthesize_sources_honest_message_with_zero_documents_found(synth_user):
    result = await SynthesizeSourcesTool().run(document_names=["does-not-exist.pdf"], user_id=str(synth_user.id))
    assert "couldn't find real documents" in result.lower()


async def test_synthesize_sources_requires_names_or_topic(synth_user):
    result = await SynthesizeSourcesTool().run(user_id=str(synth_user.id))
    assert result.startswith("Error:")


async def test_synthesize_sources_clear_error_with_no_user():
    result = await SynthesizeSourcesTool().run(topic="anything", user_id=None)
    assert result.startswith("Error:")


async def test_run_tool_threads_user_id_through_to_synthesize_sources(db_session, synth_user):
    await _make_document(db_session, synth_user.id, "solo-only.txt", "Only one real document here.")
    result = await run_tool(
        "synthesize_sources",
        {"document_names": ["solo-only.txt"]},
        session_id="unused",
        user_id=str(synth_user.id),
    )
    assert "solo-only.txt" in result
