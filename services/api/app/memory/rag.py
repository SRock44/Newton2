import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Document, DocumentChunk
from app.memory.embeddings import embed_text

# Character-based chunker with overlap - no tokenizer dependency needed for the kind of
# material students upload (lecture notes, short readings), not huge books.
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping, character-based chunks. The overlap means a
    sentence or idea straddling a chunk boundary is still fully present in (at least)
    one chunk, so it stays retrievable instead of being cut in half."""
    if overlap >= chunk_size:
        raise ValueError("overlap must be smaller than chunk_size")

    stripped = text.strip()
    if not stripped:
        return []

    chunks: list[str] = []
    start = 0
    length = len(stripped)
    while start < length:
        end = min(start + chunk_size, length)
        chunks.append(stripped[start:end])
        if end == length:
            break
        start = end - overlap
    return chunks


async def store_document_chunks(
    db: AsyncSession, document_id: uuid.UUID, text: str
) -> list[DocumentChunk]:
    """Document-RAG write path: chunk raw extracted text, embed each chunk with the
    same shared fastembed model used elsewhere (see app.memory.embeddings), and persist
    them as DocumentChunk rows. Mirrors how profile.upsert_fact embeds onto ProfileFact."""
    rows: list[DocumentChunk] = []
    for index, content in enumerate(chunk_text(text)):
        chunk = DocumentChunk(
            document_id=document_id,
            chunk_index=index,
            content=content,
            embedding=await embed_text(content),
        )
        db.add(chunk)
        rows.append(chunk)
    await db.flush()
    return rows


async def retrieve_relevant_chunks(
    db: AsyncSession, user_id: uuid.UUID, query: str, top_k: int = 5
) -> list[DocumentChunk]:
    """Document-RAG read path, structurally identical to profile.retrieve_relevant_facts:
    a small top-k pgvector cosine-distance nearest-neighbor search. DocumentChunk has no
    user_id of its own, so the scoping is enforced by joining through Document — a user
    must never be able to retrieve another user's document chunks this way."""
    query_embedding = await embed_text(query)
    stmt = (
        select(DocumentChunk)
        .join(Document, DocumentChunk.document_id == Document.id)
        .where(Document.user_id == user_id)
        .order_by(DocumentChunk.embedding.cosine_distance(query_embedding))
        .limit(top_k)
    )
    return list((await db.execute(stmt)).scalars())


async def retrieve_relevant_chunks_for_document(
    db: AsyncSession, user_id: uuid.UUID, document_id: uuid.UUID, query: str, top_k: int = 4
) -> list[DocumentChunk]:
    """Same nearest-neighbor search as retrieve_relevant_chunks, but scoped to ONE
    document rather than the whole account -- what app.services.synthesis uses to pull
    REAL, on-topic chunks from EACH source document in a multi-document synthesis,
    instead of a single merged top-k where one document's chunks could crowd every
    other source out entirely. Still joins through Document and checks user_id (not
    just document_id) for the same cross-account-leak reason retrieve_relevant_chunks
    does, even though callers are expected to have already resolved document_id from
    this same user's own library."""
    query_embedding = await embed_text(query)
    stmt = (
        select(DocumentChunk)
        .join(Document, DocumentChunk.document_id == Document.id)
        .where(Document.user_id == user_id, DocumentChunk.document_id == document_id)
        .order_by(DocumentChunk.embedding.cosine_distance(query_embedding))
        .limit(top_k)
    )
    return list((await db.execute(stmt)).scalars())


async def get_representative_chunks(
    db: AsyncSession, user_id: uuid.UUID, document_id: uuid.UUID, limit: int = 4
) -> list[DocumentChunk]:
    """A document's own first `limit` chunks, in original chunk_index order -- used
    instead of a vector search when there's no topic/query to rank by (see
    app.services.synthesis's no-topic path). The start of a document is a reasonable,
    deterministic stand-in for "what this source is about" (an intro/thesis/abstract
    for an essay, the opening argument for an article) without the arbitrariness of
    embedding a generic filler query and ranking against it."""
    stmt = (
        select(DocumentChunk)
        .join(Document, DocumentChunk.document_id == Document.id)
        .where(Document.user_id == user_id, DocumentChunk.document_id == document_id)
        .order_by(DocumentChunk.chunk_index.asc())
        .limit(limit)
    )
    return list((await db.execute(stmt)).scalars())
