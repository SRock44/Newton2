import asyncio
import re
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.db.base import get_db
from app.db.models import Document
from app.services.bibliography import assemble_bib
from app.services.docx_export import DOCX_MEDIA_TYPE, build_document_docx
from app.services.documents import (
    delete_document,
    get_document_raw,
    get_document_text,
    is_editable,
    update_document_content,
    upload_document,
)
from app.services.notes import AnnotateAction, annotate_selection
from app.services.users import get_or_create_user

router = APIRouter(prefix="/documents", tags=["documents"])


class DocumentContentUpdate(BaseModel):
    content: str


class DocumentRename(BaseModel):
    filename: str


class DocumentAnnotateRequest(BaseModel):
    selected_text: str
    context: str
    action: AnnotateAction


def _has_bibliography(document: Document) -> bool:
    """True only for a write_research_paper output that actually cited something (see
    Document.paper_sources) -- the single gate on both the .bib endpoint below and the
    frontend's "Download bibliography (.bib)" menu item. A plain uploaded PDF, a note, a
    .txt, or a paper that cited nothing all answer False, so nothing offers a student a
    download that would come back empty."""
    return bool(document.paper_sources)


def _document_meta(document: Document) -> dict:
    return {
        "id": str(document.id),
        "filename": document.filename,
        "mime_type": document.mime_type,
        "created_at": document.created_at.isoformat(),
        "has_bibliography": _has_bibliography(document),
    }


async def _get_owned_document(db: AsyncSession, document_id: uuid.UUID, user_id: uuid.UUID) -> Document:
    document = await db.get(Document, document_id)
    if document is None or document.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return document


