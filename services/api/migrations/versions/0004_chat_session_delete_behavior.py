"""chat_sessions FKs: cascade messages/summaries, null out profile_facts' reference

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-12

Needed for the new "delete chat" feature: a chat message or session summary has no
meaning without its session, so they should go with it (CASCADE) rather than block
the delete. A profile fact is a durable, cross-session memory though -- deleting the
one chat it happened to be learned in shouldn't delete the fact itself, just its
audit-trail pointer back to that chat (SET NULL), same reasoning as migration 0003.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("chat_messages_session_id_fkey", "chat_messages", type_="foreignkey")
    op.create_foreign_key(
        "chat_messages_session_id_fkey",
        "chat_messages",
        "chat_sessions",
        ["session_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("session_summaries_session_id_fkey", "session_summaries", type_="foreignkey")
    op.create_foreign_key(
        "session_summaries_session_id_fkey",
        "session_summaries",
        "chat_sessions",
        ["session_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("profile_facts_source_session_id_fkey", "profile_facts", type_="foreignkey")
    op.create_foreign_key(
        "profile_facts_source_session_id_fkey",
        "profile_facts",
        "chat_sessions",
        ["source_session_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("profile_facts_source_session_id_fkey", "profile_facts", type_="foreignkey")
    op.create_foreign_key(
        "profile_facts_source_session_id_fkey", "profile_facts", "chat_sessions", ["source_session_id"], ["id"]
    )

    op.drop_constraint("session_summaries_session_id_fkey", "session_summaries", type_="foreignkey")
    op.create_foreign_key(
        "session_summaries_session_id_fkey", "session_summaries", "chat_sessions", ["session_id"], ["id"]
    )

    op.drop_constraint("chat_messages_session_id_fkey", "chat_messages", type_="foreignkey")
    op.create_foreign_key(
        "chat_messages_session_id_fkey", "chat_messages", "chat_sessions", ["session_id"], ["id"]
    )
