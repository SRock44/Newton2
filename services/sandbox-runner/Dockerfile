FROM python:3.12-slim

# Non-root user the sandboxed subprocess (and the FastAPI server itself) runs as.
# Deliberately no home directory, no shell, no login — it never needs either.
RUN useradd --system --create-home --home-dir /home/sandbox --shell /usr/sbin/nologin --uid 10001 sandbox

WORKDIR /app

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
