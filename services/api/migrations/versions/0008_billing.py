"""Pro subscription billing fields on users

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-13

Adds the columns app/services/billing.py and app/routers/billing.py need to track a
user's Stripe subscription and their frontier-model credit ledger for the Pro tier.
Nothing here talks to Stripe itself -- see core/config.py's stripe_* settings (still
empty by default, same dormant-until-configured pattern as groq_api_key/
openrouter_api_key) for what actually activates the feature.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("plan", sa.String(), nullable=False, server_default="free"))
    op.add_column("users", sa.Column("stripe_customer_id", sa.String(), nullable=True))
    op.add_column("users", sa.Column("stripe_subscription_id", sa.String(), nullable=True))
    op.add_column("users", sa.Column("stripe_subscription_status", sa.String(), nullable=True))
    op.add_column("users", sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "users", sa.Column("credits_used_cents", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column("users", sa.Column("credits_period_start", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("preferred_pro_model", sa.String(), nullable=True))

    op.create_index("ix_users_stripe_customer_id", "users", ["stripe_customer_id"])
    op.create_index("ix_users_stripe_subscription_id", "users", ["stripe_subscription_id"])


def downgrade() -> None:
    op.drop_index("ix_users_stripe_subscription_id", table_name="users")
    op.drop_index("ix_users_stripe_customer_id", table_name="users")

    op.drop_column("users", "preferred_pro_model")
    op.drop_column("users", "credits_period_start")
    op.drop_column("users", "credits_used_cents")
    op.drop_column("users", "current_period_end")
    op.drop_column("users", "stripe_subscription_status")
    op.drop_column("users", "stripe_subscription_id")
    op.drop_column("users", "stripe_customer_id")
    op.drop_column("users", "plan")
