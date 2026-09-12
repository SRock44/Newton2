import secrets

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.db.base import get_db
from app.routers.study_plan import _serialize as serialize_study_plan_item
from app.services import google_classroom
from app.services.users import get_or_create_user

router = APIRouter(prefix="/integrations/classroom", tags=["classroom"])


@router.get("/status")
async def status_(
    claims: dict = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> dict:
    user = await get_or_create_user(db, claims)
    connection = await google_classroom.get_connection(db, user.id)
    if connection is None:
        return {"connected": False}
    return {
        "connected": True,
        "google_email": connection.google_email,
        "connected_at": connection.connected_at.isoformat(),
    }


@router.get("/connect")
async def connect(
    claims: dict = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> dict:
    """Returns a Google consent URL for the desktop app to open in the system browser.
    The browser hop means the callback below runs unauthenticated from our API's point of
    view -- `state` is how it finds its way back to this user."""
    user = await get_or_create_user(db, claims)
    await db.commit()  # persist the user row if get_or_create_user just created it

    state = secrets.token_urlsafe(24)
    await google_classroom.store_oauth_state(state, user.id)
    try:
        url = google_classroom.build_authorization_url(state)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    return {"authorization_url": url}


@router.get("/callback", response_class=HTMLResponse)
async def callback(
    state: str = Query(...),
    code: str | None = Query(None),
    error: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> str:
    """Hit directly by the browser after Google's consent screen -- no bearer token here,
    hence resolving the user via `state` rather than `require_user`."""
    user_id = await google_classroom.pop_oauth_state(state)
    if user_id is None:
        return _callback_page("This sign-in link expired or was already used. Please try connecting again.")

    if error or not code:
        return _callback_page(f"Google sign-in didn't complete ({error or 'no code received'}).")

    try:
        await google_classroom.connect(db, user_id, code)
        await db.commit()
    except (httpx.HTTPError, RuntimeError) as exc:
        return _callback_page(f"Couldn't finish connecting Google Classroom: {exc}")

    return _callback_page("Google Classroom is connected. You can close this window and return to Newton.")


def _callback_page(message: str) -> str:
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Newton</title>
<style>body{{font-family:system-ui,sans-serif;background:#0e0e0e;color:#e4e4e4;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}}
p{{max-width:360px;text-align:center;font-size:15px}}</style></head>
<body><p>{message}</p></body></html>"""


@router.post("/sync")
async def sync(
    claims: dict = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    user = await get_or_create_user(db, claims)
    try:
        items = await google_classroom.sync_to_study_plan(db, user.id)
    except google_classroom.ClassroomNotConnected as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Couldn't reach Google Classroom: {exc}") from exc
    await db.commit()
    return [serialize_study_plan_item(item) for item in items]


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(
    claims: dict = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> None:
    user = await get_or_create_user(db, claims)
    await google_classroom.disconnect(db, user.id)
    await db.commit()
