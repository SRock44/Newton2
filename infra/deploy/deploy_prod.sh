#!/usr/bin/env bash
# infra/deploy/deploy_prod.sh -- deploy to the production box (infra/README.md's
# "Production box" section): a real `git clone`, not the dev box's tar-sync target.
#
# This is deploy.sh's sibling, not a copy of its logic: it reuses common.sh's reusable
# parts verbatim (ref resolution, the migration-head/db-revision comparison, the
# health-check gate -- none of those care how the code got onto the box) but replaces
# sync_ref()'s "git archive | rsync --delete into a directory with no .git" with real git
# operations, because the production box has real git metadata that a rsync-in-place would
# silently desync from the files on disk (see common.sh's note on REMOTE_HOST). It also
# rebuilds with a plain `docker compose up -d --build` (every service whose image changed,
# not just api/worker) instead of deploy.sh's fixed --services list, because a real clone
# makes that both correct and cheap (Docker's layer cache no-ops anything unchanged).
#
# Usage:
#   infra/deploy/deploy_prod.sh <git-ref> [--yes] [--auto-downgrade]
#
# Env overrides (same names as deploy.sh): REMOTE_HOST, REMOTE_USER, SSH_KEY, REMOTE_DIR.
# Defaults point at the production box itself.
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

# Override common.sh's dev-box defaults with the production box's.
REMOTE_HOST="${REMOTE_HOST:-40.160.53.217}"
REMOTE_USER="${REMOTE_USER:-ubuntu}"
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/newton}"
REMOTE_DIR="${REMOTE_DIR:-~/newton2}"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

TARGET_REF=""
AUTO_DOWNGRADE=""
ASSUME_YES=""

while [ $# -gt 0 ]; do
  case "$1" in
    --auto-downgrade) AUTO_DOWNGRADE=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) [ -z "$TARGET_REF" ] || die "unexpected extra argument: $1"; TARGET_REF="$1"; shift ;;
  esac
done
[ -n "$TARGET_REF" ] || die "missing required <git-ref> argument (see --help)"

RESOLVED_SHA="$(resolve_ref "$TARGET_REF")"
SHORT_SHA="${RESOLVED_SHA:0:12}"

log "===== PRODUCTION DEPLOY: $TARGET_REF ($SHORT_SHA) ====="
log "Currently deployed on $REMOTE: $(ssh_remote "cd $REMOTE_DIR && git rev-parse --short HEAD 2>&1")"

TARGET_HEAD="$(ref_migration_head "$RESOLVED_SHA")"
DB_CURRENT="$(db_current_revision)"
log "Target ref's migration head:  $TARGET_HEAD"
log "Live DB's current migration:  $DB_CURRENT"

ACTION="none"
if [ "$(num "$TARGET_HEAD")" -gt "$(num "$DB_CURRENT")" ]; then
  ACTION="upgrade"
elif [ "$(num "$TARGET_HEAD")" -lt "$(num "$DB_CURRENT")" ]; then
  ACTION="downgrade"
  warn "TARGET REF IS BEHIND THE LIVE DB'S MIGRATION STATE -- same situation deploy.sh's"
  warn "header documents. Re-run with --auto-downgrade if you really mean to roll the"
  warn "schema back too; otherwise this deploys old code against the newer schema as-is"
  warn "(only safe if the newer migrations are additive)."
  if [ -z "$AUTO_DOWNGRADE" ] && [ -z "$ASSUME_YES" ]; then
    printf 'Type yes to continue without downgrading, anything else aborts: ' >&2
    read -r reply
    [ "$reply" = "yes" ] || die "confirmation not given -- aborting before touching anything."
  fi
fi

if [ -z "$ASSUME_YES" ] && [ "$ACTION" != "downgrade" ]; then
  printf 'Deploy %s (%s) to PRODUCTION (%s)? Type yes to continue: ' "$TARGET_REF" "$SHORT_SHA" "$REMOTE" >&2
  read -r reply
  [ "$reply" = "yes" ] || die "confirmation not given -- aborting."
fi

if [ "$ACTION" = "downgrade" ] && [ -n "$AUTO_DOWNGRADE" ]; then
  log "Running alembic downgrade $TARGET_HEAD (against the CURRENT container, before checkout)..."
  ssh_remote "cd $REMOTE_DIR/infra && docker compose exec -T api alembic downgrade $TARGET_HEAD" \
    || die "alembic downgrade failed -- DB may be partially downgraded. Stopping before touching code."
fi

log "Fetching and checking out $SHORT_SHA on $REMOTE:$REMOTE_DIR ..."
ssh_remote "cd $REMOTE_DIR && git fetch --quiet origin && git checkout --quiet $RESOLVED_SHA" \
  || die "git fetch/checkout failed on $REMOTE"

log "Rebuilding and restarting every service whose image changed..."
ssh_remote "cd $REMOTE_DIR/infra && docker compose up -d --build" \
  || die "docker compose up -d --build failed on $REMOTE"

if [ "$ACTION" = "upgrade" ]; then
  log "Running alembic upgrade head (against the freshly-rebuilt container)..."
  ssh_remote "cd $REMOTE_DIR/infra && docker compose exec -T api alembic upgrade head" \
    || die "alembic upgrade head failed after checkout/rebuild -- app code and DB schema are now MISMATCHED. Investigate manually."
fi

log "Running health-check gate..."
if ! health_check; then
  die "HEALTH CHECK FAILED after deploying $TARGET_REF ($SHORT_SHA). Do not treat this as successful -- investigate (docker compose logs api) before retrying or rolling back."
fi

log "===== PRODUCTION DEPLOY SUCCEEDED: $TARGET_REF ($SHORT_SHA) ====="
log "Migration action: $ACTION"
log "Health check:      passed (/health and /health/secure both OK)"
log "Now at:             $(ssh_remote "cd $REMOTE_DIR && git rev-parse --short HEAD")"
