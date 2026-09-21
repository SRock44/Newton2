"""Newton sandbox-runner: executes untrusted, LLM-generated Python code as a locked-down
subprocess and reports back what happened. This service does NOT spin up a fresh
container per request (that would require Docker-socket access, which is explicitly
forbidden for this project — see services/sandbox-runner/README.md) and it does NOT
implement network blocking itself (that is a container/network-level control, also
documented in the README). What it DOES own:

  1. Running submitted code as `python3 -I -c <code>` under real, kernel-enforced
     resource limits (CPU time, address space, file size, open files, no core dumps).
  2. A wall-clock watchdog independent of those limits, because RLIMIT_CPU only counts
     CPU time actually burned — a process that's merely sleeping or blocked would sail
     right past it. The watchdog kills the whole process group, not just the one pid,
     so code that forks can't outlive its parent.
  3. Giving every request its own throwaway scratch directory (removed before it's
     reused and after the request finishes) so no state survives between requests, even
     if a process crashes mid-write.

This is namespace/cgroup + rlimit isolation, not a hardware-virtualized sandbox — see the
README's "Limitations" section for the honest version of what it can and can't stop.

`POST /compile-latex` extends the same isolation pattern (non-root, dropped
capabilities, read-only root fs, per-request scratch dir, rlimits via preexec_fn, a
process-group wall-clock watchdog) to compile a LaTeX document with pdflatex, rather than
building a second, separate sandboxing mechanism. It gets its own, more generous
wall-clock budget and its own rlimit ceilings (see LATEX_* tunables below) because a real
multi-pass LaTeX+biber compile legitimately needs more CPU time, open files, and memory
than a short Python script does — reusing the tighter SANDBOX_* numbers would just make
every real compile fail.

`POST /run-code` is the multi-file sibling of `/execute`, backing the API's
`check_code_work` tool (services/api/app/tools/check_code_work.py): it materializes a
whole submission (several files) into the same kind of throwaway scratch dir and either
runs one of them as a script or runs a pytest test file against them, returning REAL
per-test outcomes. It runs under the IDENTICAL SANDBOX_* rlimits, wall-clock watchdog and
scratch-wipe as `/execute` — deliberately no separate, looser budget, unlike the LaTeX
endpoint (see `_limit_child` usage below and the "identical limits" note on
`_run_code_sync`).

SCOPE (deliberate): `/run-code` is Python-only. Running a student's Java/C/C++/Rust
submission would mean adding real compiler toolchains (a JDK, gcc/clang, ...) to this
image and a per-language compile+run step with its own failure modes — a genuine,
separate piece of work, not a small extension of this one. It is not attempted here and
nothing in this service claims to support it.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import os
import re
import resource
import shutil
import signal
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

from fastapi import FastAPI
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sandbox_runner")

# --- Tunables (env-overridable, sane defaults for a single request) -----------------
WALL_CLOCK_TIMEOUT_S = float(os.environ.get("SANDBOX_WALL_CLOCK_TIMEOUT_S", "10"))
CPU_TIME_LIMIT_S = int(os.environ.get("SANDBOX_CPU_TIME_LIMIT_S", "5"))
ADDRESS_SPACE_LIMIT_BYTES = int(os.environ.get("SANDBOX_AS_LIMIT_BYTES", str(256 * 1024 * 1024)))
FILE_SIZE_LIMIT_BYTES = int(os.environ.get("SANDBOX_FSIZE_LIMIT_BYTES", str(10 * 1024 * 1024)))
OPEN_FILES_LIMIT = int(os.environ.get("SANDBOX_NOFILE_LIMIT", "64"))
NPROC_LIMIT = int(os.environ.get("SANDBOX_NPROC_LIMIT", "32"))
MAX_OUTPUT_BYTES = int(os.environ.get("SANDBOX_MAX_OUTPUT_BYTES", str(1024 * 1024)))
# Must live on a writable mount even under a read-only container root filesystem —
# see README for the required `tmpfs` mount at /tmp.
SCRATCH_BASE = Path(os.environ.get("SANDBOX_SCRATCH_BASE", "/tmp/sandbox-scratch"))
MAX_CONCURRENCY = int(os.environ.get("SANDBOX_MAX_CONCURRENCY", "4"))

# --- /run-code (multi-file) tunables ---------------------------------------------
# NOTE these are about the SHAPE of a submission (how many files, how big), never about
# how much CPU/memory/wall-clock it gets: /run-code deliberately reuses the SANDBOX_*
# limits and `_limit_child` above verbatim, so a multi-file submission is sandboxed
# exactly as tightly as a one-liner sent to /execute.
MAX_SUBMITTED_FILES = int(os.environ.get("SANDBOX_MAX_SUBMITTED_FILES", "20"))
MAX_SUBMITTED_BYTES = int(os.environ.get("SANDBOX_MAX_SUBMITTED_BYTES", str(256 * 1024)))
MAX_PATH_DEPTH = int(os.environ.get("SANDBOX_MAX_PATH_DEPTH", "3"))
MAX_TEST_MESSAGE_CHARS = int(os.environ.get("SANDBOX_MAX_TEST_MESSAGE_CHARS", "4000"))
MAX_TESTS_REPORTED = int(os.environ.get("SANDBOX_MAX_TESTS_REPORTED", "200"))

# Names this service writes into the scratch dir itself. A submission is refused if it
# uses one of them, rather than either side silently clobbering the other -- the whole
# contract of this endpoint is that the submitted files are run EXACTLY as given.
TEST_FILENAME = "test_newton_check.py"
PLUGIN_MODULE = "_newton_report"
PLUGIN_FILENAME = f"{PLUGIN_MODULE}.py"
RESULTS_FILENAME = "_newton_results.jsonl"
RESERVED_FILENAMES = frozenset({TEST_FILENAME, PLUGIN_FILENAME, RESULTS_FILENAME})

# One path segment: ordinary source-file characters only. No absolute paths, no drive
# letters, no backslashes, no "..", no leading dot/dash -- checked segment by segment in
# `_validate_submission` rather than trusting a single `resolve()` at write time.
_SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]*$")

# --- LaTeX-specific tunables (independent of the SANDBOX_* ones above; see module
# docstring for why /compile-latex needs its own, more generous numbers) ------------
LATEX_WALL_CLOCK_TIMEOUT_S = float(os.environ.get("LATEX_WALL_CLOCK_TIMEOUT_S", "45"))
LATEX_CPU_TIME_LIMIT_S = int(os.environ.get("LATEX_CPU_TIME_LIMIT_S", "40"))
LATEX_AS_LIMIT_BYTES = int(os.environ.get("LATEX_AS_LIMIT_BYTES", str(1024 * 1024 * 1024)))
LATEX_FSIZE_LIMIT_BYTES = int(os.environ.get("LATEX_FSIZE_LIMIT_BYTES", str(30 * 1024 * 1024)))
LATEX_NOFILE_LIMIT = int(os.environ.get("LATEX_NOFILE_LIMIT", "512"))
LATEX_NPROC_LIMIT = int(os.environ.get("LATEX_NPROC_LIMIT", "16"))
LATEX_MAX_LOG_BYTES = int(os.environ.get("LATEX_MAX_LOG_BYTES", str(MAX_OUTPUT_BYTES)))
LATEX_MAX_PDF_BYTES = int(os.environ.get("LATEX_MAX_PDF_BYTES", str(15 * 1024 * 1024)))
LATEX_MAX_CONCURRENCY = int(os.environ.get("LATEX_MAX_CONCURRENCY", "2"))

# Deny-by-default engine allowlist: the request body's `engine` field is caller-supplied,
# so it is looked up here rather than ever being interpolated into a command line
# directly -- an unrecognized value is refused, never passed through to subprocess as a
# binary name. Extend deliberately (e.g. "xelatex") only once it's actually needed and
# the image has the corresponding binary.
LATEX_ENGINES: dict[str, str] = {"pdflatex": "pdflatex"}

SCRATCH_BASE.mkdir(parents=True, exist_ok=True)

_semaphore = asyncio.Semaphore(MAX_CONCURRENCY)
_latex_semaphore = asyncio.Semaphore(LATEX_MAX_CONCURRENCY)

app = FastAPI(title="Newton sandbox-runner")


class ExecuteRequest(BaseModel):
    code: str
    stdin: str | None = None


class ExecuteResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
    timed_out: bool


class RunCodeRequest(BaseModel):
    """A whole submission, not a single snippet. `files` maps a relative filename to its
    exact content; `entrypoint` names which of them is the student's main module;
    `test_file`, when present, is the CONTENT of a pytest-style test module written
    against those files. This service never edits, formats or repairs anything in
    `files` -- it writes them byte-for-byte and runs them."""

    files: dict[str, str]
    entrypoint: str
    test_file: str | None = None
    stdin: str | None = None


class TestResult(BaseModel):
    name: str
    outcome: str  # passed | failed | error | skipped
    phase: str  # call | setup | teardown | collect
    duration: float
    message: str


class RunCodeResponse(BaseModel):
    ok: bool
    error: str | None
    mode: str  # "tests" | "script"
    stdout: str
    stderr: str
    exit_code: int
    timed_out: bool
    tests: list[TestResult]
    passed: int
    failed: int
    errors: int
    skipped: int


class CompileLatexRequest(BaseModel):
    tex: str
    bib: str | None = None
    engine: str = "pdflatex"


class CompileLatexResponse(BaseModel):
    pdf_base64: str | None
    log: str
    success: bool
    timed_out: bool


def _limit_child() -> None:
    """Runs in the child after fork(), before exec() — i.e. as `preexec_fn`. Every limit
    here is enforced by the kernel on the child process (and, being rlimits, inherited by
    anything it forks), not just "hoped for" in Python. `start_new_session=True` on the
    Popen call (done by the caller, not here) additionally puts the child in its own
    session/process group so the timeout watchdog can SIGKILL the whole tree via killpg."""
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (CPU_TIME_LIMIT_S, CPU_TIME_LIMIT_S))
    resource.setrlimit(resource.RLIMIT_AS, (ADDRESS_SPACE_LIMIT_BYTES, ADDRESS_SPACE_LIMIT_BYTES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (FILE_SIZE_LIMIT_BYTES, FILE_SIZE_LIMIT_BYTES))
    resource.setrlimit(resource.RLIMIT_NOFILE, (OPEN_FILES_LIMIT, OPEN_FILES_LIMIT))
    # Caps fork bombs in submitted code. Not available on every platform (e.g. macOS
    # lacks RLIMIT_NPROC under some kernels) so this one is best-effort.
    with contextlib.suppress(ValueError, OSError):
        resource.setrlimit(resource.RLIMIT_NPROC, (NPROC_LIMIT, NPROC_LIMIT))


def _truncate(text: str, limit: int) -> str:
    if len(text.encode("utf-8", errors="ignore")) <= limit:
        return text
    encoded = text.encode("utf-8", errors="ignore")[:limit]
    return encoded.decode("utf-8", errors="ignore") + "\n...[truncated]"


def _run_limited(
    args: list[str], stdin_data: str | None, scratch_dir: Path
) -> tuple[str, str, int, bool]:
    """Runs ONE command under the full `/execute` sandbox contract: `_limit_child`'s
    kernel rlimits, its own session/process group, the WALL_CLOCK_TIMEOUT_S watchdog that
    SIGKILLs that whole group, a minimal explicit env, and cwd pinned to the caller's
    throwaway scratch dir. Blocking; must be run off the event loop.

    Both `/execute` and `/run-code` go through here, so there is exactly ONE copy of
    these limits -- a multi-file submission cannot end up on a looser path than a
    one-line snippet by accident, and tightening a limit tightens it for both."""
    proc = subprocess.Popen(
        args,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(scratch_dir),
        # Minimal, explicit env — no leaking the sandbox-runner's own environment
        # (secrets, service URLs, etc.) into user-controlled code. The *_NUM_THREADS=1
        # vars are required, not cosmetic: numpy/scipy's BLAS backend (OpenBLAS by
        # default) spins up one thread pool per CPU core, each reserving its own
        # virtual-memory buffers, which alone can exceed the 256MB ADDRESS_SPACE_LIMIT_
        # BYTES above before any real computation happens — confirmed via a real failure
        # ("OpenBLAS error: Memory allocation still failed after 10 retries") before this
        # fix. Forcing single-threaded BLAS keeps the address-space footprint predictable
        # regardless of the host's core count, and costs nothing here anyway: a
        # numpy/scipy call under this sandbox's own 5s CPU_TIME_LIMIT_S is never the kind
        # of workload multi-threaded BLAS would meaningfully speed up.
        env={
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": str(scratch_dir),
            "OPENBLAS_NUM_THREADS": "1",
            "OMP_NUM_THREADS": "1",
            "MKL_NUM_THREADS": "1",
            "NUMEXPR_NUM_THREADS": "1",
        },
        preexec_fn=_limit_child,
        start_new_session=True,
        text=True,
    )

    timed_out = False
    try:
        stdout, stderr = proc.communicate(input=stdin_data, timeout=WALL_CLOCK_TIMEOUT_S)
        exit_code = proc.returncode
    except subprocess.TimeoutExpired:
        timed_out = True
        # Kill the whole process group, not just `proc` — a fork()'d grandchild that's
        # still running would otherwise survive and keep burning CPU/wall-clock time.
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        try:
            stdout, stderr = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            # Pipes didn't drain even after SIGKILL (shouldn't normally happen) — give up
            # rather than hang the request forever.
            proc.kill()
            stdout, stderr = "", "[sandbox-runner: process group did not exit after SIGKILL]"
        exit_code = proc.returncode if proc.returncode is not None else -9

    return _truncate(stdout or "", MAX_OUTPUT_BYTES), _truncate(stderr or "", MAX_OUTPUT_BYTES), exit_code, timed_out


def _run_sync(code: str, stdin_data: str | None, scratch_dir: Path) -> tuple[str, str, int, bool]:
    """Blocking; must be run off the event loop (see `execute` below)."""
    return _run_limited(["python3", "-I", "-c", code], stdin_data, scratch_dir)


# ---------------------------------------------------------------------------------
# /run-code: multi-file submissions, optionally run under pytest
# ---------------------------------------------------------------------------------

# Written into the scratch dir and loaded with `pytest -p _newton_report`. It exists so
# per-test results come from pytest's OWN report objects (nodeid, outcome, longrepr)
# rather than from screen-scraping pytest's human-readable terminal output -- the point
# of this endpoint is honest, real per-test data, and a regex over `-q` output would be
# the exact kind of "close enough" layer this codebase avoids. Kept as an inline source
# string (not a third-party plugin like pytest-json-report) so the image gains exactly
# one new dependency, pytest itself.
#
# The student's own code could of course delete or scribble on the results file -- it is
# untrusted code running in the same scratch dir. That is not a security boundary and is
# not treated as one: pytest's real process exit code is reported alongside these rows,
# so a tampered/short results file shows up as an inconsistency rather than as a
# fabricated "all passed".
_PYTEST_PLUGIN_SOURCE = '''\
"""Generated by Newton's sandbox-runner. Emits one JSON object per test so the caller
gets pytest's real per-test outcomes, not parsed terminal output."""
import json

