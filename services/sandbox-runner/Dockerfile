FROM python:3.12-slim

# Non-root user the sandboxed subprocess (and the FastAPI server itself) runs as.
# Deliberately no home directory, no shell, no login — it never needs either.
RUN useradd --system --create-home --home-dir /home/sandbox --shell /usr/sbin/nologin --uid 10001 sandbox

WORKDIR /app

# TeX Live for the /compile-latex endpoint, via Debian's own apt packaging rather than
# TeX Live's net-installer (much faster, and easy to keep to a deliberately hand-picked
# package set instead of the multi-GB `scheme-full`). Covers:
#   - texlive-latex-base/-recommended/-extra, texlive-fonts-recommended: core LaTeX,
#     amsmath, amssymb, graphicx, hyperref, geometry, cite, natbib
#   - texlive-publishers: IEEEtran and acmart document classes
#   - texlive-humanities: the apa7 document class (CTAN "apa7", TeX Live
#     collection-humanities)
#   - texlive-bibtex-extra: biblatex citation styles beyond the base set
#   - biber: the biblatex backend (biblatex is what apa7/IEEEtran-with-biblatex use)
#   - lmodern: Latin Modern fonts (lmodern.sty) — apa7 requires this directly, and it is
#     NOT pulled in by any Depends: of the packages above (only ever a Recommends: of
#     other packages elsewhere in Debian's tex stack), so --no-install-recommends means
#     it has to be listed explicitly or apa7 compiles fail with "File `lmodern.sty' not
#     found" (confirmed live against a real compile before this line was added).
# --no-install-recommends keeps this to what's actually needed rather than every
# language/doc extra Debian would otherwise pull in.
#
# Versions below are pinned via Debian apt's `package=version` syntax to the exact
# versions verified installed in the real deployed sandbox-runner image as of
# 2026-09-13 (`dpkg-query -W` inside the live container). TeX Live is a large,
# historically-CVE'd, C-heavy toolchain (compilers, font/image parsers, etc.) sitting
# behind the same rlimit/namespace boundary as the untrusted-code sandbox, so an
# unpinned `apt-get install` here would mean a routine, unrelated rebuild (e.g. a
# Python dependency bump) could silently pull in a different TeX Live build next time
# Debian's apt repo rotates it in place — with zero diff, review, or changelog to show
# a security-relevant (or just compile-behavior-changing) version bump happened.
# Pinning makes every such bump an explicit, reviewed line change in this file instead.
#
# To deliberately move to a newer TeX Live release: re-run `dpkg-query -W` inside a
# freshly-rebuilt (unpinned or bumped) container, update the pins below to match, and
# call that out in the commit message — it's a reviewed action, never an automatic
# side effect of touching this Dockerfile for something else.
RUN apt-get update && apt-get install --no-install-recommends -y \
        texlive-latex-base=2024.20250309-1 \
        texlive-latex-recommended=2024.20250309-1 \
        texlive-latex-extra=2024.20250309-2 \
        texlive-fonts-recommended=2024.20250309-1 \
        texlive-publishers=2024.20250309-2 \
        texlive-humanities=2024.20250309-2 \
        texlive-bibtex-extra=2024.20250309-2 \
        biber=2.20-2 \
        lmodern=2.005-1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Scratch base dir. At runtime this directory should live on a tmpfs mount (see
# README.md — the container root filesystem is expected to be read_only) so it's
# writable regardless; baking it in here too means `docker run` without the tmpfs
# mount (e.g. ad-hoc local testing) still works out of the box.
RUN mkdir -p /tmp/sandbox-scratch && chown -R sandbox:sandbox /tmp/sandbox-scratch /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SANDBOX_SCRATCH_BASE=/tmp/sandbox-scratch

USER sandbox

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
