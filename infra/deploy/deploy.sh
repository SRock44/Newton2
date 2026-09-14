#!/usr/bin/env bash
# infra/deploy/deploy.sh -- sync a specific git ref's code to the shared dev box, rebuild
# the affected services, run whatever DB migration that requires, and refuse to call it done
# until a real health check against the freshly-rebuilt container passes.
#
# This is "deploy" and "rollback" implemented as ONE operation pointed at a different ref --
# see infra/deploy/rollback.sh, which is a thin wrapper around this same script (--rollback
# just changes banner wording / default confirmation strictness, not the underlying logic).
# That's deliberate: a rollback IS a deploy, just backward, and two scripts that each
# reimplement "sync, build, migrate, health-check" would drift out of sync with each other
# over time in exactly the way this tool exists to prevent for the app itself.
#
# Usage:
#   infra/deploy/deploy.sh <git-ref> [options]
#
# Options:
#   --services "api worker"   Space-separated compose services to rebuild/restart.
#                              Default: "api worker" (both build from services/api).
#   --auto-downgrade           Allow an automatic `alembic downgrade` when the target ref's
#                              migration head is BEHIND the DB's current state. Off by
#                              default -- see the migration-direction check below and
#                              infra/README.md's runbook for why.
#   --yes                      Skip interactive confirmation prompts (still prints every
#                              warning). Use for non-interactive/scripted runs; understand
#                              what you're skipping before you use it against the real DB.
#   --rollback                 Cosmetic only (used by rollback.sh) -- changes banner text.
#   -h, --help                 Show this help.
#
# Examples:
#   infra/deploy/deploy.sh main
#   infra/deploy/deploy.sh v1.4.0 --services "api worker"
#   infra/deploy/rollback.sh a1b2c3d --auto-downgrade
set -euo pipefail

# shellcheck source=./common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

usage() {
  sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

TARGET_REF=""
SERVICES="$DEPLOY_SERVICES_DEFAULT"
AUTO_DOWNGRADE=""
ASSUME_YES=""
MODE_LABEL="DEPLOY"

while [ $# -gt 0 ]; do
  case "$1" in
    --services) SERVICES="$2"; shift 2 ;;
    --auto-downgrade) AUTO_DOWNGRADE=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    --rollback) MODE_LABEL="ROLLBACK"; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) die "unknown option: $1 (see --help)" ;;
    *)
      [ -z "$TARGET_REF" ] || die "unexpected extra argument: $1 (already have ref '$TARGET_REF')"
      TARGET_REF="$1"; shift ;;
  esac
done

[ -n "$TARGET_REF" ] || { usage; die "missing required <git-ref> argument"; }

RESOLVED_SHA="$(resolve_ref "$TARGET_REF")"
SHORT_SHA="${RESOLVED_SHA:0:12}"

log "===== $MODE_LABEL: $TARGET_REF ($SHORT_SHA) ====="
log "Currently deployed on $REMOTE: $(read_deployed_marker)"

TARGET_HEAD="$(ref_migration_head "$RESOLVED_SHA")"
DB_CURRENT="$(db_current_revision)"
log "Target ref's migration head:  $TARGET_HEAD"
log "Live DB's current migration:  $DB_CURRENT"

ACTION="none"   # none | upgrade | downgrade
DOWNGRADE_CONFIRMED=""

if [ "$(num "$TARGET_HEAD")" -gt "$(num "$DB_CURRENT")" ]; then
  ACTION="upgrade"
  log "Action: upgrade DB to head after sync (normal forward migration)."

elif [ "$(num "$TARGET_HEAD")" -eq "$(num "$DB_CURRENT")" ]; then
  ACTION="none"
  log "Action: none -- DB already matches the target ref's migration head."

