import httpx
import pytest

from app.tools.voice_stt import VoiceSTTClient, VoiceSTTError
from app.tools.voice_tts import VoiceTTSClient, VoiceTTSError


def _mock_transport(handler):
    return httpx.MockTransport(handler)


# ---- VoiceSTTClient.transcribe --------------------------------------------------------


async def test_transcribe_raises_for_empty_audio():
    client = VoiceSTTClient(base_url="http://whisper-asr:9000")
    with pytest.raises(VoiceSTTError, match="empty"):
        await client.transcribe(b"", filename="a.wav", content_type="audio/wav")


async def test_transcribe_parses_the_text_field_from_a_mocked_response():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/asr"
        assert request.url.params.get("output") == "json"
        return httpx.Response(200, json={"text": "  what is the derivative of x squared  "})

    client = VoiceSTTClient(base_url="http://whisper-asr:9000", transport=_mock_transport(handler))
    text = await client.transcribe(b"fake-audio-bytes", filename="q.wav", content_type="audio/wav")
    assert text == "what is the derivative of x squared"


async def test_transcribe_sends_language_as_a_query_param_when_given():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["language"] = request.url.params.get("language")
        return httpx.Response(200, json={"text": "bonjour"})

    client = VoiceSTTClient(base_url="http://whisper-asr:9000", transport=_mock_transport(handler))
    await client.transcribe(b"audio", filename="a.wav", content_type="audio/wav", language="fr")
    assert seen["language"] == "fr"


async def test_transcribe_omits_language_param_when_not_given():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["has_language"] = "language" in request.url.params
        return httpx.Response(200, json={"text": "hi"})

    client = VoiceSTTClient(base_url="http://whisper-asr:9000", transport=_mock_transport(handler))
    await client.transcribe(b"audio", filename="a.wav", content_type="audio/wav")
    assert seen["has_language"] is False


async def test_transcribe_raises_on_http_error_status():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="upstream unavailable")

    client = VoiceSTTClient(base_url="http://whisper-asr:9000", transport=_mock_transport(handler))
    with pytest.raises(VoiceSTTError):
        await client.transcribe(b"audio", filename="a.wav", content_type="audio/wav")


async def test_transcribe_raises_on_connection_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    client = VoiceSTTClient(base_url="http://whisper-asr:9000", transport=_mock_transport(handler))
    with pytest.raises(VoiceSTTError):
        await client.transcribe(b"audio", filename="a.wav", content_type="audio/wav")


async def test_transcribe_raises_when_text_field_missing():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"segments": []})

    client = VoiceSTTClient(base_url="http://whisper-asr:9000", transport=_mock_transport(handler))
    with pytest.raises(VoiceSTTError, match="unexpected"):
        await client.transcribe(b"audio", filename="a.wav", content_type="audio/wav")


# ---- VoiceTTSClient.synthesize ---------------------------------------------------------


async def test_synthesize_raises_for_empty_text():
    client = VoiceTTSClient(base_url="http://piper-tts:8000")
    with pytest.raises(VoiceTTSError, match="empty"):
        await client.synthesize("   ")


async def test_synthesize_returns_the_raw_audio_bytes():
    fake_wav = b"RIFF....WAVEfmt fake audio bytes"

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/synthesize"
        import json

        assert json.loads(request.content)["text"] == "hello world"
        return httpx.Response(200, content=fake_wav, headers={"content-type": "audio/wav"})

    client = VoiceTTSClient(base_url="http://piper-tts:8000", transport=_mock_transport(handler))
    audio = await client.synthesize("hello world")
    assert audio == fake_wav


async def test_synthesize_raises_on_http_error_status():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="internal error")

    client = VoiceTTSClient(base_url="http://piper-tts:8000", transport=_mock_transport(handler))
    with pytest.raises(VoiceTTSError):
        await client.synthesize("hello")


async def test_synthesize_raises_on_connection_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    client = VoiceTTSClient(base_url="http://piper-tts:8000", transport=_mock_transport(handler))
    with pytest.raises(VoiceTTSError):
        await client.synthesize("hello")


async def test_synthesize_raises_on_empty_response_body():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"")

    client = VoiceTTSClient(base_url="http://piper-tts:8000", transport=_mock_transport(handler))
    with pytest.raises(VoiceTTSError, match="empty"):
        await client.synthesize("hello")
