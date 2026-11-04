import wave
from io import BytesIO

import pytest
import pytest_asyncio
from jose import jwt as jose_jwt
from sqlalchemy import select

from app.db.models import User


@pytest_asyncio.fixture
async def pro_student(db_session, keycloak_token):
    """Voice is gated to Pro (see app/routers/voice.py's _require_pro) -- flips the
    real dev Keycloak student1 user (the one keycloak_token/auth_headers authenticates
    as) to plan="pro" for the duration of the test, and restores whatever plan it
    actually had before (snapshot/restore, same pattern as test_billing.py's
    student1_status_snapshot/student1_focus_mode_snapshot).

    Real incident this fixes: this used to hardcode the teardown to plan="free"
    instead of snapshotting the original value -- but student1 is a PERMANENT Pro
    account (ROADMAP.md: "student1 (dev test account) granted permanent Pro access
    directly in the database"), relied on by dozens of other live-verification passes
    documented there. Every full suite run that exercised this fixture was silently
    reverting that permanent grant back to free, which is exactly the "student1 is
    plan='free' by default" comments elsewhere in this very file were describing --
    not the real baseline, a side effect of this bug normalizing itself over time.
    Caught when the product owner reported Settings showing "Free plan" on a real
    sign-in; traced to this fixture via `git log`/ROADMAP.md, confirmed by a direct
    `psql` read showing plan='free' on the live dev DB, fixed by restoring it to 'pro'
    there AND fixing the actual leak here so it can't happen again."""
    sub = jose_jwt.get_unverified_claims(keycloak_token)["sub"]
    user = (await db_session.execute(select(User).where(User.keycloak_sub == sub))).scalar_one_or_none()
    if user is None:
        user = User(keycloak_sub=sub, plan="pro")
        db_session.add(user)
        await db_session.commit()
        original_plan = "pro"
    else:
        original_plan = user.plan
        user.plan = "pro"
        await db_session.commit()

    yield

    user.plan = original_plan
    await db_session.commit()


@pytest_asyncio.fixture
async def free_student(db_session, keycloak_token):
    """The negative-path mirror of pro_student above: temporarily flips student1 to
    plan="free" so a Pro-gated endpoint's rejection path can actually be exercised,
    restoring whatever plan it really had before (never hardcoded back to "free" --
    see pro_student's own comment for the real incident that taught this lesson).
    Needed because student1 is a PERMANENT Pro account (ROADMAP.md) -- these two
    rejection tests used to implicitly depend on a *different* bug (pro_student's old
    hardcoded-to-free teardown) having already corrupted student1 back to free before
    they ran, which is exactly the kind of cross-test ordering dependency a dedicated
    fixture exists to avoid."""
    sub = jose_jwt.get_unverified_claims(keycloak_token)["sub"]
    user = (await db_session.execute(select(User).where(User.keycloak_sub == sub))).scalar_one_or_none()
    if user is None:
        user = User(keycloak_sub=sub, plan="free")
        db_session.add(user)
        await db_session.commit()
        original_plan = "free"
    else:
        original_plan = user.plan
        user.plan = "free"
        await db_session.commit()

    yield

    user.plan = original_plan
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


@pytest.mark.live_smoke
async def test_transcribe_accepts_real_audio_and_returns_text(http_client, auth_headers, pro_student):
    resp = await http_client.post(
        "/voice/transcribe",
        headers=auth_headers,
        files={"file": ("silence.wav", _silent_wav_bytes(), "audio/wav")},
    )
    assert resp.status_code == 200, resp.text
    assert "text" in resp.json()
    assert isinstance(resp.json()["text"], str)


async def test_transcribe_rejects_a_free_plan_user(http_client, auth_headers, free_student):
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


@pytest.mark.live_smoke
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


@pytest.mark.live_smoke
async def test_synthesize_returns_real_spanish_audio_with_a_different_voice(http_client, auth_headers, pro_student):
    """Real, multi-language Piper voices (see services/piper-tts/Dockerfile/app/
    main.py) -- not just "some audio comes back", but genuinely a DIFFERENT voice than
    the plain English request above, proven by X-TTS-Voice-Language actually reporting
    "es" (never a silent fallback) and by producing a real, sane-sized WAV for the
    input text length."""
    resp = await http_client.post(
        "/voice/synthesize",
        headers=auth_headers,
        json={"text": "Hola, vamos a practicar espanol juntos.", "language": "es"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "audio/wav"
    assert resp.headers.get("x-tts-voice-language") == "es"
    assert resp.headers.get("x-tts-fallback") == "false"
    assert len(resp.content) > 1000  # real synthesized speech, not an empty/stub body

    with wave.open(BytesIO(resp.content), "rb") as wav_file:
        assert wav_file.getnframes() > 0
        assert wav_file.getnchannels() == 1


@pytest.mark.live_smoke
async def test_synthesize_returns_real_french_audio_with_a_different_voice(http_client, auth_headers, pro_student):
    resp = await http_client.post(
        "/voice/synthesize",
        headers=auth_headers,
        json={"text": "Bonjour, pratiquons le francais ensemble.", "language": "fr"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "audio/wav"
    assert resp.headers.get("x-tts-voice-language") == "fr"
    assert resp.headers.get("x-tts-fallback") == "false"
    assert len(resp.content) > 1000

    with wave.open(BytesIO(resp.content), "rb") as wav_file:
        assert wav_file.getnframes() > 0


@pytest.mark.live_smoke
async def test_synthesize_falls_back_honestly_for_an_unsupported_language(http_client, auth_headers, pro_student):
    """A language with no baked-in Piper voice must still return real, playable audio
    (the default English voice), and say so honestly via X-TTS-Fallback rather than
    silently mismatching or erroring."""
    resp = await http_client.post(
        "/voice/synthesize",
        headers=auth_headers,
        json={"text": "This should fall back to English.", "language": "de"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers.get("x-tts-voice-language") == "en"
    assert resp.headers.get("x-tts-fallback") == "true"
    assert len(resp.content) > 1000

    with wave.open(BytesIO(resp.content), "rb") as wav_file:
        assert wav_file.getnframes() > 0


async def test_synthesize_rejects_a_free_plan_user(http_client, auth_headers, free_student):
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
