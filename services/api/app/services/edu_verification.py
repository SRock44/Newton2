import random
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models import EduVerificationCode, User
from app.services.email import send_email

# How long a sent code stays valid, and how many wrong guesses it tolerates before it's
# dead regardless of time remaining -- see EduVerificationCode's own comment for why
# this matters (a static 6-digit space is brute-forceable without a guess limit).
CODE_TTL_MINUTES = 15
MAX_ATTEMPTS = 5

_EMAIL_RE = re.compile(r"^[^@\s]+@([^@\s]+)$")


def allowed_domains() -> list[str]:
    """The current school-domain allowlist, parsed from Settings.edu_verified_domains
    (a comma-separated .env value -- see that field's own comment for why)."""
    settings = get_settings()
    return [d.strip().lower() for d in settings.edu_verified_domains.split(",") if d.strip()]


def is_eligible_domain(email: str) -> bool:
    match = _EMAIL_RE.match(email.strip().lower())
    if not match:
        return False
    return match.group(1) in allowed_domains()


def _generate_code() -> str:
    # random, not secrets -- a 6-digit code's real protection is the attempt limit and
    # 15-minute expiry above (see MAX_ATTEMPTS), not cryptographic unpredictability of
    # a 10^6 space either way.
    return f"{random.randint(0, 999999):06d}"


async def start_edu_verification(db: AsyncSession, user: User, email: str) -> None:
    """Emails a fresh 6-digit code to `email`. Raises ValueError for a domain that
    isn't on the allowlist (the router turns that into a 400) or RuntimeError if SMTP
    isn't configured (-> 503, see app/services/email.py). Deletes any previous code for
    this account first, so there's only ever one live code per account -- requesting a
    new one invalidates whichever code was sent before it, rather than leaving multiple
    valid codes around.
    """
    if not is_eligible_domain(email):
        raise ValueError(f"{email} isn't an eligible school email")

    await db.execute(delete(EduVerificationCode).where(EduVerificationCode.user_id == user.id))

    code = _generate_code()
    db.add(
        EduVerificationCode(
            user_id=user.id,
            email=email.strip().lower(),
            code=code,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=CODE_TTL_MINUTES),
        )
    )
    await db.flush()

    # Sent AFTER the DB write is flushed (not committed -- the caller's router commits)
    # so a code is never emailed without a matching row to check it against; if send_email
    # raises, the router's exception handling means the transaction never commits either,
    # so there's no orphaned code a student could never possibly have received.
    send_email(
        email,
        "Your Newton verification code",
        f"Your code is {code}. It expires in {CODE_TTL_MINUTES} minutes.\n\n"
        "If you didn't request this, you can safely ignore this email.",
    )


async def confirm_edu_verification(db: AsyncSession, user: User, code: str) -> bool:
    """Checks `code` against this account's one live row. Returns False (never raises)
    for a wrong code (incrementing its attempt counter), an expired one, one that's hit
    MAX_ATTEMPTS, or no code at all -- the router reports all four identically, so a
    guesser learns nothing from the response about which failure mode they hit. Returns
    True and grants Pro (User.edu_verified_at, see billing.is_pro) on a real match.
    """
    row = (
        await db.execute(select(EduVerificationCode).where(EduVerificationCode.user_id == user.id))
    ).scalar_one_or_none()
    if row is None:
        return False
    if row.expires_at < datetime.now(timezone.utc) or row.attempts >= MAX_ATTEMPTS:
        return False
    if row.code != code.strip():
        row.attempts += 1
        await db.flush()
        return False

    user.edu_email = row.email
    user.edu_verified_at = datetime.now(timezone.utc)
    await db.execute(delete(EduVerificationCode).where(EduVerificationCode.user_id == user.id))
    await db.flush()
    return True
