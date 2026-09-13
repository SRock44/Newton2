import httpx

from app.core.config import get_settings

# See voice_stt.py's module docstring: same reasoning applies here in reverse --
# synthesis happens on the model's *finished* response text, not as a tool call the
# model makes mid-turn, so this is a plain service client for a router endpoint (see
# app/routers/voice.py), not a registered Tool.


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

    async def synthesize(self, text: str) -> bytes:
        text = (text or "").strip()
        if not text:
            raise VoiceTTSError("text must not be empty")

        try:
            async with httpx.AsyncClient(
                base_url=self.base_url, timeout=self.timeout, transport=self._transport
            ) as client:
                response = await client.post("/synthesize", json={"text": text})
                response.raise_for_status()
        except VoiceTTSError:
            raise
        except Exception as exc:
            raise VoiceTTSError(f"could not reach the text-to-speech service ({exc})") from exc

        if not response.content:
            raise VoiceTTSError("text-to-speech service returned empty audio")
        return response.content
