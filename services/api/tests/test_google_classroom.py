import base64
import json
import uuid
from datetime import date
from urllib.parse import parse_qs, urlparse

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.core import crypto as crypto_module
from app.core.config import Settings
from app.db.models import GoogleClassroomConnection, StudyPlanItem, User
from app.services import google_classroom
from app.services.google_classroom import (
    ClassroomNotConnected,
    _due_date_text,
    _parse_classroom_due_date,
    _store_tokens,
    build_authorization_url,
    sync_to_study_plan,
)

FAKE_SETTINGS = Settings(
    google_classroom_client_id="fake-client-id",
    google_classroom_client_secret="fake-client-secret",
    google_classroom_redirect_uri="http://127.0.0.1:58001/integrations/classroom/callback",
)

# ---------------------------------------------------------------------------
# Pure parsing/formatting — no DB, no network.
# ---------------------------------------------------------------------------


def test_parse_classroom_due_date_extracts_a_valid_date():
    work = {"dueDate": {"year": 2026, "month": 9, "day": 20}}
    assert _parse_classroom_due_date(work) == date(2026, 9, 20)


def test_parse_classroom_due_date_returns_none_when_absent_or_malformed():
    assert _parse_classroom_due_date({}) is None
    assert _parse_classroom_due_date({"dueDate": {"year": 2026}}) is None
    assert _parse_classroom_due_date({"dueDate": {"year": 2026, "month": 13, "day": 1}}) is None


def test_due_date_text_includes_time_when_present():
    work = {"dueDate": {"year": 2026, "month": 9, "day": 20}, "dueTime": {"hours": 23, "minutes": 59}}
    assert _due_date_text("MATH 201", work) == "MATH 201 — 2026-09-20 23:59"


def test_due_date_text_falls_back_to_course_name_with_no_due_date():
    assert _due_date_text("MATH 201", {}) == "MATH 201"


def test_build_authorization_url_has_the_expected_shape(monkeypatch):
    monkeypatch.setattr(google_classroom, "get_settings", lambda: FAKE_SETTINGS)

    url = build_authorization_url("some-state")
    parsed = urlparse(url)
    params = parse_qs(parsed.query)

    assert parsed.netloc == "accounts.google.com"
    assert params["client_id"] == ["fake-client-id"]
    assert params["redirect_uri"] == ["http://127.0.0.1:58001/integrations/classroom/callback"]
    assert params["state"] == ["some-state"]
    assert params["access_type"] == ["offline"]
    assert params["prompt"] == ["consent"]
    assert "https://www.googleapis.com/auth/classroom.courses.readonly" in params["scope"][0]


def test_build_authorization_url_raises_clearly_when_not_configured(monkeypatch):
    monkeypatch.setattr(
        google_classroom, "get_settings", lambda: Settings(google_classroom_client_id=None)
    )
    with pytest.raises(RuntimeError, match="GOOGLE_CLASSROOM_CLIENT_ID"):
        build_authorization_url("some-state")


# ---------------------------------------------------------------------------
# Encryption round-trip
# ---------------------------------------------------------------------------


def test_encrypt_decrypt_round_trip():
    # relies on the autouse _use_fake_encryption_key fixture below
    ciphertext = crypto_module.encrypt("a-real-refresh-token")
    assert ciphertext != "a-real-refresh-token"
    assert crypto_module.decrypt(ciphertext) == "a-real-refresh-token"


# ---------------------------------------------------------------------------
# DB-level: token storage and study-plan sync, with fetch_courses/fetch_coursework and
# the token endpoint faked at the function boundary rather than mocking httpx itself.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def classroom_user(db_session) -> User:
    keycloak_sub = f"test-classroom-{uuid.uuid4()}"
    user = User(keycloak_sub=keycloak_sub, email="classroom-test@example.test")
    db_session.add(user)
    await db_session.flush()
    yield user
    await db_session.execute(
        delete(StudyPlanItem).where(StudyPlanItem.user_id == user.id)
    )
    await db_session.execute(
        delete(GoogleClassroomConnection).where(GoogleClassroomConnection.user_id == user.id)
    )
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


@pytest.fixture(autouse=True)
def _use_fake_encryption_key(monkeypatch):
    from cryptography.fernet import Fernet

    fake_key = Fernet.generate_key().decode()
    monkeypatch.setattr(
        crypto_module, "get_settings", lambda: Settings(secret_encryption_key=fake_key)
    )
    crypto_module._fernet.cache_clear()
    yield
    crypto_module._fernet.cache_clear()


async def test_store_tokens_encrypts_and_round_trips(db_session, classroom_user):
    tokens = {
        "access_token": "raw-access-token",
        "refresh_token": "raw-refresh-token",
        "expires_in": 3600,
        "id_token": _fake_id_token("student@example.test"),
    }
    connection = await _store_tokens(db_session, classroom_user.id, tokens)
    await db_session.commit()

    assert connection.encrypted_access_token != "raw-access-token"
    assert connection.encrypted_refresh_token != "raw-refresh-token"
    assert crypto_module.decrypt(connection.encrypted_access_token) == "raw-access-token"
    assert crypto_module.decrypt(connection.encrypted_refresh_token) == "raw-refresh-token"
    assert connection.google_email == "student@example.test"


