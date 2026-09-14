#!/usr/bin/env bash
# Shared config/helpers for infra/deploy/deploy.sh and infra/deploy/rollback.sh. Sourced,
# not run directly. Mirrors the shape of infra/backup/common.sh (small, focused,
# heavily-commented shell) on purpose, for the same reason: this is exactly the kind of
# operational script where "looks right" isn't good enough, so every non-obvious choice is
# explained inline.
set -euo pipefail

DEPLOY_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$DEPLOY_SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$INFRA_DIR/.." && pwd)"

# --- Remote box ------------------------------------------------------------------------
# Same shared dev box infra/README.md's "Remote dev box" section documents. Default to the
# Tailscale address (reachable from anywhere Tailscale is up, unlike the LAN address the
# README also mentions) -- override either piece if you're running this from somewhere
# that only reaches the LAN IP.
REMOTE_HOST="${REMOTE_HOST:-100.117.101.98}"
REMOTE_USER="${REMOTE_USER:-sr}"
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_claude}"
REMOTE_DIR="${REMOTE_DIR:-~/dev/newton2}"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

# What gets synced from a git ref to the box, and what gets rebuilt. Kept as the same two
# paths infra/README.md's manual sync command already uses (`tar -czf - infra services/api
# | ssh ...`) so this script is a direct automation of that existing pattern, not a new one.
DEPLOY_PATHS=(infra services/api)
DEPLOY_SERVICES_DEFAULT="api worker"

log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

