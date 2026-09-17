"""Newton artifact-runner: runs the real `opencode` coding agent (github.com/sst/opencode)
headless, inside a locked-down container, to actually write a self-contained HTML/CSS/JS
artifact for a student -- the "Claude spawns Claude Code" shape of Claude.ai's Artifacts,
with opencode standing in for Claude Code (see services/artifact-runner/README.md).

WHY THIS IS A SECOND SERVICE AND NOT A NEW ENDPOINT ON sandbox-runner
---------------------------------------------------------------------
Every instinct (and this codebase's own precedent -- /compile-latex was deliberately
added to sandbox-runner rather than built as a second sandbox) says this belongs on
sandbox-runner. It cannot go there, for exactly one hard reason: sandbox-runner sits on
`sandbox_net`, which is `internal: true`, and infra/docker-compose.yml calls that "the
load-bearing line for the code interpreter's isolation". It has no DNS and no route to
the internet -- confirmed live, not assumed. `opencode` is an LLM agent: its entire job
is calling OpenRouter over the public internet. Giving sandbox-runner egress so opencode
could run there would hand every piece of untrusted, LLM-generated Python the
code_interpreter tool ever executes a live exfiltration path. That trade is not worth
making, so this is a separate container on its own separate network, and sandbox-runner's
guarantee is left exactly as strong as it was.

What this service DOES reuse is sandbox-runner's isolation *pattern*, deliberately, line
for line where it applies -- the code below is the same shape as its `_run_sync`:

  1. Non-root (uid 10001, no shell), dropped capabilities, no-new-privileges, read-only
     container root filesystem, tmpfs scratch -- all container-level, see README.
  2. Real kernel-enforced `resource.setrlimit` limits applied in the child via
     `preexec_fn` (CPU time, address space, file size, open files, process count), with
     their own ARTIFACT_* tunables rather than reusing sandbox-runner's SANDBOX_* or
     LATEX_* numbers -- a real agentic run legitimately needs far more of all of them
     than a short Python script does, exactly the reasoning /compile-latex's LATEX_*
     tunables already follow.
  3. A wall-clock watchdog independent of those rlimits that SIGKILLs the whole process
     group, because an agent waiting on a slow HTTP response burns no CPU time at all
     and would sail straight past RLIMIT_CPU.
  4. A fresh throwaway scratch directory per request, which is ALSO the run's $HOME --
     so opencode's own config, session state, auth and cache live and die with the one
     request, and nothing (including a half-written artifact) survives into the next.

ADDITIONALLY, opencode itself is locked down from the inside, via the opencode.json this
service writes per run (see _write_opencode_config): every tool except read/edit/write/
glob/grep is disabled and every permission except those is "deny". That matters because
this container, unlike sandbox-runner, CAN reach the internet: without it, a
prompt-injected model could run arbitrary shell commands here with real egress. With it,
the only thing the agent can do in this container is write files into its own scratch
directory. See the README's "Limitations" for the honest version of what that is and
isn't worth.

SELF-CORRECTION is real but bounded and deterministic-checker-driven: after the first
run, `_validate_html` checks what actually landed on disk (does it exist, is it real
HTML, is it self-contained, is it within the size cap). If it fails, ONE more opencode
turn runs via `--continue` with the exact validation failures as its prompt. The checker
is ours, not the model's opinion of its own work -- the model never gets to declare
success on its own say-so.
"""

from __future__ import annotations

import asyncio
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
logger = logging.getLogger("artifact_runner")

