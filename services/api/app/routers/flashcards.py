import asyncio
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.db.base import get_db
from app.db.models import Document, Flashcard
from app.services import billing as billing_service
from app.services.anki import build_apkg, build_flashcard_decks
from app.services.flashcards import (
    DIRECTION_PRODUCTION,
    card_direction,
    generate_flashcards,
    get_due_flashcards,
    review_flashcard,
    review_production_flashcard,
)
from app.services.pptx_export import PPTX_MEDIA_TYPE, build_flashcard_pptx
from app.services.users import get_or_create_user

router = APIRouter(prefix="/flashcards", tags=["flashcards"])


def _serialize(card: Flashcard) -> dict:
    return {
        "id": str(card.id),
        "document_id": str(card.document_id) if card.document_id else None,
        "front": card.front,
        "back": card.back,
        # Always a concrete string, never null, even for the pre-0021 rows whose column
        # is NULL -- clients shouldn't have to know that NULL means "recognition".
        "direction": card_direction(card),
        "due": card.due.isoformat(),
        "state": card.fsrs_state,
        "last_review": card.last_review.isoformat() if card.last_review else None,
        "created_at": card.created_at.isoformat(),
    }


@router.post("/generate/{document_id}")
async def generate(
    document_id: uuid.UUID,
    include_production: bool = Query(False),
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """`include_production=true` additionally creates a production-direction sibling for
    every card -- shown the answer, type the term. Opt-in rather than inferred: it's the
    right default for vocabulary and the wrong one for a chemistry deck, and doubling a
    student's daily review load on a guess about content type isn't a call this endpoint
    should be making for them. See app/services/flashcards.generate_flashcards."""
    user = await get_or_create_user(db, claims)
    document = await db.get(Document, document_id)
    if document is None or document.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")

    target_count = billing_service.generation_target_count(user)
    cards = await generate_flashcards(
        db,
        user.id,
        document,
        target_count=target_count,
        include_production_cards=include_production,
    )
    await db.commit()
    return [_serialize(c) for c in cards]


@router.get("")
async def list_flashcards(
    due_only: bool = Query(False),
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    user = await get_or_create_user(db, claims)
    if due_only:
        cards = await get_due_flashcards(db, user.id)
        return [_serialize(c) for c in cards]

    rows = (
        (
            await db.execute(
                select(Flashcard).where(Flashcard.user_id == user.id).order_by(Flashcard.due)
            )
        )
        .scalars()
        .all()
    )
    return [_serialize(c) for c in rows]


@router.get("/export.apkg")
async def export_apkg(
    document_id: uuid.UUID | None = Query(None),
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """A real Anki `.apkg` of this student's own flashcards -- a genuine SQLite-backed
    Anki package built by `genanki` (see app/services/anki.py), not a CSV pretending to
    be one -- so cards Newton generated can be reviewed on a phone. Decks are grouped by
    source document, the same grouping app/services/weak_areas.py already uses.

    `document_id` narrows the export to one document's cards; omitted, it exports
    everything. 404 when there's nothing to export rather than handing back a valid but
    empty package, since an empty .apkg imports silently and looks like a bug to the
    student.

    Package construction is CPU/disk-bound (genanki builds a SQLite collection and zips
    it), so it runs in a worker thread like every other blocking call in this codebase --
    see app/services/documents.py's asyncio.to_thread use for the same reason."""
    user = await get_or_create_user(db, claims)
    if document_id is not None:
        document = await db.get(Document, document_id)
        if document is None or document.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")

    decks = await build_flashcard_decks(db, user.id, document_id)
    if not decks:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No flashcards to export yet")

    data = await asyncio.to_thread(build_apkg, decks)
    filename = _export_filename(decks, "apkg")
    return Response(
        content=data,
        # Anki's own registered type -- what a phone/desktop Anki install associates
        # with a downloaded package.
        media_type="application/vnd.anki",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export.pptx")
async def export_pptx(
    document_id: uuid.UUID | None = Query(None),
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """A real PowerPoint deck of this student's own flashcards -- two slides per card
    (Question, then Answer) so it can actually be clicked through as a study slideshow,
    with a title slide per source document. Built by app/services/pptx_export.py over the
    SAME build_flashcard_decks() grouping the .apkg export above uses, so the two exports
    can never disagree about what a deck is.

    Deliberately NOT Pro-gated and deliberately consuming no billing credit, unlike
    app/tools/create_artifact.py (which really does rent a sandboxed coding agent per
    call and is Pro-gated for that reason). Nothing here calls a model or a sandbox: it's
    python-pptx assembling a fixed document schema from rows this user already owns, so
    its cost is ordinary request handling. Please don't "fix" this by adding a gate --
    there is no extra compute here to pay for.

    Mirrors export_apkg above exactly otherwise: same auth, same optional `document_id`
    scoping with the same ownership check, same 404 when there's nothing to export
    (rather than a valid-but-empty deck, which just looks like a bug to the student), and
    the same worker-thread offload since building and zipping an OOXML package is
    CPU-bound."""
    user = await get_or_create_user(db, claims)
    if document_id is not None:
        document = await db.get(Document, document_id)
        if document is None or document.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")

    decks = await build_flashcard_decks(db, user.id, document_id)
    if not decks:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No flashcards to export yet")

    data = await asyncio.to_thread(build_flashcard_pptx, decks)
    filename = _export_filename(decks, "pptx")
    return Response(
        content=data,
        media_type=PPTX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _export_filename(decks: list, extension: str) -> str:
    """"newton-lecture-3.pdf.apkg" for a single-deck (one document) export, plain
    "newton-flashcards.apkg" when several decks are bundled -- and the same two shapes
    for any other extension, so the .pptx export names its file exactly the way the
    .apkg one already does. Sanitized because a deck name is derived from a
    student-renameable filename and this lands in a quoted Content-Disposition header."""
    if len(decks) == 1:
        label = decks[0][0].split("::", 1)[-1]
        cleaned = re.sub(r'[\x00-\x1f"\\/]', "", label).strip()
        if cleaned:
            return f"newton-{cleaned}.{extension}"
    return f"newton-flashcards.{extension}"


class ReviewRequest(BaseModel):
    """Exactly one of these is required, and `rating` still means what it always meant.

    `rating` (1=Again, 2=Hard, 3=Good, 4=Easy) is the self-rating a recognition card has
    always used. `typed_answer` is the production-direction path: the student commits to
    an answer and the server grades it (app/services/flashcards.grade_production_answer)
    instead of asking them to judge themselves on a word they may have just failed to
    produce. Sending both is allowed and `rating` wins -- that's the student overriding a
    grade they disagree with, which is a reasonable thing to let them do and a bad thing
    to make them fight the API over."""

    rating: int | None = Field(None, ge=1, le=4)
    typed_answer: str | None = Field(None, max_length=2000)


@router.post("/{card_id}/review")
async def review(
    card_id: uuid.UUID,
    body: ReviewRequest,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    card = await db.get(Flashcard, card_id)
    if card is None or card.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flashcard not found")

    if body.rating is not None:
        updated = await review_flashcard(db, card, body.rating)
        await db.commit()
        return _serialize(updated)

    if body.typed_answer is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Send either a rating (1-4) or a typed_answer."
        )
    if card_direction(card) != DIRECTION_PRODUCTION:
        # A recognition card's `back` is a full answer, not a term -- typing it out
        # verbatim is not the skill it drills, and grading against it would fail almost
        # everyone. Say so rather than silently marking them wrong.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This card is a recognition card -- rate it 1-4 instead of typing an answer.",
        )

    updated, grading = await review_production_flashcard(db, card, body.typed_answer)
    await db.commit()
    return {**_serialize(updated), "grading": grading}


@router.delete("/{card_id}")
async def delete_flashcard(
    card_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    card = await db.get(Flashcard, card_id)
    if card is None or card.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flashcard not found")

    await db.delete(card)
    await db.commit()
    return {"status": "deleted"}
