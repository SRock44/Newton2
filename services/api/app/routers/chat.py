import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.router import route
from app.agents.tutor import run_tutor
from app.core.auth import decode_token, require_user
from app.db.base import SessionLocal, get_db
from app.db.models import ChatMessage, ChatSession
from app.jobs.pool import get_arq_pool
from app.memory import profile as profile_memory
from app.memory.working import append_turn, set_profile_facts
from app.services.users import get_or_create_user

router = APIRouter(prefix="/chat", tags=["chat"])


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


@router.websocket("/ws/{session_id}")
async def chat_ws(websocket: WebSocket, session_id: uuid.UUID, token: str) -> None:
    try:
        claims = await decode_token(token)
    except HTTPException:
        await websocket.close(code=4401)
        return

    async with SessionLocal() as db:
        user = await get_or_create_user(db, claims)
        session = await db.get(ChatSession, session_id)
        if session is None or session.user_id != user.id:
            await websocket.close(code=4404)
            return
        await db.commit()  # persist user row if it was just created

        await websocket.accept()

        try:
            while True:
                user_message = await websocket.receive_text()

                db.add(ChatMessage(session_id=session_id, role="user", content=user_message))
                await db.commit()
                await append_turn(str(session_id), "user", user_message)

                # Tier 3 read path: pull only what's relevant to *this* message into the
                # Tier 1 bundle, rather than dumping the whole profile into every turn.
                relevant_facts = await profile_memory.retrieve_relevant_facts(db, user.id, user_message)
                await set_profile_facts(
                    str(session_id), [f"{f.subject_key}: {f.value}" for f in relevant_facts]
                )

                plan = route(user_message)
                if plan.agent != "tutor":
                    await websocket.send_json({"type": "error", "content": f"unknown agent {plan.agent}"})
                    continue

                full_response = ""
                async for chunk in run_tutor(str(session_id), user_message):
                    full_response += chunk
                    await websocket.send_json({"type": "chunk", "content": chunk})

                db.add(ChatMessage(session_id=session_id, role="assistant", content=full_response))
                await db.commit()
                await append_turn(str(session_id), "assistant", full_response)

                await websocket.send_json({"type": "done"})
        except WebSocketDisconnect:
            pass