# --- Tunables (env-overridable) -----------------------------------------------------
# Deliberately independent of sandbox-runner's SANDBOX_*/LATEX_* numbers (this service
# doesn't share a process with it anyway) -- a multi-turn agentic run that makes real
# network calls to an inference provider needs a wall-clock budget in minutes, not the
# ~10s a short Python script gets.
WALL_CLOCK_TIMEOUT_S = float(os.environ.get("ARTIFACT_WALL_CLOCK_TIMEOUT_S", "300"))
# RLIMIT_CPU is per-process CPU *seconds actually burned*. An opencode run spends nearly
# all of its wall-clock time blocked on OpenRouter, so this is far below the wall-clock
# budget on purpose: it catches a runaway spin, while the watchdog catches a hang.
CPU_TIME_LIMIT_S = int(os.environ.get("ARTIFACT_CPU_TIME_LIMIT_S", "120"))
# DELIBERATELY UNSET (0 = don't apply), unlike sandbox-runner's RLIMIT_AS, and this is
# NOT an oversight -- it was tried at 2GB first and it broke every single build. opencode
# ships as a Bun binary, and JavaScriptCore RESERVES many gigabytes of *virtual* address
# space up front for its GC heap and JIT regions regardless of how little it actually
# touches. RLIMIT_AS caps virtual address space, not resident memory, so any value low
# enough to be a meaningful limit kills the runtime outright:
#
#   ASSERTION FAILED: MemoryExhaustion: Crash intentionally because memory is exhausted.
#   vendor/WebKit/Source/JavaScriptCore/heap/LocalAllocator.cpp(150)
#
# -- observed live, on a build that then reported "You did not create artifact.html".
# The correct control for a JIT runtime's real memory use is the container's cgroup
# memory limit (`mem_limit: 1g` in infra/docker-compose.yml), which bounds RESIDENT
# memory and lets the kernel OOM-kill the process group if it genuinely grows. That is
# a real, kernel-enforced limit -- this is a change of mechanism, not a removal of one.
# Set ARTIFACT_AS_LIMIT_BYTES to a positive value to re-enable the rlimit anyway.
ADDRESS_SPACE_LIMIT_BYTES = int(os.environ.get("ARTIFACT_AS_LIMIT_BYTES", "0"))
FILE_SIZE_LIMIT_BYTES = int(os.environ.get("ARTIFACT_FSIZE_LIMIT_BYTES", str(20 * 1024 * 1024)))
# A Node/Bun runtime opens a lot more file descriptors than a plain python3 -c does --
# same reasoning as LATEX_NOFILE_LIMIT being far above SANDBOX_NOFILE_LIMIT.
OPEN_FILES_LIMIT = int(os.environ.get("ARTIFACT_NOFILE_LIMIT", "4096"))
NPROC_LIMIT = int(os.environ.get("ARTIFACT_NPROC_LIMIT", "256"))
MAX_LOG_BYTES = int(os.environ.get("ARTIFACT_MAX_LOG_BYTES", str(256 * 1024)))
# The artifact is embedded in an <iframe srcdoc> in the desktop app and stored as a real
# Document row -- a multi-megabyte page would be a bug, not a feature.
MAX_HTML_BYTES = int(os.environ.get("ARTIFACT_MAX_HTML_BYTES", str(512 * 1024)))
SCRATCH_BASE = Path(os.environ.get("ARTIFACT_SCRATCH_BASE", "/tmp/artifact-scratch"))
# One at a time by default: each run is a real agentic process with a Node-class memory
# footprint, and this container has a hard mem_limit. Two concurrent runs is a much
# better way to get OOM-killed than to get two artifacts.
MAX_CONCURRENCY = int(os.environ.get("ARTIFACT_MAX_CONCURRENCY", "1"))
# Total opencode turns per request: the first attempt, plus at most this many validator-
# driven correction turns. Every extra turn is real OpenRouter spend billed to a real
# student (see app/tools/create_artifact.py's metering), so this is small on purpose.
MAX_CORRECTION_ATTEMPTS = int(os.environ.get("ARTIFACT_MAX_CORRECTION_ATTEMPTS", "1"))

OPENCODE_BIN = os.environ.get("ARTIFACT_OPENCODE_BIN", "opencode")
# Fully-qualified "<opencode provider>/<model id>" -- the API layer passes the model in
# on every request (from app/core/config.py's openrouter_model, the same identifier
# app/services/billing.py prices), so the model this app uses is decided in ONE place
# and never drifts between the chat path and the artifact path. This is only the
# fallback for a direct call that omits it.
DEFAULT_MODEL = os.environ.get("ARTIFACT_MODEL", "deepseek/deepseek-v4-flash-0731")

ARTIFACT_FILENAME = "artifact.html"

SCRATCH_BASE.mkdir(parents=True, exist_ok=True)

_semaphore = asyncio.Semaphore(MAX_CONCURRENCY)

app = FastAPI(title="Newton artifact-runner")


class BuildArtifactRequest(BaseModel):
    # The detailed coding brief an artifact-agent persona produced (see
    # app/tools/create_artifact.py). This service never talks to a persona itself -- it
    # is handed a finished brief and runs the coding agent against it.
    brief: str
    model: str = DEFAULT_MODEL


