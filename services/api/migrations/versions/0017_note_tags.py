"""Note tags

Revision ID: 0017
Revises: 0016
Create Date: 2026-09-15

Adds `tags` (JSONB, list[str]) to `documents` -- purely additive and safe for every
existing row (backfilled to `[]` via server_default). User-created, optional course
tags on a Newton Notepad note (see app/routers/notes.py's new PATCH /notes/{id}/tags);
meaningless on kind="upload" rows, no UI ever surfaces it for plain uploads. Deliberately
a plain JSONB list rather than a normalized tags table -- this is "a student types a few
free-text labels on their own note," not a reusable, cross-note tag-management system.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0017"
down_revision: Union[str, None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("tags", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
    )


def downgrade() -> None:
    op.drop_column("documents", "tags")
