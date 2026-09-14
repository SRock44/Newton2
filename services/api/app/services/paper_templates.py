"""Builds complete, compilable IEEE/APA7 LaTeX documents for
app/tools/write_research_paper.py, mirroring the exact working shapes already proven
live against the real sandbox-runner compiler in
services/sandbox-runner/tests/test_latex_compile_integration.py (`_IEEE_DOC`,
`_APA7_DOC`, `_APA7_WITH_CITATION_DOC`) -- copied faithfully rather than invented from
scratch, since those are what's actually confirmed to compile against the real TeX Live
install baked into the sandbox image.

Citations in BOTH styles go through biblatex/biber (never classic bibtex/IEEEtran's own
\\bibliographystyle mechanism) because sandbox-runner's /compile-latex endpoint only ever
runs `biber` as its bibliography step (see services/sandbox-runner/app/main.py's
`_run_compile_steps` -- "pdflatex -> [biber -> pdflatex] (only when a .bib was provided)
-> pdflatex"), never classic bibtex8. IEEE gets `style=ieee`, APA7 gets `style=apa`;
otherwise the `\\usepackage[backend=biber,...]{biblatex}` + `\\addbibresource{refs.bib}`
+ `\\printbibliography` incantation is identical to `_APA7_WITH_CITATION_DOC`.

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


def _render_sections(sections: list[RenderSection]) -> list[str]:
    lines: list[str] = []
    for section in sections:
        lines.append(f"\\section{{{escape_latex_text(section['heading'])}}}")
        lines.append(section["body"])
    return lines


def render_ieee(
    title: str,
    sections: list[RenderSection],
    has_bibliography: bool,
    abstract: str | None = None,
) -> str:
    """A complete, minimal IEEEtran document -- same class/structure as
    test_latex_compile_integration.py's `_IEEE_DOC`, extended with an optional
    \\begin{abstract} block and, when `has_bibliography`, the biblatex/biber citation
    machinery proven in `_APA7_WITH_CITATION_DOC` (style=ieee here instead of apa)."""
    lines = ["\\documentclass{IEEEtran}"]
    lines.extend(_bib_preamble("ieee", has_bibliography))
    lines.append("\\begin{document}")
    lines.append(f"\\title{{{escape_latex_text(title)}}}")
    lines.append("\\author{Student Author}")
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


def render_apa7(
    title: str,
    sections: list[RenderSection],
    has_bibliography: bool,
    abstract: str | None = None,
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


# Keyed by the `style` value write_research_paper.py's tool parameters accept.
RENDERERS = {"ieee": render_ieee, "apa7": render_apa7}
STYLE_LABELS = {"ieee": "IEEE", "apa7": "APA 7"}
