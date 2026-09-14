"""Self-service Learn Mode

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-14

Adds learn_mode_enabled to users -- a self-service, student-toggled setting, exactly
the same pattern as migration 0012's focus_mode_enabled (NOT a teacher/guardian-
administered one; see that migration's docstring for why this codebase doesn't have
that account concept). Independent of and stackable with focus_mode_enabled -- a
student can turn on either, both, or neither. See app/agents/tutor.py's
LEARN_MODE_SYSTEM_ADDENDUM and app/routers/billing.py's PATCH /billing/learn-mode for
the real behavioral effects. Defaults to False for every existing and new row -- opt-in
only, byte-for-byte identical behavior for anyone who never touches the toggle.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("learn_mode_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("users", "learn_mode_enabled")
