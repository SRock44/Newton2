FROM python:3.14-slim

# Non-root user the FastAPI server runs as.
RUN useradd --system --create-home --home-dir /home/piper --shell /usr/sbin/nologin --uid 10002 piper

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the voice model into the image at build time (piper.download_voices is the
# package's own downloader, hits Hugging Face — needs build-time internet egress, same
# as any other `docker build` that pulls a base image) so the running container never
# needs outbound network access and startup never depends on Hugging Face being up.
RUN mkdir -p /voices && python -m piper.download_voices en_US-lessac-medium --download-dir /voices

COPY app ./app

RUN chown -R piper:piper /app /voices

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

USER piper

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
    CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
