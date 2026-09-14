# Dev infra

`docker-compose.yml` brings up everything Newton's backend needs locally: Postgres+pgvector,
MinIO, Redis, Keycloak, and the FastAPI `api` service.

**Isolation:** every port is published to `127.0.0.1` only (never `0.0.0.0`), on high, unique
ports (55432, 56379, 59000/59001, 58180, 58001, 58080) chosen to avoid every port already in
use on a shared box. The whole stack lives under its own Compose project (`name: newton2`) and its
own Docker network (`newton2_net`) — it cannot see or collide with unrelated containers/stacks
on the same host.

```bash
cd infra
cp .env.example .env   # fill in real values
docker compose up -d
docker compose ps
```

Keycloak stores its own realm/user state in a dedicated `keycloak` Postgres database (not
the ephemeral in-memory DB `start-dev` defaults to) so accounts survive a container
restart. **On a genuinely fresh environment** (a brand-new `keycloak` database with no
realm in it yet — first-ever setup, or after deliberately dropping that database), bootstrap
the realm once:

```bash
docker compose exec postgres psql -U newton -d newton -c 'CREATE DATABASE keycloak OWNER newton;'  # first time only
docker compose run --rm keycloak start-dev --import-realm
docker compose up -d
```

This imports a `newton` realm with a public client `newton-api` and a dev user
(`student1` / `newton-dev`) — dev-only credentials, not for production use. Do **not** add
`--import-realm` to the standing `command:` in docker-compose.yml — Keycloak's file import
always runs with an OVERWRITE_EXISTING strategy, so on every normal restart it would delete
and recreate the whole realm from the static JSON file, wiping every real account (Google
or email) that signed up since. `start-dev --import-realm` is a one-time bootstrap action,
never the steady-state startup command.

To get a token and hit the authenticated health check (from inside the network — reachable
regardless of Keycloak's browser-facing hostname config, and the token's `iss` still matches
what the API validates against, since KC_HOSTNAME is fixed):

```bash
docker compose exec api python -c "
import httpx
tok = httpx.post('http://keycloak:8080/realms/newton/protocol/openid-connect/token', data={
    'grant_type': 'password', 'client_id': 'newton-api',
    'username': 'student1', 'password': 'newton-dev',
}).json()['access_token']
r = httpx.get('http://localhost:8000/health/secure', headers={'Authorization': f'Bearer {tok}'})
print(r.status_code, r.json())
"
```

Tear down: `docker compose down` (add `-v` to also drop the named volumes).

## Enabling a real model

Every agent-driven code path — chat, memory consolidation, study-plan extraction — goes
through the single provider adapter (`services/api/app/providers/registry.py`). Until a
key is set, all of it runs on the keyless `EchoProvider`, which just echoes the input back
(useful for testing the pipeline, useless for actual answers).

Set in `.env`:
```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=deepseek/deepseek-v4-flash-0731   # this is the default already; override if you want a different model
```
then `docker compose up -d --build api worker` (the key applies to both — `worker` runs
the same provider adapter for session-summary consolidation). No other config or code
change is needed; every feature that calls an agent picks this up automatically.

Current model choice: `deepseek/deepseek-v4-flash-0731` via OpenRouter — chosen for cost
($0.03/$0.07 per million input/output tokens) and a 1M context window, used uniformly for
every agent role rather than a tiered "cheap model here, expensive model there" split,
since it's cheap enough that the tiering isn't worth the complexity right now. A user's own
BYOK Anthropic key (if they supply one) still always takes precedence over this — see
`registry.py`.

## Remote dev box

Docker isn't available on the primary Windows dev machine, so this stack runs on a shared
Ubuntu box instead (`sr@192.168.1.101`, key `~/.ssh/id_claude`) that also hosts unrelated
projects. To stay isolated from those:
- Code lives under `~/dev/newton2` on that box (separate from everything else in `~`), synced
  from this repo (e.g. `tar -czf - infra services/api | ssh sr@192.168.1.101 'tar -xzf - -C ~/dev/newton2'`).