warn() {
  printf '[%s] WARNING: %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

die() {
  printf '[%s] ERROR: %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
  exit 1
}

ssh_remote() {
  ssh "${SSH_OPTS[@]}" "$REMOTE" "$@"
}

# Resolve a user-supplied ref (SHA, tag, branch) to a full commit SHA, failing loudly if it
# doesn't exist in this local repo. Never trust an unresolved ref past this point -- a typo
# that happens to look like a short SHA is exactly the kind of mistake this exists to catch
# before it reaches the live box.
resolve_ref() {
  local ref="$1"
  (cd "$REPO_ROOT" && git rev-parse --verify -q "${ref}^{commit}") \
    || die "'$ref' does not resolve to a commit in this repo (typo, or not fetched locally?)"
}

# The migration "head" implied by a given ref, WITHOUT needing that ref checked out or
# alembic run against it -- just reads the versions/ directory's tree at that ref.
#
# Relies on this repo's migration files following a strictly linear, zero-padded sequential
# naming/revision convention (0001, 0002, ... 0011, each one's down_revision the previous
# number -- confirmed by reading every file in services/api/migrations/versions/ before
# writing this script). That means the highest-numbered filename at a given ref IS that
# ref's migration head; no need to parse revision/down_revision chains to find the tip.
# If this repo ever grows branching migrations (multiple heads), this heuristic breaks --
# update this function (and re-derive the head via the down_revision chain, or by running
# `alembic heads` against a checkout of that ref) before trusting it again.
ref_migration_head() {
  local ref="$1"
  local head
  head="$(cd "$REPO_ROOT" && git ls-tree -r --name-only "$ref" -- services/api/migrations/versions 2>/dev/null \
    | grep -E '/[0-9]{4}_[^/]+\.py$' \
    | sed -E 's#.*/([0-9]{4})_.*#\1#' \
    | sort -n \
    | tail -1)"
  printf '%s' "${head:-0000}"
}

# The revision currently stamped in the live DB's alembic_version table, read via whatever
# code is CURRENTLY deployed (irrelevant to correctness here -- `alembic current` just
# echoes the DB's stamped value; it doesn't need the target ref's migration files to do
# that). Queried BEFORE any sync/build so it reflects true pre-deploy state.
db_current_revision() {
  local out
  out="$(ssh_remote "cd $REMOTE_DIR/infra && docker compose exec -T api alembic current 2>&1")" \
    || die "could not read DB migration state via 'alembic current' on $REMOTE (is the api container up?): $out"
  local rev
  rev="$(printf '%s\n' "$out" | grep -oE '^[0-9]{4}' | head -1)"
  [ -n "$rev" ] || die "could not parse a revision id out of 'alembic current' output:\n$out"
  printf '%s' "$rev"
}

# Strip leading zeros for arithmetic comparison (bash treats a leading-zero literal like
# 0008 as octal in $(( )) otherwise, and 0008/0009 would blow up as "invalid octal number").
num() { printf '%d' "$((10#$1))"; }

# Sync exactly the tree state of $ref for DEPLOY_PATHS onto the box, replacing (not
# merging with) whatever's there now -- so a rollback across a commit that DELETED a file
# actually removes it on the box too, instead of leaving stale modules lying around for
# `COPY app ./app` to bake into the next image.
#
# Implementation: `git archive` streams the exact tree of $ref (tracked files only, exactly
# what's committed -- no working-tree drift) straight over ssh into a scratch staging dir on
# the box, then `rsync -a --delete` from staging into place. --delete is what makes this a
# real "match exactly", not just an overlay -- but it's deliberately scoped so it can NEVER
# touch anything not tracked in git under these paths: infra/.env (real secrets, generated
# on the box, never committed -- see infra/README.md) and infra/ovh/ (box-local, not part of
# this repo at all) are both excluded from the delete pass explicitly. Everything else under
# infra/ and services/api/ that's tracked in git is fair game to be replaced or removed.
sync_ref() {
  local ref="$1"
  log "Syncing $ref (${DEPLOY_PATHS[*]}) to $REMOTE:$REMOTE_DIR ..."

  ssh_remote "rm -rf $REMOTE_DIR/.deploy_staging && mkdir -p $REMOTE_DIR/.deploy_staging"

  (cd "$REPO_ROOT" && git archive "$ref" -- "${DEPLOY_PATHS[@]}") \
    | ssh_remote "tar -x -C $REMOTE_DIR/.deploy_staging" \
    || die "sync failed: git archive | ssh tar extract"

  local p
  for p in "${DEPLOY_PATHS[@]}"; do
    ssh_remote "rsync -a --delete --exclude='.env' --exclude='.env.*' --exclude='ovh/' \
      $REMOTE_DIR/.deploy_staging/$p/ $REMOTE_DIR/$p/" \
      || die "sync failed: rsync --delete into $REMOTE_DIR/$p"
  done

  ssh_remote "rm -rf $REMOTE_DIR/.deploy_staging"
  log "Sync complete."
}

# Rebuild + restart the given space-separated compose services on the box.
rebuild_services() {
  local services="$1"
  log "Rebuilding and restarting: $services"
  ssh_remote "cd $REMOTE_DIR/infra && docker compose up -d --build $services" \
    || die "docker compose up -d --build $services failed on $REMOTE"
}

# Health-check gate: run ENTIRELY on the box via one ssh call (the API's ports are
# 127.0.0.1-only, per infra/README.md's isolation note, so they're not reachable directly
# from off-box -- this has to run from inside the box, same as the token-fetch example
# already in infra/README.md).
#
#   1. Plain /health, with retries -- gives a freshly-rebuilt container a few seconds to
#      finish uvicorn startup / DB pool init instead of failing on the first ssh round-trip.
#   2. /health/secure with a REAL Keycloak token (dev user `student1`, same dev-only
#      credentials infra/README.md already documents in plaintext) -- proves auth actually
#      works end-to-end, not just that the process is listening.
#
# Exits non-zero (and this function's caller must NOT report success) if either check fails.
health_check() {
  local remote_cmd
  remote_cmd=$(cat <<'EOF'
set -u
ok=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -m 5 http://127.0.0.1:58001/health >/tmp/.newton_health_out 2>/tmp/.newton_health_err; then
    ok=1
    break
  fi
  sleep 3
done
if [ -z "$ok" ]; then
  echo "FAILED: /health never returned healthy after 10 attempts (~30s). Last error:" >&2
  cat /tmp/.newton_health_err >&2
  exit 1
fi
echo "/health OK: $(cat /tmp/.newton_health_out)"

TOKEN="$(curl -fsS -m 5 -X POST http://127.0.0.1:58180/realms/newton/protocol/openid-connect/token \
  -d grant_type=password -d client_id=newton-api -d username=student1 -d password=newton-dev \
  2>/tmp/.newton_kc_err | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)"
if [ -z "$TOKEN" ]; then
  echo "FAILED: could not obtain a Keycloak token for /health/secure. Keycloak error:" >&2
  cat /tmp/.newton_kc_err >&2
  exit 1
fi

if ! curl -fsS -m 5 -H "Authorization: Bearer $TOKEN" http://127.0.0.1:58001/health/secure >/tmp/.newton_secure_out 2>/tmp/.newton_secure_err; then
  echo "FAILED: /health/secure did not return 200 with a real token. Error:" >&2
  cat /tmp/.newton_secure_err >&2
  exit 1
fi
echo "/health/secure OK: $(cat /tmp/.newton_secure_out)"
rm -f /tmp/.newton_health_out /tmp/.newton_health_err /tmp/.newton_kc_err /tmp/.newton_secure_out /tmp/.newton_secure_err
EOF
)
  ssh_remote "$remote_cmd"
}

# Record what's actually deployed right now, so the next run (or a human) can see it
# without needing git on the box (there isn't any -- code arrives via sync_ref, not clone).
write_deployed_marker() {
  local sha="$1" ref_label="$2"
  ssh_remote "printf '%s\t%s\t%s\n' '$sha' '$ref_label' \"\$(date -u +%Y-%m-%dT%H:%M:%SZ)\" > $REMOTE_DIR/.deployed_ref"
}

read_deployed_marker() {
  ssh_remote "cat $REMOTE_DIR/.deployed_ref 2>/dev/null || echo '(no marker yet -- box predates this tooling)'"
}
