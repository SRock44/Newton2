"""Newton piper-tts: a thin FastAPI wrapper around the `piper` (Piper neural TTS)
Python package, self-hosted so text-to-speech never depends on a cloud API. No
off-the-shelf Piper image ships a simple REST interface (the common ones speak the
Wyoming protocol, built for Home Assistant, not plain HTTP) — this service exists for
the same reason sandbox-runner is a custom-built service rather than an off-the-shelf
image: the tool this app needs doesn't come pre-packaged.

Every voice model is downloaded once at image build time (see Dockerfile) and loaded
once at process startup — synthesis itself is CPU-bound ONNX inference, no per-request
network call and no state carried between requests.

Multi-language voices: this used to hardcode exactly ONE English voice
(en_US-lessac-medium), so asking it to read back a Spanish or French reply produced
mangled/wrong-language audio out of the only model it had. VOICE_MODELS below is now a
real map of language -> a real, pretrained Piper voice (rhasspy/piper-voices on Hugging
Face — verified to actually exist and ship both the .onnx and .onnx.json files before
being added here, not guessed at). /synthesize takes an optional `language` and picks
the matching voice, falling back to DEFAULT_LANGUAGE (and saying so via a response
header) for a language with no voice baked into this image — never a silent mismatch."""

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

VOICES_DIR = Path("/voices")
MAX_TEXT_CHARS = 5000

# Language code (lowercase ISO 639-1) -> the exact Piper voice id baked into this image
# by the Dockerfile's `piper.download_voices` calls. "en" is DEFAULT_LANGUAGE and must
# always be present -- every other entry is a genuine bonus voice this service can fall
# back away from without breaking anything that only ever asked for English.
VOICE_MODELS: dict[str, str] = {
    "en": "en_US-lessac-medium",
    "es": "es_ES-davefx-medium",
    "fr": "fr_FR-siwis-medium",
}
DEFAULT_LANGUAGE = "en"

app = FastAPI(title="Newton Piper TTS")
_voices: dict[str, PiperVoice] = {}


@app.on_event("startup")
def load_voices() -> None:
    for language, model_id in VOICE_MODELS.items():
        model_path = VOICES_DIR / f"{model_id}.onnx"
        if not model_path.exists():
            if language == DEFAULT_LANGUAGE:
                raise RuntimeError(f"Voice model not found at {model_path} — check the image build step.")
            # A bonus (non-default) voice missing from the image is a real, recoverable
            # condition -- e.g. a partial/older build -- not a reason to refuse to
            # start. /synthesize's own fallback logic below handles the resulting gap
            # honestly (a request for that language falls back to DEFAULT_LANGUAGE and
            # says so), same as an outright-unsupported language would.
            logger.warning(
                "voice model for language=%s not found at %s -- that language will "
                "fall back to %s until the image is rebuilt with it",
                language,
                model_path,
                DEFAULT_LANGUAGE,
            )
            continue
        _voices[language] = PiperVoice.load(str(model_path))
        logger.info("Loaded Piper voice model %s for language=%s", model_id, language)


@app.get("/health")
def health() -> dict:
    return {"status": "ok" if _voices else "loading", "languages": sorted(_voices)}


class SynthesizeRequest(BaseModel):
    text: str
    # ISO 639-1 code, e.g. "es". Omitted/unrecognized both mean "use the default voice"
    # -- this endpoint never errors over a language it doesn't have, it substitutes.
    language: str | None = None


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest) -> Response:
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "text must not be empty")
    if len(text) > MAX_TEXT_CHARS:
        raise HTTPException(400, f"text too long — max {MAX_TEXT_CHARS} characters")
    if not _voices:
        raise HTTPException(503, "voice model still loading")

    requested_language = (req.language or "").strip().lower() or DEFAULT_LANGUAGE
    voice = _voices.get(requested_language)
    fell_back = voice is None
    used_language = requested_language
    if fell_back:
        voice = _voices.get(DEFAULT_LANGUAGE)
        used_language = DEFAULT_LANGUAGE
    if voice is None:
        # Only reachable if even the default voice failed to load, which startup
        # already refuses to start over -- defensive, not a real runtime path.
        raise HTTPException(503, "no voice model available")

    if fell_back and requested_language != DEFAULT_LANGUAGE:
        logger.info(
            "no voice for requested language=%s -- falling back to default=%s",
            requested_language,
            DEFAULT_LANGUAGE,
        )

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        voice.synthesize_wav(text, wav_file)

    # Honest metadata about what actually played, for a caller that wants to know
    # (app/tools/voice_tts.py's TTSResult) rather than silently trusting the request it
    # sent — see this module's own docstring for why that matters here specifically.
    headers = {
        "X-TTS-Voice-Language": used_language,
        "X-TTS-Voice-Requested": requested_language,
        "X-TTS-Fallback": "true" if fell_back else "false",
    }
    return Response(content=buffer.getvalue(), media_type="audio/wav", headers=headers)
