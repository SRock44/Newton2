"""Builds complete, compilable IEEE/arXiv/APA7/MLA/Chicago LaTeX documents for
app/tools/write_research_paper.py, mirroring the exact working shapes already proven
live against the real sandbox-runner compiler in
services/sandbox-runner/tests/test_latex_compile_integration.py (`_IEEE_DOC`,
`_APA7_DOC`, `_APA7_WITH_CITATION_DOC`) -- copied faithfully rather than invented from
scratch, since those are what's actually confirmed to compile against the real TeX Live
install baked into the sandbox image.

Citations in EVERY style go through biblatex/biber (never classic bibtex/IEEEtran's own
\\bibliographystyle mechanism) because sandbox-runner's /compile-latex endpoint only ever
runs `biber` as its bibliography step (see services/sandbox-runner/app/main.py's
`_run_compile_steps` -- "pdflatex -> [biber -> pdflatex] (only when a .bib was provided)
-> pdflatex"), never classic bibtex8. IEEE gets `style=ieee`, APA7 gets `style=apa`,
MLA gets `style=mla` (the CTAN biblatex-mla package); otherwise the
`\\usepackage[backend=biber,...]{biblatex}` + `\\addbibresource{refs.bib}` +
`\\printbibliography` incantation is identical to `_APA7_WITH_CITATION_DOC`. Chicago is
the one structural exception: it loads `biblatex-chicago` (which loads biblatex itself,
so it must NOT be combined with a separate `\\usepackage{biblatex}`) -- see
render_chicago's docstring.

--- Humanities styles: MLA and Chicago (notes-bibliography) --------------------------
Both were added to reach parity with app/tools/citation.py's `format_citation`, which
has always been able to format an individual MLA or Chicago citation while this module
could only COMPILE ieee/apa7 -- an English or History major asking for their own
discipline's format silently got the wrong citation apparatus typeset into their PDF.

Neither MLA nor Chicago has a LaTeX document *class* the way IEEE (IEEEtran) and APA 7
(apa7) do -- they're page-layout-and-citation conventions, not journal templates -- so
both are built on plain `article` plus the layout each style actually mandates
(1in margins, 12pt Times-equivalent, double spacing, a running header). Every package
used below (geometry, mathptmx, setspace, fancyhdr, biblatex-mla, biblatex-chicago) was
confirmed present in the real deployed sandbox-runner image via `kpsewhich` before these
renderers were written; no Dockerfile change was needed, and nothing here may start
depending on a package that isn't in services/sandbox-runner/Dockerfile's hand-picked,
version-pinned apt set.

The BIBLIOGRAPHY-entry formatting in both styles is biblatex-mla's / biblatex-chicago's
own, i.e. the real published MLA 9 / CMOS conventions -- deliberately not a
reimplementation of citation.py's `format_citation` string-building. Those two modules
solve different problems (see app/services/bibliography.py's docstring for the same
distinction): `format_citation` produces one human-readable citation STRING for a
student to paste, while this produces a typeset bibliography from `.bib` entries. They
agree on convention (MLA: author-last-first, title, container, year; Chicago
bibliography: reverse-name first author, period-separated), which is the point -- but the
canonical biblatex styles are the source of truth for what gets typeset, not a
hand-rolled copy that could drift. One intentional divergence: `format_citation`'s
Chicago is the AUTHOR-DATE variant (the sciences one), while a Chicago PAPER here is
notes-bibliography (the humanities one, which is what a History major means by "Chicago"
and what this tool was asked for); those two genuinely are different styles within CMOS,
not an inconsistency.

--- LaTeX-escaping decision (read before changing anything below) ---------------------
Two very different kinds of text flow through this module:

  1. Plain-text fields WE generate or the student typed with no expectation it's LaTeX --
     the paper title, section headings, and the abstract sketch. These can contain
     completely ordinary punctuation (a title with "%", "&", "_", "#") that would
     otherwise silently break compilation or -- worse -- start a LaTeX comment mid-title
     and swallow the rest of the line. These fields ALWAYS go through
     `escape_latex_text()` below.

  2. Section BODY text, which is MODEL-AUTHORED PROSE from
     app/tools/write_research_paper.py's per-section drafting call. That prompt
     deliberately asks the model to write inline math ($...$) where appropriate and to
     place real `\\cite{key}` placeholders after cited claims -- both of those are
     correct, INTENTIONAL LaTeX the model was explicitly instructed to produce.
     Blanket-escaping body text the same way as #1 would corrupt it outright (e.g. turn
     "$E=mc^2$" into inert escaped text, or "\\cite{doe2024}" into
     "\\textbackslash{}cite\\{doe2024\\}", breaking the citation entirely). So body text
     is passed through completely UNESCAPED. If a section's prose ever contains LaTeX
     that doesn't actually compile, that surfaces as a real compiler error --
     write_research_paper.py's one bounded retry feeds that error back to the model to
     fix, the same as any other LaTeX mistake it might make -- rather than this template
     layer silently mangling text the model wrote on purpose.
"""