- Every port this stack publishes is `127.0.0.1`-only and picked to avoid every port already
  bound on that box (5432, 6379, 80/443, 8000, 8080, 8096, 8920, 9000, 27015, 27020 were all
  taken by other stacks — see `docker ps`/`ss -tlnp` before adding a new published port).
- Real secrets for that box's `.env` are generated on the box itself and never committed.

For local development against it (e.g. running the Tauri app on Windows), open an SSH local
port-forward so `127.0.0.1:58001` etc. on the dev machine reach the same ports on the box:

```
ssh -N -L 58001:127.0.0.1:58001 -L 58080:127.0.0.1:58080 -L 58180:127.0.0.1:58180 -i ~/.ssh/id_claude sr@192.168.1.101
```

## Testing

`services/api`'s suite runs two ways — see ROADMAP.md's Phase 7 "Decouple the test
suite from the shared live dev box" entry for why this split exists.

### Hermetic suite (CI, `.github/workflows/test.yml`)

Runs on every push/PR against a fresh, disposable Postgres + Redis + MinIO (never the
shared dev box above) and a self-signed fake JWKS server standing in for Keycloak (see
`services/api/tests/hermetic/`) — no real external service required. Excludes anything
marked `@pytest.mark.live_smoke` (real Open Library/SearXNG/OpenRouter catalog/
sandbox-runner/whisper-asr/piper-tts calls — see `pytest.ini`'s marker docs).

To reproduce locally (Docker required):

```bash
cd services/api
pip install -r requirements.txt

docker run -d --name pg -p 5432:5432 -e POSTGRES_USER=newton \
  -e POSTGRES_PASSWORD=newton-ci-secret -e POSTGRES_DB=newton pgvector/pgvector:pg16
docker run -d --name redis -p 6379:6379 redis:7-alpine
docker run -d --name minio -p 9000:9000 -e MINIO_ROOT_USER=newton \
  -e MINIO_ROOT_PASSWORD=newton-ci-secret quay.io/minio/minio:latest server /data

export DATABASE_URL=postgresql+asyncpg://newton:newton-ci-secret@localhost:5432/newton
export REDIS_URL=redis://localhost:6379/0
export ARQ_REDIS_URL=redis://localhost:6379/1
export MINIO_ENDPOINT=localhost:9000 MINIO_ACCESS_KEY=newton MINIO_SECRET_KEY=newton-ci-secret
export KEYCLOAK_INTERNAL_URL=http://127.0.0.1:9999/realms/newton
export KEYCLOAK_ISSUER=http://127.0.0.1:9999/realms/newton
export KEYCLOAK_AUDIENCE=newton-api
export API_BASE_URL=http://127.0.0.1:8000
export HERMETIC_TESTS=1

alembic upgrade head
python tests/hermetic/jwks_server.py --port 9999 &
uvicorn app.main:app --port 8000 &
python -m pytest tests/ -m "not live_smoke"
```

### Live-box smoke suite (manual)

Everything marked `live_smoke`, plus a full run against the real deployed stack as an
end-to-end sanity check, is run by hand against the shared dev box above:

```bash
tar -czf - infra services/api | ssh sr@192.168.1.101 'tar -xzf - -C ~/dev/newton2'
ssh sr@192.168.1.101 'cd ~/dev/newton2/infra && docker compose up -d --build api'
ssh sr@192.168.1.101 'docker exec newton2-api-1 python -m pytest tests/ -q'
```



`infra/backup/` holds the backup mechanism for the two stateful stores that actually
matter: Postgres (every account, chat history, profile fact, study plan, ...) and MinIO
(uploaded documents, generated `write_research_paper` PDFs/LaTeX, chat images).

**Be honest with yourself about what this protects against today.** By default both
scripts stage their output under `/var/backups/newton` on the box's own disk. That's a
real, working backup against operator error (a bad migration, an accidental `DROP`, a
corrupted MinIO object) — but it does **not** protect against a disk failure, which is
the actual gap this was built to close. That only happens once `BACKUP_REMOTE_DEST` (see
below) is pointed at a real second machine and a copy has actually been observed to land
there. As of this writing, no off-box destination is configured — see "Configuring an
off-box destination" below to close that out.

### What runs

- `infra/backup/pg_backup.sh` — runs `pg_dumpall` inside the running `postgres` container
  (via `docker compose exec`, so it doesn't matter whether `pg_dump` is installed on the
  host) and gzips the result to `/var/backups/newton/postgres/newton-pg-<UTC timestamp>.sql.gz`.
  `pg_dumpall`, not a single-database `pg_dump`, deliberately: this Postgres instance hosts
  *two* databases — the app's `newton` database and the `keycloak` database Keycloak's own
  accounts live in (see the `keycloak` service's comments in `docker-compose.yml`) — and a
  restore that brings back app data without the matching accounts (or vice versa) is worse
  than useless. One dump file, both databases, plus role/grant definitions.
- `infra/backup/minio_backup.sh` — uses MinIO's own `mc mirror` (already present inside the
  running `minio` container's image) to mirror the live bucket (`newton` by default, matching
  `app/core/config.py`'s `minio_bucket`) to a temp path inside that container, `docker cp`s it
  out to the host, and tars it to
  `/var/backups/newton/minio/newton-minio-<UTC timestamp>.tar.gz`.
- `infra/backup/run_backups.sh` — runs both and exits non-zero if either failed; this is what
  cron actually calls.
- `infra/backup/common.sh` — shared config (`BACKUP_ROOT`, `RETENTION_DAYS`,
  `BACKUP_REMOTE_DEST`/`BACKUP_REMOTE_METHOD`) and the `ship_offbox`/`prune_old` helpers both
  scripts use. Read the comments at the top of this file — they spell out exactly what is and
  isn't protected at each step.

### Retention

Local dumps/snapshots older than `RETENTION_DAYS` (default **14**) are deleted after each
run, independently for the postgres and MinIO directories, so this can't quietly fill the
disk it exists to protect. Override by exporting `RETENTION_DAYS` in the crontab line or
environment. Retention on an off-box destination (an rsync target's disk, an S3 lifecycle
rule, etc.) is **not** managed by this script — that's the destination owner's job, since
there's no safe way to enumerate and prune an arbitrary remote from here.

### Scheduling

A host crontab entry, not a sidecar container, on purpose: both scripts already work by
`docker exec`/`docker compose exec`-ing into the running application containers, so a
sidecar would need the host's Docker socket bind-mounted into it to do the same thing —
a meaningfully bigger attack surface than one crontab line for a single shared box that
doesn't otherwise run a backup orchestration platform. Installed on the box today:

```
15 3 * * * /home/sr/dev/newton2/infra/backup/run_backups.sh >> /var/backups/newton/log/cron.log 2>&1
```

(`crontab -l` on the box to confirm; `crontab -e` to change the schedule.) Runs nightly at
03:15 UTC, low-traffic hours for a single-timezone dev/early-user base. See
`infra/backup/crontab.example` for the same line annotated, including where
`BACKUP_REMOTE_DEST` goes once it's configured (see below).

### Configuring an off-box destination

Set `BACKUP_REMOTE_DEST` (and optionally `BACKUP_REMOTE_METHOD`, default `rsync`) in the
crontab line or environment `run_backups.sh` runs under. Two options, in order of how
little setup they need on this box:

- **`rsync` over SSH to a second host (default, recommended to start with)** — needs
  nothing installed (rsync is already on this box) beyond a second machine you can already
  SSH into with a key (no password prompt) and somewhere to write on it:
  ```
  BACKUP_REMOTE_DEST="sr@your-second-host:/srv/newton-backups/"
  ```
  Uses `~/.ssh/id_claude` by default (`BACKUP_SSH_KEY` to override). This is genuinely the
  simplest thing to wire up today since it needs no new package and no cloud account — just
  a second machine, which is the one prerequisite nobody else can supply on your behalf.
- **`rclone` to an S3-compatible endpoint (or Backblaze B2, Google Drive, etc.)** — `rclone`
  is **not installed on this box as of writing**; `apt install rclone` (or equivalent), then
  `rclone config` to add a remote with real credentials for whatever provider you pick, then:
  ```
  BACKUP_REMOTE_METHOD=rclone
  BACKUP_REMOTE_DEST="s3-backup:your-bucket-name/newton"
  ```
  This repo has no S3/B2/GCS credentials of its own to wire up here — this is the account
  owner's step, same as the Stripe/OpenRouter/Google Classroom integrations already
  documented above in this file being "dormant until you provide real credentials."

Either way, confirm it's actually landing off-box after the next scheduled run (`ssh` to
the second host and check the file showed up, or `rclone ls` the remote) — a
misconfigured destination fails loudly in `run_backups.sh`'s own log
(`/var/backups/newton/log/cron.log`), but it's worth a manual look the first time.

### Restoring

**Postgres.** Restore into a **throwaway** target first and sanity-check it — never
`psql` a dump straight into the live `postgres` service.

```bash
# 1. Spin up a scratch Postgres container, isolated from the real stack:
docker network create restore-net
docker run -d --name restore-pg --network restore-net -e POSTGRES_PASSWORD=throwaway pgvector/pgvector:pg16
# wait for it: docker exec restore-pg pg_isready -U postgres

# 2. Load the dump (pg_dumpall output is plain SQL, so this is just psql, not pg_restore):
zcat /var/backups/newton/postgres/newton-pg-<timestamp>.sql.gz | docker exec -i restore-pg psql -U postgres

# 3. Sanity-check before trusting it -- e.g. compare row counts against the live DB:
docker exec restore-pg psql -U postgres -d newton -t -c "select count(*) from users;"
docker exec restore-pg psql -U postgres -d keycloak -t -c "select count(*) from user_entity;"

# 4. Tear the scratch container down once satisfied.
docker rm -f restore-pg && docker network rm restore-net
```

To actually recover the live box after a real disk-failure/data-loss event (not a drill):
bring up a fresh `postgres` service (new volume), restore into it with the same `zcat |
psql` pipeline pointed at that container instead, then bring the rest of the stack up
against it.

**MinIO.** Restore into a **throwaway** bucket first, same reasoning:

```bash
# 1. Extract the archive:
mkdir -p /tmp/minio_restore && tar -xzf /var/backups/newton/minio/newton-minio-<timestamp>.tar.gz -C /tmp/minio_restore

# 2. Spin up a scratch MinIO container:
docker run -d --name restore-minio --network restore-net -e MINIO_ROOT_USER=throwaway -e MINIO_ROOT_PASSWORD=throwaway123 quay.io/minio/minio:latest server /data

# 3. Copy the extracted tree in and mirror it into a new bucket:
docker cp /tmp/minio_restore/newton-minio-<timestamp>/. restore-minio:/tmp/restore_src
docker exec restore-minio sh -c "mc alias set restoremc http://localhost:9000 throwaway throwaway123 && mc mb restoremc/newton-restored && mc mirror --quiet /tmp/restore_src restoremc/newton-restored"

# 4. Spot-check a known file's bytes match what you expect (md5sum), then tear down.
docker rm -f restore-minio
```

To recover the live box for real: mirror the extracted tree into the real `minio`
service's bucket instead of a scratch container/bucket once you've confirmed the archive
is good.

This exact sequence (both halves) was run against the real live dev box's data during
this feature's own verification — a real `pg_dumpall` restored into a scratch container
with row counts matching the live DB exactly, and a real uploaded PDF's bytes verified
identical (md5sum) after being mirrored out of a live-data backup archive and back into a
scratch MinIO bucket.

## Deploy and rollback

ROADMAP.md's Phase 7 named the actual gap: the shared dev box above is the only
environment that exists, and until this, a bad deploy had no path back except manually
re-syncing an older commit over SSH by hand. `infra/deploy/` is a tested rollback (and
forward-deploy) mechanism for that one box, built the same way `infra/backup/` was: small,
focused, heavily-commented shell scripts, not a new platform.

- `infra/deploy/deploy.sh <git-ref>` — sync that exact commit/tag's `infra/` and
  `services/api/` trees to the box, rebuild + restart `api` and `worker`, run whatever DB
  migration that implies, and gate success on a real health check.
- `infra/deploy/rollback.sh <git-ref>` — a thin wrapper around `deploy.sh` (same script,
  `--rollback` just changes banner wording). **Deploy and rollback are the same operation
  pointed at a different ref**, deliberately: two scripts that each reimplemented
  "sync, build, migrate, health-check" would drift out of sync with each other the same way
  the app they manage would.
- `infra/deploy/common.sh` — shared config/helpers both scripts source (ref resolution,
  the sync/build/health-check functions, the migration-direction check). Not meant to be
  run directly.

```bash
infra/deploy/deploy.sh main                    # deploy the tip of main
infra/deploy/deploy.sh v1.4.0                   # deploy a tag
infra/deploy/rollback.sh a1b2c3d                 # roll back to an earlier commit
infra/deploy/rollback.sh a1b2c3d --auto-downgrade  # ...and allow an automatic DB downgrade
```

Both read `REMOTE_HOST`/`REMOTE_USER`/`SSH_KEY`/`REMOTE_DIR` from the environment if you
need to override the defaults (`sr@100.117.101.98` over Tailscale, `~/.ssh/id_claude`,
`~/dev/newton2`) — see `infra/deploy/common.sh`.

### What the sync actually does

`git archive <ref> -- infra services/api`, piped straight over SSH into a scratch staging
directory on the box, then `rsync -a --delete` from staging into place — the same tar/ssh
pattern this file's "Remote dev box" section already documents, just sourced from a git ref
instead of the live working tree, and with `--delete` so a rollback across a commit that
*removed* a file actually removes it on the box (instead of leaving a stale module for
`COPY app ./app` to bake into the next image). `--delete` is explicitly scoped to never
touch `infra/.env` (real secrets, generated on the box, never committed) or `infra/ovh/`
(box-local, not part of this repo) — both are excluded from the delete pass by name.

### The health-check gate

Neither script reports success without this passing. It runs entirely on the box (the
API's ports are `127.0.0.1`-only, so this can't be checked from off-box without the SSH
tunnel this file already documents):

1. `GET /health`, retried for ~30s to give a freshly-rebuilt container time to finish
   uvicorn startup / DB pool init.
2. A real Keycloak token for the dev user (`student1` / `newton-dev`, the same dev-only
   login this file's "Remote dev box" section already uses) fetched and sent as a Bearer
   token to `GET /health/secure` — proves auth actually works end-to-end, not just that the
   process is listening.

A failure at either step is a loud, explicit `HEALTH CHECK FAILED` message and a non-zero
exit — it never silently reports "done" on a container that didn't actually come up healthy.

### The migration-direction check, and why downgrade isn't automatic by default

Before touching anything, both scripts compare the **target ref's migration head** (the
highest-numbered file under `services/api/migrations/versions/` at that ref — this repo's
migrations are a single linear chain, so that's a reliable proxy for "what `alembic upgrade
head` would produce" without needing that ref checked out) against the **live DB's current
migration** (`alembic current`, read before anything is touched).

- Target ahead of the DB → normal forward migration: sync, rebuild, then
  `alembic upgrade head` against the freshly-rebuilt container (it needs the new migration
  files, which only exist post-sync).
- Target equal to the DB → sync and rebuild only, no migration needed.
- **Target behind the DB** (a rollback crossing a real migration boundary) → this is the
  case ROADMAP.md's Phase 7 called out by name: deploying old application code against a
  newer DB schema is a real way to make an incident worse. The script never proceeds
  silently here. It prints exactly which migration files' `downgrade()` would need to run
  (read from the *current* checkout, since those files are newer than the target ref and
  won't exist in its own tree) and:
  - **By default, it does NOT run `alembic downgrade`.** It warns loudly, and requires
    typed confirmation (or `--yes` for non-interactive use) before even deploying the old
    code as-is with the DB left at its current, newer migration state. Several real
    `downgrade()` functions in this repo's migration history (`0006`, `0007`, `0008`, ...)
    are genuinely destructive — `op.drop_table` / `op.drop_column` — and running one
    automatically against a live database with real rows is a permanent, real data-loss
    action. Detect-and-warn was chosen over auto-downgrade as the default specifically
    because the downside of a wrong guess here (silently deleted user data) is categorically
    worse than the downside of the safer default (a human has to make one more decision).
  - Pass `--auto-downgrade` to allow it anyway. Even then, it still prints the exact list of
    downgrade migrations about to run and requires typing `DOWNGRADE` (or `--yes`) before
    executing — the downgrade runs against the **current, pre-sync** container (it's the
    only one that still has those newer migration files loaded), *then* the code sync and
    rebuild happen.

### Known limitation: this assumes it has the box to itself

Like the rest of this repo's remote-dev-box tooling, `infra/deploy/` assumes nothing else
is syncing code to `~/dev/newton2` at the same time. It has no lock file and no way to
detect a concurrent manual `tar | ssh` sync (the pattern this file's "Remote dev box"
section documents, still valid for a one-off change). If two things sync to the box at
once, last-write-wins, same as it would with two people SSHed in running commands by hand
— this doesn't make that meaningfully safer, only the box's own steady-state deploy/rollback
path faster and gated on a real health check.

### Verification

This was run for real against the real live dev box, not just read for plausibility: a
forward deploy of the then-current `main`, a rollback to a real earlier commit (several
commits back, chosen to change something real and independently verifiable —
`requirements.txt`'s pinned `uvicorn` version — without crossing a migration boundary, so
the first round-trip exercised the sync/build/health-check path in isolation from the
migration-direction logic), confirmed via `docker exec`ing the live container and reading
the installed `uvicorn.__version__` directly (not just trusting the script's own report)
that the rollback had genuinely taken effect, then a forward deploy back — each of the
three runs gated on and passing the real `/health` + `/health/secure` check against the
live Keycloak. The bundled backend test suite (`docker exec newton2-api-1 python -m pytest
tests/ -q`) was run to confirm the box was left in a working state; two categories of
failure surfaced that are pre-existing characteristics of this shared box and this repo's
own test suite, unrelated to this tooling, and are worth knowing about before treating a
future run's output at face value:
- The `api` service's `mem_limit: 640m` (`docker-compose.yml`) is tight enough that running
  the full test suite via `docker exec` inside the same container as the live server can
  trip the kernel's cgroup OOM killer under this shared box's real memory pressure (confirmed
  via `journalctl -k` showing an actual `oom-kill` of the `uvicorn`/`pytest` processes) —
  running the suite in smaller batches (a handful of files per `pytest` invocation) instead
  of one single ~640-test run avoids this. Worth a follow-up if the suite is going to be run
  against this container routinely: either a higher `mem_limit`, or running tests in an
  ephemeral container instead of `docker exec` into the live one (see the `live_smoke`
  marker note in `services/api/pytest.ini` — ROADMAP.md's Phase 7 already names decoupling
  the test suite from the shared live box as a follow-up).
- A handful of tests intermittently got a real `401` from Keycloak's own token endpoint
  while fetching a fresh dev-user login — transient, and gone on an immediate retry; almost
  certainly Keycloak's own brute-force/rate-limiting kicking in under many rapid successive
  password-grant logins (each test using the `keycloak_token` fixture does its own). Not
  something this tooling caused or can fix from the outside.
- One test (`test_run_against_real_open_library`) is marked `live_smoke` — it hits the real
  Open Library API and is already excluded from this repo's own CI
  (`.github/workflows/test.yml` runs `-m "not live_smoke"`); this tooling's verification
  used the same exclusion for its final pass, matching the repo's own definition of
  "the suite passes."
