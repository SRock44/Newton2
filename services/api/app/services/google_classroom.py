import base64
import json
import uuid
from datetime import date, datetime, timezone
from urllib.parse import urlencode

import httpx
import redis.asyncio as redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.crypto import decrypt, encrypt
from app.db.models import GoogleClassroomConnection, StudyPlanItem

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
CLASSROOM_API = "https://classroom.googleapis.com/v1"

# Deliberately minimal and read-only: this connector reads a student's own courses and
# assignments to build a study plan, nothing more. Kept separate from the Keycloak-
# brokered Google *login* scope (`openid email profile` only) even though both reuse the
# same Google Cloud OAuth client -- a user can sign in with Google without ever seeing a
# Classroom consent screen, and vice versa.
SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
]

# Refreshed this far ahead of actual expiry so a slow sync never loses the race against
# the token dying mid-request -- same buffer convention as the desktop app's TokenManager.
EXPIRY_BUFFER_SECONDS = 60


class ClassroomNotConnected(Exception):
    pass


_redis: redis.Redis | None = None
STATE_TTL_SECONDS = 600


def _get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.from_url(get_settings().redis_url, decode_responses=True)
    return _redis


def _state_key(state: str) -> str:
    return f"newton:classroom:oauth_state:{state}"


async def store_oauth_state(state: str, user_id: uuid.UUID) -> None:
    """The browser hop to Google and back means the callback below can't carry our own
    bearer token -- it correlates back to the user who started the flow via this
    short-lived, one-time-use mapping instead."""
    await _get_redis().set(_state_key(state), str(user_id), ex=STATE_TTL_SECONDS)


async def pop_oauth_state(state: str) -> uuid.UUID | None:
    key = _state_key(state)
    raw = await _get_redis().get(key)
    if raw is None:
        return None
    await _get_redis().delete(key)
    return uuid.UUID(raw)


def _require_client_config() -> tuple[str, str, str]:
    settings = get_settings()
    if settings.google_classroom_client_id is None or settings.google_classroom_client_secret is None:
        raise RuntimeError(
            "GOOGLE_CLASSROOM_CLIENT_ID / GOOGLE_CLASSROOM_CLIENT_SECRET are not set. "
            "Same Google Cloud OAuth client as the Keycloak Google IdP -- see "
            "infra/keycloak/setup_google_idp.py."
        )
    return (
        settings.google_classroom_client_id,
        settings.google_classroom_client_secret.get_secret_value(),
        settings.google_classroom_redirect_uri,
    )


def build_authorization_url(state: str) -> str:
    client_id, _secret, redirect_uri = _require_client_config()
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        # Forces Google to reissue a refresh_token even for a user reconnecting after a
        # prior grant -- without this, a repeat consent can come back with no
        # refresh_token at all, silently breaking the "connect once" expectation.
        "prompt": "consent",
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def _decode_id_token_email(id_token: str) -> str | None:
    """Display-only extraction, not a verification -- we fetched this token directly from
    Google's own token endpoint over TLS, not from a client that could have forged it."""
    try:
        payload = id_token.split(".")[1]
        padded = payload + "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded))
        email = claims.get("email")
        return email if isinstance(email, str) else None
    except Exception:
        return None


async def _token_request(data: dict[str, str]) -> dict:
    client_id, client_secret, redirect_uri = _require_client_config()
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            TOKEN_URL,
            data={"client_id": client_id, "client_secret": client_secret, **data},
        )
        resp.raise_for_status()
        return resp.json()


async def connect(db: AsyncSession, user_id: uuid.UUID, code: str) -> GoogleClassroomConnection:
    """Exchanges an authorization code for tokens and upserts the connection row."""
    _client_id, _secret, redirect_uri = _require_client_config()
    tokens = await _token_request(
        {"code": code, "grant_type": "authorization_code", "redirect_uri": redirect_uri}
    )
    return await _store_tokens(db, user_id, tokens)


async def _store_tokens(db: AsyncSession, user_id: uuid.UUID, tokens: dict) -> GoogleClassroomConnection:
    existing = (
        await db.execute(
            select(GoogleClassroomConnection).where(GoogleClassroomConnection.user_id == user_id)
        )
    ).scalar_one_or_none()

    expires_at = datetime.now(timezone.utc).timestamp() + tokens["expires_in"]
    email = _decode_id_token_email(tokens["id_token"]) if "id_token" in tokens else None

    if existing is None:
        if "refresh_token" not in tokens:
            raise RuntimeError(
                "Google didn't return a refresh_token on first connect -- this shouldn't "
                "happen with access_type=offline and prompt=consent; check the OAuth client."
            )
        existing = GoogleClassroomConnection(
            user_id=user_id,
            google_email=email,
            encrypted_access_token=encrypt(tokens["access_token"]),
            encrypted_refresh_token=encrypt(tokens["refresh_token"]),
            access_token_expires_at=datetime.fromtimestamp(expires_at, tz=timezone.utc),
            scopes=" ".join(SCOPES),
        )
        db.add(existing)
    else:
        existing.encrypted_access_token = encrypt(tokens["access_token"])
        if "refresh_token" in tokens:
            existing.encrypted_refresh_token = encrypt(tokens["refresh_token"])
        existing.access_token_expires_at = datetime.fromtimestamp(expires_at, tz=timezone.utc)
        if email:
            existing.google_email = email

    await db.flush()
    return existing


