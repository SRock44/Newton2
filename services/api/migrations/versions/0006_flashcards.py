"""flashcards + flashcard_review_logs

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-12
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "flashcards",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "document_id", sa.Uuid(), sa.ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("front", sa.Text(), nullable=False),
        sa.Column("back", sa.Text(), nullable=False),
        sa.Column("fsrs_state", sa.String(), nullable=False, server_default="learning"),
        sa.Column("fsrs_step", sa.Integer(), nullable=True),
        sa.Column("fsrs_stability", sa.Float(), nullable=True),
        sa.Column("fsrs_difficulty", sa.Float(), nullable=True),
        sa.Column("due", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_review", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_flashcards_user_id", "flashcards", ["user_id"])
    op.create_index("ix_flashcards_document_id", "flashcards", ["document_id"])
    op.create_index("ix_flashcards_due", "flashcards", ["due"])

    op.create_table(
        "flashcard_review_logs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "flashcard_id",
            sa.Uuid(),
            sa.ForeignKey("flashcards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_flashcard_review_logs_flashcard_id", "flashcard_review_logs", ["flashcard_id"])
    op.create_index("ix_flashcard_review_logs_user_id", "flashcard_review_logs", ["user_id"])
    op.create_index("ix_flashcard_review_logs_reviewed_at", "flashcard_review_logs", ["reviewed_at"])


def downgrade() -> None:
    op.drop_table("flashcard_review_logs")
    op.drop_table("flashcards")
