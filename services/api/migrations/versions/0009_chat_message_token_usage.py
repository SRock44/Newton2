"""Token usage per chat message

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-13

Adds prompt_tokens/completion_tokens to chat_messages, populated on assistant messages
by app/agents/tutor.py's UsageInfo event (see app/routers/chat.py's chat_ws). Nullable:
user messages never have it, and neither do assistant messages predating this column or
ones ended by Stop before the provider's trailing usage chunk arrived. Summed
client-side for the "Newton Context" panel's per-chat token total.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("chat_messages", sa.Column("prompt_tokens", sa.Integer(), nullable=True))
    op.add_column("chat_messages", sa.Column("completion_tokens", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_messages", "completion_tokens")
    op.drop_column("chat_messages", "prompt_tokens")
