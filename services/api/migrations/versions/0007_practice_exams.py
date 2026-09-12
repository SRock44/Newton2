"""practice_exams + practice_exam_questions

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-12
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "practice_exams",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "document_id", sa.Uuid(), sa.ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("difficulty", sa.String(), nullable=False, server_default="medium"),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_practice_exams_user_id", "practice_exams", ["user_id"])
    op.create_index("ix_practice_exams_document_id", "practice_exams", ["document_id"])

    op.create_table(
        "practice_exam_questions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "exam_id", sa.Uuid(), sa.ForeignKey("practice_exams.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("question_index", sa.Integer(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("choices", postgresql.JSONB(), nullable=False),
        sa.Column("correct_index", sa.Integer(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("student_answer_index", sa.Integer(), nullable=True),
        sa.Column("is_correct", sa.Boolean(), nullable=True),
    )
    op.create_index("ix_practice_exam_questions_exam_id", "practice_exam_questions", ["exam_id"])


def downgrade() -> None:
    op.drop_table("practice_exam_questions")
    op.drop_table("practice_exams")
