# Sandbox runner

Executes untrusted, LLM-generated Python code on request, for the Code Interpreter tool
(`services/api/app/tools/code_interpreter.py`). `POST /execute` takes
`{"code": "...", "stdin": "..." (optional)}` and returns
`{"stdout": "...", "stderr": "...", "exit_code": N, "timed_out": bool}`. `GET /health`
is a plain liveness check.

`POST /run-code` is the multi-file sibling of `/execute`, backing the Check Code Work tool
(`services/api/app/tools/check_code_work.py`) -- see "Multi-file submissions" below.

`POST /compile-latex` compiles a LaTeX document (for the research-paper-writer feature's
LaTeX assembly step, called via `services/api/app/services/latex_compile.py`) under the
same isolation pattern as `/execute` -- see "LaTeX compilation" below.

## What this service does, and does not, isolate

This is **subprocess isolation inside a locked-down container**, not a hardware-virtualized
sandbox (gVisor/Firecracker/a fresh VM per request). Concretely:

- Submitted code runs as `python3 -I -c <code>` (isolated mode — no `PYTHONPATH`, no user
  site-packages, no implicit cwd on `sys.path`) as a **non-root** user (`sandbox`, uid
  10001, no shell), in a scratch directory unique to that request, removed the moment the
  request finishes.
- Real, kernel-enforced `resource.setrlimit` limits on the child (CPU time, address space,
  file size, open files, no core dumps, process count) — set via `preexec_fn`, so the
  kernel enforces them regardless of what the submitted code tries.
- An independent wall-clock watchdog (default ~10s) that `os.killpg()`s the child's entire
  process group — this is what catches code that's blocked/sleeping rather than
  CPU-bound, which a CPU-time rlimit alone would never see coming.
- Network egress blocking is a **container/network-level** control, not something this
  service enforces in Python — see "Required deployment shape" below. Do not deploy this
  service without that network topology; without it, submitted code has full outbound
  network access.

**What it does not stop:** a sufficiently sophisticated kernel-level exploit (a container
escape via a kernel vulnerability, side channels, etc.) is not ruled out by namespaces,
cgroups, dropped capabilities, and rlimits — those raise the bar a long way for
LLM-generated Python doing ordinary LLM-generated-Python things, but they are not the same
security boundary as a VM. If/when arbitrary or adversarial code execution needs a harder
guarantee than that, the next step up is a gVisor/Firecracker-class sandbox per execution,
not more rlimits on top of this one.

## Multi-file submissions (`POST /run-code`)

Runs a whole Python submission -- the student's own code, several files if need be --
and optionally runs a pytest test module against it, returning **real per-test results**.
This is what makes the API's `check_code_work` tool a verification tool rather than a
"looks right to me" one. Request:

```json
{
  "files": {"main.py": "...", "utils.py": "..."},
  "entrypoint": "main.py",
  "test_file": "<optional pytest module content>",
  "stdin": "<optional>"
}
```

Response:

```json
{
  "ok": true, "error": null, "mode": "tests" | "script",
  "stdout": "...", "stderr": "...", "exit_code": 0, "timed_out": false,
  "tests": [{"name": "test_newton_check.py::test_adds", "outcome": "passed",
             "phase": "call", "duration": 0.001, "message": ""}],
  "passed": 1, "failed": 0, "errors": 0, "skipped": 0
}
```

Key properties:

- **Identical limits to `/execute`, not looser ones.** Both endpoints go through the same
  `_run_limited` helper: same `_limit_child` rlimits, same `WALL_CLOCK_TIMEOUT_S`
  process-group watchdog, same per-request scratch dir wiped afterwards, same
  `_semaphore` concurrency cap. Unlike `/compile-latex`, `/run-code` gets **no** separate,
  more generous budget -- a multi-file submission is sandboxed exactly as tightly as a
  one-liner. `services/sandbox-runner/tests/test_sandbox_integration.py` asserts this
  directly (infinite loop, memory bomb and network egress, all re-run over `/run-code`).
