"""Public, read-only share links for a flashcard deck or a practice exam.

Two routers live here, and the split is the security boundary:

  * `router` (prefix /share) is normal authenticated app surface -- create, list and
    revoke your OWN links -- using the same `require_user` + `get_or_create_user` pair as
    every other router in this codebase.

  * `public_router` serves GET /s/{token} with NO authentication dependency whatsoever.
    That is the entire feature: the person receiving a shared deck does not have a Newton
    account, has nothing to log in as, and is opening the link in an ordinary browser.
    See that handler's docstring for how the token substitutes for a session, and
    app/services/share_tokens.py for why it is deliberately not a JWT.

The HTML is built right here as a self-contained string. This project has no public web
frontend at all -- the only UI is the Tauri desktop bundle, which the recipient by
definition does not have installed -- so there is nothing to redirect to and no template
engine in the dependency list to reach for. Inline <style> and a few lines of inline
<script> keep the whole page a single response with no assets to serve.

EVERY piece of content interpolated into that HTML goes through html.escape(). Flashcard
fronts/backs, exam questions, choices and explanations are all model-generated text
derived from documents a student uploaded -- i.e. attacker-influenceable in the general
case -- and this page is served from the API's own origin to an audience with no
relationship to the app. Unescaped interpolation here would be stored XSS.
"""

import html
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.core.config import get_settings
from app.db.base import get_db
from app.db.models import Document, Flashcard, PracticeExam, PracticeExamQuestion, ShareLink
from app.services.share_tokens import generate_token
from app.services.users import get_or_create_user

router = APIRouter(prefix="/share", tags=["share"])
public_router = APIRouter(tags=["share"])

KIND_FLASHCARDS = "flashcards"
KIND_PRACTICE_EXAM = "practice_exam"
VALID_KINDS = (KIND_FLASHCARDS, KIND_PRACTICE_EXAM)


def _public_url(token: str) -> str:
    """A plain http(s) URL pointing straight at this API. Deliberately NOT a deep link
    into the desktop app: whoever receives this has no Tauri app installed, which is the
    entire reason the page is server-rendered."""
    return f"{get_settings().public_base_url.rstrip('/')}/s/{token}"


def _serialize(link: ShareLink) -> dict:
    return {
        "id": str(link.id),
        "kind": link.kind,
        "document_id": str(link.document_id) if link.document_id else None,
        "exam_id": str(link.exam_id) if link.exam_id else None,
        "url": _public_url(link.token),
        "created_at": link.created_at.isoformat(),
    }


