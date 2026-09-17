# Artifact runner

Runs the real [`opencode`](https://github.com/sst/opencode) coding agent, headless, to
actually write a self-contained HTML/CSS/JS artifact from a coding brief — the execution
half of Newton's Artifacts feature (`services/api/app/tools/create_artifact.py` produces
the brief; `services/api/app/services/artifact_build.py` is the client for this service).

`POST /build-artifact` takes `{"brief": "...", "model": "deepseek/deepseek-v4-flash-0731"}`
and returns:

```json
{
  "html": "<!DOCTYPE html>…" | null,
  "success": true,
  "timed_out": false,
  "log": "<summarized opencode event stream>",
  "input_tokens": 12043,
  "output_tokens": 2891,
  "attempts": 1,
  "problems": []
}
```

`GET /health` is a plain liveness check.

## Why this is a separate service from `sandbox-runner`

It should not be, and every other instinct in this repo says it should not be — the
LaTeX compiler was deliberately added to `sandbox-runner` as a second endpoint rather
than built as a second sandbox. There is exactly one reason it cannot be here:

`sandbox-runner` sits on `sandbox_net`, which is `internal: true`. `infra/docker-compose.yml`
calls that **"the load-bearing line for the code interpreter's isolation"**, and it is
real: that container has no DNS and no route off the box (verified live — a
`gethostbyname("openrouter.ai")` inside it fails with `Temporary failure in name
resolution`). `opencode` is an LLM agent whose entire job is calling OpenRouter over the
public internet. Adding egress to `sandbox-runner` so it could run there would hand every
piece of untrusted LLM-generated Python that `code_interpreter` executes a live
exfiltration path, in exchange for saving one container. That trade is not worth making.

So: a second container, on its own `artifact_net`, which has internet egress but — like
`sandbox_net` — **no route to `newton_net`**, and therefore no route to postgres, redis,
MinIO, or Keycloak. `sandbox-runner`'s guarantee is left exactly as strong as it was.

Everything else here is `sandbox-runner`'s pattern, reused rather than reinvented:
non-root uid 10001, `cap_drop: ALL`, `no-new-privileges`, a read-only container root
filesystem, a tmpfs scratch mount, real `resource.setrlimit` limits applied via
`preexec_fn`, a wall-clock watchdog that `os.killpg()`s the whole process group, a fresh
throwaway scratch directory per request, and an in-process concurrency semaphore. The
limits have their own `ARTIFACT_*` tunables rather than reusing `SANDBOX_*`, for exactly
the reason `/compile-latex` has its own `LATEX_*` ones: a real agentic run needs a
wall-clock budget in minutes and a Node-class memory/fd footprint, and reusing the
tighter numbers would just make every build fail.

## The second isolation layer: opencode's own config

This container *can* reach the internet, so the process-level sandbox is not the whole
story. Every run writes a fresh `opencode.json` into its scratch directory
(`app/main.py`'s `_opencode_config`) that disables everything the agent does not need:

```json
{
  "permission": { "*": "deny", "read": "allow", "edit": "allow", "glob": "allow", "grep": "allow" },
  "tools": { "bash": false, "webfetch": false, "websearch": false, "task": false },
  "autoupdate": false,
  "share": "disabled"
}
```

That `tools` list is exactly four entries and that is **empirical, not conservative**.
It was first written with `patch`, `todowrite` and `todoread` disabled as well — nothing
an artifact build should need. That silently broke the feature: opencode ran to
completion, reported success, spent real tokens, and never wrote the file, with no error
anywhere. Bisected against a live container (four runs, one variable each: rich vs.
minimal child env, with vs. without the rlimit `preexec_fn`, full vs. minimal tools
list); only the tools list mattered. Don't extend this list without re-running that
check.

`bash` is the one that matters: without it disabled, a prompt-injected model would have
arbitrary shell execution in a container with real network egress, driven by text a
student typed. Both knobs are set — `tools` stops it being offered to the model at all,
`permission: {"*": "deny"}` denies anything a future opencode version might reintroduce
under a different name. `autoupdate: false` stops the agent replacing its own pinned
binary mid-run; `share: "disabled"` stops a student's session being posted to opencode's
public share service.

The run's `$HOME` is the per-request scratch directory, with every `XDG_*` dir pointed
inside it, so opencode's config, credentials, session state and cache are created and
destroyed with the single request. The child's environment is otherwise minimal and
explicit (`PATH`, `HOME`, `XDG_*`, `CI=1`, `TERM=dumb`), with one deliberate exception:
`OPENROUTER_API_KEY` — the same key `services/api/app/providers/registry.py` already uses
for every other model call this app makes. One credential, not a second parallel
OpenRouter integration.

## Validation and self-correction

The model never declares its own success. After each opencode turn, `_validate_html`
checks what actually landed on disk: the file exists and is non-empty, it has a
`<!DOCTYPE>` and an `<html>` element, it is within `ARTIFACT_MAX_HTML_BYTES`, and it is
genuinely self-contained — no `src=`/`href=`/`url()` pointing at `http(s)://` or `//`, no
`fetch`/`XMLHttpRequest`/`importScripts`, and no `localStorage`/`sessionStorage`/
`document.cookie` (all three throw in the `sandbox="allow-scripts"` iframe the desktop app
renders these in — see `apps/desktop/src/components/ArtifactBlock.tsx`).

If validation fails, **one** more turn runs via `opencode run --continue` whose prompt is
the validator's own complaints, verbatim — a real revision of the file the agent already
wrote, in the same session, not a blind rewrite. Every extra turn is real OpenRouter spend
billed to a real student, so the retry budget (`ARTIFACT_MAX_CORRECTION_ATTEMPTS`) is 1 by
default, and all attempts share ONE wall-clock budget so a slow first attempt cannot buy
the correction turn extra time.

## Why `RLIMIT_AS` is not used here (when `sandbox-runner` does use it)

It was, at 2GB, and it broke **every** build. `opencode` ships as a Bun binary, and
JavaScriptCore reserves many gigabytes of *virtual* address space up front for its GC
heap and JIT regions no matter how little it actually touches. `RLIMIT_AS` caps virtual
address space, not resident memory, so any value low enough to mean anything kills the
runtime on startup:

```
ASSERTION FAILED: MemoryExhaustion: Crash intentionally because memory is exhausted.
vendor/WebKit/Source/JavaScriptCore/heap/LocalAllocator.cpp(150)
```

— observed live, on a build that then reported `You did not create artifact.html`. The
right control for a JIT runtime's real memory use is the container's **cgroup memory
limit** (`mem_limit: 1g`), which bounds *resident* memory and lets the kernel OOM-kill
the process group if it genuinely grows. That is still a real, kernel-enforced limit;
this is a change of mechanism, not a removal of one. Every other rlimit
(`RLIMIT_CPU`/`FSIZE`/`NOFILE`/`NPROC`/`CORE`) is applied exactly as `sandbox-runner`
applies it.

## Limitations (the honest version)

- **This container has internet egress.** That is unavoidable — the agent has to call
  OpenRouter. It is mitigated by disabling every opencode tool that could use the network
  or the shell, by being non-root with no capabilities, and by having no route to any
  other Newton service. It is not eliminated. The realistic residual risk is a
  prompt-injected model writing *something other than what the student asked for* into
  `artifact.html`; the frontend's `sandbox="allow-scripts"` iframe (no
  `allow-same-origin`) is the control for that, and it is the load-bearing one — artifact
  JavaScript runs in an opaque origin and can never read the app's token, localStorage, or
  cookies.
