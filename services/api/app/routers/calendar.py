"""The student's own calendar: CRUD over CalendarEvent, plus the subscribable ICS feed.

Two very different auth stories live in this one file, deliberately side by side so the
difference is impossible to miss:

  * Everything under /calendar/events and /calendar/feed-url is normal app surface and
    uses the standard `require_user` + `get_or_create_user` pair every other router in
    this codebase uses -- a short-lived Keycloak bearer token, verified against JWKS in
    app/core/auth.py.

  * GET /calendar/feed/{user_id}/{token}.ics has NO `require_user` and never touches
    app/core/auth.py at all. See its own docstring for the full reasoning; the short
    version is that the caller is Google Calendar's fetcher at 3am, not a person, and it
    cannot obtain or refresh a bearer token. Its credential is a stored, per-user random
    secret compared byte-for-byte (app/services/share_tokens.py), never decoded.
"""

import datetime as dt
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.core.config import get_settings
from app.db.base import get_db
from app.db.models import CalendarEvent, StudyPlanItem, User
from app.services.ics import IcsEvent, event_uid, serialize
from app.services.share_tokens import generate_token, tokens_match
from app.services.users import get_or_create_user

router = APIRouter(prefix="/calendar", tags=["calendar"])


def _serialize(event: CalendarEvent) -> dict:
    return {
        "id": str(event.id),
        "title": event.title,
        "start_at": event.start_at.isoformat(),
        "end_at": event.end_at.isoformat() if event.end_at else None,
        "notes": event.notes,
        "created_at": event.created_at.isoformat(),
    }


class EventCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    start_at: dt.datetime
    end_at: dt.datetime | None = None
    notes: str | None = None


class EventUpdate(BaseModel):
    """Every field optional: a PATCH that only moves the time shouldn't have to resend the
    title. `end_at` is the awkward one -- an explicitly-sent `null` means "clear the end
    time", which is different from omitting it, so the handler checks
    `model_fields_set` rather than testing the value for None."""

    title: str | None = Field(default=None, min_length=1, max_length=500)
    start_at: dt.datetime | None = None
    end_at: dt.datetime | None = None
    notes: str | None = None


def _validate_range(start_at: dt.datetime, end_at: dt.datetime | None) -> None:
    if end_at is not None and end_at < start_at:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "An event can't end before it starts."
        )