from __future__ import annotations

from typing import TypedDict

# Order matters: backslash MUST be escaped as \textbackslash{} (itself backslash-free in
# its OUTPUT) without ever re-scanning the escaped output -- iterating the input
# character-by-character and looking up each character independently (rather than
# chaining sequential str.replace calls) means a backslash introduced by one escape can
# never itself get re-escaped by a later rule. See escape_latex_text below.
_LATEX_ESCAPES: dict[str, str] = {
    "\\": r"\textbackslash{}",
    "%": r"\%",
    "&": r"\&",
    "#": r"\#",
    "_": r"\_",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}

_MAX_SHORTTITLE_CHARS = 60


def escape_latex_text(text: str) -> str:
    """Escapes LaTeX's genuinely dangerous bare characters in ordinary plain text (see
    the module docstring for exactly which text this should and shouldn't be applied
    to). Character-by-character substitution, not chained str.replace -- see the
    _LATEX_ESCAPES comment for why that matters for the backslash case."""
    return "".join(_LATEX_ESCAPES.get(ch, ch) for ch in text)


class RenderSection(TypedDict):
    heading: str
    body: str  # model-authored LaTeX prose -- deliberately NOT escaped, see module docstring


def _bib_preamble(style: str, has_bibliography: bool) -> list[str]:
    if not has_bibliography:
        return []
    return [
        f"\\usepackage[backend=biber,style={style},sortcites=true]{{biblatex}}",
        "\\addbibresource{refs.bib}",
    ]


def _render_sections(sections: list[RenderSection], *, numbered: bool = True) -> list[str]:
    """Shared by every renderer -- the section-drafting pipeline (and the escaping
    decision in the module docstring) is identical across styles; only whether the
    heading carries a number differs. IEEE/APA 7 number their sections; MLA and Chicago
    papers conventionally do not, so those pass numbered=False for `\\section*`."""
    command = "\\section" if numbered else "\\section*"
    lines: list[str] = []
    for section in sections:
        lines.append(f"{command}{{{escape_latex_text(section['heading'])}}}")
        lines.append(section["body"])
    return lines


# Shared by render_mla/render_chicago: neither MLA nor Chicago has its own document
# class, so both spell out the page layout their style guide actually mandates --
# letter paper, 1in margins on all sides, 12pt Times-equivalent (mathptmx is the Times
# clone that ships with TeX Live's psnfss; real Times New Type 1 fonts aren't
# redistributable and aren't in the image), and double-spaced body text. setspace's
# \doublespacing deliberately leaves footnotes single-spaced, which is what Chicago
# wants for its notes.
_HUMANITIES_LAYOUT_PREAMBLE = [
    "\\documentclass[12pt]{article}",
    "\\usepackage[letterpaper,margin=1in]{geometry}",
    "\\usepackage{mathptmx}",
    "\\usepackage{setspace}",
    "\\usepackage{fancyhdr}",
]