- `/tmp` is mounted `noexec` here exactly as it is for `sandbox-runner` (verified: a real
  opencode run works fine under it), so nothing the agent writes into its scratch
  directory can ever be executed as a binary.
- Same as `sandbox-runner`: this is namespace/cgroup + rlimit isolation, not a
  hardware-virtualized sandbox. A kernel-level container escape is not ruled out by it.

## Required deployment shape

```yaml
networks:
  artifact_net:
    name: newton2_artifact_net
    # NOT internal: opencode must reach openrouter.ai. Still separate from newton_net,
    # so this container has no route to postgres/redis/minio/keycloak.

services:
  artifact-runner:
    build: ../services/artifact-runner
    networks: [artifact_net]
    environment:
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY:-}
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    read_only: true
    tmpfs:
      - /tmp:size=512m,nosuid,nodev   # noexec by Docker default, and verified to work
    mem_limit: 1g
    pids_limit: 512
    # no ports: — only `api`, over artifact_net, ever calls this

  api:
    networks: [newton_net, sandbox_net, artifact_net]
    environment:
      ARTIFACT_RUNNER_URL: http://artifact-runner:8000
```

## Tunables (env vars, all optional)

| Var | Default | Meaning |
|---|---|---|
| `ARTIFACT_WALL_CLOCK_TIMEOUT_S` | `300` | Hard wall-clock kill for the WHOLE request (all opencode turns combined) |
| `ARTIFACT_CPU_TIME_LIMIT_S` | `120` | `RLIMIT_CPU` per opencode turn — far below the wall-clock budget on purpose, since an agent spends most of its time blocked on the network |
| `ARTIFACT_AS_LIMIT_BYTES` | `0` (not applied) | `RLIMIT_AS`. Deliberately off — see "Why `RLIMIT_AS` is not used here" below |
| `ARTIFACT_FSIZE_LIMIT_BYTES` | `20971520` (20MB) | `RLIMIT_FSIZE` |
| `ARTIFACT_NOFILE_LIMIT` | `4096` | `RLIMIT_NOFILE` — a Node runtime opens far more fds than `python3 -c` |
| `ARTIFACT_NPROC_LIMIT` | `256` | `RLIMIT_NPROC`, best-effort |
| `ARTIFACT_MAX_HTML_BYTES` | `524288` (512KB) | An artifact over this fails validation |
| `ARTIFACT_MAX_LOG_BYTES` | `262144` (256KB) | Returned log is truncated past this |
| `ARTIFACT_MAX_CONCURRENCY` | `1` | In-process semaphore — each run is a real agentic process with a Node-class footprint |
| `ARTIFACT_MAX_CORRECTION_ATTEMPTS` | `1` | Validator-driven correction turns after the first attempt |
| `ARTIFACT_MODEL` | `deepseek/deepseek-v4-flash-0731` | Fallback only — the API passes the model on every request |
| `ARTIFACT_OPENCODE_BIN` | `opencode` | Binary name/path |
| `ARTIFACT_SCRATCH_BASE` | `/tmp/artifact-scratch` | Must be on a writable (tmpfs) mount |

## How this was tested

`tests/test_artifact_integration.py` hits a REAL running instance over HTTP, the same
way `services/sandbox-runner/tests/` do and for the same reason — the properties under
test (a real agent run, real validation, real rejection of a bad build) only mean
anything against the real container. It makes real, paid OpenRouter calls, so it is not
a CI test.
