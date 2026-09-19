"""Cross-document synthesis (app/tools/synthesize_sources.py) — the "what do these
readings agree/disagree on" step of writing an argumentative essay, and the thing the
Humanities-major critique flagged as Newton's genuine document-RAG advantage going
completely unused outside flashcard/quiz generation.

Built on the SAME document-lookup and retrieval infrastructure every other
document-aware tool uses (app.tools.document_resolution.resolve_document,
app.memory.rag) rather than a parallel system, with one real extension: retrieval here
is PER-DOCUMENT, not a single top-k across a merged pool. A merged pool risks one
document's chunks (the one closest to the query, or just the longest) dominating every
retrieved slot, making the other sources invisible to the model — exactly wrong for a
tool whose entire point is comparing multiple sources against each other.

The actual synthesis (agreements / disagreements / how one source builds on another) is
one direct, stateless provider call, structurally the same shape as
app.services.notes.annotate_selection: no tool-calling loop, no chat history, no
persistence of the exchange. Grounding is enforced two ways: (1) the system prompt
requires the model to cite a source filename for every point and forbids describing a
source's position beyond what's in its excerpts, and (2) regardless of what the model
does, a real "Sources consulted" footer listing the documents whose actual chunks were
retrieved is always appended — so a caller always has honest, code-guaranteed source
attribution even if the model's own citations are sloppy.
"""
import asyncio
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Document
from app.memory import rag
from app.providers.base import ChatTurn, TextDelta
from app.providers.registry import get_provider
from app.tools.document_resolution import resolve_document

# Real chunks pulled from EACH source document -- small enough that MAX_SOURCES worth of
# them stays a reasonable prompt size, generous enough that a source gets genuine
# representation rather than one lonely sentence.
CHUNKS_PER_SOURCE = 4

# How many distinct source documents a single synthesis call will ever compare -- past
# this, the point (a focused compare/contrast, not a literature-review dump) is lost and
# the prompt would grow without bound.
MAX_SOURCES = 5

# When no explicit document list is given, how many candidate chunks (across the whole
# account) to scan to DISCOVER which documents are topically relevant, before grouping by
# document and keeping the first MAX_SOURCES distinct ones -- generous so a genuinely
# relevant document isn't missed just because a couple of very close matches from one
# other document occupied the early slots.
TOPIC_DISCOVERY_TOP_K = 40

SYNTHESIS_TIMEOUT_SECONDS = 45.0

SYSTEM_PROMPT = (
    "You are Newton, an academic tutor helping a student synthesize multiple of their "
    "own uploaded sources -- the first real step of writing an argumentative essay. You "
    "are given real excerpts from two or more documents, each labeled with its source "
    "filename. Using ONLY what is in these excerpts:\n\n"
    "1. What the sources agree on.\n"
    "2. Where they genuinely disagree, or emphasize different things.\n"
    "3. How one source's argument builds on, responds to, or contrasts with another's "
    "(only if the excerpts actually support this -- don't invent a dialogue between "
    "sources that never engage with each other).\n\n"
    "For EVERY point you make, name the source filename it comes from. Never attribute a "
    "position to a source beyond what its excerpts actually show, and never invent a "
    "source's stance to fill out a section -- if a section genuinely has nothing to "
    "report (e.g. the sources don't disagree on anything visible in these excerpts), say "
    "so honestly instead of manufacturing a disagreement. Structure your reply with "
    "clear headings for the three parts above."
)


@dataclass
class SourceExcerpt:
    filename: str
    document_id: uuid.UUID
    chunks: list[str]


async def _discover_documents_by_topic(db: AsyncSession, user_id: uuid.UUID, topic: str) -> list[Document]:
    """Finds which of the student's own documents are relevant to `topic` by scanning a
    generous top-k across the whole account and grouping by document, preserving
    relevance order (the document whose closest chunk ranked first stays first)."""
    chunks = await rag.retrieve_relevant_chunks(db, user_id, topic, top_k=TOPIC_DISCOVERY_TOP_K)
    ordered_ids: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for chunk in chunks:
        if chunk.document_id not in seen:
            seen.add(chunk.document_id)
            ordered_ids.append(chunk.document_id)
        if len(ordered_ids) >= MAX_SOURCES:
            break
    if not ordered_ids:
        return []
    rows = (await db.execute(select(Document).where(Document.id.in_(ordered_ids)))).scalars().all()
    by_id = {d.id: d for d in rows}
    return [by_id[i] for i in ordered_ids if i in by_id]