def _humanities_abstract(abstract: str | None) -> list[str]:
    """Neither MLA nor Chicago mandates an abstract, but write_research_paper.py always
    has one (`abstract_sketch` is a required tool parameter the student approved as part
    of their plan). Rendering it as a plain unnumbered leading section is a deliberate
    simplification: silently DROPPING approved student content because the style guide
    has no slot for it would be worse than typesetting it under an honest heading, and
    both styles do permit an abstract where an instructor asks for one."""
    if not abstract:
        return []
    return ["\\section*{Abstract}", escape_latex_text(abstract)]


def render_ieee(
    title: str,
    sections: list[RenderSection],
    has_bibliography: bool,
    abstract: str | None = None,
    author: str | None = None,
) -> str:
    """A complete, minimal IEEEtran document -- same class/structure as
    test_latex_compile_integration.py's `_IEEE_DOC`, extended with an optional
    \\begin{abstract} block and, when `has_bibliography`, the biblatex/biber citation
    machinery proven in `_APA7_WITH_CITATION_DOC` (style=ieee here instead of apa)."""
    lines = ["\\documentclass{IEEEtran}"]
    lines.extend(_bib_preamble("ieee", has_bibliography))
    lines.append("\\begin{document}")
    lines.append(f"\\title{{{escape_latex_text(title)}}}")
    lines.append(f"\\author{{{escape_latex_text(author) if author else 'Student Author'}}}")
    lines.append("\\maketitle")
    if abstract:
        lines.append("\\begin{abstract}")
        lines.append(escape_latex_text(abstract))
        lines.append("\\end{abstract}")
    lines.extend(_render_sections(sections))
    if has_bibliography:
        lines.append("\\printbibliography")
    lines.append("\\end{document}")
    return "\n".join(lines) + "\n"


def render_arxiv(
    title: str,
    sections: list[RenderSection],
    has_bibliography: bool,
    abstract: str | None = None,
    author: str | None = None,
) -> str:
    """An arXiv-preprint-style document: the plain single-column `article` layout most
    preprints on arXiv are actually posted in (11pt, 1in margins, numbered sections, a
    numeric bibliography), with the amsmath/booktabs/hyperref set a mathematics, physics or
    computer-science paper needs so the section-drafting model can write real equations,
    professional tables (\\toprule/\\midrule/\\bottomrule), and clickable references.
    Every package here is in the sandbox-runner image (checked with kpsewhich); citations go
    through biblatex/biber like every other style (see the module docstring)."""
    lines = [
        "\\documentclass[11pt]{article}",
        "\\usepackage[T1]{fontenc}",
        "\\usepackage{lmodern}",
        "\\usepackage[margin=1in]{geometry}",
        "\\usepackage{amsmath,amssymb,mathtools}",
        "\\usepackage{booktabs}",
        "\\usepackage{microtype}",
        "\\usepackage[dvipsnames]{xcolor}",
        "\\usepackage[colorlinks=true,linkcolor=NavyBlue,citecolor=NavyBlue,urlcolor=NavyBlue]{hyperref}",
    ]
    lines.extend(_bib_preamble("numeric", has_bibliography))
    lines.append(f"\\title{{{escape_latex_text(title)}}}")
    lines.append(f"\\author{{{escape_latex_text(author) if author else 'Author'}}}")
    lines.append("\\date{\\today}")
    lines.append("\\begin{document}")
    lines.append("\\maketitle")
    if abstract:
        lines.append("\\begin{abstract}")
        lines.append(escape_latex_text(abstract))
        lines.append("\\end{abstract}")
    lines.extend(_render_sections(sections))
    if has_bibliography:
        lines.append("\\printbibliography[title={References}]")
    lines.append("\\end{document}")
    return "\n".join(lines) + "\n"


