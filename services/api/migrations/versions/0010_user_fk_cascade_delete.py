"""user_id FKs: ON DELETE CASCADE, to make account deletion possible

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-13

Every user_id foreign key except the two already patched (study_plan_items.document_id
in 0003, chat_sessions' children in 0004 -- neither of which is actually a user_id FK)
had no ondelete behavior at all, so deleting a User row raised an IntegrityError against
half a dozen tables -- there was no way to honor a deletion request. All 8 tables below
hold content a user owns outright (not an audit-trail reference to another user), so
CASCADE is the correct semantic for all of them, same reasoning as 0004's message/summary
cascade: none of these rows mean anything once the owning user is gone.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (table, constraint_name) -- default Postgres/SQLAlchemy naming, "<table>_user_id_fkey",
# confirmed against how 0003/0004 named their own altered constraints.
_TABLES = [
    "chat_sessions",
    "documents",
    "study_plan_items",
    "google_classroom_connections",
    "flashcards",
    "flashcard_review_logs",
    "practice_exams",
    "profile_facts",
]


def upgrade() -> None:
    for table in _TABLES:
        constraint = f"{table}_user_id_fkey"
        op.drop_constraint(constraint, table, type_="foreignkey")
        op.create_foreign_key(
            constraint,
            table,
            "users",
            ["user_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    for table in reversed(_TABLES):
        constraint = f"{table}_user_id_fkey"
        op.drop_constraint(constraint, table, type_="foreignkey")
        op.create_foreign_key(constraint, table, "users", ["user_id"], ["id"])