class ShareCreate(BaseModel):
    kind: str
    document_id: uuid.UUID | None = None
    exam_id: uuid.UUID | None = None
    # When true, any existing link for this exact target is DELETED first and a brand new
    # secret minted -- the leak-recovery path, same reasoning as the calendar feed's
    # regenerate. Default false makes the endpoint idempotent, so a student pressing
    # "Share" twice gets the same URL back instead of quietly orphaning the one they
    # already sent someone.
    regenerate: bool = False


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_share_link(
    body: ShareCreate,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)

    if body.kind not in VALID_KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown share kind: {body.kind}")

    document_id: uuid.UUID | None = None
    exam_id: uuid.UUID | None = None

    if body.kind == KIND_FLASHCARDS:
        # document_id is optional here (None = every card this student owns), but when it
        # IS given it has to be verified as theirs -- otherwise a caller could mint a
        # public link to someone else's document's deck.
        if body.document_id is not None:
            document = await db.get(Document, body.document_id)
            if document is None or document.user_id != user.id:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
            document_id = document.id
    else:
        if body.exam_id is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "exam_id is required to share a practice exam."
            )
        exam = await db.get(PracticeExam, body.exam_id)
        if exam is None or exam.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Practice exam not found")
        exam_id = exam.id

    # `col == None` renders as `= NULL` (never true) in SQL, so the NULL cases have to use
    # IS NULL explicitly -- otherwise "the link for all my flashcards" would never be
    # found and every press of Share would mint a new secret, orphaning the last one.
    conditions = [ShareLink.user_id == user.id, ShareLink.kind == body.kind]
    conditions.append(
        ShareLink.document_id == document_id if document_id is not None else ShareLink.document_id.is_(None)
    )
    conditions.append(
        ShareLink.exam_id == exam_id if exam_id is not None else ShareLink.exam_id.is_(None)
    )
    existing = (await db.execute(select(ShareLink).where(*conditions))).scalars().first()

    if existing is not None and not body.regenerate:
        return _serialize(existing)
    if existing is not None:
        await db.delete(existing)
        await db.flush()

    link = ShareLink(
        user_id=user.id,
        kind=body.kind,
        document_id=document_id,
        exam_id=exam_id,
        token=generate_token(),
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return _serialize(link)


@router.get("")
async def list_share_links(
    claims: dict = Depends(require_user), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    user = await get_or_create_user(db, claims)
    rows = (
        (
            await db.execute(
                select(ShareLink)
                .where(ShareLink.user_id == user.id)
                .order_by(ShareLink.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [_serialize(link) for link in rows]


@router.delete("/{link_id}")
async def revoke_share_link(
    link_id: uuid.UUID,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Revocation is a real DELETE -- from the next request onward the public URL 404s.
    There is no soft-delete flag to forget to filter on."""
    user = await get_or_create_user(db, claims)
    link = await db.get(ShareLink, link_id)
    if link is None or link.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Share link not found")
    await db.delete(link)
    await db.commit()
    return {"status": "revoked"}


# ---------------------------------------------------------------------------
# The public page.
# ---------------------------------------------------------------------------

_PAGE_CSS = """
:root { color-scheme: light dark; --bg:#fbfaf8; --fg:#1b1a18; --muted:#6b675f;
  --card:#ffffff; --line:#e6e2da; --accent:#3f6f5c; --good:#2f7a4f; --bad:#a4372f; }
@media (prefers-color-scheme: dark) { :root { --bg:#16151a; --fg:#ecebe8; --muted:#a09b93;
  --card:#1f1e24; --line:#312f38; --accent:#7fb79f; --good:#6dbb8c; --bad:#e08b83; } }
* { box-sizing: border-box; }
body { margin:0; padding:32px 16px 64px; background:var(--bg); color:var(--fg);
  font:16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.wrap { max-width: 720px; margin: 0 auto; }
header { border-bottom:1px solid var(--line); padding-bottom:16px; margin-bottom:24px; }
h1 { font-size:1.5rem; margin:0 0 6px; letter-spacing:-0.01em; }
.sub { color:var(--muted); font-size:0.9rem; margin:0; }
.badge { display:inline-block; font-size:0.72rem; letter-spacing:0.08em; text-transform:uppercase;
  color:var(--accent); border:1px solid var(--accent); border-radius:999px; padding:2px 9px; margin-bottom:10px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px;
  padding:16px 18px; margin-bottom:12px; }
.card-q { font-weight:600; }
.flip { margin-top:10px; background:none; border:1px solid var(--line); color:var(--muted);
  border-radius:8px; padding:5px 12px; font:inherit; font-size:0.85rem; cursor:pointer; }
.flip:hover { color:var(--fg); border-color:var(--accent); }
.answer { margin-top:12px; padding-top:12px; border-top:1px dashed var(--line); }
.answer[hidden] { display:none; }
ol.choices { list-style:none; margin:10px 0 0; padding:0; }
ol.choices li { border:1px solid var(--line); border-radius:8px; padding:8px 12px; margin-bottom:6px; }
ol.choices li.correct { border-color:var(--good); color:var(--good); font-weight:600; }
ol.choices li.chosen-wrong { border-color:var(--bad); color:var(--bad); }
.explain { margin-top:10px; font-size:0.9rem; color:var(--muted); }
.notice { background:var(--card); border:1px solid var(--line); border-left:3px solid var(--accent);
  border-radius:8px; padding:12px 14px; color:var(--muted); font-size:0.9rem; margin-bottom:20px; }
footer { margin-top:40px; color:var(--muted); font-size:0.82rem; text-align:center; }
"""

_FLIP_SCRIPT = """
document.addEventListener('click', function (e) {
  var btn = e.target.closest('.flip');
  if (!btn) return;
  var answer = btn.parentElement.querySelector('.answer');
  var hidden = answer.hasAttribute('hidden');
  if (hidden) { answer.removeAttribute('hidden'); } else { answer.setAttribute('hidden', ''); }
  btn.textContent = hidden ? 'Hide answer' : 'Show answer';
});
"""


def _page(title: str, badge: str, subtitle: str, body: str) -> str:
    """One shell for both kinds of shared content. `title`/`badge`/`subtitle` are escaped
    here; `body` is pre-built HTML whose own interpolations were escaped at the point they
    were inserted."""
    return f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)} · Newton</title>
<meta name="robots" content="noindex, nofollow">
<style>{_PAGE_CSS}</style>
</head><body><div class="wrap">
<header>
  <div class="badge">{html.escape(badge)}</div>
  <h1>{html.escape(title)}</h1>
  <p class="sub">{html.escape(subtitle)}</p>
</header>
{body}
<footer>Shared from Newton — a study companion. This is a read-only copy.</footer>
</div><script>{_FLIP_SCRIPT}</script></body></html>"""


@public_router.get("/s/{token}", response_class=HTMLResponse)
async def public_share_page(token: str, db: AsyncSession = Depends(get_db)) -> HTMLResponse:
    """Renders a shared deck or exam to anyone holding the link. NO AUTH, on purpose.

    There is deliberately no `Depends(require_user)` here and no reference to
    app/core/auth.py. The whole value of the feature is that a classmate, a parent or a
    study group can open the link with no Newton account, so there is no identity to
    establish and nothing to sign in as. The 256-bit random token in the path is the sole
    authorization (see app/services/share_tokens.py) -- it is looked up as an opaque
    string in a UNIQUE-indexed column, never decoded, never parsed, and carries no claims
    that could be tampered with.

    A bad or revoked token is a plain 404 with no distinguishing detail, so the endpoint
    can't be used to tell "never existed" from "revoked".

    The lookup goes token -> ShareLink -> content, never the other way around, so the only
    content reachable is exactly what the owner minted a link for. Nothing here reads a
    user id or any other identifier from the request.
    """
    link = (
        await db.execute(select(ShareLink).where(ShareLink.token == token))
    ).scalar_one_or_none()
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This link isn't valid (it may have been revoked).")

    if link.kind == KIND_FLASHCARDS:
        return HTMLResponse(await _render_flashcards(db, link))
    if link.kind == KIND_PRACTICE_EXAM:
        return HTMLResponse(await _render_exam(db, link))
    raise HTTPException(status.HTTP_404_NOT_FOUND, "This link isn't valid.")


async def _render_flashcards(db: AsyncSession, link: ShareLink) -> str:
    query = select(Flashcard).where(Flashcard.user_id == link.user_id)
    deck_name = "Flashcards"
    if link.document_id is not None:
        query = query.where(Flashcard.document_id == link.document_id)
        document = await db.get(Document, link.document_id)
        if document is not None:
            deck_name = document.filename
    cards = (await db.execute(query.order_by(Flashcard.created_at))).scalars().all()

    if not cards:
        body = '<div class="notice">This deck is empty.</div>'
    else:
        parts = []
        for card in cards:
            parts.append(
                '<div class="card">'
                f'<div class="card-q">{html.escape(card.front)}</div>'
                '<button type="button" class="flip">Show answer</button>'
                f'<div class="answer" hidden>{html.escape(card.back)}</div>'
                "</div>"
            )
        body = "".join(parts)

    count = len(cards)
    subtitle = f"{count} card{'s' if count != 1 else ''} · click a card's button to reveal the answer"
    return _page(deck_name, "Flashcard deck", subtitle, body)


async def _render_exam(db: AsyncSession, link: ShareLink) -> str:
    exam = await db.get(PracticeExam, link.exam_id) if link.exam_id else None
    if exam is None:
        # The FK CASCADEs, so this is only reachable in a race with a delete. Still worth
        # handling explicitly rather than rendering a page about a NoneType.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This link isn't valid.")

    questions = (
        (
            await db.execute(
                select(PracticeExamQuestion)
                .where(PracticeExamQuestion.exam_id == exam.id)
                .order_by(PracticeExamQuestion.question_index)
            )
        )
        .scalars()
        .all()
    )

    # THE SAME RULE the authenticated API enforces (see app/routers/practice_exams.py's
    # _serialize_question): the answer key, the explanations and the student's own graded
    # answers are revealed only once the exam has actually been completed. Making this page
    # public must not become a hole in that rule -- an un-taken exam shared with a
    # classmate shows the questions and choices and nothing else, exactly as the owner's
    # own app would show it.
    reveal = exam.completed_at is not None

    parts: list[str] = []
    if not reveal:
        parts.append(
            '<div class="notice">This exam hasn\'t been taken yet, so the answers aren\'t '
            "available here. Questions and choices only.</div>"
        )

    for index, question in enumerate(questions, start=1):
        choice_items = []
        for choice_index, choice in enumerate(question.choices):
            css = ""
            if reveal:
                if choice_index == question.correct_index:
                    css = ' class="correct"'
                elif question.student_answer_index == choice_index and not question.is_correct:
                    css = ' class="chosen-wrong"'
            choice_items.append(f"<li{css}>{html.escape(str(choice))}</li>")

        explanation = ""
        if reveal and question.explanation:
            explanation = f'<div class="explain">{html.escape(question.explanation)}</div>'

        parts.append(
            '<div class="card">'
            f'<div class="card-q">{index}. {html.escape(question.question)}</div>'
            f'<ol class="choices">{"".join(choice_items)}</ol>'
            f"{explanation}"
            "</div>"
        )

    if not questions:
        parts.append('<div class="notice">This exam has no questions.</div>')

    score = f" · scored {round((exam.score or 0) * 100)}%" if reveal else ""
    subtitle = f"{len(questions)} question{'s' if len(questions) != 1 else ''} · {exam.difficulty}{score}"
    return _page(exam.title, "Practice exam", subtitle, "".join(parts))
