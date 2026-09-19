"""flashcards.direction -- recognition vs. production, scheduled independently

Revision ID: 0021
Revises: 0020
Create Date: 2026-09-19

Every flashcard this app has ever made is recognition-only: see the front, recall the
back, self-rate 1-4. For most subjects that is the whole job. For language learning it
is half of it -- recognizing that "casa" means house and producing "casa" when shown
"house" are different skills with different forgetting curves, which is why real
language decks in Anki carry a term twice, once per direction, and schedule the two
separately. A student drilling vocabulary in Newton today gets the easy direction
forever and never finds out they can't produce the word.

This column names the direction a row drills. "recognition" is the existing behaviour;
"production" shows the meaning and requires the target term to be TYPED, graded by
comparison against the stored answer (app/services/flashcards.py's
grade_production_answer) instead of self-rated.

Nullable, with no backfill and no server default, for two reasons. First, every existing
row is a recognition card, and NULL is read as exactly that everywhere (see
flashcards.card_direction) -- so an UPDATE across a table that grows with every
generated card would buy nothing. Second, it keeps this an additive, instantly-applied
DDL change on a table that's in the hot path of the review loop.

Deliberately NOT added here: any "sibling"/family foreign key between a term's two
cards. The pedagogy requires the two directions to be scheduled INDEPENDENTLY, and the
FSRS state in this table is already per-row (fsrs_state/step/stability/difficulty/due/
last_review), so independence is what you get by doing nothing. A link column would only
create a shared-state temptation that the feature exists to avoid.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: Union[str, None] = "0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("flashcards", sa.Column("direction", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("flashcards", "direction")
