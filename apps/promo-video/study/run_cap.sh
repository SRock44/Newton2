#!/bin/bash
# Usage: run_cap.sh stage | setup | say "text" [--attach] [--timeout N] | fetch [name] |
#        review-cards 3,3,1,2 | take-exam N | weak | show | dump | restore [--delete-docs]
# Streams capture.py to the api container on the dev box.
# Needs NEWTON_DEV_HOST=user@host and (optionally) NEWTON_DEV_KEY=path/to/ssh/key.
# `stage` copies the packet into the container first: ./run_cap.sh stage
HOST="${NEWTON_DEV_HOST:?set NEWTON_DEV_HOST=user@host}"
KEY="${NEWTON_DEV_KEY:-$HOME/.ssh/id_rsa}"
cd "$(dirname "$0")"
if [ "$1" = "stage" ]; then
  ssh -i "$KEY" -o BatchMode=yes "$HOST" "docker exec newton2-api-1 mkdir -p /tmp/study_src"
  scp -i "$KEY" -o BatchMode=yes packet.docx "$HOST:/tmp/study_packet.docx" >/dev/null
  ssh -i "$KEY" -o BatchMode=yes "$HOST" "docker cp /tmp/study_packet.docx newton2-api-1:/tmp/study_src/packet.docx && rm /tmp/study_packet.docx"
  echo staged
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
