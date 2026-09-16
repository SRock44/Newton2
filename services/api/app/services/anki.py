"""Builds a real Anki `.apkg` package from a student's own Newton flashcards, so the
cards this app generated can be reviewed on a phone in Anki rather than only ever inside
Newton.

Why this exists at all: app/services/flashcards.py already schedules every card with the
`fsrs` library -- the same algorithm family Anki itself uses -- but the cards lived
exclusively in this app's database, with no export path of any kind. The deck grouping
here is deliberately the SAME one app/services/weak_areas.py already uses (group by
source `Document`, since that filename is the only real "topic" label this codebase has;
anything with no source document groups under "general") rather than inventing a second,
competing notion of what a deck is.

An honest limitation, stated plainly rather than papered over: this exports the CARDS,
not their FSRS review history. `.apkg` scheduling state is a different representation
from this app's Flashcard columns (and Anki's own FSRS implementation re-derives its
state from a review log this export doesn't carry), so every exported card arrives in
Anki as a new card. Each note's GUID IS stable and derived from the Newton flashcard's
own id, which means re-exporting later updates the same notes in place instead of
duplicating them -- that part genuinely works.

No I/O against MinIO, no model calls: pure DB rows in, package bytes out.
"""

from __future__ import annotations

import hashlib
import html
import os
import tempfile
import uuid

import genanki
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Document, Flashcard

# Same "no source document" bucket label weak_areas.py uses, for the same reason.
GENERAL_LABEL = "general"

# Anki namespaces decks with "::" -- everything Newton exports lands under one top-level
# deck so it never scatters itself through a student's existing collection.
DECK_ROOT = "Newton"

# A model (Anki's term for a note type) id must be stable across exports, or every
# export creates a duplicate note type in the student's collection. Fixed constant
# rather than derived from anything: there is exactly one Newton note type.
_MODEL_ID = 1741320001
_MODEL_NAME = "Newton Basic"

NEWTON_MODEL = genanki.Model(
    _MODEL_ID,
    _MODEL_NAME,
    fields=[{"name": "Front"}, {"name": "Back"}],
    templates=[
        {
            "name": "Card 1",
            "qfmt": "{{Front}}",
            "afmt": '{{FrontSide}}<hr id="answer">{{Back}}',
        }
    ],
)


def _stable_id(text: str) -> int:
    """Anki deck ids are arbitrary integers, conventionally in [2^30, 2^31) (that's the
    range Anki's own code and genanki's docs pick from). Deriving one from a hash of the
    deck name rather than randomizing it means re-exporting the same deck later targets
    the SAME Anki deck instead of creating "Newton::biology-2" beside it."""
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return (1 << 30) + (int.from_bytes(digest[:4], "big") % (1 << 30))


def _field_html(text: str) -> str:
    """Anki note fields are HTML. Card text here is plain text the model wrote, so it's
    escaped (a chemistry card's "n < 3" must not be swallowed as a tag) and its line
    breaks are turned into real <br> so a multi-line answer still reads as multi-line."""
    return html.escape(text or "").replace("\n", "<br>")


async def build_flashcard_decks(
    db: AsyncSession, user_id: uuid.UUID, document_id: uuid.UUID | None = None
) -> list[tuple[str, list[Flashcard]]]:
    """This user's flashcards grouped into (deck name, cards) pairs -- by source
    document, exactly as weak_areas.py groups them. `document_id` narrows the export to
    one document's cards (what the Documents panel would export for a single file);
    omitted, it exports everything the student has. Deck order is alphabetical by name so
    an export is deterministic, and cards within a deck keep creation order."""
    query = select(Flashcard).where(Flashcard.user_id == user_id)
    if document_id is not None:
        query = query.where(Flashcard.document_id == document_id)
    cards = (await db.execute(query.order_by(Flashcard.created_at))).scalars().all()
    if not cards:
        return []

    by_document: dict[uuid.UUID | None, list[Flashcard]] = {}
    for card in cards:
        by_document.setdefault(card.document_id, []).append(card)

    doc_ids = {key for key in by_document if key is not None}
    filenames: dict[uuid.UUID, str] = {}
    if doc_ids:
        docs = (await db.execute(select(Document).where(Document.id.in_(doc_ids)))).scalars().all()
        filenames = {d.id: d.filename for d in docs}

    decks: list[tuple[str, list[Flashcard]]] = []
    for key, group in by_document.items():
        label = filenames.get(key, GENERAL_LABEL) if key is not None else GENERAL_LABEL
        decks.append((f"{DECK_ROOT}::{_sanitize_deck_label(label)}", group))
    decks.sort(key=lambda pair: pair[0])
    return decks


def _sanitize_deck_label(label: str) -> str:
    """"::" is Anki's deck-nesting separator, so a filename containing it would silently
    invent extra sub-decks; collapse it to a single ":" instead. Everything else about
    the filename (including its extension) is kept -- "lecture-3.pdf" is a more
    recognizable deck name to the student who uploaded it than a cleaned-up guess."""
    return label.replace("::", ":").strip() or GENERAL_LABEL


def build_apkg(decks: list[tuple[str, list[Flashcard]]]) -> bytes:
    """Renders the grouped cards into real `.apkg` bytes. genanki only knows how to write
    to a filesystem path (it builds a SQLite collection internally, which needs a real
    file), so this writes to a temp file and reads it straight back -- the caller only
    ever sees bytes."""
    packages: list[genanki.Deck] = []
    for deck_name, cards in decks:
        deck = genanki.Deck(_stable_id(deck_name), deck_name)
        for card in cards:
            deck.add_note(
                genanki.Note(
                    model=NEWTON_MODEL,
                    fields=[_field_html(card.front), _field_html(card.back)],
                    # Stable per Newton card: a later re-export updates this same note in
                    # the student's collection rather than adding a duplicate.
                    guid=genanki.guid_for(str(card.id)),
                )
            )
        packages.append(deck)

    handle, path = tempfile.mkstemp(suffix=".apkg")
    os.close(handle)
    try:
        genanki.Package(packages).write_to_file(path)
        with open(path, "rb") as fh:
            return fh.read()
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
