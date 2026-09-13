from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.db.base import get_db
from app.services import billing as billing_service
from app.services.users import get_or_create_user
from app.tools.voice_stt import VoiceSTTClient, VoiceSTTError
from app.tools.voice_tts import VoiceTTSClient, VoiceTTSError

router = APIRouter(prefix="/voice", tags=["voice"])

MAX_AUDIO_BYTES = 20 * 1024 * 1024  # 20MB — a few minutes of voice, generous for a question

# Genuinely expensive self-hosted compute (whisper-asr/piper-tts), so — like
# start_study_session — this is gated to Pro. See app/services/billing.py's is_pro, the
# single shared plan check both Pro-only gates use.
PRO_ONLY_MESSAGE = "Voice is a Pro feature — upgrade to Newton Pro to use transcription and playback."

_stt = VoiceSTTClient()
_tts = VoiceTTSClient()


async def _require_pro(claims: dict, db: AsyncSession) -> None:
    user = await get_or_create_user(db, claims)
    await db.commit()
    if not billing_service.is_pro(user):
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, PRO_ONLY_MESSAGE)


@router.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str | None = None,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Transcribes a recorded voice question to text. The frontend records audio (e.g.
    holding a mic button), uploads it here, and drops the returned text straight into
    the chat composer for the student to review/edit before sending — this is NOT part
    of the agent tool-call loop (see voice_stt.py's module docstring for why)."""
    raw = await file.read()
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Audio is empty")
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Audio too large — max {MAX_AUDIO_BYTES // (1024 * 1024)}MB"
        )

    await _require_pro(claims, db)

    try:
        text = await _stt.transcribe(
            raw,
            filename=file.filename or "audio.wav",
            content_type=file.content_type or "audio/wav",
            language=language,
        )
    except VoiceSTTError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    return {"text": text}


class SynthesizeRequest(BaseModel):
    text: str


@router.post("/synthesize")
async def synthesize(
    body: SynthesizeRequest,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Synthesizes text (typically an assistant message) to speech so it can be read
    back. Returns raw WAV bytes the frontend plays directly — a "listen" action on a
    message bubble, not part of the agent tool-call loop."""
    if not body.text.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "text must not be empty")

    await _require_pro(claims, db)

    try:
        audio = await _tts.synthesize(body.text)
    except VoiceTTSError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    return Response(content=audio, media_type="audio/wav")