async def test_store_tokens_preserves_refresh_token_when_refresh_response_omits_one(
    db_session, classroom_user
):
    await _store_tokens(
        db_session,
        classroom_user.id,
        {"access_token": "first-access", "refresh_token": "first-refresh", "expires_in": 3600},
    )
    await db_session.commit()

    # a refresh grant response never includes a new refresh_token
    connection = await _store_tokens(
        db_session, classroom_user.id, {"access_token": "second-access", "expires_in": 3600}
    )
    await db_session.commit()

    assert crypto_module.decrypt(connection.encrypted_access_token) == "second-access"
    assert crypto_module.decrypt(connection.encrypted_refresh_token) == "first-refresh"


async def test_sync_raises_when_not_connected(db_session, classroom_user):
    with pytest.raises(ClassroomNotConnected):
        await sync_to_study_plan(db_session, classroom_user.id)


async def test_sync_upserts_by_external_id_instead_of_duplicating(
    db_session, classroom_user, monkeypatch
):
    await _store_tokens(
        db_session,
        classroom_user.id,
        {"access_token": "access", "refresh_token": "refresh", "expires_in": 3600},
    )
    await db_session.commit()

    monkeypatch.setattr(google_classroom, "get_valid_access_token", _fake_get_valid_access_token)
    monkeypatch.setattr(google_classroom, "fetch_courses", _fake_fetch_courses)
    monkeypatch.setattr(google_classroom, "fetch_coursework", _fake_fetch_coursework_v1)

    first = await sync_to_study_plan(db_session, classroom_user.id)
    await db_session.commit()
    assert len(first) == 1
    assert first[0].title == "Problem Set 1"
    assert first[0].due_date_text == "MATH 201 — 2026-09-20"

    # Re-sync with an updated due date for the same courseWork id — must update the
    # existing row, not create a second one.
    monkeypatch.setattr(google_classroom, "fetch_coursework", _fake_fetch_coursework_v2)
    second = await sync_to_study_plan(db_session, classroom_user.id)
    await db_session.commit()

    rows = (
        await db_session.execute(
            select(StudyPlanItem).where(
                StudyPlanItem.user_id == classroom_user.id,
                StudyPlanItem.source == "google_classroom",
            )
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].due_date_text == "MATH 201 — 2026-09-27"
    assert len(second) == 1


def _fake_id_token(email: str) -> str:
    header = base64.urlsafe_b64encode(b'{"alg":"none"}').rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(json.dumps({"email": email}).encode()).rstrip(b"=").decode()
    return f"{header}.{payload}.fakesig"


async def _fake_get_valid_access_token(db, connection):
    return "fake-access-token"


async def _fake_fetch_courses(access_token: str):
    return [{"id": "course-1", "name": "MATH 201"}]


async def _fake_fetch_coursework_v1(access_token: str, course_id: str):
    return [
        {
            "id": "coursework-1",
            "title": "Problem Set 1",
            "dueDate": {"year": 2026, "month": 9, "day": 20},
        }
    ]


async def _fake_fetch_coursework_v2(access_token: str, course_id: str):
    return [
        {
            "id": "coursework-1",
            "title": "Problem Set 1",
            "dueDate": {"year": 2026, "month": 9, "day": 27},
        }
    ]


# ---------------------------------------------------------------------------
# Router-level, against the live server (real HTTP, real auth, no Google network calls
# except through /connect, which only builds a URL and never actually contacts Google).
# ---------------------------------------------------------------------------


async def test_status_is_disconnected_by_default(http_client, auth_headers, db_session):
    await _clear_classroom_connection_for(db_session, auth_headers)
    resp = await http_client.get("/integrations/classroom/status", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {"connected": False}


async def test_connect_returns_a_google_authorization_url(http_client, auth_headers):
    resp = await http_client.get("/integrations/classroom/connect", headers=auth_headers)
    assert resp.status_code == 200
    url = resp.json()["authorization_url"]
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "integrations%2Fclassroom%2Fcallback" in url


async def test_sync_without_a_connection_returns_409(http_client, auth_headers, db_session):
    await _clear_classroom_connection_for(db_session, auth_headers)
    resp = await http_client.post("/integrations/classroom/sync", headers=auth_headers)
    assert resp.status_code == 409


async def test_disconnect_is_idempotent(http_client, auth_headers):
    resp = await http_client.delete("/integrations/classroom", headers=auth_headers)
    assert resp.status_code == 204
    resp_again = await http_client.delete("/integrations/classroom", headers=auth_headers)
    assert resp_again.status_code == 204


def _decode_sub(auth_headers: dict) -> str:
    token = auth_headers["Authorization"].removeprefix("Bearer ")
    payload = token.split(".")[1]
    padded = payload + "=" * (-len(payload) % 4)
    claims = json.loads(base64.urlsafe_b64decode(padded))
    return claims["sub"]


async def _clear_classroom_connection_for(db_session, auth_headers: dict) -> None:
    # Looked up by keycloak_sub, not email: this dev realm has had more than one
    # historical "student1" row under the same email from unrelated Keycloak-restart
    # testing earlier, and email isn't unique on the users table.
    sub = _decode_sub(auth_headers)
    user = (
        await db_session.execute(select(User).where(User.keycloak_sub == sub))
    ).scalar_one_or_none()
    if user is not None:
        await db_session.execute(
            delete(GoogleClassroomConnection).where(GoogleClassroomConnection.user_id == user.id)
        )
        await db_session.commit()
