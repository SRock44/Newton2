"""Personal calendar events, the ICS feed secret, and public share links

Revision ID: 0019
Revises: 0018
Create Date: 2026-09-16

Three additive changes, none of which touch an existing row's data:

1. `calendar_events` -- a student's OWN hand-entered schedule (see app/db/models.py's
   CalendarEvent for why this is a separate table from `study_plan_items` rather than a
   new `source` value on it). user_id CASCADEs, matching every other owned-content table
   since migration 0010, so DELETE /account keeps working with no code change.

2. `users.calendar_feed_token` -- the per-user secret embedded in the subscribable ICS
   URL. Nullable, and existing rows stay NULL on purpose: the secret is minted lazily the
   first time a student asks for their feed URL, so nobody who never uses the feature ends
   up with a shareable credential sitting in the database. No unique index: the feed
   endpoint looks the user up by the user_id ALSO present in the path and then compares
   the token with secrets.compare_digest, so this column is never itself a lookup key.

3. `share_links` -- public, revocable read-only links to a flashcard deck or a practice
   exam. `token` is UNIQUE because it IS the lookup key for an unauthenticated endpoint;
   a collision would be a cross-account content leak, so the DB enforces uniqueness rather
   than trusting the RNG alone. document_id/exam_id both CASCADE so deleting the underlying
   content also kills every live public URL pointing at it.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: Union[str, None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "calendar_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_calendar_events_user_id", "calendar_events", ["user_id"])
    op.create_index("ix_calendar_events_start_at", "calendar_events", ["start_at"])

    op.add_column("users", sa.Column("calendar_feed_token", sa.String(), nullable=True))

    op.create_table(
        "share_links",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column(
            "document_id",
            sa.Uuid(),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "exam_id",
            sa.Uuid(),
            sa.ForeignKey("practice_exams.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("token", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_share_links_user_id", "share_links", ["user_id"])
    op.create_index("ix_share_links_document_id", "share_links", ["document_id"])
    op.create_index("ix_share_links_exam_id", "share_links", ["exam_id"])
    # UNIQUE at the index level (what SQLAlchemy's `unique=True, index=True` on the model
    # column produces) -- the token is the only lookup key an unauthenticated caller
    # presents, so a duplicate would be a cross-account content leak.
    op.create_index("ix_share_links_token", "share_links", ["token"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_share_links_token", table_name="share_links")
    op.drop_index("ix_share_links_exam_id", table_name="share_links")
    op.drop_index("ix_share_links_document_id", table_name="share_links")
    op.drop_index("ix_share_links_user_id", table_name="share_links")
    op.drop_table("share_links")

    op.drop_column("users", "calendar_feed_token")

    op.drop_index("ix_calendar_events_start_at", table_name="calendar_events")
    op.drop_index("ix_calendar_events_user_id", table_name="calendar_events")
    op.drop_table("calendar_events")
