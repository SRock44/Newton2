import asyncio
import contextlib
import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, WebSocket, WebSocketDisconnect, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.router import route
from app.agents.tutor import PlanChunk, TextChunk, ToolActivity, UsageInfo, run_tutor
from app.core.auth import decode_token, require_user
from app.core.crisis_detection import CRISIS_RESPONSE_TEXT, classify_crisis, detects_crisis
from app.core.logging import correlation_id_scope, new_correlation_id
from app.core.sentry import report_exception
from app.db.base import SessionLocal, get_db
from app.db.models import ChatMessage, ChatSession
from app.jobs.pool import get_arq_pool
from app.memory import profile as profile_memory
from app.memory import rag as rag_memory
from app.memory.working import append_turn, invalidate, set_profile_facts, set_retrieved_chunks
from app.services.images import get_image_for_session, upload_image
from app.services.users import get_or_create_user

router = APIRouter(prefix="/chat", tags=["chat"])

logger = logging.getLogger("newton.chat")

# ToolActivity.phase -> outgoing WS frame "type"
_PHASE_TO_FRAME_TYPE = {"started": "tool_start", "finished": "tool_end"}

# When one of these tools finishes, also emit a "suggested_action" frame pointing at
# where the result actually landed -- deterministic (keyed off the real tool that ran,
# not the model's own prose), so the desktop app can offer a real "Open Flashcards"-
# style button on the reply instead of the student having to notice the panel exists
# and click it themselves. Deliberately doesn't cover start_study_session (the Pro
# composite): it produces three different artifacts in three different panels at once,
# so no single "open X" button fits, and its own reply text already summarizes all three.
_TOOL_TO_SUGGESTED_ACTION = {
    "generate_flashcards": {"panel": "flashcards", "label": "Open Flashcards"},
    "generate_practice_exam": {"panel": "practice_exams", "label": "Open Practice Exams"},
    "generate_study_plan": {"panel": "study_plan", "label": "Open Study Plan"},
    "sync_google_classroom": {"panel": "study_plan", "label": "Open Study Plan"},
    "write_research_paper": {"panel": "documents", "label": "Open Documents"},
}


async def _gather_memory_context(
    user_id: uuid.UUID, user_message: str
) -> tuple[list, list]:
    """Fetches Tier 3 profile facts and document-RAG chunks concurrently instead of one
    after another. Each retrieval does its own embed_text() call (app/memory/
    embeddings.py) -- real ONNX inference that, even off the event loop via
    asyncio.to_thread, still takes real wall-clock time -- so running the two
    independent reads concurrently roughly halves that latency instead of paying it
    twice, sequentially, before the tutor even starts.

    Each gets its own short-lived AsyncSession rather than sharing the WS handler's
    `db`: AsyncSession forbids concurrent use by two coroutines at once (it raises
    under real overlap), so reusing one session across a gather() here would be unsafe,
    not just slower."""

    async def _facts() -> list:
        async with SessionLocal() as facts_db:
            return await profile_memory.retrieve_relevant_facts(facts_db, user_id, user_message)

    async def _chunks() -> list:
        async with SessionLocal() as chunks_db:
            return await rag_memory.retrieve_relevant_chunks(chunks_db, user_id, user_message)

    return await asyncio.gather(_facts(), _chunks())


async def _maybe_enqueue_title_job(
    db: AsyncSession, session: ChatSession, session_id: uuid.UUID
) -> None:
    """Auto-generated conversation titles (ROADMAP.md): enqueues app/jobs/titling.py's
    generate_session_title exactly once, right after the SECOND assistant reply lands
    for this session -- enough transcript for a real title without waiting for the
    whole conversation, and never fired on every turn. `session.title is None` is
    checked here so a race/double-trigger is harmless; generate_session_title itself
    also no-ops if a title is already set by the time it runs, so this check is
    belt-and-suspenders, not load-bearing on its own."""
    if session.title is not None:
        return
    assistant_reply_count = (
        await db.execute(
            select(func.count())
            .select_from(ChatMessage)
            .where(ChatMessage.session_id == session_id, ChatMessage.role == "assistant")
        )
    ).scalar_one()
    if assistant_reply_count == 2:
        pool = await get_arq_pool()
        await pool.enqueue_job("generate_session_title", str(session_id))