else
  # Target ref's code is OLDER than the DB's current migration state. This is the case
  # infra/README.md's runbook and this script's header warn about: deploying old app code
  # against a newer DB schema (or leaving a newer schema partially un-downgraded) is a real
  # way to make an incident worse, not better, so this branch never proceeds silently.
  ACTION="downgrade"
  warn "TARGET REF IS BEHIND THE LIVE DB'S MIGRATION STATE."
  warn "  Target ref's migration head: $TARGET_HEAD"
  warn "  Live DB is currently at:     $DB_CURRENT"
  warn "  Deploying this ref's code as-is means old application code will run against a"
  warn "  database schema that includes $(( $(num "$DB_CURRENT") - $(num "$TARGET_HEAD") )) migration(s) newer than what this code knows about."
  echo >&2
  warn "Migration file(s) whose downgrade() would need to run to actually match the schema"
  warn "to this ref (read via THIS repo's local checkout, not the target ref -- these files"
  warn "won't exist in the target ref's own tree, since they're newer than it):"
  for f in "$REPO_ROOT"/services/api/migrations/versions/[0-9][0-9][0-9][0-9]_*.py; do
    base="$(basename "$f")"
    rev="${base%%_*}"
    if [ "$(num "$rev")" -gt "$(num "$TARGET_HEAD")" ] && [ "$(num "$rev")" -le "$(num "$DB_CURRENT")" ]; then
      warn "  - $base"
    fi
  done
  echo >&2

  if [ -n "$AUTO_DOWNGRADE" ]; then
    warn "This run was invoked with --auto-downgrade. Several of the downgrade() functions"
    warn "above are DESTRUCTIVE (op.drop_table / op.drop_column) -- rows in those"
    warn "tables/columns are permanently gone once this runs against a real database with"
    warn "real data in it. Read the files listed above before confirming."
    if [ -n "$ASSUME_YES" ]; then
      DOWNGRADE_CONFIRMED=1
      warn "--yes given: proceeding with automatic downgrade without an interactive prompt."
    else
      printf 'Type DOWNGRADE (all caps) to run `alembic downgrade %s` against the live DB, anything else aborts: ' "$TARGET_HEAD" >&2
      read -r reply
      if [ "$reply" = "DOWNGRADE" ]; then
        DOWNGRADE_CONFIRMED=1
      else
        die "confirmation not given -- aborting before touching anything."
      fi
    fi
  else
    warn "--auto-downgrade was NOT given, so this script will NOT run 'alembic downgrade'."
    warn "It will deploy the OLD CODE and leave the DB at its current (newer) migration"
    warn "state -- safe only if every migration between $TARGET_HEAD and $DB_CURRENT is"
    warn "backward-compatible (additive columns/tables the old ORM models simply ignore)."
    warn "Re-run with --auto-downgrade if you actually need the schema rolled back too."
    if [ -z "$ASSUME_YES" ]; then
      printf 'Type yes to continue deploying old code WITHOUT touching the DB, anything else aborts: ' >&2
      read -r reply
      [ "$reply" = "yes" ] || die "confirmation not given -- aborting before touching anything."
    fi
  fi
fi

# --- Downgrade (if confirmed) runs BEFORE the code sync -------------------------------
# The downgrade() bodies for revisions above $TARGET_HEAD only exist in the CURRENTLY
# deployed code (they're newer than the target ref we're about to sync in), so this has to
# run against the container that's running right now, before it gets replaced. Running it
# after sync/rebuild would swap in a container whose migrations/ directory doesn't even
# contain those revision files anymore.
if [ "$ACTION" = "downgrade" ] && [ -n "$DOWNGRADE_CONFIRMED" ]; then
  log "Running alembic downgrade $TARGET_HEAD (against the CURRENT container, before sync)..."
  ssh_remote "cd $REMOTE_DIR/infra && docker compose exec -T api alembic downgrade $TARGET_HEAD" \
    || die "alembic downgrade failed -- DB may be in a partially-downgraded state. Stopping before touching code. Investigate manually before retrying."
  log "Downgrade complete."
fi

sync_ref "$RESOLVED_SHA"
rebuild_services "$SERVICES"

# --- Upgrade (if needed) runs AFTER the code sync/rebuild ------------------------------
# The opposite reasoning from the downgrade case: the new migration files this needs only
# exist in the code we just synced in, so this has to run against the freshly-rebuilt
# container, not the old one.
if [ "$ACTION" = "upgrade" ]; then
  log "Running alembic upgrade head (against the freshly-rebuilt container)..."
  ssh_remote "cd $REMOTE_DIR/infra && docker compose exec -T api alembic upgrade head" \
    || die "alembic upgrade head failed after sync/rebuild -- app code and DB schema are now MISMATCHED on $REMOTE. Investigate manually; do not treat this deploy as successful."
  log "Upgrade complete."
fi

log "Running health-check gate..."
if ! health_check; then
  die "HEALTH CHECK FAILED after $MODE_LABEL to $TARGET_REF ($SHORT_SHA). The box is NOT confirmed healthy -- do not treat this as a successful $MODE_LABEL. Investigate (docker compose logs api) before retrying or rolling back further."
fi

write_deployed_marker "$RESOLVED_SHA" "$TARGET_REF"

log "===== $MODE_LABEL SUCCEEDED: $TARGET_REF ($SHORT_SHA) ====="
log "Services rebuilt: $SERVICES"
log "Migration action: $ACTION$( [ "$ACTION" = "downgrade" ] && [ -z "$DOWNGRADE_CONFIRMED" ] && echo " (skipped -- not confirmed, DB left at $DB_CURRENT)" )"
log "Health check:      passed (/health and /health/secure both OK)"
log "Now deployed:       $(read_deployed_marker)"
