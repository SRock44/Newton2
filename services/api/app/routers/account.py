from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.db.base import get_db
from app.db.models import User
from app.services import edu_verification
from app.services.account import delete_own_account
from app.services.users import get_or_create_user

router = APIRouter(prefix="/account", tags=["account"])

# Minor-consent / age-gate scaffolding (ROADMAP.md Phase 7 / migration 0014 /
# docs/data-retention-and-privacy.md). "under_13" is a real, valid answer -- it's
# recorded (see submit_age_consent below) but deliberately never sets consented_at,
# since a student's own self-attestation is not COPPA's required verifiable PARENTAL
# consent. See the docs file for the full reasoning and the real gap this leaves.
AGE_BANDS = ("under_13", "13_17", "18_plus")


class AgeConsentRequest(BaseModel):
    age_band: str


def _serialize_consent(user: User) -> dict:
    return {
        "age_band": user.age_band,
        "consented_at": user.consented_at.isoformat() if user.consented_at else None,
        # True until a "13_17"/"18_plus" answer is recorded -- the desktop app's
        # age-gate screen (App.tsx) blocks the rest of the UI on this exact flag, every
        # sign-in, not just once (deliberately server-side, unlike the local-only
        # first-run onboarding card in lib/onboarding.ts, since this needs to survive a
        # reinstall/new device and actually mean something as a compliance record).
        "needs_consent": user.consented_at is None,
    }


@router.get("")
async def account_status(
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Read-only: whether the calling user still needs to complete the age-gate step,
    and what they've answered so far (if anything). See POST /account/age-consent."""
    user = await get_or_create_user(db, claims)
    await db.commit()  # persist the user row if get_or_create_user just created it
    return _serialize_consent(user)


@router.post("/age-consent")
async def submit_age_consent(
    body: AgeConsentRequest,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Records the age band a student selected on the desktop app's first-pass age-gate
    screen. "under_13" is recorded but never unlocks the app (consented_at stays null,
    so account_status above keeps reporting needs_consent=True) -- see this module's
    AGE_BANDS comment and docs/data-retention-and-privacy.md for why. "13_17"/"18_plus"
    both set consented_at to now, which is what actually unblocks the desktop app's
    AgeGateScreen."""
    if body.age_band not in AGE_BANDS:
        raise HTTPException(status_code=400, detail=f"age_band must be one of {AGE_BANDS}")

    user = await get_or_create_user(db, claims)
    user.age_band = body.age_band
    user.consented_at = datetime.now(timezone.utc) if body.age_band != "under_13" else None
    await db.commit()
    return _serialize_consent(user)


@router.delete("")
async def delete_account(
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Deletes the calling user's own account and everything they own (chat history,
    documents, study plan items, flashcards/review logs, practice exams, profile
    facts, Google Classroom connection) via migration 0010's ON DELETE CASCADE, plus
    their MinIO-stored files. Deliberately takes no user-id parameter -- this is
    "delete my own account," never an admin operation on someone else's. See
    app/services/account.py's delete_own_account for the MinIO-ordering and
    Keycloak-identity-scope reasoning."""
    user = await get_or_create_user(db, claims)
    await db.commit()  # persist the user row if get_or_create_user just created it
    await delete_own_account(db, user)
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Free Pro for a verified school email -- see app/services/edu_verification.py.
# ---------------------------------------------------------------------------


class EduVerificationStart(BaseModel):
    email: str


class EduVerificationConfirm(BaseModel):
    code: str


def _serialize_edu_status(user: User) -> dict:
    return {
        "edu_email": user.edu_email,
        "edu_verified_at": user.edu_verified_at.isoformat() if user.edu_verified_at else None,
        "eligible_domains": edu_verification.allowed_domains(),
    }


@router.get("/edu-verification")
async def edu_verification_status(
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Whether this account already has free Pro from a verified school email, and
    which domains are currently eligible (so the Settings UI can say so before the
    student even types an address)."""
    user = await get_or_create_user(db, claims)
    await db.commit()
    return _serialize_edu_status(user)


@router.post("/edu-verification/start")
async def start_edu_verification(
    body: EduVerificationStart,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Emails a 6-digit code to the given school address. 400 for a domain that isn't
    on the allowlist, 503 if outbound email isn't configured yet (see
    app/services/email.py) -- never a raw 500 for either, both are expected,
    recoverable states, not bugs."""
    user = await get_or_create_user(db, claims)
    try:
        await edu_verification.start_edu_verification(db, user, body.email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    await db.commit()
    return {"status": "sent"}


@router.post("/edu-verification/confirm")
async def confirm_edu_verification(
    body: EduVerificationConfirm,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Checks the code the student typed back in. A wrong/expired/missing code is
    reported identically (400, same message) -- see edu_verification.confirm_
    edu_verification's own comment for why that's deliberate, not an oversight."""
    user = await get_or_create_user(db, claims)
    verified = await edu_verification.confirm_edu_verification(db, user, body.code)
    await db.commit()
    if not verified:
        raise HTTPException(status_code=400, detail="That code is wrong or has expired.")
    return _serialize_edu_status(user)
