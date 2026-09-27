import uuid

import pytest

from app.services.study_links import study_link


def test_study_link_formats_the_marker_the_app_parses():
    item = uuid.uuid4()
    assert study_link("exam", item, "Midterm 2 packet.docx", "15 questions") == (
        f"[Study item: exam|{item}|Midterm 2 packet.docx|15 questions]"
    )


def test_study_link_uses_a_dash_when_there_is_no_id():
    assert study_link("flashcards", None, "linear algebra", "8 cards") == "[Study item: flashcards|-|linear algebra|8 cards]"


def test_study_link_keeps_the_pipe_and_bracket_delimiters_out_of_the_text():
    assert study_link("plan", "d1", "a|b [c] d", "3 items") == "[Study item: plan|d1|a/b (c) d|3 items]"


def test_study_link_collapses_whitespace_and_newlines():
    assert study_link("plan", "d1", "two\n  lines", "3 items") == "[Study item: plan|d1|two lines|3 items]"


def test_study_link_rejects_an_unknown_kind():
    with pytest.raises(ValueError):
        study_link("deck", "d1", "x", "y")
