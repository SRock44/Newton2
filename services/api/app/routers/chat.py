import asyncio
import contextlib
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.router import route
from app.agents.tutor import TextChunk, ToolActivity, run_tutor
from app.core.auth import decode_token, require_user
from app.db.base import SessionLocal, get_db
from app.db.models import ChatMessage, ChatSession
from app.jobs.pool import get_arq_pool
from app.memory import profile as profile_memory
from app.memory import rag as rag_memory
from app.memory.working import append_turn, invalidate, set_profile_facts, set_retrieved_chunks
from app.services.images import get_image_for_session, upload_image
from app.services.users import get_or_create_user

router = APIRouter(prefix="/chat", tags=["chat"])

# ToolActivity.phase -> outgoing WS frame "type"
_PHASE_TO_FRAME_TYPE = {"started": "tool_start", "finished": "tool_end"}


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
    return [{"role": m.role, "content": m.content, "created_at": m.created_at.isoformat()} for m in rows]


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

        try:
            while True:
                # Idle: nothing generating, just wait for the student's next message
                # (or a stray/late "stop", which is a harmless no-op here).
                if recv_task is None:
                    recv_task = asyncio.create_task(_receive_frame())
                frame = await recv_task
                recv_task = None

                frame_type = frame.get("type")
                if frame_type == "stop":
                    continue  # nothing is generating — no-op
                if frame_type != "user_message":
                    await websocket.send_json(
                        {"type": "error", "content": f"unexpected frame type '{frame_type}'"}
                    )
                    continue

                user_message = frame.get("content") or ""

                db.add(ChatMessage(session_id=session_id, role="user", content=user_message))
                await db.commit()
                await append_turn(str(session_id), "user", user_message)

                # Tier 3 read path: pull only what's relevant to *this* message into the
                # Tier 1 bundle, rather than dumping the whole profile into every turn.
                relevant_facts = await profile_memory.retrieve_relevant_facts(db, user.id, user_message)
                await set_profile_facts(
                    str(session_id), [f"{f.subject_key}: {f.value}" for f in relevant_facts]
                )

                # Same shape, for the student's uploaded documents: retrieve only what's
                # relevant to this message and stash it in the Tier 1 bundle for the Tutor.
                relevant_chunks = await rag_memory.retrieve_relevant_chunks(db, user.id, user_message)
                await set_retrieved_chunks(str(session_id), [c.content for c in relevant_chunks])

                plan = route(user_message)
                if plan.agent != "tutor":
                    await websocket.send_json({"type": "error", "content": f"unknown agent {plan.agent}"})
                    continue

                full_response = ""

                async def _drain_generation() -> None:
                    nonlocal full_response
                    async for event in run_tutor(str(session_id), user_message, user_id=str(user.id)):
                        if isinstance(event, TextChunk):
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

                # Run generation concurrently with listening for the next incoming
                # frame, so a "stop" sent mid-generation is actually seen instead of
                # sitting unread behind a blocking receive_text() until this reply
                # finishes on its own.
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
                # the partial text streamed so far. Never silently drop it.
                db.add(ChatMessage(session_id=session_id, role="assistant", content=full_response))
                await db.commit()
                await append_turn(str(session_id), "assistant", full_response)

                await websocket.send_json({"type": "stopped" if stopped else "done"})
        except WebSocketDisconnect:
            pass
        finally:
            if recv_task is not None and not recv_task.done():
                recv_task.cancel()
            if gen_task is not None and not gen_task.done():
                gen_task.cancel()
