"""A minimal but genuinely RFC 5545-correct iCalendar writer.

Hand-rolled on purpose: nothing in services/api/requirements.txt provides iCalendar
support (checked -- the closest things there are genanki, python-pptx and python-docx,
none of which touch this format), and the subset needed here is small, stable, and
entirely text. Adding a dependency for it would mean a real Docker image rebuild for a
few dozen lines of string formatting.

What "correct" means here, and what this file actually implements rather than hand-waves:

  * CRLF line endings everywhere (RFC 5545 s3.1). Not "\\n" -- several real parsers,
    Outlook's included, are strict about this.
  * Content lines folded at 75 OCTETS, continuation lines beginning with a single space
    (s3.1). Folding counts UTF-8 bytes, not characters, and never splits a multi-byte
    character across the fold -- a student's event title can contain any character at all.
  * TEXT values escaped (s3.3.11): backslash, semicolon, comma, and newline -> \\n.
  * Every VEVENT carries UID and DTSTAMP, which s3.6.1 makes mandatory, plus DTSTART.
  * Stable UIDs -- derived from the row's own primary key, so a calendar client refetching
    the feed UPDATES the event it already has instead of creating a duplicate. This is the
    single most important property for a subscribed feed and the easiest to get wrong.
  * A stable PRODID identifying this software (s3.7.3).

Timed vs all-day is a real distinction, not a formatting detail:
  * A CalendarEvent has a timestamp, so it is emitted as a UTC DATE-TIME
    ("19980118T230000Z", s3.3.5 form 2).
  * A StudyPlanItem has a DATE with no time of day ("this is due Thursday"), so it is
    emitted as a real all-day event: DTSTART;VALUE=DATE with a DTEND;VALUE=DATE of the
    NEXT day, because DTEND is exclusive (s3.6.1). Emitting the same date for both is the
    classic off-by-one that makes all-day events vanish in Google Calendar.
"""

from __future__ import annotations

import datetime as dt
import uuid as uuid_mod
from dataclasses import dataclass

PRODID = "-//Newton//Newton Study Companion//EN"
# The RFC 5545 line-length limit, in octets, excluding the CRLF.
MAX_LINE_OCTETS = 75

# A point-in-time event (CalendarEvent.end_at is NULL -- "Dentist, 9am") still has to
# produce a VEVENT with a real extent. RFC 5545 permits DTSTART alone and defines the
# duration as zero for a DATE-TIME start, but a zero-length event renders as an
# easy-to-miss hairline (or is dropped outright) in several real clients. A nominal
# half-hour DURATION is honest about being nominal -- it is not a made-up DTEND stored
# anywhere, just how a point in time is drawn -- and makes the event actually visible.
DEFAULT_DURATION = "PT30M"


@dataclass(frozen=True)
class IcsEvent:
    """One VEVENT's worth of already-resolved data. Deliberately not the ORM rows
    themselves: this module stays a pure, dependency-free formatter that is trivial to
    test, and the router owns the mapping from its two different source tables."""

    uid: str
    summary: str
    # Exactly one of these is set. `start_at` means a timed event; `start_date` means a
    # real all-day event.
    start_at: dt.datetime | None = None
    end_at: dt.datetime | None = None
    start_date: dt.date | None = None
    description: str | None = None


def escape_text(value: str) -> str:
    """RFC 5545 s3.3.11 TEXT escaping. Backslash FIRST -- escaping it after the others
    would double-escape the backslashes they just introduced."""
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
        .replace("\r", "\\n")
    )


