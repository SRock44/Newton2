"""Real tests for the Anki `.apkg` export (app/services/anki.py + GET
/flashcards/export.apkg).

"Real" means the package bytes produced here are actually opened as a zip and its
internal SQLite collection queried for the notes that should be in it -- not just
"genanki didn't raise". Everything runs against a throwaway User (see
tests/test_gamification.py's convention), never the shared dev account's flashcards.
"""

import io
import sqlite3
import tempfile
import uuid
import zipfile
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import delete

from app.db.models import Document, Flashcard, FlashcardReviewLog, User
from app.routers.flashcards import export_apkg
from app.services.anki import build_apkg, build_flashcard_decks


@pytest_asyncio.fixture
async def student_with_cards(db_session):
    """One throwaway user with cards from two different documents plus one orphan card
    (no source document) -- the three cases the deck grouping has to distinguish."""
    user = User(keycloak_sub=f"test-anki-{uuid.uuid4()}")
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


def _notes_in_package(data: bytes) -> list[tuple[str, str]]:
    """Opens the real .apkg (a zip) and reads the note fields straight out of its
    embedded Anki SQLite collection -- proof the package genuinely contains the cards,
    not merely that a file was produced."""
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = archive.namelist()
            collection_name = next(n for n in names if n.startswith("collection.anki"))
            archive.extract(collection_name, tmp)
        connection = sqlite3.connect(Path(tmp) / collection_name)
        try:
            rows = connection.execute("select flds from notes").fetchall()
        finally:
            connection.close()
    # Anki separates a note's fields with U+001F in the `flds` column.
    return [tuple(row[0].split("\x1f")) for row in rows]


@pytest.mark.asyncio
async def test_decks_are_grouped_by_source_document_with_a_general_bucket(db_session, student_with_cards):
    user, _biology, _history = student_with_cards

    decks = await build_flashcard_decks(db_session, user.id)

    names = [name for name, _cards in decks]
    assert names == [
        "Newton::biology-lecture-2.pdf",
        "Newton::general",
        "Newton::history-notes.md",
    ]
    counts = {name: len(cards) for name, cards in decks}
    assert counts["Newton::biology-lecture-2.pdf"] == 2
    assert counts["Newton::general"] == 1
    assert counts["Newton::history-notes.md"] == 1


@pytest.mark.asyncio
async def test_decks_can_be_narrowed_to_one_document(db_session, student_with_cards):
    user, biology, _history = student_with_cards

    decks = await build_flashcard_decks(db_session, user.id, biology.id)

    assert [name for name, _ in decks] == ["Newton::biology-lecture-2.pdf"]
    assert len(decks[0][1]) == 2


@pytest.mark.asyncio
async def test_build_apkg_produces_a_real_anki_package_containing_every_card(db_session, student_with_cards):
    user, _biology, _history = student_with_cards
    decks = await build_flashcard_decks(db_session, user.id)

    data = build_apkg(decks)

    assert data, "package must not be empty"
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
    # A real .apkg is a zip holding an Anki SQLite collection plus its media manifest.
    assert any(n.startswith("collection.anki") for n in names), names
    assert "media" in names, names

    notes = _notes_in_package(data)
    fronts = {front for front, _back in notes}
    assert fronts == {
        "What is mitosis?",
        "Where does the Calvin cycle occur?",
        "When was the Treaty of Westphalia?",
        "What is 7 x 8?",
    }
    backs = {back for _front, back in notes}
    assert "1648." in backs


def test_card_text_is_html_escaped_so_angle_brackets_survive():
    card = Flashcard(id=uuid.uuid4(), front="Is n < 3 & m > 1?", back="Line one\nLine two")

    data = build_apkg([("Newton::edge-cases", [card])])

    notes = _notes_in_package(data)
    assert notes == [("Is n &lt; 3 &amp; m &gt; 1?", "Line one<br>Line two")]


def test_deck_ids_are_stable_across_builds():
    """Re-exporting must target the SAME Anki deck, not create a numbered sibling."""
    card = Flashcard(id=uuid.uuid4(), front="Q", back="A")
    first = build_apkg([("Newton::stable", [card])])
    second = build_apkg([("Newton::stable", [card])])

    def _deck_ids(data: bytes) -> list[int]:
        with tempfile.TemporaryDirectory() as tmp:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                name = next(n for n in archive.namelist() if n.startswith("collection.anki"))
                archive.extract(name, tmp)
            connection = sqlite3.connect(Path(tmp) / name)
            try:
                return sorted(row[0] for row in connection.execute("select did from cards").fetchall())
            finally:
                connection.close()

    assert _deck_ids(first) == _deck_ids(second)


@pytest.mark.asyncio
async def test_export_endpoint_returns_a_downloadable_package(db_session, student_with_cards):
    user, _biology, _history = student_with_cards

    response = await export_apkg(document_id=None, claims=_claims(user), db=db_session)

    assert response.status_code == 200
    assert response.media_type == "application/vnd.anki"
    assert 'filename="newton-flashcards.apkg"' in response.headers["content-disposition"]
    assert len(_notes_in_package(response.body)) == 4


@pytest.mark.asyncio
async def test_export_endpoint_scoped_to_one_document_names_the_file_after_it(db_session, student_with_cards):
    user, biology, _history = student_with_cards

    response = await export_apkg(document_id=biology.id, claims=_claims(user), db=db_session)

    assert 'filename="newton-biology-lecture-2.pdf.apkg"' in response.headers["content-disposition"]
    assert len(_notes_in_package(response.body)) == 2


@pytest.mark.asyncio
async def test_export_endpoint_404s_when_there_is_nothing_to_export(db_session):
    user = User(keycloak_sub=f"test-anki-empty-{uuid.uuid4()}")
    db_session.add(user)
    await db_session.flush()
    await db_session.commit()
    try:
        with pytest.raises(HTTPException) as excinfo:
            await export_apkg(document_id=None, claims=_claims(user), db=db_session)
        assert excinfo.value.status_code == 404
    finally:
        await db_session.execute(delete(User).where(User.id == user.id))
        await db_session.commit()


@pytest.mark.asyncio
async def test_export_endpoint_404s_for_someone_elses_document(db_session, student_with_cards):
    _owner, biology, _history = student_with_cards
    stranger = User(keycloak_sub=f"test-anki-stranger-{uuid.uuid4()}")
    db_session.add(stranger)
    await db_session.flush()
    await db_session.commit()
    try:
        with pytest.raises(HTTPException) as excinfo:
            await export_apkg(document_id=biology.id, claims=_claims(stranger), db=db_session)
        assert excinfo.value.status_code == 404
    finally:
        await db_session.execute(delete(User).where(User.id == stranger.id))
        await db_session.commit()
