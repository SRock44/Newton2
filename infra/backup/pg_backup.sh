#!/usr/bin/env bash
# Dumps every database on the live Postgres instance -- the `newton` app
# database (chats, profile facts, documents metadata, study plans, ...) AND
# the `keycloak` database Keycloak's own accounts live in (see
# docker-compose.yml's keycloak service comments: Keycloak stopped using an
# ephemeral in-memory DB specifically so accounts survive a restart) -- plus
# role/grant definitions, so a restore always comes back with matched accounts
# and app data instead of one without the other.
#
# Run via cron (see infra/README.md's Backups section for the crontab line
# and the full restore walkthrough). Safe to run manually too:
#   infra/backup/pg_backup.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=./common.sh
source ./common.sh

TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
OUT_FILE="$PG_BACKUP_DIR/newton-pg-$TIMESTAMP.sql.gz"
TMP_FILE="$OUT_FILE.partial"

log "Starting Postgres backup -> $OUT_FILE"

# pg_dumpall (not a per-database pg_dump) deliberately: it dumps every
# database on the instance plus role/grant definitions in one consistent SQL
# script. Run *inside* the postgres container via `docker compose exec` so
# this works identically whether or not pg_dump/pg_dumpall is installed on the
# host, and so it uses the real POSTGRES_USER the container already has
# rather than re-deriving credentials from .env. Plain-SQL output (pg_dumpall
# has no custom/compressed format of its own) is piped straight into gzip, so
# the backup is still compressed on disk like a `pg_dump -Fc` dump would be.
if ! DC exec -T postgres sh -c 'pg_dumpall -U "$POSTGRES_USER"' | gzip -9 > "$TMP_FILE"; then
  log "ERROR: pg_dumpall failed -- aborting, not overwriting any previous good backup."
  rm -f "$TMP_FILE"
  exit 1
fi

if [ ! -s "$TMP_FILE" ]; then
  log "ERROR: pg_dumpall produced an empty file -- aborting, not overwriting any previous good backup."
  rm -f "$TMP_FILE"
  exit 1
fi

mv "$TMP_FILE" "$OUT_FILE"
log "Postgres backup complete: $(du -h "$OUT_FILE" | cut -f1) -> $OUT_FILE"

ship_offbox "$OUT_FILE"
prune_old "$PG_BACKUP_DIR" 'newton-pg-*.sql.gz'
log "Postgres backup done."