- **`python3 -E -s`, not `python3 -I`.** The single difference is `-P`, which `-I`
  implies: `-P` keeps the script's own directory off `sys.path`, which would make
  `import utils` from `main.py` impossible -- i.e. would make multi-file submissions
  impossible. `-E` and `-s` are kept. The directory now on `sys.path` is a fresh scratch
  dir containing nothing but the caller's own submitted files, and the code being run is
  already arbitrary code from that same submission, so no real boundary moves.
- **Per-test results come from pytest itself.** A small plugin is generated into the
  scratch dir and loaded with `-p _newton_report`; it records each `nodeid`, outcome and
  `longrepr` from pytest's own report objects (plus collection failures, so a submission
  that doesn't even import still explains itself). Nothing screen-scrapes pytest's
  terminal output, and no third-party reporting plugin is added to the image. A
  submission can of course scribble on that results file -- it is untrusted code in the
  same directory -- so pytest's real process exit code is always returned alongside the
  rows; a tampered file shows up as an inconsistency, never as a fabricated "all passed".
- **Files are written byte-for-byte.** This service never edits, formats or repairs a
  submission. Filenames are validated segment by segment (no `..`, no absolute paths, no
  hidden segments, depth and count capped) and the handful of names the service writes
  itself (`test_newton_check.py`, `_newton_report.py`, `_newton_results.jsonl`) are
  reserved -- a submission using one is **refused**, never silently overwritten.

**Scope: Python only.** Java/C/C++/Rust submissions would need real compiler toolchains
(a JDK, gcc/clang, ...) in this image plus a per-language compile-then-run step with its
own failure modes and its own security review. That is a real, separate piece of work; it
is deliberately not attempted here, and nothing in this service or in `check_code_work`
claims to support it.

## LaTeX compilation (`POST /compile-latex`)

Compiles a LaTeX document for the research-paper-writer feature's LaTeX-assembly step.
Request:

```json
{"tex": "<main.tex content>", "bib": "<optional .bib content>", "engine": "pdflatex"}
```

Response:

```json
{"pdf_base64": "..." | null, "log": "<compiler output, truncated like /execute's stdout/stderr>", "success": bool, "timed_out": bool}
```

This extends the SAME isolation pattern described above rather than building a second
sandboxing mechanism: non-root, dropped capabilities, read-only root fs, a fresh
per-request scratch directory (`main.tex` + `refs.bib` if given, cleaned up after), real
`preexec_fn` rlimits, and a process-group wall-clock watchdog. It differs in exactly the
ways a LaTeX compile legitimately has to:

- **Independent, more generous limits.** A real multi-pass pdflatex+biber compile needs
  more wall-clock time, CPU time, open files (TeX Live searches several TEXMF trees for
  fonts/formats), and memory than a short Python script. Reusing `/execute`'s `SANDBOX_*`
  numbers would make every real compile fail, so `/compile-latex` has its own `LATEX_*`
  tunables (see table below), applied via the same `preexec_fn`/watchdog pattern, not a
  different mechanism.
- **`-no-shell-escape -interaction=nonstopmode -halt-on-error`, always, explicitly.**
  Shell-escape is off by default in a stock modern TeX Live, but LaTeX's `\write18` is
  arbitrary shell execution the moment shell-escape is ever enabled (a distro default
  change, a texmf.cnf edit, anything) — so this is never left to the default; it's on the
  command line of every single pdflatex invocation.
- **Standard multi-pass build.** `pdflatex` → (if a `.bib` was supplied) `biber` →
  `pdflatex` → `pdflatex` again, to resolve citations and cross-references, all sharing
  ONE wall-clock budget (`LATEX_WALL_CLOCK_TIMEOUT_S`) across every pass rather than
  restarting the clock per pass. `biber` (not classic `bibtex`) is used because that's
  what `biblatex` — what apa7 and IEEEtran-with-biblatex both actually use — expects.
  If the first pdflatex pass fails outright, later passes are skipped and its real error
  log is returned rather than continuing to run passes that can't succeed.
