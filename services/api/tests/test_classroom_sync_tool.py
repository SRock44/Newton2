"""Covers the chat-callable sync_google_classroom tool -- the same class of gap as the
flashcard/exam/study-plan generation tools (see test_generation_tools.py's module
docstring): a real HTTP endpoint (POST /integrations/classroom/sync, triggered by a
"Sync now" UI button) existed with no way for a chat request ("sync my classroom
assignments") to trigger the same real, saved effect."""

import uuid

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import delete

from app.core.config import Settings
from app.db.models import GoogleClassroomConnection, StudyPlanItem, User
from app.services import google_classroom
from app.tools.classroom_sync import ClassroomSyncTool
from app.tools.registry import get_tool_specs, run_tool


@pytest_asyncio.fixture
async def classroom_sync_user(db_session) -> User:
    user = User(keycloak_sub=f"test-classroom-sync-{uuid.uuid4()}", plan="free")
    db_session.add(user)
    await db_session.commit()

    yield user

    await db_session.execute(delete(StudyPlanItem).where(StudyPlanItem.user_id == user.id))
    await db_session.execute(
        delete(GoogleClassroomConnection).where(GoogleClassroomConnection.user_id == user.id)
    )
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


@pytest.fixture(autouse=True)
def _use_fake_encryption_key(monkeypatch):
    from cryptography.fernet import Fernet

    from app.core import crypto as crypto_module

    fake_key = Fernet.generate_key().decode()
    monkeypatch.setattr(crypto_module, "get_settings", lambda: Settings(secret_encryption_key=fake_key))
    crypto_module._fernet.cache_clear()
    yield
    crypto_module._fernet.cache_clear()


async def _fake_get_valid_access_token(db, connection):
    return "fake-access-token"


async def _fake_fetch_courses(access_token: str):
    return [{"id": "course-1", "name": "BIO 101"}]


async def _fake_fetch_coursework(access_token: str, course_id: str):
    return [
        {"id": "cw-1", "title": "Lab report", "dueDate": {"year": 2026, "month": 10, "day": 1}}
    ]


def test_sync_google_classroom_is_registered():
    names = {t.name for t in get_tool_specs()}
    assert "sync_google_classroom" in names


async def test_run_clear_error_with_no_user():
    result = await ClassroomSyncTool().run(user_id=None)
    assert result.startswith("Error:")


async def test_run_gives_a_clear_actionable_error_when_not_connected(classroom_sync_user):
    result = await ClassroomSyncTool().run(user_id=str(classroom_sync_user.id))
    assert result.startswith("Error:")
    assert "connect" in result.lower()


async def test_run_syncs_real_items_into_the_study_plan(
    classroom_sync_user, db_session, monkeypatch
):
    await google_classroom._store_tokens(
        db_session,
        classroom_sync_user.id,
        {"access_token": "access", "refresh_token": "refresh", "expires_in": 3600},
    )
    await db_session.commit()

    monkeypatch.setattr(google_classroom, "get_valid_access_token", _fake_get_valid_access_token)
    monkeypatch.setattr(google_classroom, "fetch_courses", _fake_fetch_courses)
    monkeypatch.setattr(google_classroom, "fetch_coursework", _fake_fetch_coursework)

    result = await ClassroomSyncTool().run(user_id=str(classroom_sync_user.id))

    assert "1 item(s)" in result
    from sqlalchemy import select

    rows = (
        await db_session.execute(
            select(StudyPlanItem).where(
                StudyPlanItem.user_id == classroom_sync_user.id,
                StudyPlanItem.source == "google_classroom",
            )
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].title == "Lab report"


async def test_run_reports_a_clear_error_on_an_http_failure(
    classroom_sync_user, db_session, monkeypatch
):
    await google_classroom._store_tokens(
        db_session,
        classroom_sync_user.id,
        {"access_token": "access", "refresh_token": "refresh", "expires_in": 3600},
    )
    await db_session.commit()

    async def _boom(access_token: str):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(google_classroom, "get_valid_access_token", _fake_get_valid_access_token)
    monkeypatch.setattr(google_classroom, "fetch_courses", _boom)

    result = await ClassroomSyncTool().run(user_id=str(classroom_sync_user.id))
    assert result.startswith("Error:")


async def test_run_tool_threads_user_id_through_to_sync_google_classroom(
    classroom_sync_user, db_session, monkeypatch
):
    await google_classroom._store_tokens(
        db_session,
        classroom_sync_user.id,
        {"access_token": "access", "refresh_token": "refresh", "expires_in": 3600},
    )
    await db_session.commit()

    monkeypatch.setattr(google_classroom, "get_valid_access_token", _fake_get_valid_access_token)
    monkeypatch.setattr(google_classroom, "fetch_courses", _fake_fetch_courses)
    monkeypatch.setattr(google_classroom, "fetch_coursework", _fake_fetch_coursework)

    result = await run_tool(
        "sync_google_classroom", {}, session_id="unused", user_id=str(classroom_sync_user.id)
    )
    assert "1 item(s)" in result
