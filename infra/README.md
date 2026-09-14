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

## Backups

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
