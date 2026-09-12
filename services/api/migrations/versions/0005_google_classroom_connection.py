"""google_classroom_connections table; study_plan_items.external_id

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-12
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("study_plan_items", sa.Column("external_id", sa.String(), nullable=True))
    op.create_index("ix_study_plan_items_external_id", "study_plan_items", ["external_id"])

    op.create_table(
        "google_classroom_connections",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("google_email", sa.String(), nullable=True),
        sa.Column("encrypted_access_token", sa.Text(), nullable=False),
        sa.Column("encrypted_refresh_token", sa.Text(), nullable=False),
        sa.Column("access_token_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scopes", sa.Text(), nullable=False),
        sa.Column("connected_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_google_classroom_connections_user_id",
        "google_classroom_connections",
        ["user_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_google_classroom_connections_user_id", table_name="google_classroom_connections")
    op.drop_table("google_classroom_connections")

    op.drop_index("ix_study_plan_items_external_id", table_name="study_plan_items")
    op.drop_column("study_plan_items", "external_id")
