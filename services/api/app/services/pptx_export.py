"""Builds a real PowerPoint `.pptx` study deck from a student's own Newton flashcards, so
the cards this app generated can be clicked through full-screen (or handed to a study
group, or projected in a review session) rather than only ever reviewed one-at-a-time
inside Newton's own FSRS queue.

Sibling of app/services/anki.py, and deliberately built on the SAME grouping: it takes
the exact `list[tuple[str, list[Flashcard]]]` that anki.build_flashcard_decks() already
returns -- cards grouped by source `Document`, with a "general" bucket for cards with no
source -- rather than re-querying or inventing a second notion of what a deck is.

DESIGN DECISION -- two slides per card, not one. A flashcard's whole point is the pause
between reading the question and seeing the answer; putting both on one slide destroys
that, and the file stops being a study tool and becomes a printed answer key. So each
card becomes a Question slide followed immediately by an Answer slide, which maps
exactly onto how a slideshow is actually driven: read, think, press space, check. The
Answer slide repeats the question (smaller, above the answer) so the student is never
looking at a bare answer with no idea what it was answering.

Every deck gets its own title slide naming the source document it came from, so a
multi-document export reads as real sections instead of one undifferentiated pile.

Nothing here calls a model or a sandbox: this is deterministic assembly of a fixed
document schema from rows we already have, via python-pptx's ordinary API. Pure
`decks in, bytes out` -- no DB session, no I/O of any kind.
"""

from __future__ import annotations

import io

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

from app.db.models import Flashcard

# 16:9. The stock python-pptx template is 4:3, which no laptop or projector made this
# decade actually is -- and since every shape below is explicitly positioned anyway
# (see _place), changing the canvas costs nothing and stops the deck from opening with
# black pillarboxes down both sides.
SLIDE_WIDTH = Inches(13.333)
SLIDE_HEIGHT = Inches(7.5)

# Layout indices in python-pptx's default template. 0 = Title Slide (title + subtitle),
# 5 = Title Only. Both are used with their real placeholders filled; no layout with a
# placeholder this code leaves empty is used, because an unfilled placeholder shows
# PowerPoint's "Click to add text" prompt to whoever opens the file.
_TITLE_SLIDE_LAYOUT = 0
_TITLE_ONLY_LAYOUT = 5

_MARGIN = Inches(0.9)
_CONTENT_WIDTH = SLIDE_WIDTH - 2 * _MARGIN

_INK = RGBColor(0x11, 0x18, 0x27)
_MUTED = RGBColor(0x6B, 0x72, 0x80)
_ACCENT = RGBColor(0x1D, 0x4E, 0xD8)

PPTX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def deck_title(deck_name: str) -> str:
    """"Newton::biology-lecture-2.pdf" -> "biology-lecture-2.pdf". The "Newton::" root
    exists to namespace decks inside a student's Anki collection (see anki.DECK_ROOT);
    on a slide it's noise, since every slide in the file is already Newton's."""
    return deck_name.rsplit("::", 1)[-1].strip() or deck_name


def _place(shape, left, top, width, height) -> None:
    shape.left = int(left)
    shape.top = int(top)
    shape.width = int(width)
    shape.height = int(height)


def _write(
    text_frame,
    text: str,
    *,
    size: int,
    color: RGBColor = _INK,
    bold: bool = False,
    align=PP_ALIGN.LEFT,
    anchor=MSO_ANCHOR.TOP,
) -> None:
    """Fills a text frame with `text`, one real paragraph per line.

    Assigning a multi-line string straight to `text_frame.text` is not equivalent:
    python-pptx turns embedded newlines into <a:br> line breaks inside a single
    paragraph, which ignores paragraph spacing and makes a multi-line answer render as
    one cramped block. Card text routinely IS multi-line (a model-written answer with
    two or three steps), so each line becomes its own paragraph here.
    """
    text_frame.word_wrap = True
    text_frame.vertical_anchor = anchor
    lines = (text or "").split("\n") or [""]
    for index, line in enumerate(lines):
        paragraph = text_frame.paragraphs[0] if index == 0 else text_frame.add_paragraph()
        paragraph.alignment = align
        run = paragraph.add_run()
        run.text = line
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.color.rgb = color