@router.post("/upload")
async def upload(
    file: UploadFile = File(...),
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    document = await upload_document(db, user.id, file)
    return _document_meta(document)


@router.get("")
async def list_documents(
    claims: dict = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    """Uploaded files only (kind="upload") -- Newton Notepad notes (kind="note", see
    app/routers/notes.py) have their own listing at GET /notes and are deliberately
    left out here so the existing Documents panel doesn't get cluttered with notes it
    was never designed to show."""
    user = await get_or_create_user(db, claims)
    rows = (
        (
            await db.execute(
                select(Document)
                .where(Document.user_id == user.id, Document.kind == "upload")
                .order_by(Document.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [_document_meta(d) for d in rows]


@router.delete("/{document_id}")
async def delete(
    document_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    document = await _get_owned_document(db, document_id, user.id)
    await delete_document(db, document)
    return {"status": "deleted"}


@router.get("/{document_id}/content")
async def get_content(
    document_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Extracted text for the viewer/editor pane — for a PDF this is the extracted
    text (view-only); `editable` tells the frontend whether to offer an Edit toggle."""
    user = await get_or_create_user(db, claims)
    document = await _get_owned_document(db, document_id, user.id)
    content = await get_document_text(document)
    return {"content": content, "editable": is_editable(document)}


@router.post("/{document_id}/annotate")
async def annotate_document(
    document_id: uuid.UUID,
    body: DocumentAnnotateRequest,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Highlight-to-act for an uploaded document — the SAME explain/define/summarize
    logic Newton Notepad's POST /notes/{id}/annotate already uses (see
    app.services.notes.annotate_selection), generalized to accept a document reference
    instead of only a note. This is deliberately NOT a fork: it imports and calls the
    exact same stateless function notes.py's endpoint calls, over exactly the
    selected_text/context the frontend sends for whatever passage was highlighted in the
    document's read-only preview pane.

    Unlike a note, a document's stored content is never mutated by this endpoint (or by
    the frontend that calls it) — an uploaded reading is normally read-only, so the
    generated response is meant to render as a transient popover near the selection, not
    be written back into the document. Ownership is checked exactly like every other
    per-document endpoint (_get_owned_document), and works for ANY document kind the
    student owns (a plain upload, a generated artifact, even a note reached this way) —
    there's no reason to restrict this action to uploads only."""
    user = await get_or_create_user(db, claims)
    await _get_owned_document(db, document_id, user.id)
    text = await annotate_selection(body.selected_text, body.context, body.action)
    return {"text": text}


@router.get("/{document_id}/raw")
async def get_raw(
    document_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """The exact stored bytes with the original Content-Type — what a PDF viewer embeds
    or a download affordance would fetch. No text extraction here."""
    user = await get_or_create_user(db, claims)
    document = await _get_owned_document(db, document_id, user.id)
    data = await get_document_raw(document)
    return Response(content=data, media_type=document.mime_type or "application/octet-stream")


@router.get("/{document_id}/bibliography.bib")
async def get_bibliography(
    document_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """The real `.bib` file behind a research paper this app wrote, rebuilt on demand by
    the SAME pure app/services/bibliography.py assemble_bib() the LaTeX compile itself
    used, over the SAME de-duplicated, final-keyed source list stored on the row (see
    Document.paper_sources). So the `\\cite{}` keys in the downloaded .bib match the ones
    in the paper's own .tex exactly -- this isn't a second, parallel rendering of the
    bibliography, it's the same function over the same data.

    404 for a document that has no such source data at all (every plain upload, note,
    and any paper that genuinely cited nothing) -- deliberately the same status as "no
    such document", since from the student's point of view there IS no bibliography
    artifact here to fetch. The frontend never offers the action in that case anyway
    (see `has_bibliography` on every document payload)."""
    user = await get_or_create_user(db, claims)
    document = await _get_owned_document(db, document_id, user.id)
    if not _has_bibliography(document):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "This document doesn't have a bibliography"
        )
    body = assemble_bib(list(document.paper_sources or []))
    # application/x-bibtex is what biblatex tooling and reference managers (Zotero,
    # JabRef) actually advertise for this format; charset is spelled out because a .bib
    # routinely carries non-ASCII author names.
    return Response(
        content=body.encode("utf-8"),
        media_type="application/x-bibtex; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{_bib_filename(document)}"'},
    )


def _bib_filename(document: Document) -> str:
    """"Attention Is All You Need.pdf" -> "Attention Is All You Need.bib" -- the paper's
    own name with its extension swapped, so a student's Downloads folder shows the .bib
    sitting right next to the paper it belongs to rather than a generic
    "bibliography.bib" that collides with every other paper's.

    Quotes, control characters, and path separators are stripped because this goes into a
    quoted Content-Disposition header -- PATCH /documents/{id} lets a student rename a
    document to anything at all, so the name reaching this header is user-controlled."""
    return _filename_with_extension(document, "bib", "bibliography")


def _filename_stem(document: Document) -> str:
    """The document's name without its extension, with the characters that would break a
    quoted Content-Disposition header (quotes, backslashes, slashes, control codes)
    removed. May be empty -- callers supply their own fallback."""
    stem = document.filename.rsplit(".", 1)[0] if "." in document.filename else document.filename
    return re.sub(r'[\x00-\x1f"\\/]', "", stem).strip()


def _filename_with_extension(document: Document, extension: str, fallback: str) -> str:
    return f"{_filename_stem(document) or fallback}.{extension}"


@router.get("/{document_id}/export.docx")
async def export_docx(
    document_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """A real, properly-formatted Word document built from this document's own content --
    the same text GET /documents/{id}/content hands the viewer, mapped onto real Word
    heading/list/table styles by app/services/docx_export.py. Notes and documents in this
    app are genuinely Markdown (see that module's docstring for the evidence), so this
    preserves the structure the student can already see in the preview pane instead of
    handing them a wall of "## Causes".

    Available to every document this user owns, and never 404s for "wrong kind" the way
    bibliography.bib does: every document has content, so there is always a real Word
    file to produce -- including an empty note, which becomes a correctly-titled, nearly
    empty .docx rather than an error.

    Deliberately NOT Pro-gated and deliberately consuming no billing credit. Unlike
    app/tools/create_artifact.py, which rents a real sandboxed coding agent per call,
    nothing here calls a model or a sandbox -- it's python-docx assembling a fixed
    document schema from text we already have, so its cost is ordinary request handling.
    Please don't add a gate here; there is no extra compute to pay for.

    Fetching from MinIO and re-extracting is async already; the python-docx assembly is
    CPU-bound, so it goes to a worker thread like every other blocking call here."""
    user = await get_or_create_user(db, claims)
    document = await _get_owned_document(db, document_id, user.id)
    content = await get_document_text(document)
    # The heading inside the Word file is the document's name WITHOUT its extension --
    # "Lecture notes", not "Lecture notes.md". A note's filename is already just its
    # title, so this is a no-op there and only helps for real uploads.
    title = _filename_stem(document) or document.filename
    data = await asyncio.to_thread(build_document_docx, title, content)
    return Response(
        content=data,
        media_type=DOCX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{_docx_filename(document)}"'
        },
    )


def _docx_filename(document: Document) -> str:
    """"Lecture notes.md" -> "Lecture notes.docx" -- the document's own name with its
    extension swapped, exactly like _bib_filename above and sanitized for the same
    reason (a student can rename a document to anything, and this lands inside a quoted
    Content-Disposition header)."""
    return _filename_with_extension(document, "docx", "document")


@router.put("/{document_id}/content")
async def update_content(
    document_id: uuid.UUID,
    body: DocumentContentUpdate,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Overwrites a text/markdown document's stored content and re-chunks it for RAG.
    PDFs are view-only — editing extracted PDF text and writing it back as a PDF would
    just produce garbage, so that's rejected outright."""
    user = await get_or_create_user(db, claims)
    document = await _get_owned_document(db, document_id, user.id)
    if not is_editable(document):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This document type can't be edited — PDFs are view-only")
    document = await update_document_content(db, document, body.content)
    return _document_meta(document)


@router.patch("/{document_id}")
async def rename(
    document_id: uuid.UUID,
    body: DocumentRename,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Renames the display filename only — the MinIO object key is an internal storage
    path and doesn't need to track the display name."""
    user = await get_or_create_user(db, claims)
    document = await _get_owned_document(db, document_id, user.id)
    filename = body.filename.strip()
    if not filename:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Filename can't be empty")
    document.filename = filename
    await db.commit()
    await db.refresh(document)
    return _document_meta(document)