def render_apa7(
    title: str,
    sections: list[RenderSection],
    has_bibliography: bool,
    abstract: str | None = None,
    author: str | None = None,
) -> str:
    """A complete, minimal apa7-class document -- same class/preamble shape as
    test_latex_compile_integration.py's `_APA7_DOC`/`_APA7_WITH_CITATION_DOC`
    (`\\documentclass[man]{apa7}`, `\\shorttitle`, `\\affiliation`, `\\abstract`)."""
    # Truncate the RAW title (before escaping) so a multi-character escape sequence
    # (e.g. "\textbackslash{}") is never split in half by the character-count cutoff.
    short_raw = title.strip()
    if len(short_raw) > _MAX_SHORTTITLE_CHARS:
        short_raw = short_raw[: _MAX_SHORTTITLE_CHARS - 3].rstrip() + "..."

    lines = ["\\documentclass[man]{apa7}"]
    lines.extend(_bib_preamble("apa", has_bibliography))
    lines.append(f"\\title{{{escape_latex_text(title)}}}")
    lines.append(f"\\shorttitle{{{escape_latex_text(short_raw)}}}")
    lines.append("\\author{Student Author}")
    lines.append("\\affiliation{Newton}")
    if abstract:
        lines.append(f"\\abstract{{{escape_latex_text(abstract)}}}")
    lines.append("\\begin{document}")
    lines.append("\\maketitle")
    lines.extend(_render_sections(sections))
    if has_bibliography:
        lines.append("\\printbibliography")
    lines.append("\\end{document}")
    return "\n".join(lines) + "\n"


def render_mla(
    title: str,
    sections: list[RenderSection],
    has_bibliography: bool,
    abstract: str | None = None,
    author: str | None = None,
) -> str:
    """A complete MLA 9 paper: 12pt Times-equivalent, 1in margins, double-spaced, the
    standard four-line MLA header block (name / instructor / course / date) flush left on
    page one, a centered plain title, a "Lastname page#" running header, parenthetical
    in-text citations, and an alphabetical, hanging-indented "Works Cited" list.

    Citations: biblatex's `style=mla` (CTAN biblatex-mla) does all the actual MLA
    formatting. The one adjustment is `\\let\\cite\\parencite`: biblatex-mla's bare
    `\\cite` produces a BARE "Author 42" for a sentence that already names the author,
    while MLA's default and by far most common form -- and the only one the section
    drafting prompt can sensibly produce, since it emits a plain `\\cite{key}` after a
    cited claim with no knowledge of the surrounding sentence -- is the parenthetical
    "(Author 42)". Aliasing rather than redefining keeps biblatex's full
    `\\cite[prenote][postnote]{keys}` argument signature intact, so a `\\cite[42]{key}`
    the model happened to write still yields "(Author 42)" with the page number.
    Alphabetical ordering and the hanging indent are biblatex-mla's own defaults; the
    "Works Cited" title is passed explicitly rather than relied on so the heading is
    pinned by this module (and assertable) instead of by a package default that could
    change under a TeX Live bump.

    The header block's instructor/course lines are placeholders, exactly like
    render_ieee/render_apa7's "Student Author"/"Newton" -- the tool has no instructor or
    course name to work from, and omitting the block entirely would be less MLA-correct
    than emitting it for the student to fill in.
    """
    lines = list(_HUMANITIES_LAYOUT_PREAMBLE)
    lines.extend(_bib_preamble("mla", has_bibliography))
    if has_bibliography:
        lines.append("\\let\\cite\\parencite")
    lines.extend(
        [
            "\\pagestyle{fancy}",
            "\\fancyhf{}",
            "\\renewcommand{\\headrulewidth}{0pt}",
            "\\fancyhead[R]{Student Author \\thepage}",
            "\\begin{document}",
            "\\thispagestyle{fancy}",
            "\\doublespacing",
            # The MLA header block: four flush-left, double-spaced lines.
            "\\noindent Student Author\\\\",
            "Instructor\\\\",
            "Course\\\\",
            "\\today",
            "\\begin{center}",
            escape_latex_text(title),
            "\\end{center}",
        ]
    )
    lines.extend(_humanities_abstract(abstract))
    lines.extend(_render_sections(sections, numbered=False))
    if has_bibliography:
        lines.append("\\printbibliography[title={Works Cited}]")
    lines.append("\\end{document}")
    return "\n".join(lines) + "\n"


