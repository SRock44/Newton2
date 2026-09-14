"""Pure-function tests for app.services.paper_templates -- valid document structure for
both styles, and the escaping decision documented in that module's docstring actually
behaving as documented (title/heading punctuation escaped, model-authored body text
with inline math / \\cite{} left untouched)."""

from app.services.paper_templates import escape_latex_text, render_apa7, render_ieee

# ---------------------------------------------------------------------------
# escape_latex_text
# ---------------------------------------------------------------------------


def test_escape_latex_text_escapes_all_dangerous_characters():
    assert escape_latex_text("100% & #1 _score_ ~tilde ^caret \\slash") == (
        r"100\% \& \#1 \_score\_ \textasciitilde{}tilde \textasciicircum{}caret \textbackslash{}slash"
    )


def test_escape_latex_text_never_double_escapes_via_the_backslashes_it_introduces():
    # A naive sequence of str.replace calls would re-escape the backslash this
    # introduces for "%"; character-by-character substitution must not.
    result = escape_latex_text("%")
    assert result == r"\%"
    assert result.count("\\") == 1


def test_escape_latex_text_leaves_ordinary_text_alone():
    assert escape_latex_text("A Perfectly Normal Title") == "A Perfectly Normal Title"


# ---------------------------------------------------------------------------
# render_ieee / render_apa7 -- structural validity
# ---------------------------------------------------------------------------

_SECTIONS = [
    {"heading": "Introduction", "body": "This is the introduction."},
    {"heading": "Conclusion", "body": "This is the conclusion."},
]


def test_render_ieee_produces_a_complete_document():
    tex = render_ieee("My Paper", _SECTIONS, has_bibliography=False)
    assert tex.startswith("\\documentclass{IEEEtran}")
    assert "\\begin{document}" in tex
    assert "\\end{document}" in tex
    assert "\\title{My Paper}" in tex
    assert "\\section{Introduction}" in tex
    assert "\\section{Conclusion}" in tex
    assert "This is the introduction." in tex
    # No bibliography requested -> no biblatex machinery at all.
    assert "biblatex" not in tex
    assert "\\printbibliography" not in tex


def test_render_ieee_includes_biblatex_ieee_style_when_bibliography_requested():
    tex = render_ieee("My Paper", _SECTIONS, has_bibliography=True)
    assert "\\usepackage[backend=biber,style=ieee,sortcites=true]{biblatex}" in tex
    assert "\\addbibresource{refs.bib}" in tex
    assert "\\printbibliography" in tex


def test_render_ieee_includes_abstract_when_given():
    tex = render_ieee("My Paper", _SECTIONS, has_bibliography=False, abstract="A short summary.")
    assert "\\begin{abstract}" in tex
    assert "A short summary." in tex
    assert "\\end{abstract}" in tex


def test_render_apa7_produces_a_complete_document():
    tex = render_apa7("My Paper", _SECTIONS, has_bibliography=False)
    assert tex.startswith("\\documentclass[man]{apa7}")
    assert "\\shorttitle{My Paper}" in tex
    assert "\\affiliation{Newton}" in tex
    assert "\\begin{document}" in tex
    assert "\\end{document}" in tex
    assert "\\section{Introduction}" in tex


def test_render_apa7_includes_biblatex_apa_style_when_bibliography_requested():
    tex = render_apa7("My Paper", _SECTIONS, has_bibliography=True)
    assert "\\usepackage[backend=biber,style=apa,sortcites=true]{biblatex}" in tex
    assert "\\addbibresource{refs.bib}" in tex
    assert "\\printbibliography" in tex


def test_render_apa7_abstract_field_uses_abstract_command():
    tex = render_apa7("My Paper", _SECTIONS, has_bibliography=False, abstract="A short summary.")
    assert "\\abstract{A short summary.}" in tex


def test_render_apa7_shorttitle_truncation_does_not_split_an_escape_sequence():
    long_title = "A" * 55 + "% tail"  # raw title > 60 chars once escaped ("%"->"\%")
    tex = render_apa7(long_title, _SECTIONS, has_bibliography=False)
    # Truncation happens on the RAW title before escaping, so any \shorttitle escape
    # sequence that does appear must be complete, never a truncated fragment.
    shorttitle_line = next(line for line in tex.splitlines() if line.startswith("\\shorttitle{"))
    assert "\\textbackslash" not in shorttitle_line  # would only appear from a corrupted escape
    assert shorttitle_line.count("\\%") <= 1


# ---------------------------------------------------------------------------
# Escaping decision: title/headings escaped, model-authored body text is NOT.
# ---------------------------------------------------------------------------


def test_title_with_dangerous_characters_is_escaped():
    tex = render_ieee("50% Faster & Better_Results #1", _SECTIONS, has_bibliography=False)
    assert "\\title{50\\% Faster \\& Better\\_Results \\#1}" in tex


def test_section_heading_with_dangerous_characters_is_escaped():
    sections = [{"heading": "Cost & Benefit_Analysis", "body": "Body text."}]
    tex = render_ieee("Title", sections, has_bibliography=False)
    assert "\\section{Cost \\& Benefit\\_Analysis}" in tex


def test_section_body_inline_math_and_cite_placeholders_survive_untouched():
    sections = [
        {
            "heading": "Results",
            "body": "The energy relation $E = mc^2$ is well known \\cite{einstein1905}, "
            "and 50% of trials confirmed it.",
        }
    ]
    tex = render_ieee("Title", sections, has_bibliography=True)
    assert "$E = mc^2$" in tex
    assert "\\cite{einstein1905}" in tex
    # The literal "50%" in body prose is untouched (not "50\%") -- proving body text is
    # NOT escaped, per the module's documented decision -- even though the exact same
    # character in the title (see test_title_with_dangerous_characters_is_escaped) is.
    assert "50% of trials" in tex


def test_apa7_section_body_is_also_left_unescaped():
    sections = [{"heading": "Discussion", "body": "See \\cite{doe2024} for details & context."}]
    tex = render_apa7("Title", sections, has_bibliography=True)
    assert "\\cite{doe2024} for details & context." in tex
