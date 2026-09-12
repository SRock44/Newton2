# Sandbox runner

Executes untrusted, LLM-generated Python code on request, for the Code Interpreter tool
(`services/api/app/tools/code_interpreter.py`). `POST /execute` takes
`{"code": "...", "stdin": "..." (optional)}` and returns
`{"stdout": "...", "stderr": "...", "exit_code": N, "timed_out": bool}`. `GET /health`
is a plain liveness check.

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
