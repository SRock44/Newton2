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
    result = await client.synthesize("hello world")
    assert result.audio == fake_wav


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


# ---- VoiceTTSClient.synthesize — language/voice selection (Conversation Practice) -----
# Real, multi-language Piper voices (see services/piper-tts/Dockerfile/app/main.py):
# this proves the CLIENT sends the language the caller asked for and honestly reports
# back whatever piper-tts says it actually used, including a fallback -- not that Piper
# itself picks the right model (that's services/piper-tts's own concern, exercised for
# real by the live_smoke tests in test_voice_router.py against the real running
# service).


async def test_synthesize_sends_the_requested_language_in_the_request_body():
    import json

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            content=b"fake-spanish-wav",
            headers={"X-TTS-Voice-Language": "es", "X-TTS-Fallback": "false"},
        )

    client = VoiceTTSClient(base_url="http://piper-tts:8000", transport=_mock_transport(handler))
    result = await client.synthesize("hola", language="es")

    assert seen["body"] == {"text": "hola", "language": "es"}
    assert result.language == "es"
    assert result.fallback is False


async def test_synthesize_lowercases_and_normalizes_the_language_code():
    import json

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, content=b"fake-wav", headers={"X-TTS-Voice-Language": "fr"})

    client = VoiceTTSClient(base_url="http://piper-tts:8000", transport=_mock_transport(handler))
    await client.synthesize("bonjour", language="  FR  ")

    assert seen["body"]["language"] == "fr"


async def test_synthesize_omits_the_language_field_when_none_given():
    import json

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["has_language"] = "language" in json.loads(request.content)
        return httpx.Response(200, content=b"fake-wav", headers={"X-TTS-Voice-Language": "en"})

    client = VoiceTTSClient(base_url="http://piper-tts:8000", transport=_mock_transport(handler))
    await client.synthesize("hello")

    assert seen["has_language"] is False


async def test_synthesize_reports_a_true_fallback_for_an_unsupported_language():
    """A language piper-tts has no voice for must never silently produce audio in the
    wrong (or a garbled) voice -- the service falls back to the default voice and says
    so via response headers (see services/piper-tts/app/main.py), and this client must
    surface that honestly rather than pretending the request's language was honored."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=b"fake-english-fallback-wav",
            headers={
                "X-TTS-Voice-Language": "en",
                "X-TTS-Voice-Requested": "de",
                "X-TTS-Fallback": "true",
            },
        )

    client = VoiceTTSClient(base_url="http://piper-tts:8000", transport=_mock_transport(handler))
    result = await client.synthesize("Guten Tag", language="de")

    assert result.audio == b"fake-english-fallback-wav"
    assert result.language == "en"
    assert result.fallback is True


async def test_synthesize_defaults_language_and_fallback_when_headers_are_missing():
    """An older/mocked server that never sends the new headers at all must still yield
    a usable TTSResult (best-effort language guess, fallback assumed False) instead of
    raising -- see VoiceTTSClient.synthesize's own defensive-read comment."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"fake-wav")  # no X-TTS-* headers at all

    client = VoiceTTSClient(base_url="http://piper-tts:8000", transport=_mock_transport(handler))
    result = await client.synthesize("hello", language="es")

    assert result.language == "es"  # best-effort guess: what was requested
    assert result.fallback is False


async def test_synthesize_defaults_language_to_english_when_none_requested_and_headers_missing():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"fake-wav")

    client = VoiceTTSClient(base_url="http://piper-tts:8000", transport=_mock_transport(handler))
    result = await client.synthesize("hello")

    assert result.language == "en"
