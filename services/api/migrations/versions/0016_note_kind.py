"""Note kind + updated_at on documents

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-15

Adds two columns to `documents`, both purely additive and safe for every existing row:

- `kind`: "upload" (server_default -- every row that exists today, and every
  student-uploaded file going forward) or "note" (see app/routers/notes.py's "Newton
  Notepad" feature). A note is a REAL Document row that goes through the exact same
  chunk+embed pipeline an upload already uses, so it's automatically retrievable via
  RAG in ANY chat session with zero new retrieval logic -- app/memory/rag.py's
  retrieve_relevant_chunks has no kind filter at all.
- `updated_at`: didn't exist before this migration -- GET /notes sorts/displays the
  note picker by it. Existing rows get NOW() as their starting value via
  server_default; nothing depended on this column's absence before.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("kind", sa.String(), nullable=False, server_default="upload"),
    )
    op.add_column(
        "documents",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_column("documents", "updated_at")
    op.drop_column("documents", "kind")
