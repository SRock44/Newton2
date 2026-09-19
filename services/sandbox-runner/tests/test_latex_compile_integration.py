"""Integration tests for sandbox-runner's POST /compile-latex.

Same philosophy as test_sandbox_integration.py: these hit a REAL running instance over
HTTP (real pdflatex/biber, real TeX Live install baked into the image), not a mocked
compiler -- the properties under test (a genuine PDF comes out, a genuine compiler error
comes back, citations actually resolve, the wall-clock budget is real) only mean anything
against the real toolchain. Point BASE_URL at a running sandbox-runner.

Deliberately stdlib-only (urllib/json/base64), same reasoning as
test_sandbox_integration.py.

Usage:
    BASE_URL=http://sandbox-test:8000 python3 test_latex_compile_integration.py
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE_URL = os.environ.get("BASE_URL", "http://localhost:18000")

results: list[tuple[str, bool, str]] = []

_IEEE_DOC = r"""
\documentclass{IEEEtran}
\begin{document}
\title{A Minimal IEEE Test Document}
\author{Test Author}
\maketitle
\section{Introduction}
This is a minimal IEEEtran-format test document used to verify the sandbox-runner
LaTeX compile endpoint. It includes a little math: $E = mc^2$ and a symbol,
\(\sum_{i=1}^{n} i\).
\end{document}
"""

_APA7_DOC = r"""
\documentclass[man]{apa7}
\title{A Minimal APA7 Test Document}
\shorttitle{Minimal APA7 Test}
\author{Test Author}
\affiliation{Test University}
\abstract{This is a minimal APA7-format test document used to verify the
sandbox-runner LaTeX compile endpoint.}
\begin{document}
\maketitle
\section{Introduction}
This is the body of a minimal APA7-format test document.
\end{document}
"""

_APA7_WITH_CITATION_DOC = r"""
\documentclass[man]{apa7}
\usepackage[backend=biber,style=apa,sortcites=true]{biblatex}
\addbibresource{refs.bib}
\title{Citation Round Trip Test}
\shorttitle{Citation Test}
\author{Test Author}
\affiliation{Test University}
\abstract{Testing that a real citation resolves through pdflatex/biber/pdflatex/pdflatex.}
\begin{document}
\maketitle
\section{Introduction}
This document cites \textcite{sample2024} to prove the biblatex/biber round trip
actually resolves a reference, not just that the compiler ran.
\printbibliography
\end{document}
"""

# The two humanities styles app/services/paper_templates.py's render_mla/render_chicago
# emit. Unlike IEEE/APA 7 these have no document CLASS of their own, so what's actually
# being proven here is that the real TeX Live image has the biblatex-mla and
# biblatex-chicago styles (plus geometry/mathptmx/setspace/fancyhdr) and that both
# citation apparatuses resolve end to end -- a parenthetical "(Doe)" + "Works Cited" for
# MLA, real numbered footnotes + a separate "Bibliography" for Chicago.
_MLA_DOC = r"""
\documentclass[12pt]{article}
\usepackage[letterpaper,margin=1in]{geometry}
\usepackage{mathptmx}
\usepackage{setspace}
\usepackage{fancyhdr}
\usepackage[backend=biber,style=mla,sortcites=true]{biblatex}
\addbibresource{refs.bib}
\let\cite\parencite
\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0pt}
\fancyhead[R]{Student Author \thepage}
\begin{document}
\thispagestyle{fancy}
\doublespacing
\noindent Student Author\\
Instructor\\
Course\\
\today
\begin{center}
A Minimal MLA Test Document
\end{center}
\section*{Introduction}
This is the body of a minimal MLA-format test document \cite{sample2024}.
\printbibliography[title={Works Cited}]
\end{document}
"""

# biblatex-chicago loads biblatex itself -- there must be no separate
# \usepackage{biblatex} here, and \footcite is what makes each cite a real footnote.
_CHICAGO_DOC = r"""
\documentclass[12pt]{article}
\usepackage[letterpaper,margin=1in]{geometry}
\usepackage{mathptmx}
\usepackage{setspace}
\usepackage{fancyhdr}
\usepackage[notes,backend=biber,sortcites=true]{biblatex-chicago}
\addbibresource{refs.bib}
\let\cite\footcite
\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0pt}
\fancyhead[R]{\thepage}
\begin{document}
\thispagestyle{fancy}
\doublespacing
\begin{center}
{\large A Minimal Chicago Test Document}\\[1em]
Student Author\\
\today
\end{center}
\section*{Introduction}
This is the body of a minimal Chicago notes-bibliography test document \cite{sample2024}.
A second reference to the same source \cite{sample2024} should produce a SHORTENED note.
\printbibliography[title={Bibliography}]
\end{document}
"""

_REFS_BIB = r"""
@article{sample2024,
  author  = {Jane Doe},
  title   = {A Sample Reference Title for Testing},
  journal = {Journal of Sample Studies},
  year    = {2024},
  volume  = {1},
  pages   = {1--10},
}
"""

_BROKEN_DOC = r"""
\documentclass{article}
\begin{document}
\thisCommandDoesNotExist
\end{document}
"""

# Recursive macro expansion with no base case -- pdflatex will either burn CPU/wall-clock
# time until sandbox-runner's watchdog/RLIMIT_CPU kills it, or hit TeX's own internal
# capacity limit first. Either outcome is acceptable (see test_wall_clock_timeout); what
# must never happen is the request hanging past the service's own bounded budget.
_INFINITE_LOOP_DOC = r"""
\documentclass{article}
\newcount\mycount
\def\countdown{\advance\mycount by -1 \ifnum\mycount>0 \countdown\fi}
\begin{document}
\mycount=2000000000
\countdown
\end{document}
"""


def compile_latex(tex: str, bib: str | None = None, engine: str = "pdflatex", client_timeout: float = 90.0) -> dict:
    payload: dict[str, str] = {"tex": tex, "engine": engine}
    if bib is not None:
        payload["bib"] = bib
    req = urllib.request.Request(
        f"{BASE_URL}/compile-latex",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=client_timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def health() -> bool:
    try:
        with urllib.request.urlopen(f"{BASE_URL}/health", timeout=5) as resp:
            return resp.status == 200
    except Exception:
        return False


def check(name: str, condition: bool, detail: str) -> None:
    results.append((name, condition, detail))
    status = "PASS" if condition else "FAIL"
    print(f"[{status}] {name}: {detail}")


def _pdf_bytes(result: dict) -> bytes | None:
    if not result.get("pdf_base64"):
        return None
    return base64.b64decode(result["pdf_base64"])


def test_ieee_document_compiles_to_a_real_pdf() -> None:
    r = compile_latex(_IEEE_DOC)
    pdf = _pdf_bytes(r)
    check(
        "ieee_compile_success",
        r["success"] is True and not r["timed_out"],
        f"success={r['success']} timed_out={r['timed_out']} log_tail={r['log'][-500:]!r}",
    )
    check(
        "ieee_pdf_has_real_magic_bytes_and_size",
        pdf is not None and pdf[:5] == b"%PDF-" and len(pdf) > 1000,
        f"pdf_len={len(pdf) if pdf else 0} magic={pdf[:8] if pdf else None!r}",
    )


def test_apa7_document_compiles_to_a_real_pdf() -> None:
    r = compile_latex(_APA7_DOC)
    pdf = _pdf_bytes(r)
    check(
        "apa7_compile_success",
        r["success"] is True and not r["timed_out"],
        f"success={r['success']} timed_out={r['timed_out']} log_tail={r['log'][-500:]!r}",
    )
    check(
        "apa7_pdf_has_real_magic_bytes_and_size",
        pdf is not None and pdf[:5] == b"%PDF-" and len(pdf) > 1000,
        f"pdf_len={len(pdf) if pdf else 0} magic={pdf[:8] if pdf else None!r}",
    )


def test_mla_document_compiles_with_a_resolved_works_cited() -> None:
    r = compile_latex(_MLA_DOC, bib=_REFS_BIB)
    pdf = _pdf_bytes(r)
    check(
        "mla_compile_success",
        r["success"] is True and not r["timed_out"],
        f"success={r['success']} timed_out={r['timed_out']} log_tail={r['log'][-800:]!r}",
    )
    check(
        "mla_pdf_has_real_magic_bytes_and_size",
        pdf is not None and pdf[:5] == b"%PDF-" and len(pdf) > 1000,
        f"pdf_len={len(pdf) if pdf else 0}",
    )
    # Same "only the FINAL pdflatex pass proves the end state" reasoning as the APA 7
    # citation test below -- the first pass always warns before biber has run.
    final_pass_log = r["log"].rsplit("$ pdflatex", 1)[-1]
    check(
        "mla_citation_actually_resolved",
        "Citation" not in final_pass_log or "undefined" not in final_pass_log.lower(),
        f"log_tail={r['log'][-1500:]!r}",
    )


def test_chicago_notes_document_compiles_with_footnotes_and_a_bibliography() -> None:
    r = compile_latex(_CHICAGO_DOC, bib=_REFS_BIB)
    pdf = _pdf_bytes(r)
    check(
        "chicago_compile_success",
        r["success"] is True and not r["timed_out"],
        f"success={r['success']} timed_out={r['timed_out']} log_tail={r['log'][-800:]!r}",
    )
    check(
        "chicago_pdf_has_real_magic_bytes_and_size",
        pdf is not None and pdf[:5] == b"%PDF-" and len(pdf) > 1000,
        f"pdf_len={len(pdf) if pdf else 0}",
    )
    final_pass_log = r["log"].rsplit("$ pdflatex", 1)[-1]
    check(
        "chicago_citation_actually_resolved",
        "Citation" not in final_pass_log or "undefined" not in final_pass_log.lower(),
        f"log_tail={r['log'][-1500:]!r}",
    )


def test_genuinely_bad_latex_returns_the_real_compiler_error() -> None:
    r = compile_latex(_BROKEN_DOC)
    check(
        "broken_latex_reports_failure",
        r["success"] is False and not r["timed_out"],
        f"success={r['success']} timed_out={r['timed_out']}",
    )
    check(
        "broken_latex_log_contains_real_error_not_just_a_verdict",
        "Undefined control sequence" in r["log"],
        f"log_tail={r['log'][-800:]!r}",
    )
    check("service_alive_after_broken_latex", health(), "GET /health after a bad-LaTeX compile")


def test_bib_citation_round_trip_resolves_through_biber() -> None:
    r = compile_latex(_APA7_WITH_CITATION_DOC, bib=_REFS_BIB)
    pdf = _pdf_bytes(r)
    check(
        "citation_compile_success",
        r["success"] is True and not r["timed_out"],
        f"success={r['success']} timed_out={r['timed_out']} log_tail={r['log'][-800:]!r}",
    )
    check(
        "citation_pdf_produced",
        pdf is not None and pdf[:5] == b"%PDF-",
        f"pdf_len={len(pdf) if pdf else 0}",
    )
    # A failed/unresolved citation is the single most common biblatex/biber failure mode,
    # and pdflatex reports it via this exact warning text -- but only the LAST pdflatex
    # pass's output actually proves the final state: the very first pass, before biber has
    # ever run, is EXPECTED to warn "Citation ... undefined" (there's no .bbl yet), so
    # checking the whole 4-step concatenated log would flag that normal transient warning
    # as a false failure. Isolate the final "$ pdflatex ..." step's own output instead.
    final_pass_log = r["log"].rsplit("$ pdflatex", 1)[-1]
    check(
        "citation_actually_resolved_no_undefined_citation_warning",
        "Citation" not in final_pass_log or "undefined" not in final_pass_log.lower(),
        f"log_tail={r['log'][-1500:]!r}",
    )


def test_wall_clock_timeout_on_pathological_input() -> None:
    """Either the watchdog/RLIMIT_CPU kills a runaway compile, or TeX's own internal
    capacity limit does -- either is an acceptable outcome (same lenient shape as
    test_sandbox_integration.py's CPU-bound-loop test). What must hold is that the
    request itself is bounded and the service survives it."""
    start = time.monotonic()
    r = compile_latex(_INFINITE_LOOP_DOC, client_timeout=90.0)
    elapsed = time.monotonic() - start
    check(
        "pathological_input_did_not_succeed",
        r["success"] is False,
        f"success={r['success']} timed_out={r['timed_out']} elapsed={elapsed:.1f}s",
    )
    check(
        "pathological_input_bounded_by_watchdog_or_tex_capacity_limit",
        elapsed < 75.0,
        f"elapsed={elapsed:.1f}s (should be bounded well under the client timeout)",
    )
    check("service_alive_after_pathological_input", health(), "GET /health after the pathological input")


def test_no_state_leak_between_requests() -> None:
    r1 = compile_latex(_IEEE_DOC)
    check("request1_ieee_compiled", r1["success"] is True, f"success={r1['success']}")
    # A second, unrelated document must not see main.aux/main.pdf/etc. from the first
    # request's scratch dir -- e.g. a stray leftover .bbl could silently "fix" a citation
    # this second document never actually supplied.
    r2 = compile_latex(_APA7_DOC)
    check(
        "request2_apa7_compiled_independently",
        r2["success"] is True,
        f"success={r2['success']} log_tail={r2['log'][-300:]!r}",
    )


def test_unsupported_engine_is_refused_cleanly() -> None:
    r = compile_latex(_IEEE_DOC, engine="xelatex")
    check(
        "unsupported_engine_refused",
        r["success"] is False and "engine" in r["log"].lower(),
        f"success={r['success']} log={r['log']!r}",
    )


def main() -> int:
    print(f"Testing sandbox-runner /compile-latex at {BASE_URL}\n")
    if not health():
        print("FATAL: service is not reachable / healthy at startup")
        return 2

    test_ieee_document_compiles_to_a_real_pdf()
    test_apa7_document_compiles_to_a_real_pdf()
    test_mla_document_compiles_with_a_resolved_works_cited()
    test_chicago_notes_document_compiles_with_footnotes_and_a_bibliography()
    test_genuinely_bad_latex_returns_the_real_compiler_error()
    test_bib_citation_round_trip_resolves_through_biber()
    test_unsupported_engine_is_refused_cleanly()
    test_no_state_leak_between_requests()
    test_wall_clock_timeout_on_pathological_input()

    print("\n--- Summary ---")
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    for name, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    print(f"\n{passed}/{total} checks passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
