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
RUN apt-get update && apt-get install --no-install-recommends -y \
        texlive-latex-base \
        texlive-latex-recommended \
        texlive-latex-extra \
        texlive-fonts-recommended \
        texlive-publishers \
        texlive-humanities \
        texlive-bibtex-extra \
        biber \
        lmodern \
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
