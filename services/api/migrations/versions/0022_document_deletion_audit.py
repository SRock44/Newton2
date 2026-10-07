"""document_deletions audit trail -- every document delete, and why

Revision ID: 0022
Revises: 0021
Create Date: 2026-10-01

A real incident (see ROADMAP.md / the student1 data-loss investigation) traced lost
documents back to a test's cleanup running a raw `delete(Document)` that skipped
app/services/documents.py's delete_document(), silently orphaning the file in MinIO with
zero record anywhere of what happened or why. Instrumenting delete_document() alone
would have the exact same blind spot: ANY other way a `documents` row disappears -- a
raw SQL delete run by hand, a future bug, the CASCADE app/services/account.py's account
deletion already relies on (migration 0010) -- bypasses Python entirely and would leave
no trace, which is the whole failure mode this exists to close.

So this is a database-level trigger, not an application-level log call: it fires on
every DELETE from `documents` regardless of what issued it, and cannot be skipped by
forgetting to call the right function. It reads `app.delete_reason`, a Postgres
session-local setting (`SET LOCAL`/`set_config(..., true)`, scoped to the current
transaction only) that delete_document() and delete_own_account() both set immediately
before deleting -- if a row vanishes with reason IS NULL here, that itself is the signal
that something deleted a document outside both of those paths and needs a look.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: Union[str, None] = "0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "document_deletions",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("filename", sa.String(), nullable=True),
        sa.Column("kind", sa.String(), nullable=True),
        sa.Column("mime_type", sa.String(), nullable=True),
        sa.Column("minio_key", sa.String(), nullable=True),
        # NULL means whatever deleted this row never set app.delete_reason -- i.e. it
        # didn't go through delete_document()/delete_own_account(), see module docstring.
        sa.Column("reason", sa.String(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_document_deletions_user_id", "document_deletions", ["user_id"])
    op.create_index("ix_document_deletions_deleted_at", "document_deletions", ["deleted_at"])

    op.execute(
        """
        CREATE OR REPLACE FUNCTION log_document_deletion() RETURNS trigger AS $$
        BEGIN
            INSERT INTO document_deletions
                (document_id, user_id, filename, kind, mime_type, minio_key, reason, deleted_at)
            VALUES
                (OLD.id, OLD.user_id, OLD.filename, OLD.kind, OLD.mime_type, OLD.minio_key,
                 current_setting('app.delete_reason', true), now());
            RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_log_document_deletion
        AFTER DELETE ON documents
        FOR EACH ROW EXECUTE FUNCTION log_document_deletion();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_log_document_deletion ON documents")
    op.execute("DROP FUNCTION IF EXISTS log_document_deletion()")
    op.drop_table("document_deletions")
