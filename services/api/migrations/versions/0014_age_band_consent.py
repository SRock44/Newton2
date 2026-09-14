"""Minor-consent / age-gate scaffolding on users

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-14

ROADMAP.md Phase 7's "explicit FERPA/COPPA/GDPR data-retention posture" item -- a
first-pass DRAFT, not a lawyer-reviewed compliance flow. See
docs/data-retention-and-privacy.md for the real design decision and its honest,
explicit gaps (most importantly: this does NOT implement COPPA's verifiable-parental-
consent requirement -- it records a self-reported age band and BLOCKS further use for
anyone who says they're under 13, rather than claiming to have obtained real parental
consent it doesn't have).

age_band: nullable free-text ("under_13" / "13_17" / "18_plus"), validated at the app
layer (app/routers/account.py) rather than a DB enum/CHECK constraint, matching this
codebase's existing style for status-like columns (flashcards.fsrs_state,
practice_exams.difficulty). Every existing row starts NULL -- this migration does not
and cannot retroactively ask already-registered students their age; the desktop app's
new age-gate screen (App.tsx) asks on next sign-in instead.

consented_at: nullable timestamp, set only when age_band is "13_17" or "18_plus".
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("age_band", sa.String(), nullable=True))
    op.add_column("users", sa.Column("consented_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "consented_at")
    op.drop_column("users", "age_band")
