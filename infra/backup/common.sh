#!/usr/bin/env bash
# Shared config/helpers for infra/backup/*.sh. Sourced, not run directly.
#
# HONESTY NOTE -- read this before trusting any of this as "disk-failure-proof":
# Every script in this directory stages its output under $BACKUP_ROOT, which by
# default lives on the SAME disk as the live docker volumes (newton_pgdata,
# newton_miniodata). That protects against operator error (a bad migration, an
# accidental DROP, a corrupted MinIO object) but NOT against the actual failure
# mode named in ROADMAP.md Phase 7: "a single disk failure on the shared dev
# box." That is only mitigated once BACKUP_REMOTE_DEST (below) points at a real
# second machine / off-box target AND a copy has actually been observed to land
# there -- see infra/README.md's "Backups" section for what "actually configure
# this" means, since no off-box destination is configured out of the box (there
# are no cloud credentials in this repo to wire up on anyone's behalf).
set -euo pipefail

BACKUP_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$BACKUP_SCRIPT_DIR/.." && pwd)"

# Where local dump/snapshot files are staged before (optionally) being shipped
# off-box. Override via the environment / crontab if this box's layout differs.
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/newton}"
PG_BACKUP_DIR="$BACKUP_ROOT/postgres"
MINIO_BACKUP_DIR="$BACKUP_ROOT/minio"
LOG_DIR="$BACKUP_ROOT/log"

# How many days of local dumps to retain before deletion (applied independently
# to the postgres and MinIO backup directories). Keeps the backup mechanism
# from quietly filling the same disk it exists to protect.
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# Bucket name mirrors app/core/config.py's `minio_bucket` default -- override if
# that setting is ever overridden in this box's .env.
MINIO_BUCKET="${MINIO_BUCKET:-newton}"

# Resolve the running `postgres`/`minio` containers by Compose service name
# (not a hardcoded container name, which depends on the compose project name).
COMPOSE_FILE="${COMPOSE_FILE:-$INFRA_DIR/docker-compose.yml}"
DC() { docker compose -f "$COMPOSE_FILE" "$@"; }

log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

mkdir -p "$PG_BACKUP_DIR" "$MINIO_BACKUP_DIR" "$LOG_DIR"

# Ship a single local file off-box, if BACKUP_REMOTE_DEST is configured.
#
#   BACKUP_REMOTE_METHOD=rsync (default) -- BACKUP_REMOTE_DEST is an rsync/ssh
#     target, e.g. "sr@second-host:/srv/newton-backups/". Requires: key-based
#     SSH from this box to that host (an entry in ~/.ssh/config or
#     BACKUP_SSH_KEY below), and rsync installed on both ends (already true on
#     this box). This is the path documented as "the simplest to wire up
#     today" in infra/README.md, since it needs nothing beyond a second host
#     you can already SSH into -- no cloud account, no new package to install
#     here (rclone is NOT installed on this box as of writing).
#
#   BACKUP_REMOTE_METHOD=rclone -- BACKUP_REMOTE_DEST is a configured rclone
#     remote:path, e.g. "s3-backup:my-bucket/newton" or "gdrive:newton-backups".
#     Requires: `rclone` installed on this box and `rclone config` already set
#     up with that remote's credentials. Use this if the real off-box target
#     ends up being S3/B2/GCS/etc rather than a second SSH-reachable host.
#
# If BACKUP_REMOTE_DEST is unset, this only logs a loud warning -- the file is
# NOT protected against a disk failure on this box yet.
ship_offbox() {
  local local_path="$1"
  if [ -z "${BACKUP_REMOTE_DEST:-}" ]; then
    log "WARNING: BACKUP_REMOTE_DEST is not set -- '$local_path' exists only on this box's disk and is NOT protected against a disk failure. See infra/README.md's Backups section to configure an off-box destination."
    return 0
  fi

  local method="${BACKUP_REMOTE_METHOD:-rsync}"
  case "$method" in
    rsync)
      if ! command -v rsync >/dev/null 2>&1; then
        log "ERROR: BACKUP_REMOTE_METHOD=rsync but rsync is not installed. Off-box copy of '$local_path' skipped."
        return 1
      fi
      log "Shipping $local_path -> $BACKUP_REMOTE_DEST (rsync over ssh)"
      rsync -az -e "ssh -i ${BACKUP_SSH_KEY:-$HOME/.ssh/id_claude} -o BatchMode=yes -o StrictHostKeyChecking=accept-new" \
        "$local_path" "$BACKUP_REMOTE_DEST"
      ;;
    rclone)
      if ! command -v rclone >/dev/null 2>&1; then
        log "ERROR: BACKUP_REMOTE_METHOD=rclone but rclone is not installed on this box. Off-box copy of '$local_path' skipped."
        return 1
      fi
      log "Shipping $local_path -> $BACKUP_REMOTE_DEST (rclone)"
      rclone copy "$local_path" "$BACKUP_REMOTE_DEST"
      ;;
    *)
      log "ERROR: unknown BACKUP_REMOTE_METHOD='$method' (expected rsync or rclone). Off-box copy of '$local_path' skipped."
      return 1
      ;;
  esac
}

# Delete local files older than RETENTION_DAYS in $dir matching glob $pattern.
# Off-box copies are NOT touched by this: retention on a remote/rclone
# destination is the account owner's responsibility (target disk quota, S3
# lifecycle rule, etc.) since this script has no reliable way to enumerate or
# safely prune an arbitrary remote's existing contents.
prune_old() {
  local dir="$1" pattern="$2"
  find "$dir" -maxdepth 1 -type f -name "$pattern" -mtime "+$RETENTION_DAYS" -print -delete 2>/dev/null | while IFS= read -r f; do
    log "Pruned old local backup (older than ${RETENTION_DAYS}d): $f"
  done
  return 0
}
