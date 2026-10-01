#!/usr/bin/env bash
# Cron entry point: runs both backups and exits non-zero if either failed, so
# cron's own failure-mail behavior (or whatever picks this up once Phase 7's
# monitoring/alerting item lands -- see ROADMAP.md) has something to catch.
# See infra/README.md's Backups section for the crontab line this is meant to
# be invoked from, and infra/backup/common.sh for BACKUP_ROOT/BACKUP_REMOTE_DEST/
# RETENTION_DAYS configuration.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

STATUS=0

echo "===== $(date -u +'%Y-%m-%dT%H:%M:%SZ') starting newton backup run ====="

./pg_backup.sh || STATUS=1
./minio_backup.sh || STATUS=1

if [ "$STATUS" -ne 0 ]; then
  echo "===== newton backup run FINISHED WITH ERRORS -- see log above ====="
else
  echo "===== newton backup run finished OK ====="
fi

exit "$STATUS"
