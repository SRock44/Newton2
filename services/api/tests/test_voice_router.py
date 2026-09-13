import wave
from io import BytesIO

import pytest_asyncio
from jose import jwt as jose_jwt
from sqlalchemy import select

from app.db.models import User


@pytest_asyncio.fixture
async def pro_student(db_session, keycloak_token):
    """Voice is gated to Pro (see app/routers/voice.py's _require_pro) -- flips the
    real dev Keycloak student1 user (the one keycloak_token/auth_headers authenticates
    as) to plan="pro" for the duration of the test, and reverts it afterward so other
    tests keep seeing the normal free-tier default."""
    sub = jose_jwt.get_unverified_claims(keycloak_token)["sub"]
    user = (await db_session.execute(select(User).where(User.keycloak_sub == sub))).scalar_one_or_none()
    if user is None:
        user = User(keycloak_sub=sub, plan="pro")
        db_session.add(user)
    else:
        user.plan = "pro"
    await db_session.commit()

    yield

    user.plan = "free"
    await db_session.commit()


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


async def test_transcribe_accepts_real_audio_and_returns_text(http_client, auth_headers, pro_student):
    resp = await http_client.post(
        "/voice/transcribe",
        headers=auth_headers,
        files={"file": ("silence.wav", _silent_wav_bytes(), "audio/wav")},
    )
    assert resp.status_code == 200, resp.text
    assert "text" in resp.json()
    assert isinstance(resp.json()["text"], str)


async def test_transcribe_rejects_a_free_plan_user(http_client, auth_headers):
    # No pro_student fixture here -- student1 is plan="free" by default.
    resp = await http_client.post(
        "/voice/transcribe",
        headers=auth_headers,
        files={"file": ("silence.wav", _silent_wav_bytes(), "audio/wav")},
    )
    assert resp.status_code == 402
    assert "Pro" in resp.json()["detail"]


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


async def test_synthesize_returns_real_playable_wav_audio(http_client, auth_headers, pro_student):
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


async def test_synthesize_rejects_a_free_plan_user(http_client, auth_headers):
    # No pro_student fixture here -- student1 is plan="free" by default.
    resp = await http_client.post(
        "/voice/synthesize",
        headers=auth_headers,
        json={"text": "hello there"},
    )
    assert resp.status_code == 402
    assert "Pro" in resp.json()["detail"]


async def test_synthesize_rejects_empty_text(http_client, auth_headers):
    resp = await http_client.post("/voice/synthesize", headers=auth_headers, json={"text": "   "})
    assert resp.status_code == 400


async def test_synthesize_requires_auth(http_client):
    resp = await http_client.post("/voice/synthesize", json={"text": "hello"})
    assert resp.status_code in (401, 403)