class BuildArtifactResponse(BaseModel):
    html: str | None
    success: bool
    timed_out: bool
    log: str
    # Real token counts summed from opencode's own `step_finish` events (--format json),
    # not an estimate -- this is what app/tools/create_artifact.py charges the student's
    # credit ledger with, via the same billing.record_frontier_usage every metered call
    # in this app goes through.
    input_tokens: int
    output_tokens: int
    # How many opencode turns actually ran (1 = first try was already valid).
    attempts: int
    # Which validator complaints, if any, the final artifact still had. Empty on success.
    problems: list[str]


# --- opencode configuration written per run ------------------------------------------

# Every tool that could reach the shell or the network is denied. `bash` is the one that
# matters most: this container has real internet egress (it has to -- opencode calls
# OpenRouter), so an agent with shell access here would be an arbitrary-code-execution-
# with-network surface driven by a student-supplied prompt. Disabled at BOTH layers
# opencode offers, deliberately: `tools` stops the tool being offered to the model at
# all, `permission` (below) denies it even if a future opencode version reintroduces it
# under a different name via the "*" default.
#
# THIS LIST IS EXACTLY THE FOUR TOOLS BELOW, AND IT IS EMPIRICAL, NOT CAUTIOUS-BY-
# DEFAULT. It was first written with "patch", "todowrite" and "todoread" disabled too,
# on the reasoning that an artifact build has no use for any of them. That silently
# BROKE the feature: opencode ran to completion, reported success, burned real tokens,
# and never wrote the file -- no error anywhere. Isolated by bisecting the config
# against a live container (four runs, one variable each: rich vs. minimal env, with
# vs. without the rlimit preexec_fn, full vs. minimal tools list) -- only the tools
# list mattered, and the minimal list wrote the file every time. Do not add tools back
# to this list without re-running that check: opencode's own file-writing flow depends
# on more of its default tool set than it looks like it should.
_DENIED_TOOLS = ("bash", "webfetch", "websearch", "task")


def _opencode_config(model: str) -> dict:
    return {
        "$schema": "https://opencode.ai/config.json",
        "model": f"openrouter/{model}",
        # Never let the agent update its own binary mid-run, and never let a student's
        # artifact session get shared to opencode's public share service.
        "autoupdate": False,
        "share": "disabled",
        "permission": {
            "*": "deny",
            "read": "allow",
            "edit": "allow",
            "glob": "allow",
            "grep": "allow",
        },
        "tools": {name: False for name in _DENIED_TOOLS},
        "provider": {"openrouter": {"models": {model: {}}}},
    }


def _write_opencode_config(scratch_dir: Path, model: str) -> None:
    (scratch_dir / "opencode.json").write_text(json.dumps(_opencode_config(model), indent=2), encoding="utf-8")


def _build_prompt(brief: str) -> str:
    """The file-level contract wrapped around the persona's brief. The brief itself owns
    all the pedagogical/design direction (see app/tools/create_artifact.py's personas);
    this only states the mechanical requirements the validator below actually enforces,
    so the agent is told the rules it will be checked against rather than being failed
    for something it was never asked to do."""
    return (
        f"Write a single file named `{ARTIFACT_FILENAME}` in the current directory.\n\n"
        "HARD REQUIREMENTS (these are checked automatically after you finish):\n"
        f"- The file must be named exactly `{ARTIFACT_FILENAME}`.\n"
        "- It must be ONE complete, self-contained HTML document: a `<!DOCTYPE html>`, "
        "all CSS in an inline `<style>` tag, all JavaScript in an inline `<script>` tag.\n"
        "- NO external resources of any kind: no CDN script or stylesheet tags, no "
        "web fonts, no external images, no fetch()/XMLHttpRequest calls to any URL. "
        "Everything it needs must be in the file. Draw graphics with inline SVG, "
        "canvas, or CSS rather than loading an image.\n"
        f"- Keep the finished file under {MAX_HTML_BYTES // 1024} KB.\n"
        "- It renders inside a sandboxed iframe with no access to storage or cookies, "
        "so do not use localStorage, sessionStorage, cookies, or `window.parent`. "
        "Hold state in ordinary JavaScript variables.\n"
        "- It must work at narrow widths (down to about 360px) as well as wide ones.\n\n"
        "THE BRIEF:\n\n"
        f"{brief}\n\n"
        f"Write `{ARTIFACT_FILENAME}` now. Do not create any other files."
    )


# --- Validation (ours, not the model's self-assessment) ------------------------------

