"""add study_plan_items table

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-12

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "study_plan_items",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("document_id", sa.Uuid(), sa.ForeignKey("documents.id"), nullable=True),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("due_date_text", sa.String(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("source", sa.String(), nullable=False, server_default="syllabus_upload"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_study_plan_items_user_id", "study_plan_items", ["user_id"])
    op.create_index("ix_study_plan_items_document_id", "study_plan_items", ["document_id"])


def downgrade() -> None:
    op.drop_table("study_plan_items")