_RESULTS_PATH = "{results}"
_MAX_MESSAGE_CHARS = {max_chars}


def _write(record):
    try:
        with open(_RESULTS_PATH, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\\n")
    except Exception:
        pass


def _detail(report):
    text = ""
    if report.longrepr is not None:
        try:
            text = str(report.longrepr)
        except Exception:
            text = "<failure detail could not be rendered>"
    if len(text) > _MAX_MESSAGE_CHARS:
        text = text[:_MAX_MESSAGE_CHARS] + "\\n...[truncated]"
    return text


def pytest_runtest_logreport(report):
    if report.when == "call":
        outcome = report.outcome            # passed / failed / (skipped via pytest.skip in body)
    elif report.outcome == "failed":
        outcome = "error"                   # blew up in setup/teardown, not in the test body
    elif report.when == "setup" and report.outcome == "skipped":
        outcome = "skipped"
    else:
        return
    _write(
        {{
            "name": report.nodeid,
            "outcome": outcome,
            "phase": report.when,
            "duration": float(getattr(report, "duration", 0.0) or 0.0),
            "message": _detail(report),
        }}
    )


def pytest_collectreport(report):
    # A submission that doesn't even import (SyntaxError, a module-level NameError, a
    # bad import) fails at COLLECTION -- no test ever runs, so pytest_runtest_logreport
    # never fires for it. Without this hook the student would get "0 tests" and no
    # reason why.
    if report.failed:
        _write(
            {{
                "name": report.nodeid or "<collection>",
                "outcome": "error",
                "phase": "collect",
                "duration": 0.0,
                "message": _detail(report),
            }}
        )
'''


def _validate_submission(files: dict[str, str], entrypoint: str) -> str | None:
    """Returns a human-readable refusal reason, or None if the submission is safe to
    materialize. Path traversal is rejected segment by segment (never by trusting a
    single `resolve()` after the fact), and the names this service writes itself are
    reserved so neither side can silently clobber the other."""
    if not files:
        return "files must contain at least one file."
    if len(files) > MAX_SUBMITTED_FILES:
        return f"too many files ({len(files)}); the limit is {MAX_SUBMITTED_FILES}."

    total = 0
    for name, content in files.items():
        if not isinstance(name, str) or not isinstance(content, str):
            return "every entry in files must be a filename string mapped to a content string."
        if not name or name != name.strip():
            return f"invalid filename {name!r}: must not be empty or padded with whitespace."
        if "\\" in name or name.startswith("/"):
            return f"invalid filename {name!r}: must be a relative POSIX path."
        segments = name.split("/")
        if len(segments) > MAX_PATH_DEPTH:
            return f"invalid filename {name!r}: at most {MAX_PATH_DEPTH} path segments."
        for segment in segments:
            if not _SAFE_SEGMENT.match(segment):
                return (
                    f"invalid filename {name!r}: each path segment must match "
                    "[A-Za-z0-9_][A-Za-z0-9_.-]* (no '..', no hidden or empty segments)."
                )
        if name in RESERVED_FILENAMES or segments[-1] in RESERVED_FILENAMES:
            return f"filename {name!r} is reserved by sandbox-runner; rename it and resubmit."
        total += len(content.encode("utf-8", errors="ignore"))

    if total > MAX_SUBMITTED_BYTES:
        return f"submission is {total} bytes; the limit is {MAX_SUBMITTED_BYTES}."
    if entrypoint not in files:
        return f"entrypoint {entrypoint!r} is not one of the submitted files ({sorted(files)})."
    return None


def _materialize(files: dict[str, str], scratch_dir: Path) -> None:
    """Writes each submitted file into the scratch dir EXACTLY as given -- no
    reformatting, no import fixing, no injected shims. `_validate_submission` has already
    rejected anything that could escape the directory; the containment re-check here is
    a cheap second line of defense, not the primary one."""
    root = scratch_dir.resolve()
    for name, content in files.items():
        path = (scratch_dir / name).resolve()
        if not path.is_relative_to(root):
            raise ValueError(f"refusing to write {name!r} outside the scratch directory")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


def _read_test_results(scratch_dir: Path) -> list[TestResult]:
    results_path = scratch_dir / RESULTS_FILENAME
    if not results_path.exists():
        return []
    rows: list[TestResult] = []
    try:
        raw = results_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
            rows.append(
                TestResult(
                    name=str(record["name"]),
                    outcome=str(record["outcome"]),
                    phase=str(record.get("phase", "call")),
                    duration=float(record.get("duration", 0.0)),
                    message=str(record.get("message", "")),
                )
            )
        except Exception:
            # A partially-written or tampered-with row is dropped rather than faked.
            continue
        if len(rows) >= MAX_TESTS_REPORTED:
            break
    return rows


def _run_code_sync(
    files: dict[str, str],
    entrypoint: str,
    test_file: str | None,
    stdin_data: str | None,
    scratch_dir: Path,
) -> tuple[str, str, int, bool, list[TestResult]]:
    """Blocking; must be run off the event loop (see `run_code` below).

    Runs `python3 -E -s` rather than `/execute`'s `python3 -I`. The ONLY difference is
    `-P`, which `-I` implies: `-P` refuses to put the script's own directory on
    sys.path, which would make `import utils` from `main.py` fail -- i.e. it would make
    multi-file submissions, the entire point of this endpoint, impossible. `-E`
    (ignore PYTHON* env vars) and `-s` (no user site-packages) are kept, and the
    directory now on sys.path is a freshly-created scratch dir containing nothing but
    the caller's own submitted files, so this widens no real boundary: the code being
    run is already arbitrary code from the same submission.

    Every resource limit is `/execute`'s, unchanged -- see `_run_limited`."""
    _materialize(files, scratch_dir)

    if test_file is None:
        stdout, stderr, exit_code, timed_out = _run_limited(
            ["python3", "-E", "-s", entrypoint], stdin_data, scratch_dir
        )
        return stdout, stderr, exit_code, timed_out, []

    (scratch_dir / TEST_FILENAME).write_text(test_file, encoding="utf-8")
    (scratch_dir / PLUGIN_FILENAME).write_text(
        _PYTEST_PLUGIN_SOURCE.format(results=RESULTS_FILENAME, max_chars=MAX_TEST_MESSAGE_CHARS),
        encoding="utf-8",
    )

    args = [
        "python3",
        "-E",
        "-s",
        "-m",
        "pytest",
        TEST_FILENAME,
        "-q",
        "--tb=short",
        "--color=no",
        "-p",
        PLUGIN_MODULE,
        # No .pytest_cache dir: nothing survives the request anyway (the scratch dir is
        # wiped), and it keeps the student's directory to exactly what they submitted.
        "-p",
        "no:cacheprovider",
    ]
    stdout, stderr, exit_code, timed_out = _run_limited(args, stdin_data, scratch_dir)
    return stdout, stderr, exit_code, timed_out, _read_test_results(scratch_dir)


def _limit_latex_child() -> None:
    """Same rlimit pattern as `_limit_child` (preexec_fn, kernel-enforced, inherited by
    forked children), but with LaTeX-appropriate ceilings: a real pdflatex/biber run
    legitimately opens far more files (font/format search across several TEXMF trees),
    can legitimately need more memory, and needs more CPU time than a short Python
    script -- so this uses the independent LATEX_* tunables, never the SANDBOX_* ones
    /execute uses, so tightening or loosening one endpoint's limits never silently
    changes the other's."""
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (LATEX_CPU_TIME_LIMIT_S, LATEX_CPU_TIME_LIMIT_S))
    resource.setrlimit(resource.RLIMIT_AS, (LATEX_AS_LIMIT_BYTES, LATEX_AS_LIMIT_BYTES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (LATEX_FSIZE_LIMIT_BYTES, LATEX_FSIZE_LIMIT_BYTES))
    resource.setrlimit(resource.RLIMIT_NOFILE, (LATEX_NOFILE_LIMIT, LATEX_NOFILE_LIMIT))
    with contextlib.suppress(ValueError, OSError):
        resource.setrlimit(resource.RLIMIT_NPROC, (LATEX_NPROC_LIMIT, LATEX_NPROC_LIMIT))


def _run_compiler_step(args: list[str], scratch_dir: Path, timeout: float) -> tuple[str, str, int, bool]:
    """Runs one compiler invocation (a pdflatex pass, or biber) under the same
    process-group wall-clock watchdog pattern as `_run_sync` -- blocking, must be run off
    the event loop."""
    proc = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(scratch_dir),
        # Minimal, explicit env -- same reasoning as _run_sync: never leak this
        # service's own environment into a document's compile step.
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(scratch_dir)},
        preexec_fn=_limit_latex_child,
        start_new_session=True,
        text=True,
    )

    timed_out = False
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
        exit_code = proc.returncode
    except subprocess.TimeoutExpired:
        timed_out = True
        # Kill the whole process group -- pdflatex/biber don't typically fork, but this
        # stays consistent with _run_sync's defense regardless.
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        try:
            stdout, stderr = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = "", "[sandbox-runner: process group did not exit after SIGKILL]"
        exit_code = proc.returncode if proc.returncode is not None else -9

    return stdout or "", stderr or "", exit_code, timed_out


def _run_latex_sync(
    tex: str, bib: str | None, engine: str, scratch_dir: Path
) -> tuple[bytes | None, str, bool, bool]:
    """Blocking; must be run off the event loop (see `compile_latex` below). Writes
    main.tex (and refs.bib, if provided) into scratch_dir, then runs the standard
    multi-pass LaTeX build:

        pdflatex -> [biber -> pdflatex] (only when a .bib was provided) -> pdflatex

    -- the same sequence any real LaTeX build needs for citations and cross-references to
    resolve, all under ONE shared wall-clock budget (LATEX_WALL_CLOCK_TIMEOUT_S) spread
    across every step, not per-step, so a slow first pass can't buy the later passes extra
    time. Returns (pdf_bytes_or_None, combined_log, timed_out, success).

    `-no-shell-escape -interaction=nonstopmode -halt-on-error` are passed explicitly on
    every pdflatex invocation. `-no-shell-escape` is the single most important flag here:
    shell-escape is off by default in a stock modern TeX Live, but LaTeX's `\\write18` is
    arbitrary shell execution the instant shell-escape is ever enabled (by a distro
    default change, a texmf.cnf tweak, anything) -- so this is never left to the default,
    it's stated on the command line every single time.
    """
    tex_path = scratch_dir / "main.tex"
    tex_path.write_text(tex, encoding="utf-8")
    if bib:
        (scratch_dir / "refs.bib").write_text(bib, encoding="utf-8")

    binary = LATEX_ENGINES[engine]
    pdflatex_args = [binary, "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "main.tex"]

    steps: list[list[str]] = [pdflatex_args]
    if bib:
        steps.append(["biber", "main"])
        steps.append(pdflatex_args)
    steps.append(pdflatex_args)  # final pass to resolve cross-references/citations

    log_parts: list[str] = []
    deadline = time.monotonic() + LATEX_WALL_CLOCK_TIMEOUT_S
    timed_out = False
    exit_code = -1

    for i, args in enumerate(steps):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            timed_out = True
            log_parts.append("[sandbox-runner: wall-clock budget exhausted before this step could run]")
            break
        stdout, stderr, exit_code, step_timed_out = _run_compiler_step(args, scratch_dir, remaining)
        log_parts.append(f"$ {' '.join(args)}\n{stdout}{stderr}")
        if step_timed_out:
            timed_out = True
            break
        if exit_code != 0 and i == 0:
            # The initial pass failed outright (e.g. a real LaTeX syntax error) --
            # running biber/further pdflatex passes over a document that never produced
            # a usable .aux would be pointless, so stop here and report this error.
            break

    pdf_path = scratch_dir / "main.pdf"
    pdf_bytes: bytes | None = None
    success = (not timed_out) and exit_code == 0 and pdf_path.exists()
    if success:
        raw = pdf_path.read_bytes()
        if len(raw) > LATEX_MAX_PDF_BYTES:
            success = False
            log_parts.append(
                f"[sandbox-runner: compiled PDF ({len(raw)} bytes) exceeded the "
                f"{LATEX_MAX_PDF_BYTES}-byte cap and was not returned]"
            )
        else:
            pdf_bytes = raw

    return pdf_bytes, "\n".join(log_parts), timed_out, success


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/execute", response_model=ExecuteResponse)
async def execute(req: ExecuteRequest) -> ExecuteResponse:
    async with _semaphore:
        # Fresh, unique scratch directory per request — cleared before use (it's brand
        # new) and removed again afterwards, so nothing a request writes is visible to
        # any other request, concurrent or subsequent.
        scratch_dir = Path(tempfile.mkdtemp(prefix=f"exec-{uuid.uuid4().hex}-", dir=SCRATCH_BASE))
        try:
            try:
                stdout, stderr, exit_code, timed_out = await asyncio.to_thread(
                    _run_sync, req.code, req.stdin, scratch_dir
                )
            except Exception as exc:  # noqa: BLE001 - must never crash the service itself
                logger.exception("sandbox execution failed unexpectedly")
                return ExecuteResponse(
                    stdout="", stderr=f"sandbox-runner internal error: {exc}", exit_code=-1, timed_out=False
                )
            return ExecuteResponse(stdout=stdout, stderr=stderr, exit_code=exit_code, timed_out=timed_out)
        finally:
            shutil.rmtree(scratch_dir, ignore_errors=True)


def _empty_run_code_response(mode: str, error: str) -> RunCodeResponse:
    return RunCodeResponse(
        ok=False,
        error=error,
        mode=mode,
        stdout="",
        stderr="",
        exit_code=-1,
        timed_out=False,
        tests=[],
        passed=0,
        failed=0,
        errors=0,
        skipped=0,
    )


@app.post("/run-code", response_model=RunCodeResponse)
async def run_code(req: RunCodeRequest) -> RunCodeResponse:
    """Runs a whole (possibly multi-file) Python submission, optionally under pytest.

    Shares `/execute`'s semaphore, so a burst of multi-file submissions can't run more
    concurrent sandboxed processes than the service already allows, and shares its
    per-request scratch dir lifecycle (fresh dir, wiped in `finally` whatever happens).
    Python-only by design -- see the module docstring's SCOPE note."""
    mode = "tests" if req.test_file is not None else "script"
    refusal = _validate_submission(req.files, req.entrypoint)
    if refusal is not None:
        return _empty_run_code_response(mode, f"sandbox-runner: {refusal}")

    async with _semaphore:
        scratch_dir = Path(tempfile.mkdtemp(prefix=f"runcode-{uuid.uuid4().hex}-", dir=SCRATCH_BASE))
        try:
            try:
                stdout, stderr, exit_code, timed_out, tests = await asyncio.to_thread(
                    _run_code_sync, req.files, req.entrypoint, req.test_file, req.stdin, scratch_dir
                )
            except Exception as exc:  # noqa: BLE001 - must never crash the service itself
                logger.exception("run-code execution failed unexpectedly")
                return _empty_run_code_response(mode, f"sandbox-runner internal error: {exc}")

            return RunCodeResponse(
                ok=True,
                error=None,
                mode=mode,
                stdout=stdout,
                stderr=stderr,
                exit_code=exit_code,
                timed_out=timed_out,
                tests=tests,
                passed=sum(1 for t in tests if t.outcome == "passed"),
                failed=sum(1 for t in tests if t.outcome == "failed"),
                errors=sum(1 for t in tests if t.outcome == "error"),
                skipped=sum(1 for t in tests if t.outcome == "skipped"),
            )
        finally:
            shutil.rmtree(scratch_dir, ignore_errors=True)


@app.post("/compile-latex", response_model=CompileLatexResponse)
async def compile_latex(req: CompileLatexRequest) -> CompileLatexResponse:
    if req.engine not in LATEX_ENGINES:
        return CompileLatexResponse(
            pdf_base64=None,
            log=f"sandbox-runner: unsupported engine '{req.engine}' (allowed: {sorted(LATEX_ENGINES)})",
            success=False,
            timed_out=False,
        )

    async with _latex_semaphore:
        # Same fresh-scratch-dir-per-request pattern as /execute above.
        scratch_dir = Path(tempfile.mkdtemp(prefix=f"latex-{uuid.uuid4().hex}-", dir=SCRATCH_BASE))
        try:
            try:
                pdf_bytes, log, timed_out, success = await asyncio.to_thread(
                    _run_latex_sync, req.tex, req.bib, req.engine, scratch_dir
                )
            except Exception as exc:  # noqa: BLE001 - must never crash the service itself
                logger.exception("latex compile failed unexpectedly")
                return CompileLatexResponse(
                    pdf_base64=None,
                    log=f"sandbox-runner internal error: {exc}",
                    success=False,
                    timed_out=False,
                )
            log = _truncate(log, LATEX_MAX_LOG_BYTES)
            pdf_base64 = base64.b64encode(pdf_bytes).decode("ascii") if pdf_bytes else None
            return CompileLatexResponse(pdf_base64=pdf_base64, log=log, success=success, timed_out=timed_out)
        finally:
            shutil.rmtree(scratch_dir, ignore_errors=True)