# Matches an attribute that points at something off-box: src="http://...", href='//cdn...',
# and the url(http...) form a stylesheet would use. Deliberately narrow -- it looks for a
# real remote scheme or protocol-relative prefix, so ordinary in-document references
# (href="#section", src="data:image/svg+xml,...") don't trip it.
_EXTERNAL_REF_RE = re.compile(
    r"""(?:src|href)\s*=\s*["']\s*(?:https?:)?//|url\(\s*["']?\s*(?:https?:)?//""",
    re.IGNORECASE,
)
_NETWORK_CALL_RE = re.compile(r"\b(?:fetch\s*\(|XMLHttpRequest|importScripts\s*\()", re.IGNORECASE)
_STORAGE_RE = re.compile(r"\b(?:localStorage|sessionStorage|document\.cookie)\b")


def _validate_html(raw: str | None) -> list[str]:
    """Concrete, mechanical problems with what the agent actually wrote -- each phrased
    as an instruction, because this list is fed straight back to opencode as the
    correction turn's prompt. Empty list means the artifact passed."""
    problems: list[str] = []
    if raw is None:
        return [f"You did not create `{ARTIFACT_FILENAME}` in the current directory. Create it."]
    if not raw.strip():
        return [f"`{ARTIFACT_FILENAME}` is empty. Write the full HTML document into it."]

    lowered = raw.lower()
    if "<html" not in lowered:
        problems.append(f"`{ARTIFACT_FILENAME}` has no `<html>` element -- it must be a complete HTML document.")
    if "<!doctype" not in lowered:
        problems.append(f"`{ARTIFACT_FILENAME}` is missing its `<!DOCTYPE html>` declaration. Add it.")

    size = len(raw.encode("utf-8"))
    if size > MAX_HTML_BYTES:
        problems.append(
            f"`{ARTIFACT_FILENAME}` is {size // 1024} KB, over the {MAX_HTML_BYTES // 1024} KB limit. "
            "Cut it down -- simplify the content or the styling, don't just delete the ending."
        )

    if _EXTERNAL_REF_RE.search(raw):
        problems.append(
            "The file references at least one external URL (a CDN script/stylesheet, a web font, or a "
            "remote image). It must be fully self-contained: inline the code, or replace the asset with "
            "inline SVG/canvas/CSS."
        )
    if _NETWORK_CALL_RE.search(raw):
        problems.append(
            "The file makes a network call (fetch/XMLHttpRequest/importScripts). It runs offline in a "
            "sandboxed iframe -- remove the call and use data written directly into the file instead."
        )
    if _STORAGE_RE.search(raw):
        problems.append(
            "The file uses localStorage/sessionStorage/cookies, which throw in the sandboxed iframe this "
            "renders in. Hold that state in plain JavaScript variables instead."
        )
    return problems


# --- Process execution (sandbox-runner's pattern) ------------------------------------


def _limit_child() -> None:
    """Runs in the child after fork(), before exec() -- i.e. as `preexec_fn`, exactly as
    sandbox-runner's `_limit_child`/`_limit_latex_child` do. Kernel-enforced and
    inherited by anything the child forks. `start_new_session=True` on the Popen call
    (done by the caller) puts the child in its own process group so the watchdog can
    SIGKILL the whole tree, not just the one pid."""
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (CPU_TIME_LIMIT_S, CPU_TIME_LIMIT_S))
    # Skipped by default -- see ADDRESS_SPACE_LIMIT_BYTES above for why capping VIRTUAL
    # address space kills a JIT runtime, and what enforces real memory use instead.
    if ADDRESS_SPACE_LIMIT_BYTES > 0:
        resource.setrlimit(resource.RLIMIT_AS, (ADDRESS_SPACE_LIMIT_BYTES, ADDRESS_SPACE_LIMIT_BYTES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (FILE_SIZE_LIMIT_BYTES, FILE_SIZE_LIMIT_BYTES))
    resource.setrlimit(resource.RLIMIT_NOFILE, (OPEN_FILES_LIMIT, OPEN_FILES_LIMIT))
    with contextlib.suppress(ValueError, OSError):
        resource.setrlimit(resource.RLIMIT_NPROC, (NPROC_LIMIT, NPROC_LIMIT))


def _truncate(text: str, limit: int) -> str:
    if len(text.encode("utf-8", errors="ignore")) <= limit:
        return text
    encoded = text.encode("utf-8", errors="ignore")[:limit]
    return encoded.decode("utf-8", errors="ignore") + "\n...[truncated]"


def _child_env(scratch_dir: Path) -> dict[str, str]:
    """A minimal, explicit environment -- the same "never leak this service's own env
    into the child" rule sandbox-runner follows, with exactly one deliberate exception:
    OPENROUTER_API_KEY, which opencode reads to authenticate (models.dev lists it as
    OpenRouter's credential env var, confirmed live). That is the whole point of this
    container, and it is the same key app/providers/registry.py already uses for every
    other model call this app makes -- one credential, not a second parallel
    integration. Note what is NOT here: no DATABASE_URL, no MinIO/Keycloak/Stripe
    secrets. Those aren't withheld by choice alone -- this container isn't on
    `newton_net`, so it has no route to any of those services either way."""
    env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": str(scratch_dir),
        # opencode stores config/auth/session state under the XDG dirs; pinning them
        # inside the per-request scratch dir is what makes a run leave nothing behind.
        "XDG_CONFIG_HOME": str(scratch_dir / ".config"),
        "XDG_DATA_HOME": str(scratch_dir / ".local" / "share"),
        "XDG_CACHE_HOME": str(scratch_dir / ".cache"),
        "XDG_STATE_HOME": str(scratch_dir / ".local" / "state"),
        # Never let the agent's own runtime try to open a TTY or a pager.
        "CI": "1",
        "TERM": "dumb",
        "NO_COLOR": "1",
    }
    key = os.environ.get("OPENROUTER_API_KEY")
    if key:
        env["OPENROUTER_API_KEY"] = key
    return env


