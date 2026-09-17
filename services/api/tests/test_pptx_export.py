"""Real tests for the PowerPoint export (app/services/pptx_export.py + GET
/flashcards/export.pptx).

"Real" means the bytes produced here are actually opened as the zip archive a .pptx is,
its internal OOXML parts enumerated, and the drawing-layer text elements of each slide
parsed out and checked -- not just "python-pptx didn't raise". Everything runs against a
throwaway User (tests/test_anki_export.py's convention, which this file mirrors
throughout), never the shared dev account's flashcards.
"""

import io
import uuid
import zipfile
from xml.etree import ElementTree

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import delete

from app.db.models import Document, Flashcard, FlashcardReviewLog, User
from app.routers.flashcards import export_pptx
from app.services.anki import build_flashcard_decks
from app.services.pptx_export import PPTX_MEDIA_TYPE, build_flashcard_pptx

# The DrawingML namespace every run of text in a .pptx lives under.
_A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"


@pytest_asyncio.fixture
async def student_with_cards(db_session):
    """One throwaway user with cards from two different documents plus one orphan card
    (no source document) -- the three cases the deck grouping has to distinguish."""
    user = User(keycloak_sub=f"test-pptx-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()

    biology = Document(
        user_id=user.id, filename="biology-lecture-2.pdf", mime_type="application/pdf", minio_key="x/1"
    )
    history = Document(
        user_id=user.id, filename="history-notes.md", mime_type="text/markdown", minio_key="x/2"
    )
    db_session.add_all([biology, history])
    await db_session.flush()

    db_session.add_all(
        [
            Flashcard(user_id=user.id, document_id=biology.id, front="What is mitosis?", back="Cell division."),
            Flashcard(
                user_id=user.id,
                document_id=biology.id,
                front="Where does the Calvin cycle occur?",
                back="The stroma.",
            ),
            Flashcard(
                user_id=user.id,
                document_id=history.id,
                front="When was the Treaty of Westphalia?",
                back="1648.",
            ),
            Flashcard(user_id=user.id, document_id=None, front="What is 7 x 8?", back="56"),
        ]
    )
    await db_session.commit()

    yield user, biology, history

    await db_session.execute(delete(FlashcardReviewLog).where(FlashcardReviewLog.user_id == user.id))
    await db_session.execute(delete(Flashcard).where(Flashcard.user_id == user.id))
    await db_session.execute(delete(Document).where(Document.user_id == user.id))
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


def _claims(user: User) -> dict:
    return {"sub": user.keycloak_sub}


def _parts(data: bytes) -> list[str]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return archive.namelist()


def _slide_texts(data: bytes) -> list[str]:
    """Every slide's text, in slide order, read straight out of the package's own
    ppt/slides/slideN.xml by parsing the <a:t> text runs -- i.e. proof the words are
    really in the file's XML, independent of the library that wrote them."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = sorted(
            (n for n in archive.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml")),
            key=lambda n: int(n.rsplit("slide", 1)[-1].removesuffix(".xml")),
        )
        slides = []
        for name in names:
            root = ElementTree.fromstring(archive.read(name))
            slides.append("\n".join(node.text or "" for node in root.iter(f"{{{_A_NS}}}t")))
    return slides


@pytest.mark.asyncio
async def test_build_pptx_produces_a_real_openxml_package(db_session, student_with_cards):
    user, _biology, _history = student_with_cards
    decks = await build_flashcard_decks(db_session, user.id)

    data = build_flashcard_pptx(decks)

    assert data, "deck must not be empty"
    parts = _parts(data)
    # A .pptx is a real OOXML zip: a content-type map, the presentation part, and at
    # least one actual slide part.
    assert "[Content_Types].xml" in parts, parts
    assert "ppt/presentation.xml" in parts, parts
    assert "ppt/slides/slide1.xml" in parts, parts


@pytest.mark.asyncio
async def test_every_card_becomes_a_question_slide_then_an_answer_slide(db_session, student_with_cards):
    user, _biology, _history = student_with_cards
    decks = await build_flashcard_decks(db_session, user.id)

    slides = _slide_texts(build_flashcard_pptx(decks))

    # 3 decks (biology x2 cards, general x1, history x1) => 3 title slides + 2 slides per
    # card for 4 cards.
    assert len(slides) == 3 + 2 * 4

    # The biology deck: title slide, then Q/A, Q/A.
    assert "biology-lecture-2.pdf" in slides[0]
    assert "QUESTION 1 OF 2" in slides[1] and "What is mitosis?" in slides[1]
    # A question slide must NOT leak its own answer -- that's the whole point of the
    # two-slide split.
    assert "Cell division." not in slides[1]
    assert "ANSWER 1 OF 2" in slides[2] and "Cell division." in slides[2]
    # ...but the answer slide repeats the question, so it's never read without context.
    assert "What is mitosis?" in slides[2]
    assert "QUESTION 2 OF 2" in slides[3] and "Calvin cycle" in slides[3]
    assert "The stroma." in slides[4]


@pytest.mark.asyncio
async def test_each_source_document_gets_its_own_named_title_slide(db_session, student_with_cards):
    user, _biology, _history = student_with_cards
    decks = await build_flashcard_decks(db_session, user.id)

    slides = _slide_texts(build_flashcard_pptx(decks))

    # One divider per deck, naming the document it came from -- so a multi-document
    # export doesn't read as one undifferentiated pile.
    titles = [s for s in slides if "flashcard" in s]
    assert len(titles) == 3
    assert any("biology-lecture-2.pdf" in s and "2 flashcards" in s for s in titles)
    assert any("history-notes.md" in s and "1 flashcard" in s for s in titles)
    assert any("general" in s for s in titles)


def test_multi_line_card_text_becomes_real_paragraphs_not_one_run():
    card = Flashcard(id=uuid.uuid4(), front="Name the phases.", back="Prophase\nMetaphase\nAnaphase")

    slides = _slide_texts(build_flashcard_pptx([("Newton::cells", [card])]))

    answer = slides[2]
    assert "Prophase" in answer and "Metaphase" in answer and "Anaphase" in answer
    # Three separate <a:t> runs, not one string with embedded newlines.
    assert answer.count("Prophase") == 1
    assert answer.split("\n").count("Metaphase") == 1


def test_angle_brackets_and_ampersands_survive_as_real_text():
    """XML-hostile characters have to arrive as escaped XML that reads back as the
    original text -- a chemistry card's "n < 3" must not corrupt the package."""
    card = Flashcard(id=uuid.uuid4(), front="Is n < 3 & m > 1?", back="Yes, when n=2")

    data = build_flashcard_pptx([("Newton::edge-cases", [card])])

    slides = _slide_texts(data)
    assert "Is n < 3 & m > 1?" in slides[1]
    assert "Yes, when n=2" in slides[2]


@pytest.mark.asyncio
async def test_export_endpoint_returns_a_downloadable_deck(db_session, student_with_cards):
    user, _biology, _history = student_with_cards

    response = await export_pptx(document_id=None, claims=_claims(user), db=db_session)

    assert response.status_code == 200
    assert response.media_type == PPTX_MEDIA_TYPE
    assert 'filename="newton-flashcards.pptx"' in response.headers["content-disposition"]
    assert len(_slide_texts(response.body)) == 3 + 2 * 4


@pytest.mark.asyncio
async def test_export_endpoint_scoped_to_one_document_names_the_file_after_it(db_session, student_with_cards):
    user, biology, _history = student_with_cards

    response = await export_pptx(document_id=biology.id, claims=_claims(user), db=db_session)

    # Extension and all -- "newton-biology-lecture-2.pdf.pptx" -- exactly as the .apkg
    # export already names a single-deck file: the source document's own name is what
    # the student recognizes (see anki._sanitize_deck_label).
    assert 'filename="newton-biology-lecture-2.pdf.pptx"' in response.headers["content-disposition"]
    # One title slide + two slides for each of the two biology cards.
    assert len(_slide_texts(response.body)) == 5


@pytest.mark.asyncio
async def test_export_endpoint_404s_when_there_is_nothing_to_export(db_session):
    user = User(keycloak_sub=f"test-pptx-empty-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()
    await db_session.commit()
    try:
        with pytest.raises(HTTPException) as excinfo:
            await export_pptx(document_id=None, claims=_claims(user), db=db_session)
        assert excinfo.value.status_code == 404
    finally:
        await db_session.execute(delete(User).where(User.id == user.id))
        await db_session.commit()


@pytest.mark.asyncio
async def test_export_endpoint_404s_for_someone_elses_document(db_session, student_with_cards):
    _owner, biology, _history = student_with_cards
    stranger = User(keycloak_sub=f"test-pptx-stranger-{uuid.uuid4()}")
    db_session.add(stranger)
    await db_session.flush()
    await db_session.commit()
    try:
        with pytest.raises(HTTPException) as excinfo:
            await export_pptx(document_id=biology.id, claims=_claims(stranger), db=db_session)
        assert excinfo.value.status_code == 404
    finally:
        await db_session.execute(delete(User).where(User.id == stranger.id))
        await db_session.commit()


@pytest.mark.asyncio
async def test_export_is_available_on_the_free_plan_and_consumes_no_credit(db_session, student_with_cards):
    """This export runs no model and no sandbox -- it's python-pptx over rows the user
    already owns -- so unlike create_artifact it is deliberately NOT Pro-gated and
    deliberately bills nothing. Asserted rather than left implicit so a later "let's
    monetize the exports" change has to delete a test that says why not."""
    user, _biology, _history = student_with_cards
    assert user.plan != "pro", "fixture must be a free-plan user for this to prove anything"
    credits_before = user.credits_used_cents
    topup_before = user.topup_credits_cents

    response = await export_pptx(document_id=None, claims=_claims(user), db=db_session)

    assert response.status_code == 200
    await db_session.refresh(user)
    assert user.plan == "free"
    assert user.credits_used_cents == credits_before
    assert user.topup_credits_cents == topup_before