def format_datetime(value: dt.datetime) -> str:
    """UTC DATE-TIME, e.g. 20260916T143000Z. A naive datetime is treated as already-UTC
    rather than guessed at: everything in this app's database is timezone-aware
    (DateTime(timezone=True) throughout app/db/models.py), so a naive value here means a
    test constructed one, and inventing a local zone for it would be worse than assuming
    the one the database actually stores."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def format_date(value: dt.date) -> str:
    return value.strftime("%Y%m%d")


def fold_line(line: str) -> list[str]:
    """Split one content line into folded segments of at most 75 octets each, per s3.1.

    Works in UTF-8 bytes because the limit is defined in octets, but advances character by
    character so a multi-byte character is never cut in half (which would produce invalid
    UTF-8 that some parsers reject outright and others render as mojibake). Continuation
    segments are returned WITHOUT their leading space; serialize() adds it, so the caller
    can't accidentally count it twice.
    """
    encoded = line.encode("utf-8")
    if len(encoded) <= MAX_LINE_OCTETS:
        return [line]

    segments: list[str] = []
    current = ""
    current_octets = 0
    # The first segment may use the full 75; every continuation loses one octet to the
    # leading space that will be prepended to it.
    limit = MAX_LINE_OCTETS
    for char in line:
        char_octets = len(char.encode("utf-8"))
        if current_octets + char_octets > limit:
            segments.append(current)
            current = ""
            current_octets = 0
            limit = MAX_LINE_OCTETS - 1
        current += char
        current_octets += char_octets
    if current:
        segments.append(current)
    return segments


def serialize(events: list[IcsEvent], calendar_name: str = "Newton") -> str:
    """The whole VCALENDAR, CRLF-terminated, ready to serve as text/calendar.

    An empty event list still produces a valid, well-formed, empty calendar -- a brand new
    student's feed must not 404 or return garbage, because their calendar app subscribed
    once and will keep refetching this URL forever; a hard error on their first sync is
    how a subscription gets silently dropped by the client.
    """
    now = format_datetime(dt.datetime.now(dt.timezone.utc))

    lines: list[str] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        "CALSCALE:GREGORIAN",
        # PUBLISH is the correct METHOD for a read-only feed being subscribed to, as
        # opposed to REQUEST (a meeting invitation expecting an RSVP).
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{escape_text(calendar_name)}",
    ]

    for event in events:
        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{event.uid}")
        lines.append(f"DTSTAMP:{now}")

        if event.start_date is not None:
            lines.append(f"DTSTART;VALUE=DATE:{format_date(event.start_date)}")
            # Exclusive end -- a one-day all-day event ends the NEXT day. See the module
            # docstring.
            lines.append(f"DTEND;VALUE=DATE:{format_date(event.start_date + dt.timedelta(days=1))}")
        elif event.start_at is not None:
            lines.append(f"DTSTART:{format_datetime(event.start_at)}")
            if event.end_at is not None and event.end_at > event.start_at:
                lines.append(f"DTEND:{format_datetime(event.end_at)}")
            else:
                # Covers both "no end recorded" and a stored end that isn't actually after
                # the start (which would be an invalid VEVENT, and which a calendar client
                # would reject for the whole feed, not just this one event).
                lines.append(f"DURATION:{DEFAULT_DURATION}")
        else:  # pragma: no cover - IcsEvent construction sites always set one of the two
            raise ValueError(f"IcsEvent {event.uid} has neither start_at nor start_date")

        lines.append(f"SUMMARY:{escape_text(event.summary)}")
        if event.description:
            lines.append(f"DESCRIPTION:{escape_text(event.description)}")
        lines.append("END:VEVENT")

    lines.append("END:VCALENDAR")

    folded: list[str] = []
    for line in lines:
        segments = fold_line(line)
        folded.append(segments[0])
        folded.extend(" " + segment for segment in segments[1:])
    # Trailing CRLF included: RFC 5545 content lines are terminated, not separated.
    return "\r\n".join(folded) + "\r\n"


def event_uid(kind: str, row_id: uuid_mod.UUID) -> str:
    """A stable, globally-unique UID for one row. `kind` namespaces the two source tables
    so the feed is self-describing, and the @newton.local domain part satisfies RFC 5545's
    recommendation that a UID look like an addr-spec without claiming a real hostname this
    app doesn't own."""
    return f"{kind}-{row_id}@newton.local"
