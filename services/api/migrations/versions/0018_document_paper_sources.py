"""Document paper sources

Revision ID: 0018
Revises: 0017
Create Date: 2026-09-16

Adds `paper_sources` (JSONB, nullable) to `documents` -- purely additive and safe for
every existing row (they stay NULL, which is exactly the "this wasn't a research-paper
output" state the new GET /documents/{id}/bibliography.bib endpoint reads). Holds the
de-duplicated, final-keyed source list app/tools/write_research_paper.py already builds
via app/services/bibliography.py's assign_citation_keys() and hands to assemble_bib();
until now that list was thrown away the instant the LaTeX compile finished, so the .bib
file could never be offered to the student as its own downloadable artifact.

Deliberately NULLABLE rather than defaulting to '[]'::jsonb (unlike 0017's `tags`): here
"no sources" and "not a paper at all" must stay distinguishable at a glance, and NULL is
the only value that means the latter.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0018"
down_revision: Union[str, None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("paper_sources", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("documents", "paper_sources")
