import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.object_storage import remove_object_sync
from app.db.models import Document, User

logger = logging.getLogger(__name__)


async def delete_own_account(db: AsyncSession, user: User) -> None:
    """Deletes a user's row and, transitively, every row this app considers that
    user's owned content -- migration 0010 put ON DELETE CASCADE on all 8 user_id FKs
    that used to have none (chat_sessions, documents, study_plan_items,
    google_classroom_connections, flashcards, flashcard_review_logs, practice_exams,
    profile_facts), so a single DB-level delete of the `users` row is enough to take
    all of those with it -- no per-table cleanup needed here, matching the same
    passive_deletes trust migration 0004 already established for chat_sessions'
    children.

    MinIO objects are a different story: they live outside Postgres, so the CASCADE
    above removes the `documents` ROWS but does nothing to the actual files sitting in
    the bucket. Those have to be cleaned up separately, and deliberately BEFORE the
    user row is deleted: this function reads each Document's minio_key first (while the
    rows still exist to read), then deletes the user (cascading the DB rows), and only
    then removes the MinIO objects -- reusing the exact fire-and-forget-on-failure
    pattern app/services/documents.py's delete_document already uses, since MinIO isn't
    part of the Postgres transaction and a stray already-gone/unreachable object should
    never block account deletion.

    Keycloak identity note: this deletes the app's own data only. There is currently no
    Keycloak admin-API integration anywhere in this codebase (checked app/core/auth.py
    and app/services/ -- crypto.py's Fernet encryption is for Classroom OAuth tokens,
    not a Keycloak admin client), so the user's actual Keycloak account/identity is left
    intact by this endpoint. Building a Keycloak admin-API deletion call is a real,
    separate piece of work (service-account credentials, admin REST client, error
    handling for an identity provider outside this app's own transaction boundary) that
    is out of scope here; flagged explicitly rather than silently leaving it unaddressed.
    """
    settings = get_settings()

    minio_keys = (
        (await db.execute(select(Document.minio_key).where(Document.user_id == user.id)))
        .scalars()
        .all()
    )

    await db.delete(user)
    await db.commit()

    for key in minio_keys:
        try:
            await asyncio.to_thread(remove_object_sync, settings.minio_bucket, key)
        except Exception:
            # The DB is the source of truth for what the user owns; don't fail an
            # already-committed account deletion over a MinIO object that's already
            # gone or unreachable. Logged so an orphaned object is at least visible.
            logger.warning("Failed to remove MinIO object %s during account deletion", key, exc_info=True)