@router.post("/events", status_code=status.HTTP_201_CREATED)
async def create_event(
    body: EventCreate,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    _validate_range(body.start_at, body.end_at)

    event = CalendarEvent(
        user_id=user.id,
        title=body.title.strip(),
        start_at=body.start_at,
        end_at=body.end_at,
        notes=body.notes,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return _serialize(event)


@router.get("/events")
async def list_events(
    claims: dict = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    user = await get_or_create_user(db, claims)
    rows = (
        (
            await db.execute(
                select(CalendarEvent)
                .where(CalendarEvent.user_id == user.id)
                .order_by(CalendarEvent.start_at)
            )
        )
        .scalars()
        .all()
    )
    return [_serialize(event) for event in rows]


async def _get_owned_event(db: AsyncSession, event_id: uuid.UUID, user_id: uuid.UUID) -> CalendarEvent:
    event = await db.get(CalendarEvent, event_id)
    # Someone else's event is reported as missing, not forbidden -- the same shape every
    # other router here uses, and it doesn't confirm the id exists to a stranger.
    if event is None or event.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Calendar event not found")
    return event


@router.patch("/events/{event_id}")
async def update_event(
    event_id: uuid.UUID,
    body: EventUpdate,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    event = await _get_owned_event(db, event_id, user.id)

    fields = body.model_fields_set
    if "title" in fields and body.title is not None:
        event.title = body.title.strip()
    if "start_at" in fields and body.start_at is not None:
        event.start_at = body.start_at
    if "end_at" in fields:
        event.end_at = body.end_at
    if "notes" in fields:
        event.notes = body.notes

    _validate_range(event.start_at, event.end_at)

    await db.commit()
    await db.refresh(event)
    return _serialize(event)


@router.delete("/events/{event_id}")
async def delete_event(
    event_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    event = await _get_owned_event(db, event_id, user.id)
    await db.delete(event)
    await db.commit()
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# The subscribable feed.
# ---------------------------------------------------------------------------


def _feed_urls(user: User) -> dict:
    settings = get_settings()
    base = settings.public_base_url.rstrip("/")
    url = f"{base}/calendar/feed/{user.id}/{user.calendar_feed_token}.ics"
    return {
        "url": url,
        # webcal:// is the semantically-correct scheme for "subscribe to this, don't
        # download it once", and Apple Calendar in particular will auto-open on it. It is
        # handed back alongside, not instead of, the plain http(s) URL: webcal needs an OS
        # protocol handler registered, while every calendar app that matters accepts the
        # plain URL in its own "add by URL" box. The desktop client copies `url` for that
        # reason -- see SettingsPanel.tsx.
        "webcal_url": url.replace("https://", "webcal://").replace("http://", "webcal://"),
    }


async def _ensure_feed_token(db: AsyncSession, user: User) -> None:
    """Mint the per-user feed secret on first use. Nothing backfilled it in migration 0019
    on purpose: a student who never opens this feature should never have a URL-embeddable
    credential stored at all."""
    if not user.calendar_feed_token:
        user.calendar_feed_token = generate_token()


@router.get("/feed-url")
async def get_feed_url(
    claims: dict = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> dict:
    """The student's own personal calendar subscription URL.

    Worth being explicit about, because it's the whole point of the feature: this is a
    SUBSCRIPTION url, not a one-time .ics download. Once it's pasted into Google Calendar
    ("Other calendars > From URL"), Apple Calendar ("File > New Calendar Subscription") or
    Outlook ("Add calendar > Subscribe from web"), that app refetches it on its own
    schedule -- commonly every 12-24 hours, and configurable in some clients -- forever.
    So anything that changes what this feed returns (a new event, an edited time, a
    deleted one, a freshly synced study-plan deadline) reaches the student's phone with no
    further action from them ever again. An exported .ics FILE, by contrast, is a dead
    snapshot the moment it's saved, which is exactly the confusion this endpoint exists to
    resolve.
    """
    user = await get_or_create_user(db, claims)
    await _ensure_feed_token(db, user)
    await db.commit()
    return _feed_urls(user)


@router.post("/feed-url/regenerate")
async def regenerate_feed_url(
    claims: dict = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> dict:
    """Leak recovery. A URL-embedded secret can end up in a screenshot, a shared browser
    history, or a group chat, and unlike a password there is no session to sign out of --
    so the only real remedy is to make the old value stop working. This replaces the token
    outright: every previously-handed-out link 404s from the next request onward, and the
    student re-subscribes with the new one."""
    user = await get_or_create_user(db, claims)
    user.calendar_feed_token = generate_token()
    await db.commit()
    return _feed_urls(user)


@router.get("/feed/{user_id}/{token}.ics")
async def calendar_feed(
    user_id: uuid.UUID,
    token: str,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """The actual iCalendar feed. PUBLIC by necessity, secret by construction.

    NOTE THE ABSENT DEPENDENCY: there is no `claims: dict = Depends(require_user)` here,
    and that is the entire design, not an oversight. The caller is Google's/Apple's/
    Microsoft's calendar fetcher running unattended; it cannot complete an OAuth flow,
    cannot refresh anything, and cannot set an Authorization header on a subscription it
    was given as a bare URL. Reusing this app's normal bearer token would mean either
    embedding a short-lived JWT that stops working within minutes (breaking the
    subscription permanently and silently) or issuing a never-expiring JWT, which is a
    strictly worse version of what this does -- a bearer credential with a parseable,
    forge-attackable payload instead of an opaque random string.

    So: the URL carries the user id AND a 256-bit random secret. The user row is looked up
    by id, and the secret is compared byte-for-byte with secrets.compare_digest
    (app/services/share_tokens.py). The token is never decoded, so there is no signature
    algorithm to confuse and no claims to trust.

    Every failure -- unknown user, user with no feed token minted, wrong token -- returns
    the same 404 with the same body, so this endpoint can't be used to enumerate which
    user ids exist or which of them have feeds.
    """
    user = await db.get(User, user_id)
    if user is None or not tokens_match(token, user.calendar_feed_token):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Calendar not found")

    events = await _collect_feed_events(db, user.id)
    body = serialize(events, calendar_name="Newton")
    return Response(
        content=body,
        # charset matters: RFC 5545 s3.1.4 makes UTF-8 the default but several clients
        # sniff the header, and a student's event title can contain anything.
        media_type="text/calendar; charset=utf-8",
        headers={
            # A subscribed feed is per-user private content behind a secret URL. Telling
            # every proxy in between not to keep a copy is cheap insurance; `private`
            # alone wouldn't stop a shared cache that ignores it.
            "Cache-Control": "no-store, private",
            # Suggests a sane filename if someone opens the URL in a browser and saves it,
            # without forcing a download for the calendar clients that actually matter.
            "Content-Disposition": 'inline; filename="newton.ics"',
        },
    )


async def _collect_feed_events(db: AsyncSession, user_id: uuid.UUID) -> list[IcsEvent]:
    """Both sources, merged into one feed -- the student's own calendar events AND the
    real deadlines already extracted into study_plan_items. Merging is the point: a
    student subscribes to ONE Newton calendar, not two, and a syllabus deadline that only
    existed inside the app is exactly the thing they wanted on their phone.

    Study plan items with no parsed `due_date` (the "Week 5" case -- see StudyPlanItem's
    due_date_text) are skipped rather than guessed at. An event with no date is not an
    event a calendar can show, and inventing one would put a wrong date in front of a
    student who is trusting it.
    """
    events: list[IcsEvent] = []

    calendar_rows = (
        (
            await db.execute(
                select(CalendarEvent)
                .where(CalendarEvent.user_id == user_id)
                .order_by(CalendarEvent.start_at)
            )
        )
        .scalars()
        .all()
    )
    for row in calendar_rows:
        events.append(
            IcsEvent(
                uid=event_uid("event", row.id),
                summary=row.title,
                start_at=row.start_at,
                end_at=row.end_at,
                description=row.notes,
            )
        )

    plan_rows = (
        (
            await db.execute(
                select(StudyPlanItem)
                .where(StudyPlanItem.user_id == user_id, StudyPlanItem.due_date.is_not(None))
                .order_by(StudyPlanItem.due_date)
            )
        )
        .scalars()
        .all()
    )
    for item in plan_rows:
        events.append(
            IcsEvent(
                uid=event_uid("studyplan", item.id),
                # Prefixed so a student looking at a merged calendar app can tell at a
                # glance which entries Newton derived from a syllabus and which they typed
                # themselves.
                summary=f"Due: {item.title}",
                start_date=item.due_date,
                description=item.notes,
            )
        )

    return events