- **Engine allowlist.** The request's `engine` field is looked up in a small in-code
  dict (`LATEX_ENGINES`, currently just `{"pdflatex": "pdflatex"}`) rather than ever being
  interpolated into a subprocess command line directly — an unrecognized value is refused
  with a clear error, never passed through as a binary name to execute.
- **PDF size cap.** A compiled PDF over `LATEX_MAX_PDF_BYTES` (default 15MB) is treated
  as a failure (`success: false`) with a log line explaining why, rather than returned.
- **No network needed or granted.** All TeX packages are baked into the image at build
  time and the `.bib` is supplied directly in the request, so compilation needs no
  network access — the existing internal-only, no-internet-route network topology (see
  "Required deployment shape" below) is correct as-is for this endpoint too.
- **TeX Live via apt**, not the official net-installer, and a hand-picked package set
  (`texlive-latex-base`, `-recommended`, `-extra`, `texlive-fonts-recommended`,
  `texlive-publishers` for IEEEtran/acmart, `texlive-humanities` for apa7,
  `texlive-bibtex-extra`, and `biber`) — not `scheme-full`, which is multi-gigabyte and
  mostly unused here. See the Dockerfile for the exact package list.

## Required deployment shape (for whoever wires this into `infra/docker-compose.yml`)

This container **must** be deployed on an internal-only Docker network that has no route
to the internet and no route to any other service except the `api` container that calls
it — not postgres, not redis, not minio, not keycloak, not any other stack on the host.
It needs **zero published ports** — nothing outside the compose stack calls it directly,
only `api`, over the internal network, by service name.

```yaml
networks:
  newton_net:
    name: newton2_net
  sandbox_net:
    name: newton2_sandbox_net
    internal: true          # no gateway to the internet or the LAN — this is the load-bearing line

services:
  sandbox-runner:
    build: ../services/sandbox-runner
    restart: unless-stopped
    networks: [sandbox_net]        # NOT newton_net — must not reach postgres/redis/minio/keycloak
    cap_drop: [ALL]
    security_opt: [no-new-privileges]
    read_only: true
    tmpfs:
      - /tmp:size=128m,noexec,nosuid,nodev   # writable scratch space despite read_only root fs
    mem_limit: 300m
    pids_limit: 100
    # no `ports:` — only `api` talks to it, over sandbox_net, by service name

  api:
    networks: [newton_net, sandbox_net]   # add sandbox_net here so `api` can reach it
    environment:
      SANDBOX_RUNNER_URL: http://sandbox-runner:8000
```

`api` needs to be attached to *both* `newton_net` (for postgres/redis/minio/keycloak) and
`sandbox_net` (to reach this service) — `sandbox-runner` itself should be on `sandbox_net`
only, never on `newton_net`, so it has no path to any other service's data store even if
it were somehow compromised.

