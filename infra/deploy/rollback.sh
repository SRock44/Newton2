#!/usr/bin/env bash
# infra/deploy/rollback.sh -- roll the live dev box back to an earlier commit/tag.
#
# This is deliberately a thin wrapper around deploy.sh, not a separate implementation:
# "rollback" and "deploy" are the same operation (sync a ref's code to the box, rebuild,
# migrate, health-check) pointed at a different ref. Keeping one real implementation means
# a fix to the sync/health-check/migration-direction logic can't accidentally land in only
# one of the two scripts and quietly drift out of sync with the other.
#
# Usage:
#   infra/deploy/rollback.sh <git-ref> [same options as deploy.sh]
#
# Example -- roll back to a specific earlier commit, allowing an automatic DB downgrade if
# the target is genuinely behind the live DB's migration state:
#   infra/deploy/rollback.sh a1b2c3d --auto-downgrade
#
# See deploy.sh's header (and infra/README.md's runbook) for the full option list and for
# what the migration-direction warning/confirmation actually does.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy.sh" --rollback "$@"
