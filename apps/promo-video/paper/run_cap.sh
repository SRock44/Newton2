#!/bin/bash
# Usage: run_cap.sh setup | say "text" [--attach] [--timeout N] | fetch-paper | truncate N | show | dump | restore [--delete-docs]
# Streams capture.py to the api container on the dev box.
# Needs NEWTON_DEV_HOST=user@host and (optionally) NEWTON_DEV_KEY=path/to/ssh/key.
# `stage` copies the two source documents into the container first: ./run_cap.sh stage
HOST="${NEWTON_DEV_HOST:?set NEWTON_DEV_HOST=user@host}"
KEY="${NEWTON_DEV_KEY:-$HOME/.ssh/id_rsa}"
cd "$(dirname "$0")"
if [ "$1" = "stage" ]; then
  ssh -i "$KEY" -o BatchMode=yes "$HOST" "docker exec newton2-api-1 mkdir -p /tmp/paper_src"
  for f in SOR_scratch_notes.md Synopsis_SOR_Poisson.docx; do
    scp -i "$KEY" -o BatchMode=yes "$f" "$HOST:/tmp/$f" >/dev/null
    ssh -i "$KEY" -o BatchMode=yes "$HOST" "docker cp /tmp/$f newton2-api-1:/tmp/paper_src/$f && rm /tmp/$f"
  done
  echo staged
  exit 0
fi
if [ "$1" = "pull" ]; then
  # copy the generated paper files out of the container into ./out
  mkdir -p out
  ssh -i "$KEY" -o BatchMode=yes "$HOST" "rm -rf /tmp/paper_out && docker cp newton2-api-1:/tmp/paper_out /tmp/paper_out"
  scp -i "$KEY" -o BatchMode=yes -r "$HOST:/tmp/paper_out/." out/ >/dev/null
  ssh -i "$KEY" -o BatchMode=yes "$HOST" "rm -rf /tmp/paper_out"
  ls -la out
  exit 0
fi
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
