import json
import uuid
from typing import Any

from sqlalchemy import select

from app.db.base import SessionLocal
from app.db.models import ChatMessage, ChatSession, SessionSummary
from app.memory import profile as profile_memory
from app.providers.base import ChatTurn, TextDelta
from app.providers.registry import get_provider

SUMMARY_PROMPT = """You are summarizing a tutoring session for long-term memory. \
Reply with ONLY a JSON object, no prose, in this exact shape:
{{
  "topics": ["..."],
  "problems_solved": ["..."],
  "mistakes": ["..."],
  "actions_taken": ["..."],
  "profile_facts": [{{"subject_key": "<EXAMPLE_PLACEHOLDER_DO_NOT_COPY>", "value": "<EXAMPLE_PLACEHOLDER_DO_NOT_COPY>", "confidence": 0.0}}]
}}
subject_key should look like "course:MATH201", "skill:<topic>", or "pref:<preference>". The
profile_facts entry above is a shape example only — never emit it verbatim; omit the field
entirely (empty list) unless something genuinely durable came up in this conversation.
Only include profile_facts that are genuinely durable (not one-off), and skip the field \
entirely (empty list) if nothing durable came up.

Conversation:
{transcript}
"""

# Used instead of SUMMARY_PROMPT above whenever this session already has a summary (see
# SessionSummary.last_message_created_at's docstring for why this split exists at all):
# the model merges the NEW messages into the EXISTING summary rather than re-deriving one
# from a transcript that would otherwise have to include everything said so far. Still
# the same output shape, so _parse_summary and every downstream consumer need no
# knowledge of which prompt produced it.
INCREMENTAL_SUMMARY_PROMPT = """You are updating an existing summary of a tutoring \
session with what has happened SINCE it was last written. Reply with ONLY a JSON object, \
no prose, in this exact shape:
{{
  "topics": ["..."],
  "problems_solved": ["..."],
  "mistakes": ["..."],
  "actions_taken": ["..."],
  "profile_facts": [{{"subject_key": "<EXAMPLE_PLACEHOLDER_DO_NOT_COPY>", "value": "<EXAMPLE_PLACEHOLDER_DO_NOT_COPY>", "confidence": 0.0}}]
}}
subject_key should look like "course:MATH201", "skill:<topic>", or "pref:<preference>". The
profile_facts entry above is a shape example only — never emit it verbatim; omit the field
entirely (empty list) unless something genuinely new and durable came up below.
Merge the new material into the existing summary: keep everything still relevant, drop \
nothing that's still true, and fold in what's new. The result should read as one coherent \
summary of the WHOLE session, not just the new part.

Existing summary:
{existing_summary}

What happened since then:
{transcript}
"""

# A defensive bound, matching every other "put user/conversation text into a prompt" call
# site in this codebase (app/tools/create_artifact.py's MAX_PROMPT_CHARS/MAX_BRIEF_CHARS,
# app/tools/write_research_paper.py's MAX_DOCUMENT_EXCERPT_CHARS). The incremental cursor
# below already keeps a NORMAL run's transcript to roughly one consolidation interval's
# worth of turns, but a single turn can itself be arbitrarily long (a pasted document, a
# long generated answer), so this is a backstop, not the primary bound.
MAX_TRANSCRIPT_CHARS = 12000


