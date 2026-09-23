#!/bin/bash
# Usage: run_cap.sh setup | say "text" [--attach] [--timeout N] | truncate N | show | ...
# Streams capture.py to the api container on the dev box.
# Needs NEWTON_DEV_HOST=user@host and (optionally) NEWTON_DEV_KEY=path/to/ssh/key.
HOST="${NEWTON_DEV_HOST:?set NEWTON_DEV_HOST=user@host}"
KEY="${NEWTON_DEV_KEY:-$HOME/.ssh/id_rsa}"
cd "$(dirname "$0")"
args=()
if [ "$1" = "say" ]; then
  args=(say "$(printf '%s' "$2" | base64 -w0)")
  shift 2
else
  args=("$1"); shift
fi
args+=("$@")
q=""; for a in "${args[@]}"; do q="$q '$a'"; done
cat capture.py | ssh -i "$KEY" -o BatchMode=yes "$HOST" "docker exec -i -w /app newton2-api-1 python -u - $q"
