import asyncio
import uuid
from datetime import datetime, timezone

import pytest_asyncio
from minio.error import S3Error
from sqlalchemy import select

from app.core.config import get_settings
from app.core.object_storage import ensure_bucket_sync, get_object_sync, put_object_sync
from app.db.models import (
    ChatSession,
    Document,
    DocumentChunk,
    Flashcard,
    FlashcardReviewLog,
    GoogleClassroomConnection,
    PracticeExam,
    ProfileFact,
    StudyPlanItem,
    User,
)
from app.services.account import delete_own_account

# ---------------------------------------------------------------------------
# Service-level tests: a throwaway user (never routed through Keycloak — same
# pattern test_gamification.py/test_documents.py already use for rows that don't
# need a real login) with real rows in every one of the 8 user_id-owned tables that
# migration 0010 put ON DELETE CASCADE on.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def throwaway_user(db_session):
    user = User(keycloak_sub=f"test-account-delete-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()
    await db_session.commit()
    return user


async def test_delete_own_account_with_no_rows_still_works(db_session, throwaway_user):
    """The empty case: a user with nothing in any owned table must still delete
    cleanly, not just a user who happens to have rows everywhere."""
    user_id = throwaway_user.id

    await delete_own_account(db_session, throwaway_user)

    assert await db_session.get(User, user_id) is None


async def test_delete_own_account_cascades_every_owned_table_and_minio_object(db_session, throwaway_user):
    settings = get_settings()
    user_id = throwaway_user.id

    # Real MinIO object, so the Document row this points at is genuinely deletable
    # evidence, not just a DB row with a key that never existed.
    minio_key = f"test-account-delete/{user_id}/note.txt"
    await asyncio.to_thread(ensure_bucket_sync, settings.minio_bucket)
    await asyncio.to_thread(put_object_sync, settings.minio_bucket, minio_key, b"disposable notes", "text/plain")
    # Sanity: the object genuinely exists before we assert it's gone afterward.
    assert await asyncio.to_thread(get_object_sync, settings.minio_bucket, minio_key) == b"disposable notes"

    document = Document(user_id=user_id, filename="note.txt", mime_type="text/plain", minio_key=minio_key)
    db_session.add(document)
    await db_session.flush()

    # Caught by real live end-to-end verification: document_chunks.document_id had no
    # ondelete of its own (migration 0011), so cascading a documents row away via the
    # user's cascade used to raise an IntegrityError against its still-referencing
    # chunks. Not one of the 8 user_id tables, but a real transitive dependency of one.
    chunk = DocumentChunk(document_id=document.id, chunk_index=0, content="disposable notes")
    db_session.add(chunk)

    chat_session = ChatSession(user_id=user_id, title="scratch session")
    db_session.add(chat_session)

    study_plan_item = StudyPlanItem(user_id=user_id, title="Problem set 3")
    db_session.add(study_plan_item)

    classroom_connection = GoogleClassroomConnection(
        user_id=user_id,
        google_email="disposable@example.com",
        encrypted_access_token="encrypted-access",
        encrypted_refresh_token="encrypted-refresh",
        access_token_expires_at=datetime.now(timezone.utc),
        scopes="https://www.googleapis.com/auth/classroom.courses.readonly",
    )
    db_session.add(classroom_connection)

    flashcard = Flashcard(user_id=user_id, front="Q", back="A")
    db_session.add(flashcard)
    await db_session.flush()

    review_log = FlashcardReviewLog(flashcard_id=flashcard.id, user_id=user_id, rating=3)
    db_session.add(review_log)

    practice_exam = PracticeExam(user_id=user_id, title="Midterm review")
    db_session.add(practice_exam)

    # A superseded fact plus the fact that supersedes it (profile_facts.superseded_by
    # is a self-referential FK with no ondelete of its own) -- both rows are removed
    # by the SAME cascading delete from `users`, so this exercises that Postgres
    # genuinely resolves the self-reference within one statement rather than raising
    # an IntegrityError against its own sibling row. The partial unique index
    # (user_id, subject_key) WHERE superseded_by IS NULL only allows one "current"
    # (NULL) row at a time, so superseded_by must be set on the OLD row in the same
    # object graph that creates the new one -- never as a separate post-insert update,
    # or the two NULL rows would briefly collide.
    # Plain FK column, no ORM relationship() declared on it -- SQLAlchemy's unit of
    # work won't topologically sort a self-referential table's rows by inspecting
    # column values, so the insert order has to be forced explicitly: the superseding
    # (still-current, superseded_by NULL) row first, flushed on its own, THEN the
    # superseded row pointing at its now-real id -- inserting both in one flush risked
    # emitting the superseded row first and briefly having two NULL rows at once.
    superseding_fact = ProfileFact(user_id=user_id, subject_key="course:TEST101", value="Now solid on fractions")
    db_session.add(superseding_fact)
    await db_session.flush()

    profile_fact = ProfileFact(
        user_id=user_id,
        subject_key="course:TEST101",
        value="Struggles with fractions",
        superseded_by=superseding_fact.id,
    )
    db_session.add(profile_fact)

    await db_session.commit()

    # Sanity: every row genuinely exists before deletion, so what we assert afterward
    # is real cascade behavior and not just an always-empty table.
    assert await db_session.get(Document, document.id) is not None
    assert await db_session.get(DocumentChunk, chunk.id) is not None
    assert await db_session.get(ChatSession, chat_session.id) is not None
    assert await db_session.get(StudyPlanItem, study_plan_item.id) is not None
    assert await db_session.get(GoogleClassroomConnection, classroom_connection.id) is not None
    assert await db_session.get(Flashcard, flashcard.id) is not None
    assert await db_session.get(FlashcardReviewLog, review_log.id) is not None
    assert await db_session.get(PracticeExam, practice_exam.id) is not None
    assert await db_session.get(ProfileFact, profile_fact.id) is not None
    assert await db_session.get(ProfileFact, superseding_fact.id) is not None

    await delete_own_account(db_session, throwaway_user)

    # These rows were removed by the DB's own ON DELETE CASCADE, not by the ORM
    # deleting them one at a time -- SQLAlchemy's identity map has no way to know that
    # happened, so a plain db.get() by primary key would just hand back its (now-stale)
    # in-memory copy instead of hitting the database. Query explicitly by user_id
    # instead, which always emits real SQL, to genuinely prove "nothing left for this
    # user" in every one of the 8 owned tables rather than trusting cached objects.
    assert await db_session.get(User, user_id) is None

    for model in (
        Document,
        ChatSession,
        StudyPlanItem,
        GoogleClassroomConnection,
        Flashcard,
        FlashcardReviewLog,
        PracticeExam,
        ProfileFact,
    ):
        remaining = (await db_session.execute(select(model).where(model.user_id == user_id))).scalars().all()
        assert remaining == [], f"{model.__name__} still has rows for the deleted user"

    # DocumentChunk has no user_id of its own -- scoped by the (now-deleted) document id.
    remaining_chunks = (
        (await db_session.execute(select(DocumentChunk).where(DocumentChunk.document_id == document.id)))
        .scalars()
        .all()
    )
    assert remaining_chunks == []

    # The MinIO object itself — not just the Document row that pointed at it — is gone.
    try:
        await asyncio.to_thread(get_object_sync, settings.minio_bucket, minio_key)
        assert False, "expected the MinIO object to have been removed"
    except S3Error as exc:
        assert exc.code == "NoSuchKey"


# ---------------------------------------------------------------------------
# Router-level: auth is required, and there is no way to target another user's
# account (the endpoint takes no id at all — it only ever acts on the caller).
# ---------------------------------------------------------------------------


async def test_delete_account_requires_authentication(http_client):
    resp = await http_client.delete("/account")
    assert resp.status_code == 401


async def test_delete_account_route_accepts_no_user_id(http_client, auth_headers):
    """The route is DELETE /account with no path/query parameter for a target user —
    asserting the shape here, not actually invoking it with auth_headers (student1's
    real token), since that would delete the shared dev account other tests and
    manual verification rely on."""
    resp = await http_client.delete("/account/some-other-user-id", headers=auth_headers)
    assert resp.status_code == 404  # no such route — "delete a specific user" doesn't exist
