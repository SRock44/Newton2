"""document_chunks.document_id: ON DELETE CASCADE

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-13

Caught during live end-to-end verification of the 0010/account-deletion work: with
documents.user_id now CASCADE (0010), deleting a User whose Document rows have chunks
still hit a real IntegrityError -- document_chunks.document_id had no ondelete behavior
of its own, so cascading a documents row away leaves its chunks blocking the delete
("update or delete on table documents violates foreign key constraint
document_chunks_document_id_fkey"). app/services/documents.py's delete_document() only
worked around this by deleting chunks explicitly before deleting a Document one at a
time; a DB-level user cascade never goes through that code path. A chunk has no meaning
without the document it was extracted from, same reasoning as every 0010 table, so
CASCADE here too.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("document_chunks_document_id_fkey", "document_chunks", type_="foreignkey")
    op.create_foreign_key(
        "document_chunks_document_id_fkey",
        "document_chunks",
        "documents",
        ["document_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("document_chunks_document_id_fkey", "document_chunks", type_="foreignkey")
    op.create_foreign_key(
        "document_chunks_document_id_fkey", "document_chunks", "documents", ["document_id"], ["id"]
    )
