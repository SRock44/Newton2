"""Newton piper-tts: a thin FastAPI wrapper around the `piper` (Piper neural TTS)
Python package, self-hosted so text-to-speech never depends on a cloud API. No
off-the-shelf Piper image ships a simple REST interface (the common ones speak the
Wyoming protocol, built for Home Assistant, not plain HTTP) — this service exists for
the same reason sandbox-runner is a custom-built service rather than an off-the-shelf
image: the tool this app needs doesn't come pre-packaged.

The voice model is downloaded once at image build time (see Dockerfile) and loaded
once at process startup — synthesis itself is CPU-bound ONNX inference, no per-request
network call and no state carried between requests.
"""

from __future__ import annotations

import io
import logging
import wave
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from piper import PiperVoice
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("piper_tts")

VOICE_MODEL_PATH = Path("/voices/en_US-lessac-medium.onnx")
MAX_TEXT_CHARS = 5000

app = FastAPI(title="Newton Piper TTS")
_voice: PiperVoice | None = None


@app.on_event("startup")
def load_voice() -> None:
    global _voice
    if not VOICE_MODEL_PATH.exists():
        raise RuntimeError(f"Voice model not found at {VOICE_MODEL_PATH} — check the image build step.")
    _voice = PiperVoice.load(str(VOICE_MODEL_PATH))
    logger.info("Loaded Piper voice model from %s", VOICE_MODEL_PATH)


@app.get("/health")
def health() -> dict:
    return {"status": "ok" if _voice is not None else "loading"}


class SynthesizeRequest(BaseModel):
    text: str


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest) -> Response:
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "text must not be empty")
    if len(text) > MAX_TEXT_CHARS:
        raise HTTPException(400, f"text too long — max {MAX_TEXT_CHARS} characters")
    if _voice is None:
        raise HTTPException(503, "voice model still loading")

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        _voice.synthesize_wav(text, wav_file)
    return Response(content=buffer.getvalue(), media_type="audio/wav")
