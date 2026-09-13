import wave
from io import BytesIO

# Real, valid WAV bytes (not a placeholder blob) so this exercises the actual
# transcription path rather than assuming any bytes work — same spirit as
# test_images.py's tiny real PNG. A short burst of silence is enough: whisper should
# return *something* (a JSON `text` field, possibly empty for pure silence) without
# erroring, which is what these tests assert against a real running whisper-asr.
def _silent_wav_bytes(seconds: float = 1.0, rate: int = 16000) -> bytes:
    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(rate)
        wav_file.writeframes(b"\x00\x00" * int(rate * seconds))
    return buffer.getvalue()


async def test_transcribe_accepts_real_audio_and_returns_text(http_client, auth_headers):
    resp = await http_client.post(
        "/voice/transcribe",
        headers=auth_headers,
        files={"file": ("silence.wav", _silent_wav_bytes(), "audio/wav")},
    )
    assert resp.status_code == 200, resp.text
    assert "text" in resp.json()
    assert isinstance(resp.json()["text"], str)


async def test_transcribe_rejects_empty_audio(http_client, auth_headers):
    resp = await http_client.post(
        "/voice/transcribe",
        headers=auth_headers,
        files={"file": ("empty.wav", b"", "audio/wav")},
    )
    assert resp.status_code == 400


async def test_transcribe_requires_auth(http_client):
    resp = await http_client.post(
        "/voice/transcribe",
        files={"file": ("silence.wav", _silent_wav_bytes(), "audio/wav")},
    )
    assert resp.status_code in (401, 403)


async def test_synthesize_returns_real_playable_wav_audio(http_client, auth_headers):
    resp = await http_client.post(
        "/voice/synthesize",
        headers=auth_headers,
        json={"text": "Newton is a self hosted agentic learning environment."},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "audio/wav"
    assert len(resp.content) > 1000  # real synthesized speech, not an empty/stub body

    with wave.open(BytesIO(resp.content), "rb") as wav_file:
        assert wav_file.getnframes() > 0
        assert wav_file.getnchannels() == 1


async def test_synthesize_rejects_empty_text(http_client, auth_headers):
    resp = await http_client.post("/voice/synthesize", headers=auth_headers, json={"text": "   "})
    assert resp.status_code == 400


async def test_synthesize_requires_auth(http_client):
    resp = await http_client.post("/voice/synthesize", json={"text": "hello"})
    assert resp.status_code in (401, 403)
