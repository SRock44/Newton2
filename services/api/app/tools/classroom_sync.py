import uuid
from typing import Any

import httpx

from app.db.base import SessionLocal
from app.services import google_classroom
from app.tools.base import Tool


class ClassroomSyncTool(Tool):
    """Pulls the student's real Google Classroom coursework into their study plan, the
    same real sync the "Sync now" button in the Study Plan panel triggers (see
    app/routers/classroom.py's POST /integrations/classroom/sync) — added so a chat
    request like "sync my classroom assignments" produces real, saved study plan items
    instead of the model just describing what it would do. Connecting the account in
    the first place still has to happen through the desktop app's own OAuth button
    (a browser consent screen isn't something a chat tool can drive), so this only ever
    syncs an already-connected account and gives a clear, actionable error otherwise."""

    name = "sync_google_classroom"
    description = (
        "Syncs the student's Google Classroom coursework into their study plan. Call "
        "when asked to sync/refresh/pull in Classroom assignments. Only works if "
        "already connected from the Study Plan panel -- otherwise returns a message "
        "to connect there first (this tool can't drive the browser sign-in)."
    )
    parameters: dict[str, Any] = {"type": "object", "properties": {}}

    async def run(self, user_id: str | None = None) -> str:
        if not user_id:
            return "Error: no signed-in user to sync Google Classroom for."
        uid = uuid.UUID(user_id)

        async with SessionLocal() as db:
            try:
                items = await google_classroom.sync_to_study_plan(db, uid)
                await db.commit()
            except google_classroom.ClassroomNotConnected:
                return (
                    "Error: Google Classroom isn't connected yet. Connect it from the "
                    "Study Plan panel first, then ask me to sync again."
                )
            except httpx.HTTPError as exc:
                return f"Error: couldn't reach Google Classroom ({exc})."

        if not items:
            return "Synced Google Classroom — no active coursework found to add."
        return (
            f"Synced {len(items)} item(s) from Google Classroom into your study plan — "
            "check the Study Plan panel to see them."
        )
