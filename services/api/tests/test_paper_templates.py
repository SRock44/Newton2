"""Pure-function tests for app.services.paper_templates -- valid document structure for
every style, and the escaping decision documented in that module's docstring actually
behaving as documented (title/heading punctuation escaped, model-authored body text
with inline math / \\cite{} left untouched).

The MLA/Chicago assertions here are structural only; that these two documents actually
COMPILE (and that the compiled PDF really contains parenthetical citations + a Works
Cited list, and real numbered footnotes + a Bibliography respectively) was verified
against the real sandbox-runner TeX Live install, the same way the IEEE/APA 7 shapes
were -- see services/sandbox-runner/tests/test_latex_compile_integration.py's
`_MLA_DOC`/`_CHICAGO_DOC`."""

from app.services.paper_templates import (
    RENDERERS,
    STYLE_LABELS,
    escape_latex_text,
    render_apa7,
    render_arxiv,
    render_chicago,
    render_ieee,
    render_mla,
)

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


# ---------------------------------------------------------------------------
# render_mla -- MLA 9: parenthetical cites, a "Works Cited" list, MLA page layout.
# ---------------------------------------------------------------------------


def test_render_mla_produces_a_complete_document_with_mla_page_layout():
    tex = render_mla("My Paper", _SECTIONS, has_bibliography=False)
    assert tex.startswith("\\documentclass[12pt]{article}")
    assert "\\usepackage[letterpaper,margin=1in]{geometry}" in tex
    assert "\\usepackage{mathptmx}" in tex  # Times-equivalent
    assert "\\doublespacing" in tex
    assert "\\begin{document}" in tex
    assert "\\end{document}" in tex
    # MLA headings are unnumbered, unlike IEEE/APA 7's \section.
    assert "\\section*{Introduction}" in tex
    assert "\\section{Introduction}" not in tex


def test_render_mla_includes_the_standard_header_block_and_running_header():
    tex = render_mla("My Paper", _SECTIONS, has_bibliography=False)
    assert "\\fancyhead[R]{Student Author \\thepage}" in tex  # "Lastname page#"
    assert "\\noindent Student Author\\\\" in tex
    assert "Instructor\\\\" in tex
    assert "Course\\\\" in tex
    assert "\\today" in tex
    # Title is centered plain text, not a \maketitle title block.
    assert "\\begin{center}\nMy Paper\n\\end{center}" in tex


def test_render_mla_uses_works_cited_not_references_or_bibliography():
    tex = render_mla("My Paper", _SECTIONS, has_bibliography=True)
    assert "\\printbibliography[title={Works Cited}]" in tex
    assert "title={Bibliography}" not in tex
    assert "References" not in tex


def test_render_mla_uses_biblatex_mla_style_and_parenthetical_cites():
    tex = render_mla("My Paper", _SECTIONS, has_bibliography=True)
    assert "\\usepackage[backend=biber,style=mla,sortcites=true]{biblatex}" in tex
    assert "\\addbibresource{refs.bib}" in tex
    # \cite -> \parencite is what makes a bare \cite{key} placeholder render as the MLA
    # parenthetical "(Author 42)" rather than biblatex-mla's bare "Author 42".
    assert "\\let\\cite\\parencite" in tex


def test_render_mla_without_a_bibliography_omits_all_biblatex_machinery():
    tex = render_mla("My Paper", _SECTIONS, has_bibliography=False)
    assert "biblatex" not in tex
    assert "\\printbibliography" not in tex
    # \parencite would be undefined without biblatex, so the alias must not be emitted.
    assert "\\parencite" not in tex


def test_render_mla_keeps_cite_keys_and_escapes_only_title_and_headings():
    sections = [{"heading": "Cost & Effect", "body": "Austen argues this \\cite{austen1813} & so on."}]
    tex = render_mla("50% Reading & Writing", sections, has_bibliography=True)
    assert "\\section*{Cost \\& Effect}" in tex
    assert "50\\% Reading \\& Writing" in tex
    assert "\\cite{austen1813} & so on." in tex  # body prose untouched


# ---------------------------------------------------------------------------
# render_chicago -- notes-bibliography: footnote cites + a "Bibliography".
# ---------------------------------------------------------------------------


def test_render_chicago_produces_a_complete_document_with_chicago_page_layout():
    tex = render_chicago("My Paper", _SECTIONS, has_bibliography=False)
    assert tex.startswith("\\documentclass[12pt]{article}")
    assert "\\usepackage[letterpaper,margin=1in]{geometry}" in tex
    assert "\\usepackage{mathptmx}" in tex
    assert "\\doublespacing" in tex
    assert "\\fancyhead[R]{\\thepage}" in tex
    assert "\\section*{Introduction}" in tex
    assert "\\section{Introduction}" not in tex


def test_render_chicago_cites_become_real_footnotes():
    tex = render_chicago("My Paper", _SECTIONS, has_bibliography=True)
    # notes-bibliography, NOT the author-date Chicago variant.
    assert "\\usepackage[notes,backend=biber,sortcites=true]{biblatex-chicago}" in tex
    assert "authordate" not in tex
    # \footcite IS biblatex's real \footnote-wrapped cite command (\mkbibfootnote);
    # aliasing \cite to it is what puts a genuine footnote at each citation point.
    assert "\\let\\cite\\footcite" in tex


def test_render_chicago_uses_bibliography_not_works_cited_or_references():
    tex = render_chicago("My Paper", _SECTIONS, has_bibliography=True)
    assert "\\printbibliography[title={Bibliography}]" in tex
    assert "Works Cited" not in tex
    assert "References" not in tex


