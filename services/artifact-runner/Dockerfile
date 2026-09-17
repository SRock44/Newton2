# Node base rather than python-slim (which services/sandbox-runner uses) purely because
# the payload here IS a Node-distributed CLI: `opencode` ships as an npm package with
# per-platform prebuilt binaries. The FastAPI wrapper that runs it is small enough that
# installing Python on top of Node is far less work than installing Node on top of
# Python.
FROM node:22-slim

# Same non-root identity as services/sandbox-runner uses (uid 10001, no login shell) --
# no home directory of its own is needed: every run gets a throwaway $HOME inside its
# per-request scratch directory on the tmpfs (see app/main.py's _child_env).
RUN useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --uid 10001 artifact

WORKDIR /app

# Python for the FastAPI wrapper. Versions pinned the same way (and for the same
# reason) services/sandbox-runner pins its TeX Live packages -- these are the exact
# candidates in node:22-slim's Debian 12 base, confirmed with `apt-cache policy` in a
# real container before being written here rather than guessed.
RUN apt-get update && apt-get install --no-install-recommends -y \
        python3=3.11.2-1+b1 \
        python3-pip=23.0.1+dfsg-1 \
    && rm -rf /var/lib/apt/lists/*

# `opencode` (github.com/sst/opencode), the real open-source coding agent this service
# exists to run. PINNED to an exact version, for the same reason services/sandbox-runner
# pins its TeX Live packages: this is a large agentic tool that executes model-directed
# actions inside a container with real internet egress, so a version bump must be an
# explicit, reviewed line change here -- never something a routine unrelated rebuild
# silently picks up. Verified against the npm registry (opencode-ai) and confirmed
# working headless against OpenRouter at this exact version before pinning.
#
# To bump: change the version here, rebuild, and re-run services/artifact-runner/tests/
# test_artifact_integration.py against the rebuilt image -- opencode's CLI flags
# (`run --format json --model --continue`) and its opencode.json schema are both things
# it has changed before.
RUN npm install -g opencode-ai@1.18.31 && npm cache clean --force

# The FastAPI wrapper's own deps. --break-system-packages because Debian's Python is
# externally-managed and this is a single-purpose container image, not a shared system.
COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY app ./app

# Scratch base dir. At runtime this lives on a tmpfs mount (the container root
# filesystem is read_only -- see README.md); baking it in means a plain `docker run`
# without that mount still works for ad-hoc testing.
RUN mkdir -p /tmp/artifact-scratch && chown -R artifact:artifact /tmp/artifact-scratch /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ARTIFACT_SCRATCH_BASE=/tmp/artifact-scratch

USER artifact

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
