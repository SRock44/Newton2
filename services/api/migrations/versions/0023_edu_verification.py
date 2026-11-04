"""edu_verification -- free Pro for a verified school email

Revision ID: 0023
Revises: 0022
Create Date: 2026-11-04

Product owner, verbatim: "set up .edu verification (nyit students (@nyit.edu domain)
get FREE PRO! - requires verification etc." Adds User.edu_email/edu_verified_at
(deliberately separate columns from `plan`/stripe_* -- see app/db/models.py's own
comment on why) and a new edu_verification_codes table holding the short-lived 6-digit
codes app/services/edu_verification.py emails out and checks. See
app/services/billing.py's is_pro() for where edu_verified_at actually grants Pro.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0023"
down_revision: Union[str, None] = "0022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("edu_email", sa.String(), nullable=True))
    op.add_column("users", sa.Column("edu_verified_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "edu_verification_codes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_edu_verification_codes_user_id", "edu_verification_codes", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_edu_verification_codes_user_id", table_name="edu_verification_codes")
    op.drop_table("edu_verification_codes")
    op.drop_column("users", "edu_verified_at")
    op.drop_column("users", "edu_email")