def _run_opencode(args: list[str], scratch_dir: Path, timeout: float) -> tuple[str, str, int, bool]:
    """One opencode invocation under the process-group wall-clock watchdog -- blocking,
    must be run off the event loop. Same shape as sandbox-runner's `_run_compiler_step`."""
    proc = subprocess.Popen(
        args,
        stdin=subprocess.DEVNULL,  # no TTY, and nothing to read -- `opencode run` is headless
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(scratch_dir),
        env=_child_env(scratch_dir),
        preexec_fn=_limit_child,
        start_new_session=True,
        text=True,
    )

    timed_out = False
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
        exit_code = proc.returncode
    except subprocess.TimeoutExpired:
        timed_out = True
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        try:
            stdout, stderr = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = "", "[artifact-runner: process group did not exit after SIGKILL]"
        exit_code = proc.returncode if proc.returncode is not None else -9

    return stdout or "", stderr or "", exit_code, timed_out


def _sum_tokens(stdout: str) -> tuple[int, int]:
    """Real prompt/completion token totals from opencode's `--format json` NDJSON
    stream: every `step_finish` event carries a `part.tokens.{input,output}` object.
    Summed across steps because one `opencode run` turn is several model steps (tool
    call, then final message). Unparseable lines are skipped rather than failing the
    whole build -- a token count is for billing accuracy, not correctness, and returning
    0 for an artifact that really was produced would silently under-charge, which is
    why the caller treats a 0 total as "no usage reported" and says so."""
    input_tokens = 0
    output_tokens = 0
    for line in stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except ValueError:
            continue
        tokens = (event.get("part") or {}).get("tokens")
        if not isinstance(tokens, dict):
            continue
        with contextlib.suppress(TypeError, ValueError):
            input_tokens += int(tokens.get("input") or 0)
            output_tokens += int(tokens.get("output") or 0)
    return input_tokens, output_tokens


def _read_artifact(scratch_dir: Path) -> str | None:
    path = scratch_dir / ARTIFACT_FILENAME
    if not path.is_file():
        return None
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    # Hard-cap the read itself, not just the validation: the rlimit bounds what the child
    # could write, but this service should never load an unbounded file into memory to
    # decide it was too big. Read the cap plus one byte so oversize is still detectable.
    if len(raw) > MAX_HTML_BYTES * 2:
        raw = raw[: MAX_HTML_BYTES * 2]
    return raw.decode("utf-8", errors="replace")


