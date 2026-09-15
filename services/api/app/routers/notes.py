import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.db.base import get_db
from app.db.models import Document
from app.services.documents import create_note, delete_document, get_document_text, update_document_content
from app.services.notes import AnnotateAction, annotate_selection
from app.services.users import get_or_create_user

router = APIRouter(prefix="/notes", tags=["notes"])


class NoteCreate(BaseModel):
    title: str | None = None


class NoteUpdate(BaseModel):
    title: str
    content: str


class NoteAnnotateRequest(BaseModel):
    selected_text: str
    context: str
    action: AnnotateAction


def _note_meta(document: Document) -> dict:
    return {
        "id": str(document.id),
        "title": document.filename,
        "created_at": document.created_at.isoformat(),
        "updated_at": document.updated_at.isoformat(),
    }


async def _get_owned_note(db: AsyncSession, note_id: uuid.UUID, user_id: uuid.UUID) -> Document:
    """Same ownership pattern as every other per-user resource in this codebase (see
    app/routers/documents.py's _get_owned_document) -- also 404s (not just any other
    document type) a real document owned by this same user if it isn't kind="note", so
    a plain uploaded file can't be renamed/deleted/annotated through the notes API."""
    document = await db.get(Document, note_id)
    if document is None or document.user_id != user_id or document.kind != "note":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    return document


@router.post("")
async def create(
    body: NoteCreate,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Creates a new, empty note (kind="note") -- a real Document row that goes through
    the exact same chunk+embed pipeline an uploaded file does (see
    app.services.documents.create_note), so it's automatically retrievable via RAG in
    any chat session the moment it has real content. Defaults the title to today's date
    when the student doesn't supply one."""
    user = await get_or_create_user(db, claims)
    title = (body.title or "").strip() or date.today().isoformat()
    document = await create_note(db, user.id, title)
    return _note_meta(document)


@router.get("")
async def list_notes(
    claims: dict = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    """The caller's own notes (title, id, updated-at) for the Notepad window's note
    picker, most-recently-updated first."""
    user = await get_or_create_user(db, claims)
    rows = (
        (
            await db.execute(
                select(Document)
                .where(Document.user_id == user.id, Document.kind == "note")
                .order_by(Document.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [_note_meta(d) for d in rows]


@router.get("/{note_id}")
async def get_note(
    note_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """A note's current raw content + title, for the Notepad window's editor."""
    user = await get_or_create_user(db, claims)
    document = await _get_owned_note(db, note_id, user.id)
    content = await get_document_text(document)
    return {**_note_meta(document), "content": content}


@router.patch("/{note_id}")
async def update_note(
    note_id: uuid.UUID,
    body: NoteUpdate,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Full replace of a note's content and title -- called by the frontend on a
    client-side debounce (a few seconds of inactivity), not per keystroke; this
    endpoint just does one full save+re-chunk+re-embed each time it's actually called
    (see update_document_content's own docstring for why re-chunking the whole note
    every time, rather than diffing, is the right call for documents this small)."""
    user = await get_or_create_user(db, claims)
    document = await _get_owned_note(db, note_id, user.id)
    title = body.title.strip() or document.filename
    document = await update_document_content(db, document, body.content, filename=title)
    return _note_meta(document)


@router.delete("/{note_id}")
async def delete_note(
    note_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Reuses documents_service.delete_document exactly -- same MinIO object removal +
    chunk cleanup an uploaded file's deletion already does, no separate cleanup path."""
    user = await get_or_create_user(db, claims)
    document = await _get_owned_note(db, note_id, user.id)
    await delete_document(db, document)
    return {"status": "deleted"}


@router.post("/{note_id}/annotate")
async def annotate(
    note_id: uuid.UUID,
    body: NoteAnnotateRequest,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Highlight-to-act: explain/define/summarize a selection from within this note.
    Ownership is checked (a student can only annotate their own note) but the note's
    stored content itself is never read or written here -- annotate_selection is a
    single stateless provider call over exactly the selected_text/context the frontend
    sends, and the result is returned for the frontend to insert inline into the note's
    raw markdown itself (never routed to the main chat window)."""
    user = await get_or_create_user(db, claims)
    await _get_owned_note(db, note_id, user.id)
    text = await annotate_selection(body.selected_text, body.context, body.action)
    return {"text": text}