def render_chicago(
    title: str,
    sections: list[RenderSection],
    has_bibliography: bool,
    abstract: str | None = None,
    author: str | None = None,
) -> str:
    """A complete Chicago NOTES-BIBLIOGRAPHY paper (CMOS 17's humanities variant, the
    one a History or English student means by "Chicago" -- deliberately NOT the
    author-date variant the sciences use, which is what app/tools/citation.py's
    `format_citation` produces for a single citation; see the module docstring). 12pt
    Times-equivalent, 1in margins, double-spaced body with single-spaced footnotes
    (setspace's \\doublespacing does that split itself), a title page-style centered
    title block, page numbers top-right, real footnote citations, and a separate
    alphabetical "Bibliography" at the end.

    Citations: `\\usepackage[notes,...]{biblatex-chicago}`. That package LOADS biblatex
    itself, so it replaces (never accompanies) the `\\usepackage{biblatex}` line
    `_bib_preamble` emits for the other three styles -- loading both would be a
    "biblatex already loaded" error.

    `\\let\\cite\\footcite` is what turns each `\\cite{key}` placeholder the section
    drafting prompt emits into a REAL footnote at that point in the text. biblatex's
    `\\footcite` is the standard, punctuation-correct way to do that (it wraps the cite
    in `\\mkbibfootnote`, which is `\\footnote`, and lets the style own the note's
    terminal punctuation); hand-rolling `\\footnote{\\cite{...}}` here would literally
    contain the string "\\footnote" but would drop biblatex's optional-argument
    signature and the notes style's own end-of-note period. So the .tex source contains
    `\\footcite`, and the compiled PDF contains genuine numbered footnotes -- verified by
    a real compile, not assumed.

    --- Deliberate convention note: first-vs-subsequent notes --------------------------
    Traditional Chicago uses a FULL citation in a source's first footnote and a
    SHORTENED form ("Lastname, Short Title, 42") thereafter. This renderer does not
    implement that distinction itself: biblatex-chicago's notes style already tracks
    which entries have been cited and emits the short note form automatically on
    subsequent citations (and "Ibid."-equivalents for immediate repeats). Reimplementing
    that tracking in Python, on top of a package that already does it correctly, would
    be duplicated logic that could only ever drift from the real style -- so the
    simplification here is "delegate entirely", which yields the traditional convention
    rather than a simplified one.
    """
    lines = list(_HUMANITIES_LAYOUT_PREAMBLE)
    if has_bibliography:
        lines.append("\\usepackage[notes,backend=biber,sortcites=true]{biblatex-chicago}")
        lines.append("\\addbibresource{refs.bib}")
        lines.append("\\let\\cite\\footcite")
    lines.extend(
        [
            "\\pagestyle{fancy}",
            "\\fancyhf{}",
            "\\renewcommand{\\headrulewidth}{0pt}",
            "\\fancyhead[R]{\\thepage}",
            "\\begin{document}",
            "\\thispagestyle{fancy}",
            "\\doublespacing",
            "\\begin{center}",
            f"{{\\large {escape_latex_text(title)}}}\\\\[1em]",
            "Student Author\\\\",
            "\\today",
            "\\end{center}",
        ]
    )
    lines.extend(_humanities_abstract(abstract))
    lines.extend(_render_sections(sections, numbered=False))
    if has_bibliography:
        lines.append("\\printbibliography[title={Bibliography}]")
    lines.append("\\end{document}")
    return "\n".join(lines) + "\n"


# Keyed by the `style` value write_research_paper.py's tool parameters accept.
RENDERERS = {
    "ieee": render_ieee,
    "arxiv": render_arxiv,
    "apa7": render_apa7,
    "mla": render_mla,
    "chicago": render_chicago,
}
# Also fed verbatim into write_research_paper.py's SECTION_DRAFT_PROMPT ("...in
# {style_label} style"), so "Chicago" spells out WHICH Chicago -- a model drafting prose
# for a notes-bibliography paper should not be reaching for author-date parentheticals.
STYLE_LABELS = {
    "ieee": "IEEE",
    "arxiv": "arXiv preprint",
    "apa7": "APA 7",
    "mla": "MLA 9",
    "chicago": "Chicago (notes-bibliography)",
}
