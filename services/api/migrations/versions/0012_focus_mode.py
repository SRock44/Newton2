"""Self-service Focus Mode

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-14

Adds focus_mode_enabled to users -- a self-service, student-toggled setting (NOT a
teacher/guardian-administered one; this codebase has no such account concept -- see
ROADMAP.md Phase 7's "teacher-configurable academic-integrity mode" item, which is a
separate, larger, explicitly-deferred piece of work). See app/agents/tutor.py's
FOCUS_MODE_SYSTEM_ADDENDUM and app/tools/write_research_paper.py's FOCUS_MODE_MESSAGE
for the real behavioral effects. Defaults to False for every existing and new row --
opt-in only.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("focus_mode_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("users", "focus_mode_enabled")
