#!/usr/bin/env bash
# Snapshots the MinIO bucket holding every uploaded document, generated
# research-paper PDF/LaTeX artifact, and chat image (bucket name matches
# app/core/config.py's `minio_bucket` default, "newton" -- override with
# MINIO_BUCKET if this box's .env ever changes it).
#
# Uses MinIO's own `mc mirror` -- already present inside the running `minio`
# container's image, so this needs no extra image pull. It mirrors the bucket
# to a directory *inside* the minio container's own writable layer (not a
# bind mount, since we don't want to change the shape of the already-running
# container), then `docker cp`s that directory out to the host and tars it
# into one timestamped archive, matching the postgres backup's layout.
#
# Run via cron (see infra/README.md's Backups section for the crontab line
# and the full restore walkthrough). Safe to run manually too:
#   infra/backup/minio_backup.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=./common.sh
source ./common.sh

TIMESTAMP="$(date -u +'%Y%m%dT%H%M%SZ')"
STAGE_NAME="newton-minio-$TIMESTAMP"
OUT_FILE="$MINIO_BACKUP_DIR/$STAGE_NAME.tar.gz"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

log "Starting MinIO backup of bucket '$MINIO_BUCKET' -> $OUT_FILE"

MINIO_CID="$(DC ps -q minio)"
if [ -z "$MINIO_CID" ]; then
  log "ERROR: minio container is not running (docker compose ps -q minio returned nothing)."
  exit 1
fi

REMOTE_TMP="/tmp/$STAGE_NAME"

# Alias + mirror inside the container: `mc mirror` is the standard MinIO tool
# for exactly this (a consistent, resumable, checksum-compared copy of a
# bucket's objects), reading the real root creds the container already has
# rather than re-deriving them from .env.
if ! docker exec "$MINIO_CID" sh -c "
  set -e
  mc alias set localminio http://localhost:9000 \"\$MINIO_ROOT_USER\" \"\$MINIO_ROOT_PASSWORD\" >/dev/null
  mkdir -p '$REMOTE_TMP'
  mc mirror --quiet --overwrite 'localminio/$MINIO_BUCKET' '$REMOTE_TMP'
"; then
  log "ERROR: mc mirror failed inside the minio container."
  docker exec "$MINIO_CID" rm -rf "$REMOTE_TMP" 2>/dev/null || true
  exit 1
fi

# Copy the mirrored tree out to the host, then clean it up inside the
# container so repeated runs don't accumulate in its writable layer.
docker cp "$MINIO_CID:$REMOTE_TMP" "$WORK_DIR/$STAGE_NAME"
docker exec "$MINIO_CID" rm -rf "$REMOTE_TMP"

FILE_COUNT="$(find "$WORK_DIR/$STAGE_NAME" -type f | wc -l)"
if [ "$FILE_COUNT" -eq 0 ]; then
  log "WARNING: mirrored 0 files from bucket '$MINIO_BUCKET' -- either the bucket is genuinely empty or something went wrong upstream. Writing the (empty) archive anyway so this is visible in the backup directory rather than silently skipped."
fi

TMP_ARCHIVE="$OUT_FILE.partial"
tar -czf "$TMP_ARCHIVE" -C "$WORK_DIR" "$STAGE_NAME"
mv "$TMP_ARCHIVE" "$OUT_FILE"

log "MinIO backup complete: $FILE_COUNT file(s), $(du -h "$OUT_FILE" | cut -f1) -> $OUT_FILE"

ship_offbox "$OUT_FILE"
prune_old "$MINIO_BACKUP_DIR" 'newton-minio-*.tar.gz'
log "MinIO backup done."
