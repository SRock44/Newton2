"""Top-up credit balance

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-14

Adds topup_credits_cents to users -- a real, purchased, NON-expiring credit balance
(see ROADMAP.md Phase 7's "Newton balance" item and app/services/billing.py's
TOPUP_MARGIN / compute_topup_credit_cents / apply_topup_checkout_completed).
Deliberately a separate pool from credits_used_cents (0008): that one tracks spend
against a Pro subscriber's monthly allowance and resets every billing period; this one
is topped up via a one-time Stripe Checkout purchase (mode="payment") and only changes
via a real purchase or real frontier-model spend -- never reset on a timer. Defaults to
0 for every existing and new row.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("topup_credits_cents", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("users", "topup_credits_cents")