Also worth carrying over into the real compose file: `PYTHONDONTWRITEBYTECODE=1` and
`PYTHONUNBUFFERED=1` are already set in the Dockerfile (needed because the root filesystem
is read-only — there's nowhere for `.pyc` files to go), and a `HEALTHCHECK` hitting
`GET /health` is already baked into the image.

## Tunables (env vars, all optional — defaults are conservative)

| Var | Default | Meaning |
|---|---|---|
| `SANDBOX_WALL_CLOCK_TIMEOUT_S` | `10` | Hard wall-clock kill, independent of CPU usage |
| `SANDBOX_CPU_TIME_LIMIT_S` | `5` | `RLIMIT_CPU` for the child |
| `SANDBOX_AS_LIMIT_BYTES` | `268435456` (256MB) | `RLIMIT_AS` — address space cap |
| `SANDBOX_FSIZE_LIMIT_BYTES` | `10485760` (10MB) | `RLIMIT_FSIZE` — max file size the child can write |
| `SANDBOX_NOFILE_LIMIT` | `64` | `RLIMIT_NOFILE` — max open file descriptors |
| `SANDBOX_NPROC_LIMIT` | `32` | `RLIMIT_NPROC` — best-effort fork-bomb cap |
| `SANDBOX_MAX_OUTPUT_BYTES` | `1048576` (1MB) | stdout/stderr are truncated past this, so a chatty script can't blow up the response or this service's own memory |
| `SANDBOX_MAX_CONCURRENCY` | `4` | In-process semaphore capping concurrent executions |
| `SANDBOX_SCRATCH_BASE` | `/tmp/sandbox-scratch` | Base dir for per-request scratch directories — must be on a writable (tmpfs) mount |
| `LATEX_WALL_CLOCK_TIMEOUT_S` | `45` | Hard wall-clock kill for the WHOLE `/compile-latex` request (all passes combined), independent of `SANDBOX_WALL_CLOCK_TIMEOUT_S` |
| `LATEX_CPU_TIME_LIMIT_S` | `40` | `RLIMIT_CPU` per compiler step (pdflatex/biber) |
| `LATEX_AS_LIMIT_BYTES` | `1073741824` (1GB) | `RLIMIT_AS` for a compiler step |
| `LATEX_FSIZE_LIMIT_BYTES` | `31457280` (30MB) | `RLIMIT_FSIZE` for a compiler step (aux/log/pdf files) |
| `LATEX_NOFILE_LIMIT` | `512` | `RLIMIT_NOFILE` for a compiler step — TeX Live's font/format search opens far more files than a Python script ever would |
| `LATEX_NPROC_LIMIT` | `16` | `RLIMIT_NPROC` best-effort cap for a compiler step |
| `LATEX_MAX_LOG_BYTES` | `1048576` (1MB) | Combined compiler log is truncated past this, same reasoning as `SANDBOX_MAX_OUTPUT_BYTES` |
| `LATEX_MAX_PDF_BYTES` | `15728640` (15MB) | A compiled PDF over this size is reported as a failure rather than returned |
| `LATEX_MAX_CONCURRENCY` | `2` | Separate in-process semaphore for `/compile-latex`, independent of `SANDBOX_MAX_CONCURRENCY` so a burst of `/execute` calls can't starve compiles or vice versa |

## How this was tested

Built and ran standalone via plain `docker build`/`docker run` on the deployment host,
attached to a throwaway `docker network create --internal` network created and torn down
solely for this testing (no changes to the shared host's other running stacks) — see the
test suite in `tests/test_sandbox_integration.py` for exact scenarios and the project
history for the exact commands and captured output. Covered: normal execution, syntax and
runtime errors, a CPU-bound infinite loop (caught by `RLIMIT_CPU`), a blocking
`time.sleep()` infinite loop (only catchable by the wall-clock watchdog — proves the
watchdog is doing real work, not just the rlimit), a real outbound network attempt from
inside executed code (confirmed blocked because the test container itself had no route
out, on the same `--internal` network the production deployment requires), a multi-GB
allocation attempt (rejected via `RLIMIT_AS`, no host OOM), and back-to-back requests
proving no file-state leaks between them. All cases confirmed the service itself stayed
up and immediately served the next request — it never hung or crashed.

`/compile-latex` was verified the same way, against the real deployed image (not a
mocked compiler) — see `tests/test_latex_compile_integration.py` for exact scenarios:
a real successful compile in each of the IEEEtran and apa7 document classes, a compile
error from genuinely invalid LaTeX confirming the real compiler log comes back (not just
`success: false`), a `.bib`-driven citation actually resolving through the full
pdflatex→biber→pdflatex→pdflatex pass sequence, and back-to-back requests proving no
scratch-directory state leaks between them.
