import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ProfileFact
from app.memory.embeddings import embed_text


async def upsert_fact(
    db: AsyncSession,
    user_id: uuid.UUID,
    subject_key: str,
    value: str,
    confidence: float = 1.0,
    source_session_id: uuid.UUID | None = None,
) -> ProfileFact:
    """Tier 3 write path: dedup by construction. Looks up the current (non-superseded)
    row for this (user, subject_key) and either reconfirms it (same value) or supersedes
    it with a new row — never appends a plain duplicate."""
    existing = (
        await db.execute(
            select(ProfileFact).where(
                ProfileFact.user_id == user_id,
                ProfileFact.subject_key == subject_key,
                ProfileFact.superseded_by.is_(None),
            )
        )
    ).scalar_one_or_none()

    if existing is not None and existing.value == value:
        existing.last_confirmed_at = datetime.now(timezone.utc)
        existing.confidence = max(existing.confidence, confidence)
        await db.flush()
        return existing

    if existing is not None:
        # ux_profile_facts_current_key is a UNIQUE index on (user_id, subject_key)
        # WHERE superseded_by IS NULL, checked immediately (Postgres doesn't defer
        # partial-unique-index checks). Inserting the replacement row below while
        # `existing` still has superseded_by IS NULL would momentarily leave two
        # "current" rows for this (user, subject_key) and violate that index. Point
        # the old row at itself first so it drops out of the partial index's
        # WHERE clause before the new row is inserted; the self-reference is
        # overwritten with the real successor below once it exists.
        existing.superseded_by = existing.id
        await db.flush()

    new_fact = ProfileFact(
        user_id=user_id,
        subject_key=subject_key,
        value=value,
        confidence=confidence,
        embedding=await embed_text(f"{subject_key}: {value}"),
        source_session_id=source_session_id,
    )
    db.add(new_fact)
    await db.flush()

    if existing is not None:
        existing.superseded_by = new_fact.id
        await db.flush()

    return new_fact


async def retrieve_relevant_facts(
    db: AsyncSession, user_id: uuid.UUID, query: str, top_k: int = 8
) -> list[ProfileFact]:
    """Tier 3 read path: small top-k similarity search, not a full dump of everything
    ever learned about the student."""
    query_embedding = await embed_text(query)
    stmt = (
        select(ProfileFact)
        .where(ProfileFact.user_id == user_id, ProfileFact.superseded_by.is_(None))
        .order_by(ProfileFact.embedding.cosine_distance(query_embedding))
        .limit(top_k)
    )
    return list((await db.execute(stmt)).scalars())
