"""Personal calendar events + the subscribable ICS feed.

Same conventions as test_gamification.py: pure functions tested directly, DB-level
behaviour against real throwaway rows that are really torn down, and router-level checks
over real HTTP. Nothing here ever mutates student1's own data -- the authenticated
round-trip test creates one event and deletes it again in the same test.
"""

import datetime as dt
import re
import uuid

import pytest_asyncio
from sqlalchemy import delete, select

from app.db.models import CalendarEvent, StudyPlanItem, User
from app.services.ics import (
    MAX_LINE_OCTETS,
    IcsEvent,
    escape_text,
    event_uid,
    fold_line,
    format_date,
    format_datetime,
    serialize,
)
from app.services.share_tokens import generate_token, tokens_match

# ---------------------------------------------------------------------------
# app/services/ics.py — pure, no DB.
# ---------------------------------------------------------------------------


def test_escape_text_escapes_backslash_first():
    # If the backslash were escaped last it would double-escape the ones the other
    # replacements just introduced: "a;b" would become "a\\;b" instead of "a\;b".
    assert escape_text("a;b") == "a\\;b"
    assert escape_text("a\\b") == "a\\\\b"
    assert escape_text("a,b") == "a\\,b"
    assert escape_text("line1\nline2") == "line1\\nline2"
    assert escape_text("line1\r\nline2") == "line1\\nline2"


def test_format_datetime_is_utc_ical_form():
    value = dt.datetime(2026, 9, 17, 14, 30, 0, tzinfo=dt.timezone.utc)
    assert format_datetime(value) == "20260917T143000Z"


def test_format_datetime_converts_a_non_utc_zone():
    value = dt.datetime(2026, 9, 17, 10, 30, 0, tzinfo=dt.timezone(dt.timedelta(hours=-4)))
    assert format_datetime(value) == "20260917T143000Z"


def test_format_date_is_bare_ical_date():
    assert format_date(dt.date(2026, 9, 17)) == "20260917"


def test_fold_line_leaves_short_lines_alone():
    assert fold_line("SUMMARY:short") == ["SUMMARY:short"]


def test_fold_line_splits_on_the_octet_limit():
    line = "SUMMARY:" + ("x" * 200)
    segments = fold_line(line)
    assert len(segments) > 1
    assert segments[0].encode("utf-8").__len__() == MAX_LINE_OCTETS
    # Continuations reserve one octet for the leading space serialize() prepends.
    for segment in segments[1:]:
        assert len(segment.encode("utf-8")) <= MAX_LINE_OCTETS - 1
    assert "".join(segments) == line


def test_fold_line_never_splits_a_multibyte_character():
    line = "SUMMARY:" + ("é" * 100)  # 2 octets each
    segments = fold_line(line)
    for segment in segments:
        # Would raise if a character had been cut in half.
        segment.encode("utf-8").decode("utf-8")
    assert "".join(segments) == line


def _unfold(body: str) -> list[str]:
    """Reverse RFC 5545 line folding so assertions can look at logical content lines."""
    lines: list[str] = []
    for raw in body.split("\r\n"):
        if raw.startswith(" ") and lines:
            lines[-1] += raw[1:]
        elif raw:
            lines.append(raw)
    return lines


def test_serialize_produces_a_structurally_valid_empty_calendar():
    body = serialize([])
    assert body.endswith("\r\n")
    assert "\n" not in body.replace("\r\n", "")  # CRLF only, never a bare LF
    lines = _unfold(body)
    assert lines[0] == "BEGIN:VCALENDAR"
    assert lines[-1] == "END:VCALENDAR"
    assert "VERSION:2.0" in lines
    assert any(line.startswith("PRODID:-//Newton//") for line in lines)


def test_serialize_timed_event_has_paired_blocks_and_valid_datetimes():
    body = serialize(
        [
            IcsEvent(
                uid=event_uid("event", uuid.UUID("11111111-1111-1111-1111-111111111111")),
                summary="Chem lab",
                start_at=dt.datetime(2026, 9, 17, 14, 0, tzinfo=dt.timezone.utc),
                end_at=dt.datetime(2026, 9, 17, 16, 0, tzinfo=dt.timezone.utc),
                description="Bring goggles",
            )
        ]
    )
    lines = _unfold(body)
    assert lines.count("BEGIN:VEVENT") == 1
    assert lines.count("END:VEVENT") == 1
    assert lines.index("BEGIN:VEVENT") < lines.index("END:VEVENT")
    assert "DTSTART:20260917T140000Z" in lines
    assert "DTEND:20260917T160000Z" in lines
    assert "SUMMARY:Chem lab" in lines
    assert "DESCRIPTION:Bring goggles" in lines
    assert "UID:event-11111111-1111-1111-1111-111111111111@newton.local" in lines
    assert any(re.fullmatch(r"DTSTAMP:\d{8}T\d{6}Z", line) for line in lines)