async def consolidate_session(ctx: dict, session_id: str) -> None:
    """Memory Tier 2: fold whatever's new since the last run into a structured summary
    of the session so far, then upsert any durable facts it revealed into Tier 3
    (deduplicated profile memory). Safe to call more than once for the same session --
    both writes below are upsert-safe (merge-in-place on a repeat run), not append-only
    -- since app/routers/chat.py's WS handler now enqueues this periodically as a
    session grows (see app/memory/working.py's CONSOLIDATION_INTERVAL_TURNS), not only
    from the original, still-supported POST /chat/sessions/{id}/end path.

    Reads only the ChatMessage rows created after SessionSummary.last_message_created_at
    (None on a first run), and asks the model to MERGE them into the existing summary
    rather than re-deriving one from the whole transcript -- see that column's own
    docstring for why re-reading everything on every run doesn't scale."""
    async with SessionLocal() as db:
        session = await db.get(ChatSession, uuid.UUID(session_id))
        if session is None:
            return

        # UPDATE-in-place, not a plain INSERT: session_summaries.session_id is UNIQUE
        # (one summary per session -- migration 0001). That was never a problem while
        # this job only ever ran once, at a real session's end, but it now also fires
        # periodically DURING an active session (see CONSOLIDATION_INTERVAL_TURNS), so
        # a second real run for the same session is an expected, normal case, not an
        # edge case -- a plain db.add() here would raise a unique-constraint
        # IntegrityError on that second run and roll back this whole transaction,
        # including the profile-fact upserts below.
        existing_summary = (
            await db.execute(select(SessionSummary).where(SessionSummary.session_id == session.id))
        ).scalar_one_or_none()

        # Only messages since the last consolidation (None on a first run, or on a
        # summary that predates migration 0020 -- both correctly read as "everything so
        # far"). This is the whole fix: the old code re-read and re-summarized the
        # ENTIRE transcript on every run, so total input tokens across a session's life
        # grew with the square of its length, not linearly -- see
        # SessionSummary.last_message_created_at's docstring.
        cursor = existing_summary.last_message_created_at if existing_summary else None
        query = select(ChatMessage).where(ChatMessage.session_id == session.id)
        if cursor is not None:
            query = query.where(ChatMessage.created_at > cursor)
        messages = (await db.execute(query.order_by(ChatMessage.created_at))).scalars().all()
        if not messages:
            return  # nothing new to fold in since the last run

        transcript = "\n".join(f"{m.role}: {m.content}" for m in messages)[-MAX_TRANSCRIPT_CHARS:]

        if existing_summary is not None and cursor is not None:
            existing_json = json.dumps(
                {
                    "topics": existing_summary.topics,
                    "problems_solved": existing_summary.problems_solved,
                    "mistakes": existing_summary.mistakes,
                    "actions_taken": existing_summary.actions_taken,
                }
            )
            prompt = INCREMENTAL_SUMMARY_PROMPT.format(existing_summary=existing_json, transcript=transcript)
        else:
            # First-ever consolidation for this session (or a pre-0020 summary with no
            # cursor yet, which gets treated as a one-time catch-up read).
            prompt = SUMMARY_PROMPT.format(transcript=transcript)

        provider, model = get_provider()
        raw = ""
        # No `tools=` passed, so this will only ever yield TextDelta events.
        async for event in provider.stream_chat([ChatTurn(role="user", content=prompt)], model):
            if isinstance(event, TextDelta):
                raw += event.text

        parsed = _parse_summary(raw)
        newest_message_at = messages[-1].created_at

        if existing_summary is not None:
            existing_summary.topics = parsed["topics"]
            existing_summary.problems_solved = parsed["problems_solved"]
            existing_summary.mistakes = parsed["mistakes"]
            existing_summary.actions_taken = parsed["actions_taken"]
            existing_summary.last_message_created_at = newest_message_at
        else:
            db.add(
                SessionSummary(
                    session_id=session.id,
                    topics=parsed["topics"],
                    problems_solved=parsed["problems_solved"],
                    mistakes=parsed["mistakes"],
                    actions_taken=parsed["actions_taken"],
                    last_message_created_at=newest_message_at,
                )
            )

        for fact in parsed["profile_facts"]:
            subject_key = fact.get("subject_key")
            value = fact.get("value")
            if not subject_key or not value:
                continue
            if "EXAMPLE_PLACEHOLDER" in subject_key or "..." in (subject_key, value):
                continue  # model (or the echo fallback) parroted the prompt's own example
            await profile_memory.upsert_fact(
                db,
                user_id=session.user_id,
                subject_key=subject_key,
                value=value,
                confidence=float(fact.get("confidence", 1.0)),
                source_session_id=session.id,
            )

        await db.commit()

    # Deliberately does NOT call app.memory.working.invalidate() here (it used to).
    # This job now fires periodically DURING an active session, not just at a real
    # session's end (see app/memory/working.py's CONSOLIDATION_INTERVAL_TURNS / the WS
    # handler's trigger) -- invalidate() drops the ENTIRE Tier-1 bundle, including the
    # raw sliding "turns" window (app.agents.tutor.run_tutor's only source of recent-
    # conversation context). get_bundle now rehydrates a dropped bundle's turns from
    # Postgres on the next read rather than returning empty (see its own docstring), so
    # this would no longer cause genuine memory loss the way it used to -- but it would
    # still force an unnecessary, avoidable Postgres round trip on this session's very
    # next turn, mid-session, for no benefit. The other half of what invalidate() was
    # for -- forcing a fresh read of Tier 3 profile facts instead of serving a stale
    # cached copy -- is already handled unconditionally on every turn regardless (see
    # app/routers/chat.py's _gather_memory_context + set_profile_facts/
    # set_retrieved_chunks, called before every single reply), so there is nothing left
    # here that actually needs forcing. Safe for the original end-of-session trigger
    # too: once a session is truly done, nothing reads its bundle again before
    # BUNDLE_TTL_SECONDS expires it anyway.


def _parse_summary(raw: str) -> dict[str, Any]:
    try:
        start = raw.index("{")
        end = raw.rindex("}") + 1
        data = json.loads(raw[start:end])
        return {
            "topics": data.get("topics", []),
            "problems_solved": data.get("problems_solved", []),
            "mistakes": data.get("mistakes", []),
            "actions_taken": data.get("actions_taken", []),
            "profile_facts": data.get("profile_facts", []),
        }
    except (ValueError, json.JSONDecodeError):
        # No real model configured (or it didn't follow the format) — keep the raw
        # output visible rather than silently dropping the session.
        return {
            "topics": [],
            "problems_solved": [],
            "mistakes": [],
            "actions_taken": [f"[unparsed summary] {raw[:500]}"],
            "profile_facts": [],
        }