async def get_connection(db: AsyncSession, user_id: uuid.UUID) -> GoogleClassroomConnection | None:
    return (
        await db.execute(
            select(GoogleClassroomConnection).where(GoogleClassroomConnection.user_id == user_id)
        )
    ).scalar_one_or_none()


async def disconnect(db: AsyncSession, user_id: uuid.UUID) -> None:
    connection = await get_connection(db, user_id)
    if connection is not None:
        await db.delete(connection)
        await db.flush()


async def get_valid_access_token(db: AsyncSession, connection: GoogleClassroomConnection) -> str:
    now = datetime.now(timezone.utc)
    if connection.access_token_expires_at.timestamp() - EXPIRY_BUFFER_SECONDS > now.timestamp():
        return decrypt(connection.encrypted_access_token)

    refresh_token = decrypt(connection.encrypted_refresh_token)
    tokens = await _token_request({"refresh_token": refresh_token, "grant_type": "refresh_token"})
    # A refresh response never includes a new refresh_token (Google keeps the original
    # valid), so _store_tokens correctly leaves the encrypted refresh token untouched.
    await _store_tokens(db, connection.user_id, tokens)
    return tokens["access_token"]


async def fetch_courses(access_token: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            f"{CLASSROOM_API}/courses",
            params={"courseStates": "ACTIVE"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        return resp.json().get("courses", [])


async def fetch_coursework(access_token: str, course_id: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            f"{CLASSROOM_API}/courses/{course_id}/courseWork",
            params={"courseWorkStates": "PUBLISHED"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        return resp.json().get("courseWork", [])


def _parse_classroom_due_date(coursework: dict) -> date | None:
    due = coursework.get("dueDate")
    if not isinstance(due, dict) or not all(k in due for k in ("year", "month", "day")):
        return None
    try:
        return date(due["year"], due["month"], due["day"])
    except (KeyError, ValueError):
        return None


def _due_date_text(course_name: str, coursework: dict) -> str:
    due_time = coursework.get("dueTime")
    due_date = _parse_classroom_due_date(coursework)
    if due_date is None:
        return course_name
    if isinstance(due_time, dict) and "hours" in due_time:
        return f"{course_name} — {due_date.isoformat()} {due_time['hours']:02d}:{due_time.get('minutes', 0):02d}"
    return f"{course_name} — {due_date.isoformat()}"


async def sync_to_study_plan(db: AsyncSession, user_id: uuid.UUID) -> list[StudyPlanItem]:
    """Pulls every active course's published coursework and upserts it into
    study_plan_items by external_id (the Classroom courseWork id), so re-syncing updates
    existing rows (a due date can move) instead of piling up duplicates."""
    connection = await get_connection(db, user_id)
    if connection is None:
        raise ClassroomNotConnected("Google Classroom is not connected for this user.")

    access_token = await get_valid_access_token(db, connection)
    courses = await fetch_courses(access_token)

    existing_by_external_id = {
        item.external_id: item
        for item in (
            await db.execute(
                select(StudyPlanItem).where(
                    StudyPlanItem.user_id == user_id,
                    StudyPlanItem.source == "google_classroom",
                )
            )
        )
        .scalars()
        .all()
    }

    synced: list[StudyPlanItem] = []
    for course in courses:
        course_id = course.get("id")
        course_name = course.get("name", "Classroom")
        if not course_id:
            continue
        for work in await fetch_coursework(access_token, course_id):
            external_id = work.get("id")
            title = work.get("title")
            if not external_id or not title:
                continue

            row = existing_by_external_id.get(external_id)
            if row is None:
                row = StudyPlanItem(user_id=user_id, source="google_classroom", external_id=external_id)
                db.add(row)

            row.title = str(title)[:500]
            row.due_date = _parse_classroom_due_date(work)
            row.due_date_text = _due_date_text(course_name, work)
            row.notes = work.get("alternateLink") if isinstance(work.get("alternateLink"), str) else None
            synced.append(row)

    await db.flush()
    return synced
