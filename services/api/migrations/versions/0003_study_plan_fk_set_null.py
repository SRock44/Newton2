"""study_plan_items.document_id: ON DELETE SET NULL

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-12

This went unnoticed until a real provider key was configured: with the keyless
EchoProvider, generation never produced real structured items, so no
study_plan_items row ever actually referenced a document, and the FK was never
exercised. The column is already nullable (a plan item is meant to survive its
source document being deleted, not block the delete) -- this migration just makes
the constraint match that intent instead of the plain FK default.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("study_plan_items_document_id_fkey", "study_plan_items", type_="foreignkey")
    op.create_foreign_key(
        "study_plan_items_document_id_fkey",
        "study_plan_items",
        "documents",
        ["document_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("study_plan_items_document_id_fkey", "study_plan_items", type_="foreignkey")
    op.create_foreign_key(
        "study_plan_items_document_id_fkey", "study_plan_items", "documents", ["document_id"], ["id"]
    )
