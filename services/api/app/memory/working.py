import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.redis_client import get_redis
from app.db.base import SessionLocal
from app.db.models import ChatMessage

BUNDLE_TTL_SECONDS = 2 * 60 * 60
MAX_TURNS = 20

# Tier-1 -> Tier-2 compaction trigger (ROADMAP.md): app/jobs/consolidate.py's
# consolidate_session re-summarizes a session's FULL persisted transcript and upserts
# any durable facts into Tier 3 -- real and well-tested, but it used to only ever fire
# from the dead POST /chat/sessions/{id}/end path (nothing in the real desktop app ever
# calls it), so it essentially never ran. app/routers/chat.py's WS handler now enqueues
# it periodically instead, using `turns_since_consolidation` (maintained by append_turn
# below, in the exact same units as MAX_TURNS -- one increment per appended turn,
# either role) via should_consolidate()/mark_consolidated() below.
#
# Chosen cadence: fire once every CONSOLIDATION_INTERVAL_TURNS appended turns, the same
# value as MAX_TURNS itself. Concretely: the first consolidation fires the moment the
# sliding window first fills (turn 20, ~10 exchanges in -- matching the ~10-exchange
# point where per-turn cost was measured to plateau), and it repeats every 20 turns
# after that (40, 60, 80, ...), i.e. once per additional full window's worth of
# conversation. consolidate_session is one real model call over the session's entire
# transcript so far (see app/jobs/consolidate.py) -- a real cost, but a single call, and
# firing it this rarely means that one call amortizes over at least ~10 of the
# window-full, cost-inflated turns it exists to eventually let shrink (a future,
# separate tuning pass can lower MAX_TURNS once this compaction is proven reliable in
# production -- deliberately not bundled into this change). A tighter interval would
# pay for more, smaller summarization calls without a proportional benefit (the facts
# it extracts don't go stale meaningfully faster than that); a looser one would leave
# more turns' worth of durable facts uncaptured for longer if a session ends
# abruptly. 20 was picked as the middle of that range, tied to a number (MAX_TURNS)
# this file already defines rather than a second, unrelated magic constant.
CONSOLIDATION_INTERVAL_TURNS = MAX_TURNS


def _bundle_key(session_id: str) -> str:
    return f"newton:session:{session_id}:bundle"


async def _rehydrate_from_postgres(session_id: str) -> dict | None:
    """Cold-cache recovery for get_bundle below (real, confirmed bug -- see
    ROADMAP.md): a student returning to an existing chat after more than
    BUNDLE_TTL_SECONDS/2 hours idle used to get a Tutor with genuinely zero memory of
    that conversation, even though the full transcript is sitting right there in
    Postgres -- app/agents/tutor.py's run_tutor only ever reads bundle["turns"], never
    ChatMessage directly, and get_bundle used to just return an empty default on any
    Redis miss with no fallback at all.

    Opens its own short-lived DB session (the same self-contained pattern app/agents/
    tutor.py's _load_user and app/routers/chat.py's _gather_memory_context helpers
    already use) rather than threading one through get_bundle's signature -- get_bundle
    is called from several places in THIS module alone (append_turn, set_profile_facts,
    set_retrieved_chunks, mark_consolidated), not just app/agents/tutor.py's run_tutor,
    and rehydration has to work correctly no matter which of those hits the cold cache
    first. That matters concretely: app/routers/chat.py's WS handler calls append_turn
    with the student's new message BEFORE it calls run_tutor, so if rehydration were
    only bolted onto run_tutor's own get_bundle call, append_turn's earlier call would
    already have overwritten a cold Redis key with a single-turn bundle by the time
    run_tutor asked for it. Putting rehydration inside get_bundle itself -- its one
    real home -- means every call site benefits uniformly for free.

    Pulls back only the most recent MAX_TURNS messages, the same window size
    append_turn already caps the live `turns` list at, so a cold rehydrate and a warm
    cache read are indistinguishable to run_tutor. Returns None (never an empty-turns
    dict) when the session genuinely has no prior messages at all -- that's the ONE
    query this does either way (there's no separate, extra existence check), so a
    brand-new session still costs exactly one cheap query, same as before this fix, and
    still gets no Redis write."""
    async with SessionLocal() as db:
        rows = (
            (
                await db.execute(
                    select(ChatMessage)
                    .where(ChatMessage.session_id == uuid.UUID(session_id))
                    .order_by(ChatMessage.created_at.desc())
                    .limit(MAX_TURNS)
                )
            )
            .scalars()
            .all()
        )
    if not rows:
        return None
    rows.reverse()  # DESC -> chronological: oldest of the window first, like append_turn
    return {
        "turns": [{"role": row.role, "content": row.content} for row in rows],
        "profile_facts": [],
        "retrieved_chunks": [],
        # Reset, not carried over from nothing (there IS nothing to carry over -- this
        # is a fresh rehydration). The durable Tier-3 facts layer, not this counter, is
        # what's supposed to carry "what we covered before this gap" across a cold
        # start, so starting the periodic-consolidation clock over from 0 here is the
        # right default rather than trying to reconstruct a stale count.
        "turns_since_consolidation": 0,
        "updated_at": None,
    }