def test_serialize_point_in_time_event_gets_a_duration_not_a_bare_dtstart():
    body = serialize(
        [
            IcsEvent(
                uid="x@newton.local",
                summary="Dentist",
                start_at=dt.datetime(2026, 9, 17, 9, 0, tzinfo=dt.timezone.utc),
                end_at=None,
            )
        ]
    )
    lines = _unfold(body)
    assert "DTSTART:20260917T090000Z" in lines
    assert "DURATION:PT30M" in lines
    assert not any(line.startswith("DTEND") for line in lines)


def test_serialize_all_day_event_uses_an_exclusive_next_day_dtend():
    body = serialize(
        [IcsEvent(uid="y@newton.local", summary="Due: Problem Set 1", start_date=dt.date(2026, 9, 20))]
    )
    lines = _unfold(body)
    assert "DTSTART;VALUE=DATE:20260920" in lines
    # Exclusive end: a one-day all-day event ends on the 21st, not the 20th.
    assert "DTEND;VALUE=DATE:20260921" in lines


def test_serialize_escapes_a_summary_that_would_otherwise_break_parsing():
    body = serialize(
        [
            IcsEvent(
                uid="z@newton.local",
                summary="Study; math, physics\nand chem",
                start_at=dt.datetime(2026, 9, 17, 9, 0, tzinfo=dt.timezone.utc),
            )
        ]
    )
    assert "SUMMARY:Study\\; math\\, physics\\nand chem" in _unfold(body)


def test_every_physical_line_respects_the_octet_limit():
    body = serialize(
        [
            IcsEvent(
                uid="long@newton.local",
                summary="A " + ("very long title " * 20),
                start_at=dt.datetime(2026, 9, 17, 9, 0, tzinfo=dt.timezone.utc),
            )
        ]
    )
    for line in body.split("\r\n"):
        assert len(line.encode("utf-8")) <= MAX_LINE_OCTETS


# ---------------------------------------------------------------------------
# app/services/share_tokens.py — the credential itself.
# ---------------------------------------------------------------------------


def test_generated_tokens_are_long_unguessable_and_unique():
    tokens = {generate_token() for _ in range(200)}
    assert len(tokens) == 200
    for token in tokens:
        # 32 bytes of entropy rendered URL-safe; nothing shorter should ever ship.
        assert len(token) >= 40
        assert re.fullmatch(r"[A-Za-z0-9_-]+", token)


def test_tokens_match_is_exact_and_rejects_empties():
    token = generate_token()
    assert tokens_match(token, token)
    assert not tokens_match(token, generate_token())
    assert not tokens_match(token[:-1], token)
    # The important one: a user with no token minted must not be matchable by a caller
    # who also supplies nothing.
    assert not tokens_match(None, None)
    assert not tokens_match("", "")
    assert not tokens_match("anything", None)


