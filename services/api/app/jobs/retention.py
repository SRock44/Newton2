"""Data-retention review job (ROADMAP.md Phase 7 / docs/data-retention-and-privacy.md).

SCOPE DECISION, recorded here and in the docs file: this job REPORTS which accounts
have gone quiet longer than INACTIVITY_THRESHOLD_DAYS. It does not delete, disable, or
email anyone. Two real reasons, not laziness:

1. Auto-deleting real student data on an unreviewed retention policy is exactly the
   kind of decision that needs real legal sign-off first -- shipping it unreviewed
   would be worse than shipping nothing. See the docs file's gap list.
2. This API service has no outbound-email capability of its own to check first. The
   only SMTP configuration anywhere in this stack is Keycloak's own realm SMTP (see
   infra/keycloak/setup_smtp.py), wired for Keycloak's own account-verification /
   password-reset emails -- there is no equivalent for this `api`/`worker` process to
   send a "your account will be considered for deletion" notice with, so that half of
   the brief (send a notice if outbound email already exists) genuinely doesn't apply
   yet. Building one is real, separate work, not something to bolt on silently here.

What this job DOES do: give whoever runs it (see report_inactive_accounts, registered
as a weekly arq cron job in app/jobs/worker.py, and independently callable directly for
an ad-hoc run) a concrete, real list of which accounts a retention policy would apply
to -- log lines plus a structured return value -- so that policy decision can be made
with real numbers in front of it instead of blind.

THRESHOLD REASONING: 540 days (~18 months) of no new chat session (see
find_inactive_accounts below for exactly how "no new chat session" is measured).
Picked to comfortably span one full school year plus the summer breaks on both sides
of it, so a student who only opens Newton during the school year is never flagged just
for going quiet over a single summer -- while still being short enough that a genuinely
abandoned account (a trial that never got used again, a graduated/transferred student)
doesn't sit flagged-never in the data forever. This is a first-pass number chosen by
this session, not a legally-reviewed retention schedule -- see the docs file.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import SessionLocal
from app.db.models import ChatSession, User

logger = logging.getLogger("newton.jobs.retention")

INACTIVITY_THRESHOLD_DAYS = 540


async def find_inactive_accounts(
    db: AsyncSession,
    *,
    threshold_days: int = INACTIVITY_THRESHOLD_DAYS,
    now: datetime | None = None,
) -> list[dict]:
    """Returns one dict per account whose last real activity is older than
    `threshold_days` before `now`. "Last real activity" is the most recent
    chat_sessions.created_at this user owns (starting a chat is the one action every
    real usage of this app funnels through), or -- for an account that has never
    started a single session -- its own users.created_at, so a stale, never-used
    signup is still eligible to be flagged rather than invisible forever.

    Pure query-and-filter, no side effects and nothing written to the DB -- kept
    separate from report_inactive_accounts below so the real selection logic has a
    direct, deterministic unit-test surface (pass an explicit `now`) independent of
    arq/logging."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=threshold_days)

    last_session = (
        select(ChatSession.user_id, func.max(ChatSession.created_at).label("last_active_at"))
        .group_by(ChatSession.user_id)
        .subquery()
    )
    rows = (
        await db.execute(
            select(User.id, User.email, User.created_at, last_session.c.last_active_at).outerjoin(
                last_session, last_session.c.user_id == User.id
            )
        )
    ).all()

    flagged: list[dict] = []
    for user_id, email, created_at, last_active_at in rows:
        effective_last_active = last_active_at or created_at
        if effective_last_active < cutoff:
            flagged.append(
                {
                    "user_id": str(user_id),
                    # Never log/return the address itself -- ops can look a user_id up
                    # directly if they need to act on one, and this report has no
                    # reason to carry PII it doesn't need.
                    "has_email": email is not None,
                    "last_active_at": effective_last_active.isoformat(),
                    "days_inactive": (now - effective_last_active).days,
                }
            )
    return flagged


async def report_inactive_accounts(ctx: dict) -> dict:
    """arq job entrypoint -- see app/jobs/worker.py's WorkerSettings.cron_jobs (weekly)
    for how this actually gets scheduled. `ctx` is arq's standard per-job context dict,
    unused here (same shape as consolidate_session's, which also ignores most of it).
    Report-only by design -- see this module's docstring."""
    async with SessionLocal() as db:
        flagged = await find_inactive_accounts(db)

    logger.warning(
        "data-retention report: %d account(s) inactive > %d days (report-only, no "
        "action taken -- see app/jobs/retention.py's module docstring and "
        "docs/data-retention-and-privacy.md)",
        len(flagged),
        INACTIVITY_THRESHOLD_DAYS,
    )
    for row in flagged:
        logger.info(
            "data-retention candidate user_id=%s days_inactive=%d", row["user_id"], row["days_inactive"]
        )

    return {"threshold_days": INACTIVITY_THRESHOLD_DAYS, "flagged_count": len(flagged), "flagged": flagged}
