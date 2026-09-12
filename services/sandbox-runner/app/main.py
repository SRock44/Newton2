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
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import resource
import shutil
import signal
import subprocess
import tempfile
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

SCRATCH_BASE.mkdir(parents=True, exist_ok=True)

_semaphore = asyncio.Semaphore(MAX_CONCURRENCY)

app = FastAPI(title="Newton sandbox-runner")


class ExecuteRequest(BaseModel):
    code: str
    stdin: str | None = None


class ExecuteResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
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