def test_render_chicago_never_loads_biblatex_alongside_biblatex_chicago():
    # biblatex-chicago loads biblatex itself; a second \usepackage{biblatex} would be a
    # hard "package already loaded" error.
    tex = render_chicago("My Paper", _SECTIONS, has_bibliography=True)
    assert "{biblatex}" not in tex
    assert tex.count("\\addbibresource{refs.bib}") == 1


def test_render_chicago_without_a_bibliography_omits_all_citation_machinery():
    tex = render_chicago("My Paper", _SECTIONS, has_bibliography=False)
    assert "biblatex" not in tex
    assert "\\footcite" not in tex
    assert "\\printbibliography" not in tex


def test_render_chicago_keeps_cite_keys_and_escapes_only_title_and_headings():
    sections = [{"heading": "Trade & Empire", "body": "As shown \\cite{smith1776} & later."}]
    tex = render_chicago("100% History & Theory", sections, has_bibliography=True)
    assert "\\section*{Trade \\& Empire}" in tex
    assert "100\\% History \\& Theory" in tex
    assert "\\cite{smith1776} & later." in tex


# ---------------------------------------------------------------------------
# Abstract handling + the RENDERERS/STYLE_LABELS registry both styles plug into.
# ---------------------------------------------------------------------------


def test_humanities_styles_render_the_approved_abstract_as_a_leading_section():
    # Neither style guide mandates an abstract, but write_research_paper.py always has
    # one the student approved -- it is typeset, never silently dropped.
    for render in (render_mla, render_chicago):
        tex = render("My Paper", _SECTIONS, has_bibliography=False, abstract="A short summary.")
        assert "\\section*{Abstract}" in tex
        assert "A short summary." in tex
        # ...and it comes before the first real section.
        assert tex.index("\\section*{Abstract}") < tex.index("\\section*{Introduction}")


def test_humanities_styles_omit_the_abstract_block_entirely_when_there_is_none():
    for render in (render_mla, render_chicago):
        assert "Abstract" not in render("My Paper", _SECTIONS, has_bibliography=False)


def test_every_registered_style_has_a_label_and_a_renderer():
    assert set(RENDERERS) == {"ieee", "arxiv", "apa7", "mla", "chicago"}
    assert set(STYLE_LABELS) == set(RENDERERS)
    assert RENDERERS["mla"] is render_mla
    assert RENDERERS["chicago"] is render_chicago
    # The label is interpolated into write_research_paper.py's SECTION_DRAFT_PROMPT, so
    # "Chicago" must say which Chicago the drafting model is writing for.
    assert "notes-bibliography" in STYLE_LABELS["chicago"]


def test_every_registered_renderer_produces_a_complete_compilable_shell():
    for render in RENDERERS.values():
        tex = render("My Paper", _SECTIONS, has_bibliography=True, abstract="A short summary.")
        assert tex.startswith("\\documentclass")
        assert "\\begin{document}" in tex
        assert tex.rstrip().endswith("\\end{document}")
        assert "\\addbibresource{refs.bib}" in tex
        assert "\\printbibliography" in tex


# ---------------------------------------------------------------------------
# arXiv preprint style
# ---------------------------------------------------------------------------


def test_render_arxiv_produces_a_complete_single_column_article():
    tex = render_arxiv("My Paper", _SECTIONS, has_bibliography=False, abstract="A short summary.", author="Priya Nair")
    assert tex.startswith("\\documentclass[11pt]{article}")
    # the packages a math/physics/CS preprint needs so the drafted prose can use them
    for package in ("amsmath,amssymb,mathtools", "booktabs", "hyperref"):
        assert package in tex
    assert "\\title{My Paper}" in tex
    assert "\\author{Priya Nair}" in tex
    assert "\\maketitle" in tex
    assert "\\begin{abstract}" in tex and "A short summary." in tex
    assert "\\section{Introduction}" in tex
    assert "\\end{document}" in tex
    assert "biblatex" not in tex


def test_render_arxiv_uses_a_numeric_biblatex_bibliography_when_requested():
    tex = render_arxiv("My Paper", _SECTIONS, has_bibliography=True)
    assert "\\usepackage[backend=biber,style=numeric,sortcites=true]{biblatex}" in tex
    assert "\\addbibresource{refs.bib}" in tex
    assert "\\printbibliography[title={References}]" in tex


def test_render_arxiv_escapes_plain_text_fields_but_not_model_authored_bodies():
    tex = render_arxiv(
        "50% of $n$ & more",
        [{"heading": "Results & Discussion", "body": "We find $\\rho<1$ \\cite{young1950}."}],
        has_bibliography=True,
        author="A_B",
    )
    assert "\\title{50\\% of $n$ \\& more}" in tex
    assert "\\section{Results \\& Discussion}" in tex
    assert "\\author{A\\_B}" in tex
    assert "We find $\\rho<1$ \\cite{young1950}." in tex


def test_arxiv_is_registered_and_labelled():
    assert RENDERERS["arxiv"] is render_arxiv
    assert STYLE_LABELS["arxiv"] == "arXiv preprint"


def test_ieee_uses_the_given_author_and_keeps_the_default():
    assert "\\author{Student Author}" in render_ieee("T", _SECTIONS, has_bibliography=False)
    assert "\\author{Priya Nair}" in render_ieee("T", _SECTIONS, has_bibliography=False, author="Priya Nair")