@router.post("/sessions")
async def create_session(
    claims: dict = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> dict:
    user = await get_or_create_user(db, claims)
    session = ChatSession(user_id=user.id)
    db.add(session)
    await db.commit()
    return {"session_id": str(session.id)}


@router.get("/sessions")
async def list_sessions(
    claims: dict = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    user = await get_or_create_user(db, claims)
    rows = (
        (
            await db.execute(
                select(ChatSession)
                .where(ChatSession.user_id == user.id)
                .order_by(ChatSession.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": str(s.id),
            "title": s.title,
            "status": s.status,
            "created_at": s.created_at.isoformat(),
        }
        for s in rows
    ]


@router.get("/sessions/{session_id}/messages")
async def list_messages(
    session_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    user = await get_or_create_user(db, claims)
    session = await db.get(ChatSession, session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")

    rows = (
        (
            await db.execute(
                select(ChatMessage)
                .where(ChatMessage.session_id == session_id)
                .order_by(ChatMessage.created_at)
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": str(m.id),
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at.isoformat(),
            "prompt_tokens": m.prompt_tokens,
            "completion_tokens": m.completion_tokens,
        }
        for m in rows
    ]


@router.delete("/sessions/{session_id}/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message_and_after(
    session_id: uuid.UUID,
    message_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Backs message editing (ROADMAP.md): editing a previous message permanently
    discards that message's own original reply and everything after it in the session
    (no branch history/undo -- a real tree schema is deliberately out of scope), then
    the edited text is resent as a brand new user_message. The frontend calls this
    FIRST, awaited, before touching its local message list or sending anything new --
    see App.tsx's handleSend edit branch.

    Deletes the target message and every later message (by created_at, with the
    target's own id as an equality tiebreaker so it's removed even in the practically
    impossible case of a duplicate timestamp) in a single statement -- not a loop of
    individual deletes, so there's no window where a concurrent read could observe a
    partially-truncated history. No cascade concerns beyond the chat_messages table
    itself: nothing else in this schema references a chat message by id (profile_facts
    and session_summaries only ever reference a *session*, see migration 0004) -- unlike
    delete_session, there's no other table to clean up here."""
    user = await get_or_create_user(db, claims)
    session = await db.get(ChatSession, session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")

    target = await db.get(ChatMessage, message_id)
    if target is None or target.session_id != session_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")

    await db.execute(
        delete(ChatMessage).where(
            ChatMessage.session_id == session_id,
            (ChatMessage.created_at > target.created_at)
            | ((ChatMessage.created_at == target.created_at) & (ChatMessage.id == target.id)),
        )
    )
    await db.commit()
    # The working-memory bundle (Tier 1, Redis) may still hold turns for messages just
    # deleted -- invalidate it so the next turn rebuilds fresh from Postgres instead of
    # resending stale, now-discarded turns as context. Same cleanup delete_session
    # already does for the same reason.
    await invalidate(str(session_id))


@router.post("/sessions/{session_id}/images")
async def upload_session_image(
    session_id: uuid.UUID,
    file: UploadFile = File(...),
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Stores a photo/screenshot the student is about to ask about, scoped to this
    session — see app/services/images.py and the read_image tool. The frontend includes
    the returned id in the chat message text (e.g. "[Attached image: <id>]"); nothing
    changes in the WebSocket protocol itself."""
    user = await get_or_create_user(db, claims)
    session = await db.get(ChatSession, session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")

    image_id = await upload_image(user.id, str(session_id), file)
    return {"image_id": image_id}


@router.get("/sessions/{session_id}/images/{image_id}")
async def get_session_image(
    session_id: uuid.UUID,
    image_id: str,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Serves back an image previously attached via the endpoint above, so the desktop
    app can render a real thumbnail instead of the bare "[Attached image: <id>]" marker
    in a message's text. Short-lived by design (see IMAGE_TTL_SECONDS in
    app/services/images.py, ~2 hours) — a 404 here just means it expired, not a bug."""
    user = await get_or_create_user(db, claims)
    session = await db.get(ChatSession, session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")

    result = await get_image_for_session(str(session_id), image_id)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found or expired")
    data, mime_type = result
    return Response(content=data, media_type=mime_type)


@router.post("/sessions/{session_id}/end")
async def end_session(
    session_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    session = await db.get(ChatSession, session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")

    session.status = "ended"
    session.ended_at = datetime.now(timezone.utc)
    await db.commit()

    pool = await get_arq_pool()
    await pool.enqueue_job("consolidate_session", str(session_id))
    return {"status": "ended", "consolidation": "queued"}


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    user = await get_or_create_user(db, claims)
    session = await db.get(ChatSession, session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")

    # Messages/summary cascade at the DB level (migration 0004); any profile fact
    # learned in this session survives, just loses its audit-trail pointer back to it.
    await db.delete(session)
    await db.commit()
    await invalidate(str(session_id))


@router.websocket("/ws/{session_id}")
async def chat_ws(websocket: WebSocket, session_id: uuid.UUID, token: str) -> None:
    try:
        claims = await decode_token(token)
    except HTTPException:
        # Accept first: closing before accept collapses to a bare 403 at the HTTP
        # upgrade layer (uvicorn/Starlette reject the handshake outright), so a
        # client would never see this close code or get an error frame to read.
        await websocket.accept()
        await websocket.send_json({"type": "error", "content": "invalid or expired token"})
        await websocket.close(code=4401)
        return

    async with SessionLocal() as db:
        user = await get_or_create_user(db, claims)
        session = await db.get(ChatSession, session_id)
        if session is None or session.user_id != user.id:
            await websocket.accept()
            await websocket.send_json({"type": "error", "content": "session not found"})
            await websocket.close(code=4404)
            return
        await db.commit()  # persist user row if it was just created

        await websocket.accept()

        async def _receive_frame() -> dict:
            raw = await websocket.receive_text()
            try:
                frame = json.loads(raw)
            except ValueError:
                return {"type": "invalid"}
            return frame if isinstance(frame, dict) else {"type": "invalid"}

        recv_task: asyncio.Task | None = None
        gen_task: asyncio.Task | None = None
        turn_id: str | None = None

        try:
            while True:
                # Idle: nothing generating, just wait for the student's next message
                # (or a stray/late "stop", which is a harmless no-op here).
                if recv_task is None:
                    recv_task = asyncio.create_task(_receive_frame())
                frame = await recv_task
                recv_task = None

                frame_type = frame.get("type")
                if frame_type == "ping":
                    # Application-level keepalive (ROADMAP.md): the desktop client sends
                    # one of these every ~20-25s so real traffic keeps flowing over an
                    # otherwise-idle socket, defeating any idle-timeout closure sitting on
                    # the real network path between client and server (background-tab
                    # power throttling, an SSH tunnel's own idle timeout, a proxy, ...) --
                    # deliberately a plain no-op ack, never counted as a chat turn.
                    await websocket.send_json({"type": "pong"})
                    continue
                if frame_type == "stop":
                    continue  # nothing is generating — no-op
                if frame_type != "user_message":
                    await websocket.send_json(
                        {"type": "error", "content": f"unexpected frame type '{frame_type}'"}
                    )
                    continue

                user_message = frame.get("content") or ""

                # One id per chat turn (not per connection -- a student can send many
                # messages over the same socket), set as the ambient correlation id for
                # every log line emitted while this turn is processed, including deep
                # inside run_tutor's tool-calling loop (app/agents/tutor.py) and any tool
                # it calls (e.g. app/tools/research_fetch.py's own logger calls) -- see
                # app/core/logging.py's module docstring for why that "just works" via
                # asyncio's context-copying on task creation, with no extra plumbing.
                # Kept in a plain variable (not just inside the `with` below) so the
                # except-Exception safety net further down can still log it even after
                # the `with` block's own reset has already run while the exception
                # unwound through this frame.
                turn_id = new_correlation_id()
                with correlation_id_scope(turn_id):
                    logger.info(
                        "chat turn start session_id=%s user_id=%s", session_id, user.id
                    )

                    user_msg = ChatMessage(session_id=session_id, role="user", content=user_message)
                    db.add(user_msg)
                    await db.commit()
                    await append_turn(str(session_id), "user", user_message)
                    # Echoes back this message's real, persisted id so the desktop app
                    # can offer "Edit" on it immediately, without waiting for a session
                    # switch/reload to refetch history (see GET .../messages, which also
                    # returns this same id -- the delete-message-and-after endpoint above
                    # needs it as the truncation-point identity either way).
                    await websocket.send_json({"type": "user_message_saved", "id": str(user_msg.id)})

                    # Baseline crisis-response safety net (ROADMAP.md Phase 7): a
                    # deterministic, local pattern match -- NOT an LLM call, so this adds
                    # no latency/cost to the overwhelming majority of ordinary turns that
                    # don't match. See app/core/crisis_detection.py's module docstring for
                    # scope/design. When it matches, the normal tutor/provider pipeline is
                    # skipped entirely for this turn -- the fixed resource text is
                    # persisted/streamed through the exact same paths a normal reply uses,
                    # so it shows up in chat history like any other assistant message, and
                    # the student can keep chatting normally afterward.
                    if detects_crisis(user_message):
                        # detects_crisis() already ran this same, pure, exception-free
                        # match to get True -- re-running it here to get the category
                        # name for the log line below cannot newly raise.
                        crisis_category = classify_crisis(user_message)
                        # WARNING per spec, deliberately without the triggering message
                        # text itself -- it's already stored normally in chat_messages as
                        # part of ordinary history; the concern here is not duplicating
                        # sensitive content into general app/Sentry logs. Intentionally
                        # NOT reported to Sentry (app/core/sentry.py): this is a working
                        # safety response, not an application error.
                        logger.warning(
                            "crisis pattern detected session_id=%s user_id=%s category=%s",
                            session_id,
                            user.id,
                            crisis_category,
                        )
                        await websocket.send_json({"type": "chunk", "content": CRISIS_RESPONSE_TEXT})
                        db.add(
                            ChatMessage(
                                session_id=session_id,
                                role="assistant",
                                content=CRISIS_RESPONSE_TEXT,
                            )
                        )
                        await db.commit()
                        await append_turn(str(session_id), "assistant", CRISIS_RESPONSE_TEXT)
                        await websocket.send_json(
                            {"type": "done", "prompt_tokens": None, "completion_tokens": None}
                        )
                        logger.info(
                            "chat turn done session_id=%s user_id=%s stopped=False "
                            "prompt_tokens=None completion_tokens=None crisis=True",
                            session_id,
                            user.id,
                        )
                        continue

                    # Tier 3 read path: pull only what's relevant to *this* message into
                    # the Tier 1 bundle, rather than dumping the whole profile into every
                    # turn. Profile facts and the student's uploaded-document chunks are
                    # independent reads, fetched concurrently (see _gather_memory_context)
                    # rather than one after another.
                    relevant_facts, relevant_chunks = await _gather_memory_context(user.id, user_message)
                    await set_profile_facts(
                        str(session_id), [f"{f.subject_key}: {f.value}" for f in relevant_facts]
                    )
                    await set_retrieved_chunks(str(session_id), [c.content for c in relevant_chunks])

                    plan = route(user_message)
                    if plan.agent != "tutor":
                        await websocket.send_json({"type": "error", "content": f"unknown agent {plan.agent}"})
                        continue

                    full_response = ""
                    usage: UsageInfo | None = None

                    async def _drain_generation() -> None:
                        nonlocal full_response, usage
                        async for event in run_tutor(str(session_id), user_message, user_id=str(user.id)):
                            if isinstance(event, PlanChunk):
                                await websocket.send_json({"type": "plan_chunk", "content": event.text})
                            elif isinstance(event, TextChunk):
                                full_response += event.text
                                await websocket.send_json({"type": "chunk", "content": event.text})
                            elif isinstance(event, ToolActivity):
                                await websocket.send_json(
                                    {
                                        "type": _PHASE_TO_FRAME_TYPE[event.phase],
                                        "tool": event.tool,
                                        "label": event.label,
                                    }
                                )
                                if event.phase == "finished":
                                    action = _TOOL_TO_SUGGESTED_ACTION.get(event.tool)
                                    if action is not None:
                                        await websocket.send_json({"type": "suggested_action", **action})
                            elif isinstance(event, UsageInfo):
                                usage = event

                    # Run generation concurrently with listening for the next incoming
                    # frame, so a "stop" sent mid-generation is actually seen instead of
                    # sitting unread behind a blocking receive_text() until this reply
                    # finishes on its own. Created while turn_id's scope is active, so
                    # this task's copied context -- and everything it awaits -- carries
                    # the same correlation id (see app/core/logging.py).
                    gen_task = asyncio.create_task(_drain_generation())
                    stopped = False
                    try:
                        while True:
                            if recv_task is None:
                                recv_task = asyncio.create_task(_receive_frame())
                            await asyncio.wait(
                                {gen_task, recv_task}, return_when=asyncio.FIRST_COMPLETED
                            )

                            if gen_task.done():
                                gen_task.result()  # re-raise if generation itself crashed
                                break

                            # recv_task completed first
                            incoming = recv_task.result()
                            recv_task = None
                            if incoming.get("type") == "stop":
                                stopped = True
                                break
                            # A ping landing here (a long reply can easily outlast one
                            # ~20-25s ping interval) deliberately gets no explicit pong:
                            # _drain_generation is already streaming real chunk frames
                            # over this exact socket concurrently with this recv loop, so
                            # the keepalive's whole purpose -- real traffic flowing while
                            # otherwise idle -- is already satisfied without one, and
                            # sending from here too would race _drain_generation's own
                            # concurrent sends on the same socket (see the comment just
                            # below on why nothing else replies from this branch either).
                            # Anything else arriving mid-generation (e.g. a stray
                            # user_message) is ignored — only one reply generates at a
                            # time, and there's no safe way to interleave a second send
                            # on this socket while _drain_generation may itself be
                            # mid-send. Loop back and keep waiting.
                    finally:
                        if not gen_task.done():
                            gen_task.cancel()
                        with contextlib.suppress(asyncio.CancelledError):
                            await gen_task
                        gen_task = None

                    # Persist whatever came back — the full reply, or (if stopped) just
                    # the partial text streamed so far. Never silently drop it. usage
                    # stays None if generation was stopped before UsageInfo's yield point
                    # (the provider's trailing usage chunk hadn't arrived yet) — that
                    # reply's tokens just don't count toward the chat's running total,
                    # same graceful-degradation spirit as everything else about Stop.
                    db.add(
                        ChatMessage(
                            session_id=session_id,
                            role="assistant",
                            content=full_response,
                            prompt_tokens=usage.prompt_tokens if usage else None,
                            completion_tokens=usage.completion_tokens if usage else None,
                        )
                    )
                    await db.commit()
                    await append_turn(str(session_id), "assistant", full_response)

                    await _maybe_enqueue_title_job(db, session, session_id)

                    await websocket.send_json(
                        {
                            "type": "stopped" if stopped else "done",
                            "prompt_tokens": usage.prompt_tokens if usage else None,
                            "completion_tokens": usage.completion_tokens if usage else None,
                        }
                    )

                    logger.info(
                        "chat turn done session_id=%s user_id=%s stopped=%s prompt_tokens=%s "
                        "completion_tokens=%s",
                        session_id,
                        user.id,
                        stopped,
                        usage.prompt_tokens if usage else None,
                        usage.completion_tokens if usage else None,
                    )
        except WebSocketDisconnect:
            pass
        except Exception as exc:  # noqa: BLE001 - last-resort safety net: a bug anywhere
            # in this handler (the tutor/tool loop included -- see gen_task.result()'s
            # re-raise above) closes the socket cleanly with a real error frame instead
            # of crashing the connection with a bare traceback and no signal to the
            # client. turn_id is read directly (not via get_correlation_id()) because the
            # `with correlation_id_scope(...)` block's own reset has already run by the
            # time an exception raised inside it reaches this outer except clause.
            logger.error(
                "chat_ws unhandled exception correlation_id=%s session_id=%s user_id=%s: %s",
                turn_id,
                session_id,
                user.id,
                exc,
                exc_info=exc,
            )
            report_exception(exc)
            with contextlib.suppress(Exception):
                await websocket.send_json(
                    {"type": "error", "content": "Something went wrong on our end. Please try again."}
                )
            with contextlib.suppress(Exception):
                await websocket.close(code=1011)
        finally:
            if recv_task is not None and not recv_task.done():
                recv_task.cancel()
            if gen_task is not None and not gen_task.done():
                gen_task.cancel()