# ---------------------------------------------------------------------------
# DB + router level.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def throwaway_user(db_session):
    user = User(keycloak_sub=f"test-calendar-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()
    await db_session.commit()

    yield user

    await db_session.execute(delete(CalendarEvent).where(CalendarEvent.user_id == user.id))
    await db_session.execute(delete(StudyPlanItem).where(StudyPlanItem.user_id == user.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


async def test_feed_requires_the_right_token(http_client, db_session, throwaway_user):
    throwaway_user.calendar_feed_token = generate_token()
    await db_session.commit()

    resp = await http_client.get(f"/calendar/feed/{throwaway_user.id}/{generate_token()}.ics")
    assert resp.status_code == 404


async def test_feed_404s_for_a_user_with_no_token_minted(http_client, throwaway_user):
    assert throwaway_user.calendar_feed_token is None
    resp = await http_client.get(f"/calendar/feed/{throwaway_user.id}/{generate_token()}.ics")
    assert resp.status_code == 404


async def test_feed_404s_for_an_unknown_user_id(http_client):
    resp = await http_client.get(f"/calendar/feed/{uuid.uuid4()}/{generate_token()}.ics")
    assert resp.status_code == 404


async def test_feed_serves_real_ics_merging_events_and_study_plan_items(
    http_client, db_session, throwaway_user
):
    """The end-to-end shape that actually matters: a real HTTP fetch, with NO
    Authorization header (exactly what a calendar app's fetcher sends), returning content
    that parses as structurally valid iCalendar and contains both sources."""
    token = generate_token()
    throwaway_user.calendar_feed_token = token
    db_session.add(
        CalendarEvent(
            user_id=throwaway_user.id,
            title="Chem lab",
            start_at=dt.datetime(2026, 9, 17, 14, 0, tzinfo=dt.timezone.utc),
            end_at=dt.datetime(2026, 9, 17, 16, 0, tzinfo=dt.timezone.utc),
            notes="Bring goggles",
        )
    )
    db_session.add(
        StudyPlanItem(
            user_id=throwaway_user.id, title="Problem Set 1", due_date=dt.date(2026, 9, 20)
        )
    )
    # No parsed date -- must be skipped rather than guessed at.
    db_session.add(
        StudyPlanItem(user_id=throwaway_user.id, title="Reading Response", due_date_text="Week 3")
    )
    await db_session.commit()

    resp = await http_client.get(f"/calendar/feed/{throwaway_user.id}/{token}.ics")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/calendar")

    body = resp.text
    lines = _unfold(body)
    assert lines[0] == "BEGIN:VCALENDAR"
    assert lines[-1] == "END:VCALENDAR"
    assert lines.count("BEGIN:VEVENT") == 2
    assert lines.count("END:VEVENT") == 2
    assert "SUMMARY:Chem lab" in lines
    assert "SUMMARY:Due: Problem Set 1" in lines
    assert "Reading Response" not in body
    assert "DTSTART:20260917T140000Z" in lines
    assert "DTEND:20260917T160000Z" in lines
    assert "DTSTART;VALUE=DATE:20260920" in lines
    # Every DTSTART/DTEND is a real iCal datetime or date, not something improvised.
    for line in lines:
        if line.startswith("DTSTART:") or line.startswith("DTEND:") or line.startswith("DTSTAMP:"):
            assert re.fullmatch(r"(DTSTART|DTEND|DTSTAMP):\d{8}T\d{6}Z", line), line
        elif line.startswith("DTSTART;VALUE=DATE:") or line.startswith("DTEND;VALUE=DATE:"):
            assert re.fullmatch(r"(DTSTART|DTEND);VALUE=DATE:\d{8}", line), line


async def test_feed_does_not_leak_another_users_events(http_client, db_session, throwaway_user):
    token = generate_token()
    throwaway_user.calendar_feed_token = token

    other = User(keycloak_sub=f"test-calendar-other-{uuid.uuid4()}")
    db_session.add(other)
    await db_session.flush()
    db_session.add(
        CalendarEvent(
            user_id=other.id,
            title="Somebody Else Secret Event",
            start_at=dt.datetime(2026, 9, 17, 14, 0, tzinfo=dt.timezone.utc),
        )
    )
    await db_session.commit()
    try:
        resp = await http_client.get(f"/calendar/feed/{throwaway_user.id}/{token}.ics")
        assert resp.status_code == 200
        assert "Somebody Else Secret Event" not in resp.text
    finally:
        await db_session.execute(delete(CalendarEvent).where(CalendarEvent.user_id == other.id))
        await db_session.execute(delete(User).where(User.id == other.id))
        await db_session.commit()


async def test_event_endpoints_require_auth(http_client):
    assert (await http_client.get("/calendar/events")).status_code == 401
    assert (await http_client.post("/calendar/events", json={})).status_code == 401
    assert (await http_client.get("/calendar/feed-url")).status_code == 401


async def test_create_list_update_delete_round_trip(http_client, auth_headers, db_session):
    """A real authenticated CRUD cycle against the live server as student1, cleaning up
    after itself so the shared dev account is left exactly as it was found."""
    created = await http_client.post(
        "/calendar/events",
        headers=auth_headers,
        json={
            "title": "pytest throwaway event",
            "start_at": "2026-09-17T14:00:00+00:00",
            "end_at": "2026-09-17T16:00:00+00:00",
            "notes": "created by test_calendar.py",
        },
    )
    assert created.status_code == 201
    event = created.json()
    event_id = event["id"]

    try:
        assert event["title"] == "pytest throwaway event"
        assert event["end_at"] is not None

        listed = await http_client.get("/calendar/events", headers=auth_headers)
        assert listed.status_code == 200
        assert any(item["id"] == event_id for item in listed.json())

        patched = await http_client.patch(
            f"/calendar/events/{event_id}",
            headers=auth_headers,
            json={"title": "pytest renamed event", "end_at": None},
        )
        assert patched.status_code == 200
        assert patched.json()["title"] == "pytest renamed event"
        # An explicit null really clears the end time (as opposed to being ignored).
        assert patched.json()["end_at"] is None
    finally:
        deleted = await http_client.delete(f"/calendar/events/{event_id}", headers=auth_headers)
        assert deleted.status_code == 200
        # Belt and braces: make sure the row is genuinely gone from the shared database.
        remaining = (
            await db_session.execute(
                select(CalendarEvent).where(CalendarEvent.id == uuid.UUID(event_id))
            )
        ).scalars().first()
        assert remaining is None


async def test_create_rejects_an_end_before_the_start(http_client, auth_headers):
    resp = await http_client.post(
        "/calendar/events",
        headers=auth_headers,
        json={
            "title": "pytest backwards event",
            "start_at": "2026-09-17T16:00:00+00:00",
            "end_at": "2026-09-17T14:00:00+00:00",
        },
    )
    assert resp.status_code == 422


async def test_update_and_delete_reject_someone_elses_event(
    http_client, auth_headers, db_session, throwaway_user
):
    event = CalendarEvent(
        user_id=throwaway_user.id,
        title="not student1's event",
        start_at=dt.datetime(2026, 9, 17, 14, 0, tzinfo=dt.timezone.utc),
    )
    db_session.add(event)
    await db_session.commit()

    patched = await http_client.patch(
        f"/calendar/events/{event.id}", headers=auth_headers, json={"title": "hijacked"}
    )
    assert patched.status_code == 404
    deleted = await http_client.delete(f"/calendar/events/{event.id}", headers=auth_headers)
    assert deleted.status_code == 404

    await db_session.refresh(event)
    assert event.title == "not student1's event"


def _feed_path(url: str) -> str:
    """The server-relative path of a feed URL, so it can be refetched through the
    base_url-bound http_client regardless of what public_base_url is configured as."""
    return "/calendar/" + url.split("/calendar/", 1)[1]


@pytest_asyncio.fixture
async def restore_student1_feed_token(db_session, keycloak_token):
    """The regenerate test below necessarily rotates the REAL signed-in account's feed
    secret. That secret is this test account's own live credential, so it is snapshotted
    here and written back afterwards -- the shared dev account is left byte-for-byte as it
    was found, and any calendar subscription anyone set up against it keeps working."""
    from jose import jwt

    sub = jwt.get_unverified_claims(keycloak_token)["sub"]
    user = (await db_session.execute(select(User).where(User.keycloak_sub == sub))).scalars().first()
    original = user.calendar_feed_token if user is not None else None

    yield

    if user is not None:
        await db_session.refresh(user)
        user.calendar_feed_token = original
        await db_session.commit()


async def test_feed_url_is_stable_until_regenerated(
    http_client, auth_headers, restore_student1_feed_token
):
    first = await http_client.get("/calendar/feed-url", headers=auth_headers)
    assert first.status_code == 200
    first_url = first.json()["url"]
    assert "/calendar/feed/" in first_url and first_url.endswith(".ics")
    assert first.json()["webcal_url"].startswith("webcal://")

    # Asking again must NOT mint a new secret -- a student who re-opens Settings should
    # not silently break the subscription they already set up.
    again = await http_client.get("/calendar/feed-url", headers=auth_headers)
    assert again.json()["url"] == first_url

    # The URL works before regeneration...
    assert (await http_client.get(_feed_path(first_url))).status_code == 200

    regenerated = await http_client.post("/calendar/feed-url/regenerate", headers=auth_headers)
    assert regenerated.status_code == 200
    new_url = regenerated.json()["url"]
    assert new_url != first_url

    # ...and the leaked one is dead the moment it's rotated, while the new one works.
    assert (await http_client.get(_feed_path(first_url))).status_code == 404
    assert (await http_client.get(_feed_path(new_url))).status_code == 200
