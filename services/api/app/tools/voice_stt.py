from typing import Any

import httpx

from app.core.config import get_settings

# Deliberately NOT a Tool subclass registered with app/tools/registry.py: unlike every
# other tool, there's no sensible way for the model to invoke this via JSON tool-call
# arguments (the input is raw audio bytes, not something the model could construct) and
# transcription always happens *before* the model ever sees the turn, not as a
# mid-conversation decision it makes -- the same reason VisionTool's image bytes are
# fetched out-of-band by an id rather than passed as a tool argument, just one step
# further removed. This is a plain service client called directly by a router endpoint
# (see app/routers/voice.py), kept in app/tools/ to sit next to voice_tts.py and match
# this codebase's existing base_url/transport/clean-error-string shape (see
# app/tools/grammar_check.py) for the same testability reasons.


class VoiceSTTError(Exception):
    """Raised by VoiceSTTClient.transcribe on any upstream failure; the router turns
    this into an HTTP error response rather than a string, since (unlike a Tool) there's
    no model in the loop to hand a string result back to."""


class VoiceSTTClient:
    name = "voice_stt"

    def __init__(
        self,
        base_url: str | None = None,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 30.0,
    ):
        self.base_url = (base_url or get_settings().whisper_asr_url).rstrip("/")
        self._transport = transport
        self.timeout = timeout

    async def transcribe(self, audio: bytes, filename: str, content_type: str, language: str | None = None) -> str:
        if not audio:
            raise VoiceSTTError("audio must not be empty")

        params: dict[str, Any] = {"output": "json"}
        if language:
            params["language"] = language

        try:
            async with httpx.AsyncClient(
                base_url=self.base_url, timeout=self.timeout, transport=self._transport
            ) as client:
                response = await client.post(
                    "/asr",
                    params=params,
                    files={"audio_file": (filename, audio, content_type)},
                )
                response.raise_for_status()
                data = response.json()
        except VoiceSTTError:
            raise
        except Exception as exc:
            raise VoiceSTTError(f"could not reach the speech-to-text service ({exc})") from exc

        text = data.get("text")
        if not isinstance(text, str):
            raise VoiceSTTError("speech-to-text service returned an unexpected response")
        return text.strip()
