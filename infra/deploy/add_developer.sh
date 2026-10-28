#!/usr/bin/env bash
# infra/deploy/add_developer.sh -- provision a new developer's access to the production
# box (infra/README.md's "Production box" section). Run FROM your own machine, over SSH to
# that box (needs sudo there, same as the admin account used to set the box up).
#
# What it does, for one developer:
#   1. Creates them their own Linux user (never shared -- so access can be revoked
#      individually later with `sudo deluser --remove-home <name>`, and so `who`/auth logs
#      show whose session did what).
#   2. Adds that user to the `docker` group, so they can run `docker`/`docker compose`
#      without sudo (this is equivalent to root on the box -- see Docker's own docs on the
#      docker group -- which is why this script, not a looser blanket policy, is how that
#      access gets granted, one explicit name at a time).
#   3. Installs the SSH key THEY generated and sent you as their only login credential
#      (password login stays disabled -- `passwd -l`). Never generate a developer's own
#      keypair for them and hand them the private half over chat/email/anything else; the
#      private key has to be generated on, and never leave, their own machine. What you
#      need from them is one line: the contents of their `*.pub` file.
#   4. Clones the repo fresh into their home directory (their OWN clone to edit/build/test
#      in -- NOT the shared ~/newton2 the running stack deploys from; keeps one developer's
#      half-finished branch from fighting another's `docker compose up` on the same ports).
#      They push a branch and open a PR same as any other GitHub workflow; an admin runs
#      infra/deploy/deploy_prod.sh to actually promote a merged ref to the live stack.
#   5. Does NOT grant sudo. If a developer genuinely needs it, add that by hand
#      (`sudo usermod -aG sudo <name>`) and know that's a deliberate, separate decision --
#      this script's default is "can build and run the stack in their own clone", not
#      "can administer the box".
#
# Usage:
#   infra/deploy/add_developer.sh <username> <path-to-their-public-key>
#
# Env overrides: REMOTE_HOST, REMOTE_USER (an existing sudo-capable account, e.g. the admin
# user the box was provisioned with), SSH_KEY (your own key for that account).
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-40.160.53.217}"
REMOTE_USER="${REMOTE_USER:-ubuntu}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/newton}"
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ $# -eq 2 ] || die "usage: $0 <username> <path-to-their-public-key>"
NAME="$1"
PUBKEY_PATH="$2"

[[ "$NAME" =~ ^[a-z][a-z0-9_-]{1,31}$ ]] \
  || die "username '$NAME' doesn't look like a valid, safe Linux username (lowercase, start with a letter)"
[ -f "$PUBKEY_PATH" ] || die "no such file: $PUBKEY_PATH"

PUBKEY="$(tr -d '\r\n' < "$PUBKEY_PATH")"
[[ "$PUBKEY" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-) ]] \
  || die "'$PUBKEY_PATH' doesn't look like an SSH public key (expected it to start ssh-ed25519/ssh-rsa/ecdsa-sha2-...). Make sure you were sent the *.pub file, never a private key."

echo "About to provision '$NAME' on $REMOTE with this public key:"
echo "  $PUBKEY"
printf 'Type yes to continue: '
read -r reply
[ "$reply" = "yes" ] || die "confirmation not given -- aborting."

# ssh's multi-argument form (`ssh host cmd arg1 arg2`) does NOT preserve argument
# boundaries the way exec() would -- it joins everything into one string that the remote
# shell re-splits on whitespace. $PUBKEY contains spaces (the key blob and the comment are
# separate words), so passing it as a plain positional arg silently truncated it to just
# "ssh-ed25519" on the box (confirmed: that's exactly what landed in authorized_keys the
# first time this ran). base64-encoding it first gives a single whitespace-free token that
# survives the round trip intact; the remote side decodes it back before using it.
PUBKEY_B64="$(printf '%s' "$PUBKEY" | base64 -w0)"

ssh "${SSH_OPTS[@]}" "$REMOTE" "sudo bash -s" -- "$NAME" "$PUBKEY_B64" <<'REMOTE_SCRIPT'
set -euo pipefail
name="$1"
pubkey="$(printf '%s' "$2" | base64 -d)"

if id "$name" &>/dev/null; then
  echo "User '$name' already exists -- adding/refreshing their key and group membership only."
else
  adduser --disabled-password --gecos "" "$name"
fi
usermod -aG docker "$name"
passwd -l "$name" >/dev/null   # password login disabled; SSH key is the only way in

home="/home/$name"
mkdir -p "$home/.ssh"
touch "$home/.ssh/authorized_keys"
grep -qxF "$pubkey" "$home/.ssh/authorized_keys" || echo "$pubkey" >> "$home/.ssh/authorized_keys"
chmod 700 "$home/.ssh"
chmod 600 "$home/.ssh/authorized_keys"
chown -R "$name:$name" "$home/.ssh"

if [ ! -d "$home/newton2/.git" ]; then
  sudo -u "$name" git clone --quiet https://github.com/SRock44/Newton2.git "$home/newton2"
  echo "Cloned the repo into $home/newton2 for them to work in."
else
  echo "$home/newton2 already exists -- left as-is."
fi

echo "Done. '$name' can now: ssh -i <their private key> $name@$(hostname -I | awk '{print $1}')"
REMOTE_SCRIPT

echo
echo "Provisioned. Send them their own login line (sub in the IP you actually use):"
echo "  ssh -i ~/.ssh/<their key> $NAME@$REMOTE_HOST"
echo "Their clone is at ~$NAME/newton2 on the box -- theirs to branch/build/test in. The"
echo "live stack stays at ~newton2 under the admin account; promote a merged ref to it with"
echo "infra/deploy/deploy_prod.sh."