def _build_sync(brief: str, model: str, scratch_dir: Path) -> BuildArtifactResponse:
    """Blocking; must be run off the event loop. The full attempt -> validate ->
    correct -> validate loop, all sharing ONE wall-clock budget (the same
    "a slow first pass can't buy the later passes extra time" rule sandbox-runner's
    multi-pass LaTeX build follows)."""
    _write_opencode_config(scratch_dir, model)

    qualified_model = f"openrouter/{model}"
    log_parts: list[str] = []
    deadline = time.monotonic() + WALL_CLOCK_TIMEOUT_S
    input_tokens = 0
    output_tokens = 0
    timed_out = False
    attempts = 0
    problems: list[str] = []

    prompt = _build_prompt(brief)
    for attempt in range(MAX_CORRECTION_ATTEMPTS + 1):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            timed_out = True
            log_parts.append("[artifact-runner: wall-clock budget exhausted before this attempt could run]")
            break

        args = [OPENCODE_BIN, "run", "--format", "json", "--model", qualified_model]
        if attempt > 0:
            # Continue the SAME opencode session rather than starting fresh: the agent
            # keeps the file it already wrote and its own reasoning about it in context,
            # so a correction turn is a real revision instead of a blind rewrite. The
            # session lives in this request's scratch $HOME, so there is no chance of
            # picking up some other request's session.
            args.append("--continue")
        args.append(prompt)

        attempts += 1
        stdout, stderr, exit_code, step_timed_out = _run_opencode(args, scratch_dir, remaining)
        input_delta, output_delta = _sum_tokens(stdout)
        input_tokens += input_delta
        output_tokens += output_delta
        log_parts.append(
            f"$ opencode run (attempt {attempts}, exit {exit_code})\n"
            f"{_summarize_events(stdout)}{stderr}"
        )

        if step_timed_out:
            timed_out = True
            break

        problems = _validate_html(_read_artifact(scratch_dir))
        if not problems:
            break
        log_parts.append("[artifact-runner: validation failed]\n- " + "\n- ".join(problems))
        # The correction turn's prompt is the validator's own complaints, verbatim.
        prompt = (
            f"The `{ARTIFACT_FILENAME}` you wrote did not pass validation. Fix exactly these problems, "
            "keeping everything that already works:\n\n- "
            + "\n- ".join(problems)
            + f"\n\nRewrite `{ARTIFACT_FILENAME}` with those fixed."
        )

    html = _read_artifact(scratch_dir)
    problems = _validate_html(html)
    success = not timed_out and not problems and html is not None

    return BuildArtifactResponse(
        html=html if success else None,
        success=success,
        timed_out=timed_out,
        log=_truncate("\n".join(log_parts), MAX_LOG_BYTES),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        attempts=attempts,
        problems=problems,
    )


def _summarize_events(stdout: str) -> str:
    """opencode's `--format json` stream is NDJSON with full message parts inline, which
    would make the returned log enormous (and would echo the whole artifact back inside
    the write tool's arguments). Reduce it to one line per event with just the type and
    the tool name, which is what's actually useful when diagnosing a failed build."""
    lines: list[str] = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            if line:
                lines.append(line)
            continue
        try:
            event = json.loads(line)
        except ValueError:
            continue
        kind = event.get("type", "?")
        part = event.get("part") or {}
        if kind == "tool_use":
            lines.append(f"  {kind}: {part.get('tool')}")
        elif kind == "step_finish":
            tokens = part.get("tokens") or {}
            lines.append(
                f"  {kind}: reason={part.get('reason')} "
                f"in={tokens.get('input')} out={tokens.get('output')}"
            )
        elif kind == "text":
            lines.append(f"  {kind}: {str(part.get('text') or '')[:300]}")
        else:
            lines.append(f"  {kind}")
    return "\n".join(lines) + "\n"


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/build-artifact", response_model=BuildArtifactResponse)
async def build_artifact(req: BuildArtifactRequest) -> BuildArtifactResponse:
    if not req.brief.strip():
        return BuildArtifactResponse(
            html=None,
            success=False,
            timed_out=False,
            log="artifact-runner: empty brief",
            input_tokens=0,
            output_tokens=0,
            attempts=0,
            problems=["No brief was supplied."],
        )

    async with _semaphore:
        # Fresh scratch dir per request, which is also the run's $HOME -- see the module
        # docstring. Removed in `finally` so nothing (artifact, opencode session, auth
        # file, cache) outlives the request even if the build crashed partway.
        scratch_dir = Path(tempfile.mkdtemp(prefix=f"artifact-{uuid.uuid4().hex}-", dir=SCRATCH_BASE))
        try:
            try:
                return await asyncio.to_thread(_build_sync, req.brief, req.model, scratch_dir)
            except Exception as exc:  # noqa: BLE001 - must never crash the service itself
                logger.exception("artifact build failed unexpectedly")
                return BuildArtifactResponse(
                    html=None,
                    success=False,
                    timed_out=False,
                    log=f"artifact-runner internal error: {exc}",
                    input_tokens=0,
                    output_tokens=0,
                    attempts=0,
                    problems=[f"Internal error: {exc}"],
                )
        finally:
            shutil.rmtree(scratch_dir, ignore_errors=True)