async def _resolve_documents_by_name(
    db: AsyncSession, user_id: uuid.UUID, document_names: list[str]
) -> list[Document]:
    """Reuses the SAME filename-hint lookup every generation tool uses
    (document_resolution.resolve_document) rather than a new matching rule -- one hint
    per requested name, deduplicated by document id."""
    resolved: list[Document] = []
    seen_ids: set[uuid.UUID] = set()
    for name in document_names[:MAX_SOURCES]:
        document = await resolve_document(db, user_id, name)
        if document is not None and document.id not in seen_ids:
            seen_ids.add(document.id)
            resolved.append(document)
    return resolved


async def _gather_excerpts(
    db: AsyncSession, user_id: uuid.UUID, documents: list[Document], topic: str | None
) -> list[SourceExcerpt]:
    """Real per-document retrieval -- topic-scoped nearest-neighbor search within that
    ONE document when a topic was given, or the document's own opening chunks when there
    wasn't (see rag.get_representative_chunks). A document that turns out to have zero
    chunks (e.g. an empty note) contributes nothing and is dropped -- it isn't a "real"
    source to synthesize from."""
    excerpts: list[SourceExcerpt] = []
    for document in documents:
        if topic:
            rows = await rag.retrieve_relevant_chunks_for_document(
                db, user_id, document.id, topic, top_k=CHUNKS_PER_SOURCE
            )
        else:
            rows = await rag.get_representative_chunks(db, user_id, document.id, limit=CHUNKS_PER_SOURCE)
        texts = [r.content for r in rows if r.content.strip()]
        if texts:
            excerpts.append(SourceExcerpt(filename=document.filename, document_id=document.id, chunks=texts))
    return excerpts


def _build_user_prompt(excerpts: list[SourceExcerpt], topic: str | None) -> str:
    parts: list[str] = []
    if topic:
        parts.append(f"The student's synthesis topic/question: {topic}\n")
    for excerpt in excerpts:
        parts.append(f"=== Source: {excerpt.filename} ===")
        parts.extend(excerpt.chunks)
        parts.append("")
    return "\n".join(parts)


async def synthesize_sources(
    db: AsyncSession,
    user_id: uuid.UUID,
    document_names: list[str] | None = None,
    topic: str | None = None,
) -> str:
    """The tool's real entry point. Returns an honest "not enough material" message
    (never a fabricated one-source-pretending-to-be-several synthesis) whenever fewer
    than two documents with REAL retrievable content were actually found."""
    if document_names:
        documents = await _resolve_documents_by_name(db, user_id, document_names)
    elif topic:
        documents = await _discover_documents_by_topic(db, user_id, topic)
    else:
        return "Error: give either a list of document names or a topic to synthesize across."

    if len(documents) < 2:
        if not documents:
            return (
                "Couldn't find real documents to synthesize from"
                + (f" for '{topic}'" if topic else "")
                + " — nothing matched in your uploaded documents yet. Upload the "
                "readings you want compared, or check the names."
            )
        return (
            f"Only found one real matching document ('{documents[0].filename}') — a "
            "synthesis needs at least two independent sources to compare, so I won't "
            "manufacture a multi-source comparison out of a single document. Upload or "
            "name another source and try again."
        )

    excerpts = await _gather_excerpts(db, user_id, documents, topic)
    if len(excerpts) < 2:
        found = ", ".join(f"'{e.filename}'" for e in excerpts) or "none"
        return (
            "Couldn't retrieve enough real content to synthesize — only usable text "
            f"came back from: {found}. At least two sources with real content are needed."
        )

    user_prompt = _build_user_prompt(excerpts, topic)
    provider, model = get_provider()
    turns = [
        ChatTurn(role="system", content=SYSTEM_PROMPT),
        ChatTurn(role="user", content=user_prompt),
    ]

    async def _call() -> str:
        text = ""
        async for event in provider.stream_chat(turns, model):
            if isinstance(event, TextDelta):
                text += event.text
        return text.strip()

    generated = await asyncio.wait_for(_call(), timeout=SYNTHESIS_TIMEOUT_SECONDS)
    sources_line = "Sources consulted: " + ", ".join(e.filename for e in excerpts)
    return f"{generated}\n\n{sources_line}" if generated else sources_line
