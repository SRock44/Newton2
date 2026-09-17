"""session_summaries.last_message_created_at -- the incremental-consolidation cursor

Revision ID: 0020
Revises: 0019
Create Date: 2026-09-17

app/jobs/consolidate.py used to re-read and re-summarize a session's ENTIRE transcript
every time it ran, and app/memory/working.py's CONSOLIDATION_INTERVAL_TURNS now fires it
periodically DURING an active session (every 20 turns), not just once at the end -- so a
200-turn session was re-sending turns 1-20, then 1-40, then 1-60, ... 1-200 across ten
calls: total input tokens processed grows with the SQUARE of session length, not linearly.

This column is the fix's cursor: the created_at of the newest ChatMessage folded into the
summary so far. The next run reads only messages strictly after it (see
consolidate.py's own comment on why), merging them into the existing summary instead of
re-reading everything from turn 1. Nullable and NULL on every existing row -- a session
consolidated before this migration just treats its next run as if there's no prior cursor,
which means one ordinary "catch-up" full read of whatever it hasn't summarized yet, not a
data problem.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: Union[str, None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "session_summaries",
        sa.Column("last_message_created_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("session_summaries", "last_message_created_at")
