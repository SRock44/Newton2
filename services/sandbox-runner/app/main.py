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
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import logging
import os
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


def _run_sync(code: str, stdin_data: str | None, scratch_dir: Path) -> tuple[str, str, int, bool]:
    """Blocking; must be run off the event loop (see `execute` below)."""
    proc = subprocess.Popen(
        ["python3", "-I", "-c", code],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(scratch_dir),
        # Minimal, explicit env — no leaking the sandbox-runner's own environment
        # (secrets, service URLs, etc.) into user-controlled code.
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(scratch_dir)},
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
