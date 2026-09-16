"""Public share links for flashcard decks and practice exams.

Same conventions as test_gamification.py / test_calendar.py: throwaway users with real
teardown, real HTTP against the live server, and student1's own data never mutated beyond
a create-then-delete round trip the test cleans up itself.

The assertions that matter most here are the negative ones -- that the public page really
does render with NO Authorization header, that a wrong or revoked token is a plain 404,
and that an un-taken exam does not leak its answer key just because it's been shared.
"""

import uuid
from datetime import datetime, timezone

import pytest_asyncio
from sqlalchemy import delete, select

from app.db.models import (
    Document,
    Flashcard,
    PracticeExam,
    PracticeExamQuestion,
    ShareLink,
    User,
)
from app.services.share_tokens import generate_token


@pytest_asyncio.fixture
async def throwaway_owner(db_session):
    """A user who owns a small deck and two exams (one taken, one not). Everything created
    here is deleted again afterwards; nothing touches the real student1 account."""
    user = User(keycloak_sub=f"test-share-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()

    document = Document(
        user_id=user.id, filename="Photosynthesis notes.pdf", minio_key=f"test/{uuid.uuid4()}"
    )
    db_session.add(document)
    await db_session.flush()

    db_session.add_all(
        [
            Flashcard(
                user_id=user.id,
                document_id=document.id,
                front="What does chlorophyll absorb?",
                back="Mostly red & blue light",
            ),
            Flashcard(
                user_id=user.id,
                document_id=document.id,
                front="Where do light reactions happen?",
                back="The thylakoid membrane",
            ),
        ]
    )

    untaken = PracticeExam(user_id=user.id, title="Photosynthesis quiz", difficulty="medium")
    taken = PracticeExam(user_id=user.id, title="Cell biology quiz", difficulty="hard", score=0.5)
    db_session.add_all([untaken, taken])
    await db_session.flush()

    taken.completed_at = datetime.now(timezone.utc)

    db_session.add_all(
        [
            PracticeExamQuestion(
                exam_id=untaken.id,
                question_index=0,
                question="Which pigment drives photosynthesis?",
                choices=["Chlorophyll", "Melanin", "Keratin", "Hemoglobin"],
                correct_index=0,
                explanation="SECRETEXPLANATION chlorophyll is the primary pigment.",
            ),
            PracticeExamQuestion(
                exam_id=taken.id,
                question_index=0,
                question="What organelle makes ATP?",
                choices=["Mitochondrion", "Ribosome", "Nucleus", "Lysosome"],
                correct_index=0,
                explanation="The mitochondrion is the site of oxidative phosphorylation.",
                student_answer_index=1,
                is_correct=False,
            ),
        ]
    )
    await db_session.commit()

    yield user, document, untaken, taken

    await db_session.execute(delete(ShareLink).where(ShareLink.user_id == user.id))
    await db_session.execute(
        delete(PracticeExamQuestion).where(PracticeExamQuestion.exam_id.in_([untaken.id, taken.id]))
    )
    await db_session.execute(delete(PracticeExam).where(PracticeExam.user_id == user.id))
    await db_session.execute(delete(Flashcard).where(Flashcard.user_id == user.id))
    await db_session.execute(delete(Document).where(Document.user_id == user.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


async def _mint(db_session, user_id, *, kind, document_id=None, exam_id=None) -> str:
    token = generate_token()
    db_session.add(
        ShareLink(
            user_id=user_id, kind=kind, document_id=document_id, exam_id=exam_id, token=token
        )
    )
    await db_session.commit()
    return token


# ---------------------------------------------------------------------------
# The public page — no auth at all, which is the whole feature.
# ---------------------------------------------------------------------------


async def test_public_flashcard_page_renders_without_any_auth(
    http_client, db_session, throwaway_owner
):
    user, document, _untaken, _taken = throwaway_owner
    token = await _mint(db_session, user.id, kind="flashcards", document_id=document.id)

    # Deliberately NO headers argument: this is exactly what a browser belonging to
    # someone with no Newton account would send.
    resp = await http_client.get(f"/s/{token}")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")

    body = resp.text
    assert "<!doctype html>" in body.lower()
    assert "Photosynthesis notes.pdf" in body
    assert "What does chlorophyll absorb?" in body
    assert "Mostly red &amp; blue light" in body  # escaped, and really present
    assert "The thylakoid membrane" in body
    assert body.count('class="flip"') == 2
    assert "Flashcard deck" in body


async def test_public_flashcard_page_escapes_html_in_card_content(
    http_client, db_session, throwaway_owner
):
    """Card text is model-generated from student-uploaded documents, so it is
    attacker-influenceable in the general case and this page is served from the API's own
    origin. Unescaped interpolation would be stored XSS."""
    user, document, _untaken, _taken = throwaway_owner
    db_session.add(
        Flashcard(
            user_id=user.id,
            document_id=document.id,
            front="<script>alert('xss')</script>",
            back="<img src=x onerror=alert(1)>",
        )
    )
    await db_session.commit()
    token = await _mint(db_session, user.id, kind="flashcards", document_id=document.id)

    body = (await http_client.get(f"/s/{token}")).text
    assert "<script>alert('xss')</script>" not in body
    assert "&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;" in body
    assert "<img src=x onerror=alert(1)>" not in body


async def test_public_flashcard_page_scoped_to_all_cards_when_no_document(
    http_client, db_session, throwaway_owner
):
    user, _document, _untaken, _taken = throwaway_owner
    token = await _mint(db_session, user.id, kind="flashcards", document_id=None)

    body = (await http_client.get(f"/s/{token}")).text
    assert "What does chlorophyll absorb?" in body
    assert "Where do light reactions happen?" in body


async def test_public_exam_page_hides_answers_until_the_exam_is_completed(
    http_client, db_session, throwaway_owner
):
    """The same rule app/routers/practice_exams.py's _serialize_question enforces for the
    owner's own API. Sharing must not become a hole in it."""
    user, _document, untaken, _taken = throwaway_owner
    token = await _mint(db_session, user.id, kind="practice_exam", exam_id=untaken.id)

    body = (await http_client.get(f"/s/{token}")).text
    assert "Which pigment drives photosynthesis?" in body
    assert "Chlorophyll" in body  # the choices are shown...
    assert "SECRETEXPLANATION" not in body  # ...but the explanation is not
    assert 'class="correct"' not in body
    assert "hasn't been taken yet" in body


async def test_public_exam_page_shows_answers_once_completed(
    http_client, db_session, throwaway_owner
):
    user, _document, _untaken, taken = throwaway_owner
    token = await _mint(db_session, user.id, kind="practice_exam", exam_id=taken.id)

    body = (await http_client.get(f"/s/{token}")).text
    assert "What organelle makes ATP?" in body
    assert 'class="correct"' in body
    assert 'class="chosen-wrong"' in body
    assert "oxidative phosphorylation" in body
    assert "scored 50%" in body


async def test_unknown_and_revoked_tokens_both_404(http_client, db_session, throwaway_owner):
    user, document, _untaken, _taken = throwaway_owner
    assert (await http_client.get(f"/s/{generate_token()}")).status_code == 404

    token = await _mint(db_session, user.id, kind="flashcards", document_id=document.id)
    assert (await http_client.get(f"/s/{token}")).status_code == 200

    await db_session.execute(delete(ShareLink).where(ShareLink.token == token))
    await db_session.commit()
    assert (await http_client.get(f"/s/{token}")).status_code == 404


# ---------------------------------------------------------------------------
# The authenticated management endpoints.
# ---------------------------------------------------------------------------


async def test_management_endpoints_require_auth(http_client):
    assert (await http_client.get("/share")).status_code == 401
    assert (await http_client.post("/share", json={"kind": "flashcards"})).status_code == 401
    assert (await http_client.delete(f"/share/{uuid.uuid4()}")).status_code == 401


async def test_create_is_idempotent_then_regenerates_and_revokes(
    http_client, auth_headers, db_session
):
    """A full lifecycle as the real signed-in account, cleaned up at the end so student1 is
    left with no share links it didn't already have."""
    first = await http_client.post("/share", headers=auth_headers, json={"kind": "flashcards"})
    assert first.status_code == 201
    link = first.json()
    link_id = link["id"]

    try:
        assert "/s/" in link["url"]

        # Pressing Share twice must return the SAME link, not orphan the one already sent.
        again = await http_client.post("/share", headers=auth_headers, json={"kind": "flashcards"})
        assert again.status_code == 201
        assert again.json()["url"] == link["url"]

        listed = await http_client.get("/share", headers=auth_headers)
        assert listed.status_code == 200
        assert any(row["id"] == link_id for row in listed.json())

        old_token = link["url"].rsplit("/", 1)[1]
        assert (await http_client.get(f"/s/{old_token}")).status_code == 200

        regenerated = await http_client.post(
            "/share", headers=auth_headers, json={"kind": "flashcards", "regenerate": True}
        )
        assert regenerated.status_code == 201
        assert regenerated.json()["url"] != link["url"]
        link_id = regenerated.json()["id"]
        # The leaked URL is dead immediately.
        assert (await http_client.get(f"/s/{old_token}")).status_code == 404

        new_token = regenerated.json()["url"].rsplit("/", 1)[1]
        assert (await http_client.get(f"/s/{new_token}")).status_code == 200

        revoked = await http_client.delete(f"/share/{link_id}", headers=auth_headers)
        assert revoked.status_code == 200
        assert (await http_client.get(f"/s/{new_token}")).status_code == 404
    finally:
        await db_session.execute(delete(ShareLink).where(ShareLink.id == uuid.UUID(link_id)))
        await db_session.commit()


async def test_cannot_share_someone_elses_content(http_client, auth_headers, throwaway_owner):
    _user, document, untaken, _taken = throwaway_owner

    resp = await http_client.post(
        "/share", headers=auth_headers, json={"kind": "flashcards", "document_id": str(document.id)}
    )
    assert resp.status_code == 404

    resp = await http_client.post(
        "/share", headers=auth_headers, json={"kind": "practice_exam", "exam_id": str(untaken.id)}
    )
    assert resp.status_code == 404


async def test_cannot_revoke_someone_elses_link(
    http_client, auth_headers, db_session, throwaway_owner
):
    user, document, _untaken, _taken = throwaway_owner
    token = await _mint(db_session, user.id, kind="flashcards", document_id=document.id)
    link = (
        await db_session.execute(select(ShareLink).where(ShareLink.token == token))
    ).scalars().one()

    resp = await http_client.delete(f"/share/{link.id}", headers=auth_headers)
    assert resp.status_code == 404
    # Still live for its real owner.
    assert (await http_client.get(f"/s/{token}")).status_code == 200


async def test_create_rejects_an_unknown_kind_and_a_missing_exam_id(http_client, auth_headers):
    assert (
        await http_client.post("/share", headers=auth_headers, json={"kind": "nonsense"})
    ).status_code == 422
    assert (
        await http_client.post("/share", headers=auth_headers, json={"kind": "practice_exam"})
    ).status_code == 422