def _add_deck_title_slide(presentation: Presentation, label: str, card_count: int):
    """One per deck, naming the document the cards came from. Uses the real Title Slide
    layout so the deck name lands in PowerPoint's outline/accessibility tree as a title
    rather than as an anonymous floating text box."""
    slide = presentation.slides.add_slide(presentation.slide_layouts[_TITLE_SLIDE_LAYOUT])
    title, subtitle = slide.placeholders[0], slide.placeholders[1]
    _place(title, _MARGIN, Inches(2.4), _CONTENT_WIDTH, Inches(1.8))
    _place(subtitle, _MARGIN, Inches(4.3), _CONTENT_WIDTH, Inches(1.0))
    _write(title.text_frame, label, size=40, bold=True, align=PP_ALIGN.CENTER)
    plural = "" if card_count == 1 else "s"
    _write(
        subtitle.text_frame,
        f"{card_count} flashcard{plural} · Newton",
        size=18,
        color=_MUTED,
        align=PP_ALIGN.CENTER,
    )
    return slide


def _add_question_slide(presentation: Presentation, card: Flashcard, position: int, total: int):
    slide = presentation.slides.add_slide(presentation.slide_layouts[_TITLE_ONLY_LAYOUT])
    label = slide.shapes.add_textbox(_MARGIN, Inches(0.7), _CONTENT_WIDTH, Inches(0.4))
    _write(label.text_frame, f"QUESTION {position} OF {total}", size=14, color=_ACCENT, bold=True)

    title = slide.shapes.title
    _place(title, _MARGIN, Inches(1.5), _CONTENT_WIDTH, Inches(3.8))
    _write(title.text_frame, card.front or "", size=32, bold=True, anchor=MSO_ANCHOR.MIDDLE)

    hint = slide.shapes.add_textbox(_MARGIN, Inches(6.2), _CONTENT_WIDTH, Inches(0.5))
    _write(hint.text_frame, "Think it through, then advance to reveal the answer.", size=14, color=_MUTED)
    return slide


def _add_answer_slide(presentation: Presentation, card: Flashcard, position: int, total: int):
    slide = presentation.slides.add_slide(presentation.slide_layouts[_TITLE_ONLY_LAYOUT])

    # The question again, small and muted, so the answer is never read without the thing
    # it answers -- the one real cost of splitting a card across two slides, paid back
    # here instead of left to the student's short-term memory.
    title = slide.shapes.title
    _place(title, _MARGIN, Inches(0.7), _CONTENT_WIDTH, Inches(1.4))
    _write(title.text_frame, card.front or "", size=18, color=_MUTED)

    label = slide.shapes.add_textbox(_MARGIN, Inches(2.2), _CONTENT_WIDTH, Inches(0.4))
    _write(label.text_frame, f"ANSWER {position} OF {total}", size=14, color=_ACCENT, bold=True)

    body = slide.shapes.add_textbox(_MARGIN, Inches(2.8), _CONTENT_WIDTH, Inches(3.5))
    _write(body.text_frame, card.back or "", size=26)
    return slide


def build_flashcard_pptx(decks: list[tuple[str, list[Flashcard]]]) -> bytes:
    """Renders grouped flashcards into real `.pptx` bytes: a title slide per deck, then a
    Question slide and an Answer slide for every card, in the order the decks and cards
    arrive (which anki.build_flashcard_decks already makes deterministic).

    python-pptx can save straight to a file-like object, so unlike the .apkg path this
    needs no temp file at all -- it's assembled entirely in memory.
    """
    presentation = Presentation()
    presentation.slide_width = SLIDE_WIDTH
    presentation.slide_height = SLIDE_HEIGHT

    for deck_name, cards in decks:
        _add_deck_title_slide(presentation, deck_title(deck_name), len(cards))
        total = len(cards)
        for index, card in enumerate(cards, start=1):
            _add_question_slide(presentation, card, index, total)
            _add_answer_slide(presentation, card, index, total)

    buffer = io.BytesIO()
    presentation.save(buffer)
    return buffer.getvalue()