async def _get_bundle(session_id: str) -> tuple[dict, bool]:
    """Real implementation behind get_bundle below, plus a second return value --
    `just_rehydrated` -- that ONLY append_turn needs (see its own comment on why) to
    avoid double-counting a turn on a cold cache. Every other caller (get_bundle itself,
    set_profile_facts, set_retrieved_chunks, mark_consolidated) just ignores it.

    On a cold cache (missing/expired Redis key), rehydrates from Postgres -- see
    _rehydrate_from_postgres above -- rather than silently returning an empty bundle
    for a session that actually has history. The rehydrated bundle is cached back into
    Redis immediately (_save), so this Postgres round trip is paid once per cold start,
    not on every subsequent turn in the same active stretch. A genuinely new/empty
    session still gets the plain empty default with no Redis write, exactly as before."""
    raw = await get_redis().get(_bundle_key(session_id))
    if raw:
        return json.loads(raw), False
    bundle = await _rehydrate_from_postgres(session_id)
    if bundle is None:
        return {"turns": [], "profile_facts": [], "retrieved_chunks": [], "updated_at": None}, False
    await _save(session_id, bundle)
    return bundle, True


async def get_bundle(session_id: str) -> dict:
    """Tier 1: the assembled context bundle for an active session — recent turns plus
    retrieved profile facts and retrieved document chunks, cached in Redis and reused
    across turns instead of being rebuilt from Postgres on every message. See
    _get_bundle above for the real cache/rehydration logic."""
    bundle, _just_rehydrated = await _get_bundle(session_id)
    return bundle


async def _save(session_id: str, bundle: dict) -> None:
    bundle["updated_at"] = datetime.now(timezone.utc).isoformat()
    await get_redis().set(_bundle_key(session_id), json.dumps(bundle), ex=BUNDLE_TTL_SECONDS)


async def append_turn(session_id: str, role: str, content: str) -> dict:
    bundle, just_rehydrated = await _get_bundle(session_id)
    if (
        just_rehydrated
        and bundle["turns"]
        and bundle["turns"][-1]["role"] == role
        and bundle["turns"][-1]["content"] == content
    ):
        # Every real call site (app/routers/chat.py's WS handler, in all three places
        # it calls append_turn) always persists the ChatMessage row to Postgres and
        # commits it BEFORE calling append_turn for that same turn. On a cold cache,
        # _rehydrate_from_postgres's query therefore already picks up THIS turn's own
        # row as the newest message in Postgres -- appending it again below would
        # silently duplicate the tail of `turns`. Drop that duplicate: it's this call's
        # own row, not a coincidental unrelated repeat (just_rehydrated is only True
        # right when the cache was genuinely cold, never on the steady-state warm
        # path this same equality check would otherwise risk false-matching on).
        bundle["turns"] = bundle["turns"][:-1]
    bundle["turns"].append({"role": role, "content": content})
    bundle["turns"] = bundle["turns"][-MAX_TURNS:]
    # Deliberately NOT capped like "turns" above -- this counts every turn ever
    # appended since the last consolidation (or since the bundle was created/
    # invalidated), even ones that have already aged out of the capped window, so
    # should_consolidate() below can tell "the window has filled N more times since we
    # last consolidated" rather than just "is the window currently full" (which,
    # capped at MAX_TURNS, would otherwise stay permanently true from turn 20 onward
    # and never signal "time to run it again").
    bundle["turns_since_consolidation"] = bundle.get("turns_since_consolidation", 0) + 1
    await _save(session_id, bundle)
    return bundle


def should_consolidate(bundle: dict) -> bool:
    """True once `turns_since_consolidation` (see append_turn above) reaches
    CONSOLIDATION_INTERVAL_TURNS -- the trigger app/routers/chat.py's WS handler checks
    once per turn, right after persisting the assistant's reply. Pure/no I/O so it's
    cheap to call on every turn and easy to unit test against a plain dict."""
    return bundle.get("turns_since_consolidation", 0) >= CONSOLIDATION_INTERVAL_TURNS


async def mark_consolidated(session_id: str) -> None:
    """Resets the counter should_consolidate() reads. Called synchronously by the WS
    handler right when it decides to enqueue consolidate_session (not by the job
    itself, which runs later, asynchronously, in a separate arq worker process) --
    that's what makes "don't fire again too soon" a property of the enqueue decision
    itself rather than something that depends on the job's own, unrelated timing."""
    bundle = await get_bundle(session_id)
    bundle["turns_since_consolidation"] = 0
    await _save(session_id, bundle)


async def set_profile_facts(session_id: str, facts: list[str]) -> dict:
    bundle = await get_bundle(session_id)
    bundle["profile_facts"] = facts
    await _save(session_id, bundle)
    return bundle


async def set_retrieved_chunks(session_id: str, chunks: list[str]) -> dict:
    bundle = await get_bundle(session_id)
    bundle["retrieved_chunks"] = chunks
    await _save(session_id, bundle)
    return bundle


async def invalidate(session_id: str) -> None:
    """Drops the ENTIRE Tier-1 bundle (turns, cached profile facts/chunks, and the
    consolidation counter above) so the next turn starts from a clean slate instead of
    serving stale content. Used where that's genuinely correct: message-edit
    truncation and session delete both need previously-cached turns for now-deleted
    messages gone, not lingering in context until they naturally age out of the
    window. Deliberately NOT called by app/jobs/consolidate.py's consolidate_session
    any more -- see that module's own comment on why a full wipe there would be
    actively harmful now that it also runs mid-session, not just at a real session's
    end."""
    await get_redis().delete(_bundle_key(session_id))
