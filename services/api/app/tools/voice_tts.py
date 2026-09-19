from dataclasses import dataclass

import httpx

from app.core.config import get_settings

# See voice_stt.py's module docstring: same reasoning applies here in reverse --
# synthesis happens on the model's *finished* response text, not as a tool call the
# model makes mid-turn, so this is a plain service client for a router endpoint (see
# app/routers/voice.py), not a registered Tool.

# Mirrors services/piper-tts/app/main.py's VOICE_MODELS keys exactly -- this is the set
# of languages that actually have a real Piper voice baked into the piper-tts image.
# Kept here (not imported from the other service, which isn't importable from this
# process) as the API layer's own copy of the same fact, same "two independent sources
# of truth that are expected to agree, verified by the live_smoke tests" pattern as
# app/agents/tutor.py's CONVERSATION_PRACTICE_LANGUAGE_NAMES.
SUPPORTED_LANGUAGES = frozenset({"en", "es", "fr"})
DEFAULT_LANGUAGE = "en"


@dataclass
class TTSResult:
    """What actually happened server-side, not just the raw bytes -- `language`/
    `fallback` come from piper-tts's own response headers (see its main.py), so a
    caller can know honestly whether the requested language's voice was really used or
    silently swapped for the default, rather than guessing from the request alone."""

    audio: bytes
    language: str
    fallback: bool


class VoiceTTSError(Exception):
    """Raised by VoiceTTSClient.synthesize on any upstream failure."""


class VoiceTTSClient:
    name = "voice_tts"

    def __init__(
        self,
        base_url: str | None = None,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 30.0,
    ):
        self.base_url = (base_url or get_settings().piper_tts_url).rstrip("/")
        self._transport = transport
        self.timeout = timeout

    async def synthesize(self, text: str, language: str | None = None) -> TTSResult:
        """`language` is an ISO 639-1 code (e.g. "es") -- passed straight through to
        piper-tts, which picks the matching voice or honestly falls back to the
        default English voice (never a silent garbled mismatch, see its main.py). Left
        unset/None (the "Listen" button's own default behavior, unchanged from before
        this parameter existed) omits the field entirely rather than sending an empty
        string, so an older or stricter server sees exactly the same request shape it
        always has."""
        text = (text or "").strip()
        if not text:
            raise VoiceTTSError("text must not be empty")

        payload: dict[str, str] = {"text": text}
        normalized_language = (language or "").strip().lower()
        if normalized_language:
            payload["language"] = normalized_language

        try:
            async with httpx.AsyncClient(
                base_url=self.base_url, timeout=self.timeout, transport=self._transport
            ) as client:
                response = await client.post("/synthesize", json=payload)
                response.raise_for_status()
        except VoiceTTSError:
            raise
        except Exception as exc:
            raise VoiceTTSError(f"could not reach the text-to-speech service ({exc})") from exc

        if not response.content:
            raise VoiceTTSError("text-to-speech service returned empty audio")

        # Read defensively: an older piper-tts (or any mocked response in a test) that
        # doesn't send these headers at all must still produce a usable result rather
        # than crashing on a missing key -- same fail-honest-not-fail-loud spirit as
        # everything else in this module. Falls back to reporting whatever language was
        # actually requested (or the default, if none was) as a best-effort guess.
        used_language = response.headers.get("x-tts-voice-language") or normalized_language or DEFAULT_LANGUAGE
        fallback = response.headers.get("x-tts-fallback", "").strip().lower() == "true"
        return TTSResult(audio=response.content, language=used_language, fallback=fallback)
