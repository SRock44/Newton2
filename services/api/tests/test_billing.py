"""Tests for the Pro subscription billing foundations: app/services/billing.py's plan/
credit logic + Stripe helpers, and app/routers/billing.py's endpoints.

Stripe itself is always mocked here -- there's no way to hit the real API without real
keys, which only the account owner has. Every stripe.* call is monkeypatched at the
function boundary (stripe.Customer.create, stripe.checkout.Session.create, etc.), the
same idiom test_google_classroom.py uses for fetch_courses/fetch_coursework rather than
mocking the HTTP layer underneath them.

Router tests split two ways:
  - Endpoints whose behavior doesn't depend on mocking Stripe (status, pro-models, and
    checkout-session's genuine "not configured" path -- true in this dev stack, since no
    real Stripe keys exist yet) go through the live http_client fixture, like every
    other router test in this suite.
  - checkout-session/portal-session/webhook WITH Stripe mocked can't go through
    http_client: that talks to the live API container over the network, a separate OS
    process this test's monkeypatch can't reach into. Those use an in-process ASGI
    client against the same `app` object this test process imports, so the
    monkeypatched `stripe` module is the one the request handler actually sees.

The OpenRouter catalog calls (get_pro_model_catalog / _pricing_for's live path) ARE
real, keyless, live network calls -- no mocking needed or wanted there, since the whole
point is proving the curated model ids and pricing are real and current.
"""

import math
import uuid
from datetime import datetime, timezone

import httpx
import pytest
import pytest_asyncio
import stripe
from jose import jwt as jose_jwt
from sqlalchemy import delete, select

from app.core.config import Settings
from app.db.models import User
from app.services import billing as billing_service

# ---------------------------------------------------------------------------
# Plan-check helpers — pure, no DB/network.
# ---------------------------------------------------------------------------


def _make_user(**kwargs) -> User:
    defaults = dict(keycloak_sub="unused", plan="free", credits_used_cents=0, preferred_pro_model=None)
    defaults.update(kwargs)
    return User(**defaults)


def test_is_pro_true_only_for_pro_plan():
    assert billing_service.is_pro(_make_user(plan="pro")) is True
    assert billing_service.is_pro(_make_user(plan="free")) is False


def test_pro_credits_remaining_respects_the_configured_limit(monkeypatch):
    monkeypatch.setattr(billing_service, "get_settings", lambda: Settings(pro_monthly_credit_cents=600))
    assert billing_service.pro_credits_remaining(_make_user(credits_used_cents=599)) is True
    assert billing_service.pro_credits_remaining(_make_user(credits_used_cents=600)) is False
    assert billing_service.pro_credits_remaining(_make_user(credits_used_cents=601)) is False


def test_resolve_pro_model_defaults_when_unset():
    assert billing_service.resolve_pro_model(_make_user(preferred_pro_model=None)) == billing_service.DEFAULT_PRO_MODEL


def test_resolve_pro_model_defaults_when_selection_is_not_curated():
    assert (
        billing_service.resolve_pro_model(_make_user(preferred_pro_model="not/a-real-model"))
        == billing_service.DEFAULT_PRO_MODEL
    )


def test_resolve_pro_model_honors_a_valid_selection():
    chosen = billing_service.PRO_MODELS[-1]["id"]
    assert billing_service.resolve_pro_model(_make_user(preferred_pro_model=chosen)) == chosen


# ---------------------------------------------------------------------------
# OpenRouter catalog — real, live, keyless network calls. Proves the curated roster
# actually exists on OpenRouter right now and its pricing parses to real numbers.
# ---------------------------------------------------------------------------


@pytest.mark.live_smoke
async def test_get_pro_model_catalog_returns_real_curated_models_live():
    catalog = await billing_service.get_pro_model_catalog()
    ids = {m["id"] for m in catalog}
    # If OpenRouter has deprecated every single curated model at once, something's
    # badly wrong with the roster -- but the default, at minimum, must still resolve.
    assert billing_service.DEFAULT_PRO_MODEL in ids
    for m in catalog:
        assert m["id"] in billing_service._PRO_MODEL_IDS
        assert m["label"]


@pytest.mark.live_smoke
async def test_pricing_for_each_curated_model_parses_as_real_positive_numbers_live():
    for model in billing_service.PRO_MODELS:
        pricing = await billing_service._pricing_for(model["id"])
        assert pricing["prompt"] > 0
        assert pricing["completion"] > 0


async def test_get_pro_model_catalog_falls_back_to_the_full_curated_list_on_fetch_failure(monkeypatch):
    async def fake_fetch():
        raise httpx.ConnectError("unreachable")

    monkeypatch.setattr(billing_service, "_fetch_openrouter_catalog", fake_fetch)
    catalog = await billing_service.get_pro_model_catalog()
    assert {m["id"] for m in catalog} == {m["id"] for m in billing_service.PRO_MODELS}


# ---------------------------------------------------------------------------
# compute_cost_cents — credit-ledger math, with a mocked catalog for determinism.
# ---------------------------------------------------------------------------


async def test_compute_cost_cents_computes_exact_dollars_to_cents(monkeypatch):
    fake_catalog = {"model-x": {"pricing": {"prompt": "0.000002", "completion": "0.00001"}}}

    async def fake_fetch():
        return fake_catalog

    monkeypatch.setattr(billing_service, "_fetch_openrouter_catalog", fake_fetch)

    # 1,000,000 prompt tokens * $0.000002/token = $2.00 exactly = 200 cents.
    cost = await billing_service.compute_cost_cents("model-x", 1_000_000, 0)
    assert cost == 200


async def test_compute_cost_cents_rounds_up_a_fractional_cent(monkeypatch):
    fake_catalog = {"model-x": {"pricing": {"prompt": "0.000002", "completion": "0.00001"}}}

    async def fake_fetch():
        return fake_catalog

    monkeypatch.setattr(billing_service, "_fetch_openrouter_catalog", fake_fetch)

    # 100 prompt tokens * $0.000002 = $0.0002 = 0.02 cents -> rounds up to 1 cent, never
    # tracked as free just because a call cost a fraction of a cent.
    cost = await billing_service.compute_cost_cents("model-x", 100, 0)
    assert cost == 1


async def test_compute_cost_cents_falls_back_to_snapshot_pricing_when_catalog_unreachable(monkeypatch):
    async def fake_fetch():
        raise httpx.ConnectError("unreachable")

    monkeypatch.setattr(billing_service, "_fetch_openrouter_catalog", fake_fetch)

    model = billing_service.DEFAULT_PRO_MODEL
    fallback = next(m["_fallback_pricing"] for m in billing_service.PRO_MODELS if m["id"] == model)
    expected_cents = math.ceil(1_000_000 * fallback["prompt"] * 100)

    cost = await billing_service.compute_cost_cents(model, 1_000_000, 0)
    assert cost == expected_cents


# ---------------------------------------------------------------------------
# record_frontier_usage — atomic ledger update against a real DB row.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def billing_user(db_session):
    user = User(keycloak_sub=f"test-billing-{uuid.uuid4()}", plan="pro", credits_used_cents=0)
    db_session.add(user)
    await db_session.commit()
    yield user
    await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


async def test_record_frontier_usage_adds_cost_to_the_ledger(billing_user, db_session, monkeypatch):
    async def fake_compute(model_id, prompt_tokens, completion_tokens):
        return 42

    monkeypatch.setattr(billing_service, "compute_cost_cents", fake_compute)

    added = await billing_service.record_frontier_usage(billing_user.id, "any-model", 100, 50)
    assert added == 42

    await db_session.refresh(billing_user)
    assert billing_user.credits_used_cents == 42


async def test_record_frontier_usage_accumulates_across_calls(billing_user, db_session, monkeypatch):
    async def fake_compute(model_id, prompt_tokens, completion_tokens):
        return 10

    monkeypatch.setattr(billing_service, "compute_cost_cents", fake_compute)

    await billing_service.record_frontier_usage(billing_user.id, "any-model", 100, 50)
    await billing_service.record_frontier_usage(billing_user.id, "any-model", 100, 50)

    await db_session.refresh(billing_user)
    assert billing_user.credits_used_cents == 20


async def test_record_frontier_usage_is_a_noop_for_zero_cost(billing_user, db_session, monkeypatch):
    async def fake_compute(model_id, prompt_tokens, completion_tokens):
        return 0

    monkeypatch.setattr(billing_service, "compute_cost_cents", fake_compute)

    added = await billing_service.record_frontier_usage(billing_user.id, "any-model", 0, 0)
    assert added == 0
    await db_session.refresh(billing_user)
    assert billing_user.credits_used_cents == 0


# ---------------------------------------------------------------------------
# Top-up balance -- frontier_access_available, compute_topup_credit_cents, and
# record_frontier_usage's split between the Pro monthly allowance and the purchased,
# non-expiring topup_credits_cents balance (see ROADMAP.md Phase 7 and this module's
# own docstring for the exact product-logic decision: Pro monthly credit is spent FIRST,
# up to its cap, and only the remainder spills onto topup_credits_cents).
# ---------------------------------------------------------------------------


def test_frontier_access_available_is_false_with_no_user_or_no_openrouter():
    assert billing_service.frontier_access_available(None, True) is False
    assert billing_service.frontier_access_available(_make_user(plan="pro"), False) is False


def test_frontier_access_available_true_for_a_pro_user_with_credit_remaining(monkeypatch):
    monkeypatch.setattr(billing_service, "get_settings", lambda: Settings(pro_monthly_credit_cents=600))
    user = _make_user(plan="pro", credits_used_cents=0, topup_credits_cents=0)
    assert billing_service.frontier_access_available(user, True) is True


def test_frontier_access_available_false_for_a_pro_user_with_no_credit_and_no_topup(monkeypatch):
    monkeypatch.setattr(billing_service, "get_settings", lambda: Settings(pro_monthly_credit_cents=600))
    user = _make_user(plan="pro", credits_used_cents=600, topup_credits_cents=0)
    assert billing_service.frontier_access_available(user, True) is False


def test_frontier_access_available_true_for_a_pro_user_exhausted_on_credit_but_with_topup(monkeypatch):
    monkeypatch.setattr(billing_service, "get_settings", lambda: Settings(pro_monthly_credit_cents=600))
    user = _make_user(plan="pro", credits_used_cents=600, topup_credits_cents=100)
    assert billing_service.frontier_access_available(user, True) is True


def test_frontier_access_available_true_for_a_free_user_with_topup_balance():
    # The real product decision this feature is built on: a free (non-Pro) user can
    # still fund frontier-model access entirely from a purchased top-up balance.
    user = _make_user(plan="free", topup_credits_cents=1)
    assert billing_service.frontier_access_available(user, True) is True


def test_frontier_access_available_false_for_a_free_user_with_no_topup_balance():
    user = _make_user(plan="free", topup_credits_cents=0)
    assert billing_service.frontier_access_available(user, True) is False


def test_compute_topup_credit_cents_is_exact_for_real_dollar_tiers():
    # $5 / $10 / $25 tiers, each an exact multiple of 8% -- proves the integer-basis-
    # points math has zero drift for the amounts real users will actually pay.
    assert billing_service.compute_topup_credit_cents(500) == 460  # $5.00 -> $4.60 (8% = 40c)
    assert billing_service.compute_topup_credit_cents(1000) == 920  # $10.00 -> $9.20 (8% = 80c)
    assert billing_service.compute_topup_credit_cents(2500) == 2300  # $25.00 -> $23.00 (8% = $2.00)


def test_compute_topup_credit_cents_floors_a_fractional_cent_in_newtons_favor():
    # $7.77 * 0.92 = $7.1484 -> floors to 714 cents, never 715 -- Newton keeps the
    # sub-cent remainder rather than the user, mirroring compute_cost_cents's own bias
    # (there, a fractional cent of cost always rounds UP against the user; here, a
    # fractional cent of credit always rounds DOWN against the user -- same direction).
    assert billing_service.compute_topup_credit_cents(777) == 714


def test_compute_topup_credit_cents_matches_the_margin_constant_exactly():
    # Cross-check against TOPUP_MARGIN directly (not just hardcoded expected numbers
    # above) so a future change to the margin constant is caught by this test too.
    amount = 10_000  # $100.00, chosen to divide evenly regardless of the exact margin
    credited = billing_service.compute_topup_credit_cents(amount)
    expected = amount - round(amount * billing_service.TOPUP_MARGIN)
    assert credited == expected


async def test_record_frontier_usage_charges_pro_credit_first_when_it_fully_covers_the_cost(
    billing_user, db_session, monkeypatch
):
    billing_user.plan = "pro"
    billing_user.credits_used_cents = 0
    billing_user.topup_credits_cents = 500
    await db_session.commit()

    async def fake_compute(model_id, prompt_tokens, completion_tokens):
        return 50

    monkeypatch.setattr(billing_service, "compute_cost_cents", fake_compute)
    monkeypatch.setattr(billing_service, "get_settings", lambda: Settings(pro_monthly_credit_cents=600))

    added = await billing_service.record_frontier_usage(billing_user.id, "any-model", 100, 50)
    assert added == 50

    await db_session.refresh(billing_user)
    # Fully funded by the Pro monthly allowance -- the top-up balance is untouched.
    assert billing_user.credits_used_cents == 50
    assert billing_user.topup_credits_cents == 500


async def test_record_frontier_usage_spills_the_remainder_onto_topup_once_pro_credit_is_exhausted(
    billing_user, db_session, monkeypatch
):
    billing_user.plan = "pro"
    billing_user.credits_used_cents = 580  # only 20 cents of monthly allowance left
    billing_user.topup_credits_cents = 500
    await db_session.commit()

    async def fake_compute(model_id, prompt_tokens, completion_tokens):
        return 50

    monkeypatch.setattr(billing_service, "compute_cost_cents", fake_compute)
    monkeypatch.setattr(billing_service, "get_settings", lambda: Settings(pro_monthly_credit_cents=600))

    added = await billing_service.record_frontier_usage(billing_user.id, "any-model", 100, 50)
    assert added == 50

    await db_session.refresh(billing_user)
    # The last 20 cents of Pro allowance is used up first (credits_used_cents hits the
    # 600 cap exactly), and the remaining 30 cents of real cost spills onto topup.
    assert billing_user.credits_used_cents == 600
    assert billing_user.topup_credits_cents == 470


async def test_record_frontier_usage_funds_a_free_users_call_entirely_from_topup(
    billing_user, db_session, monkeypatch
):
    billing_user.plan = "free"
    billing_user.credits_used_cents = 0
    billing_user.topup_credits_cents = 200
    await db_session.commit()

    async def fake_compute(model_id, prompt_tokens, completion_tokens):
        return 75

    monkeypatch.setattr(billing_service, "compute_cost_cents", fake_compute)

    added = await billing_service.record_frontier_usage(billing_user.id, "any-model", 100, 50)
    assert added == 75

    await db_session.refresh(billing_user)
    # A free user has no Pro monthly allowance to draw from at all -- the entire cost
    # comes out of the purchased top-up balance, and credits_used_cents never moves.
    assert billing_user.credits_used_cents == 0
    assert billing_user.topup_credits_cents == 125


# ---------------------------------------------------------------------------
# apply_topup_checkout_completed -- webhook-driven crediting of a real one-time payment.
# ---------------------------------------------------------------------------


async def test_apply_topup_checkout_completed_credits_the_post_margin_amount(billing_user, db_session):
    billing_user.topup_credits_cents = 0
    await db_session.commit()

    event_object = {"client_reference_id": str(billing_user.id), "amount_total": 1000, "mode": "payment"}
    await billing_service.apply_topup_checkout_completed(db_session, event_object)

    await db_session.refresh(billing_user)
    # $10.00 paid -> $9.20 credited (8% margin), exact integer cents.
    assert billing_user.topup_credits_cents == 920


async def test_apply_topup_checkout_completed_accumulates_across_multiple_purchases(billing_user, db_session):
    billing_user.topup_credits_cents = 460  # one prior $5 top-up already credited
    await db_session.commit()

    event_object = {"client_reference_id": str(billing_user.id), "amount_total": 2500, "mode": "payment"}
    await billing_service.apply_topup_checkout_completed(db_session, event_object)

    await db_session.refresh(billing_user)
    assert billing_user.topup_credits_cents == 460 + 2300


async def test_apply_topup_checkout_completed_ignores_an_unknown_user(db_session):
    await billing_service.apply_topup_checkout_completed(
        db_session, {"client_reference_id": str(uuid.uuid4()), "amount_total": 1000, "mode": "payment"}
    )


async def test_apply_topup_checkout_completed_is_a_noop_with_no_amount(billing_user, db_session):
    billing_user.topup_credits_cents = 0
    await db_session.commit()

    await billing_service.apply_topup_checkout_completed(
        db_session, {"client_reference_id": str(billing_user.id), "mode": "payment"}
    )

    await db_session.refresh(billing_user)
    assert billing_user.topup_credits_cents == 0


# ---------------------------------------------------------------------------
# Stripe customer/checkout/portal helpers — Stripe SDK mocked, real DB for persistence.
# ---------------------------------------------------------------------------


async def test_get_or_create_stripe_customer_creates_once_and_persists(billing_user, db_session, monkeypatch):
    created = {}

    def fake_create(**kwargs):
        created.update(kwargs)
        return {"id": "cus_fake123"}

    monkeypatch.setattr(stripe.Customer, "create", fake_create)
    monkeypatch.setattr(billing_service, "get_settings", lambda: Settings(stripe_secret_key="sk_fake"))

    customer_id = await billing_service.get_or_create_stripe_customer(db_session, billing_user)
    assert customer_id == "cus_fake123"
    assert created["metadata"]["newton_user_id"] == str(billing_user.id)

    await db_session.commit()
    await db_session.refresh(billing_user)
    assert billing_user.stripe_customer_id == "cus_fake123"


async def test_get_or_create_stripe_customer_reuses_an_existing_id(billing_user, db_session, monkeypatch):
    billing_user.stripe_customer_id = "cus_existing"
    await db_session.commit()

    def fake_create(**kwargs):
        raise AssertionError("should not create a new customer when one already exists")

    monkeypatch.setattr(stripe.Customer, "create", fake_create)

    customer_id = await billing_service.get_or_create_stripe_customer(db_session, billing_user)
    assert customer_id == "cus_existing"


async def test_create_checkout_session_builds_a_subscription_session(monkeypatch):
    seen = {}

    def fake_create(**kwargs):
        seen.update(kwargs)
        return {"url": "https://checkout.stripe.com/fake-session"}

    monkeypatch.setattr(stripe.checkout.Session, "create", fake_create)
    monkeypatch.setattr(
        billing_service,
        "get_settings",
        lambda: Settings(stripe_secret_key="sk_fake", stripe_price_id_pro="price_fake"),
    )

    user_id = uuid.uuid4()
    url = await billing_service.create_checkout_session("cus_fake", user_id, "http://127.0.0.1:58001")

    assert url == "https://checkout.stripe.com/fake-session"
    assert seen["mode"] == "subscription"
    assert seen["customer"] == "cus_fake"
    assert seen["client_reference_id"] == str(user_id)
    assert seen["line_items"] == [{"price": "price_fake", "quantity": 1}]
    assert seen["success_url"] == "http://127.0.0.1:58001/billing/checkout-complete"
    assert seen["cancel_url"] == "http://127.0.0.1:58001/billing/checkout-complete"


async def test_create_portal_session_returns_the_portal_url(monkeypatch):
    def fake_create(**kwargs):
        assert kwargs["customer"] == "cus_fake"
        return {"url": "https://billing.stripe.com/fake-portal"}

    monkeypatch.setattr(stripe.billing_portal.Session, "create", fake_create)
    monkeypatch.setattr(billing_service, "get_settings", lambda: Settings(stripe_secret_key="sk_fake"))

    url = await billing_service.create_portal_session("cus_fake", "http://127.0.0.1:58001")
    assert url == "https://billing.stripe.com/fake-portal"


# ---------------------------------------------------------------------------
# Webhook event handlers — DB effects of each event type, called directly (the HTTP
# layer + signature verification is covered separately below via the in-process client).
# ---------------------------------------------------------------------------


async def test_apply_checkout_completed_upgrades_the_user_and_resets_credits(billing_user, db_session):
    billing_user.plan = "free"
    billing_user.credits_used_cents = 250
    await db_session.commit()

    event_object = {
        "client_reference_id": str(billing_user.id),
        "subscription": "sub_fake123",
        "customer": "cus_fake123",
    }
    await billing_service.apply_checkout_completed(db_session, event_object)

    await db_session.refresh(billing_user)
    assert billing_user.plan == "pro"
    assert billing_user.stripe_subscription_id == "sub_fake123"
    assert billing_user.stripe_customer_id == "cus_fake123"
    assert billing_user.credits_used_cents == 0
    assert billing_user.credits_period_start is not None


async def test_apply_checkout_completed_ignores_an_unknown_user(db_session):
    # Must not raise -- just a no-op for a client_reference_id that doesn't match anyone.
    await billing_service.apply_checkout_completed(db_session, {"client_reference_id": str(uuid.uuid4())})


async def test_apply_subscription_updated_syncs_status_and_starts_a_period(billing_user, db_session):
    billing_user.plan = "pro"
    billing_user.stripe_subscription_id = "sub_fake123"
    billing_user.current_period_end = None
    billing_user.credits_used_cents = 0
    await db_session.commit()

    period_end = datetime(2026, 10, 13, tzinfo=timezone.utc)
    await billing_service.apply_subscription_updated(
        db_session,
        {"id": "sub_fake123", "status": "active", "current_period_end": int(period_end.timestamp())},
    )

    await db_session.refresh(billing_user)
    assert billing_user.stripe_subscription_status == "active"
    assert billing_user.current_period_end == period_end
    assert billing_user.credits_period_start is not None


async def test_apply_subscription_updated_resets_credits_on_period_rollover(billing_user, db_session):
    old_period_end = datetime(2026, 9, 13, tzinfo=timezone.utc)
    billing_user.plan = "pro"
    billing_user.stripe_subscription_id = "sub_fake123"
    billing_user.current_period_end = old_period_end
    billing_user.credits_used_cents = 599
    await db_session.commit()

    new_period_end = datetime(2026, 10, 13, tzinfo=timezone.utc)
    await billing_service.apply_subscription_updated(
        db_session,
        {"id": "sub_fake123", "status": "active", "current_period_end": int(new_period_end.timestamp())},
    )

    await db_session.refresh(billing_user)
    assert billing_user.credits_used_cents == 0
    assert billing_user.current_period_end == new_period_end


async def test_apply_subscription_updated_does_not_reset_credits_mid_period(billing_user, db_session):
    period_end = datetime(2026, 10, 13, tzinfo=timezone.utc)
    billing_user.plan = "pro"
    billing_user.stripe_subscription_id = "sub_fake123"
    billing_user.current_period_end = period_end
    billing_user.credits_used_cents = 300
    await db_session.commit()

    # Same period_end reported again (e.g. a status-only change) -- the ledger must
    # survive untouched, not get wiped every time Stripe sends an update.
    await billing_service.apply_subscription_updated(
        db_session,
        {"id": "sub_fake123", "status": "past_due", "current_period_end": int(period_end.timestamp())},
    )

    await db_session.refresh(billing_user)
    assert billing_user.credits_used_cents == 300
    assert billing_user.stripe_subscription_status == "past_due"


async def test_apply_subscription_updated_ignores_an_unknown_subscription(db_session):
    await billing_service.apply_subscription_updated(
        db_session, {"id": "sub_does_not_exist", "status": "active", "current_period_end": 1234567890}
    )


async def test_apply_subscription_deleted_reverts_to_free(billing_user, db_session):
    billing_user.plan = "pro"
    billing_user.stripe_subscription_id = "sub_fake123"
    await db_session.commit()

    await billing_service.apply_subscription_deleted(db_session, {"id": "sub_fake123", "status": "canceled"})

    await db_session.refresh(billing_user)
    assert billing_user.plan == "free"
    assert billing_user.stripe_subscription_status == "canceled"


# ---------------------------------------------------------------------------
# Router-level, against the live server — endpoints that don't need Stripe mocked.
# ---------------------------------------------------------------------------


async def test_billing_status_returns_the_expected_shape(http_client, auth_headers):
    resp = await http_client.get("/billing/status", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {
        "plan",
        "subscription_status",
        "current_period_end",
        "credits_used_cents",
        "credits_limit_cents",
        "credits_reset_at",
        "preferred_pro_model",
        "free_generation_target",
        "pro_generation_target",
        "focus_mode_enabled",
        "topup_credits_cents",
        "topup_tiers_cents",
    }
    assert body["plan"] in ("free", "pro")
    assert isinstance(body["credits_used_cents"], int)
    assert isinstance(body["credits_limit_cents"], int)
    assert body["preferred_pro_model"] in billing_service._PRO_MODEL_IDS
    # Static plan constants, not user-specific -- always the real generation_target_count()
    # inputs, never a stale/hardcoded copy (see DocumentsPanel.tsx's generation note).
    assert body["free_generation_target"] == billing_service.FREE_GENERATION_TARGET
    assert body["pro_generation_target"] == billing_service.PRO_GENERATION_TARGET
    # Top-up balance -- see billing_service.TOPUP_MARGIN/TOPUP_TIERS_CENTS and
    # User.topup_credits_cents. A real integer balance (never negative for a fresh/never-
    # topped-up user) and the exact tier list the topup-checkout-session endpoint accepts.
    assert isinstance(body["topup_credits_cents"], int)
    assert body["topup_tiers_cents"] == billing_service.TOPUP_TIERS_CENTS


async def test_billing_status_requires_auth(http_client):
    resp = await http_client.get("/billing/status")
    assert resp.status_code in (401, 403)


async def test_pro_models_endpoint_returns_real_curated_models(http_client, auth_headers):
    resp = await http_client.get("/billing/pro-models", headers=auth_headers)
    assert resp.status_code == 200
    models = resp.json()
    assert len(models) >= 1
    ids = {m["id"] for m in models}
    assert billing_service.DEFAULT_PRO_MODEL in ids
    for m in models:
        assert set(m.keys()) == {"id", "label"}


async def test_pro_models_endpoint_requires_auth(http_client):
    resp = await http_client.get("/billing/pro-models")
    assert resp.status_code in (401, 403)


@pytest_asyncio.fixture
async def student1_status_snapshot(db_session, keycloak_token):
    """Snapshots+restores the shared dev student1 user's plan/preferred_pro_model around
    a test that flips them -- same rationale as student1_user's stripe_customer_id
    snapshot below: this is a shared dev DB row other tests/runs also rely on."""
    sub = jose_jwt.get_unverified_claims(keycloak_token)["sub"]
    user = (await db_session.execute(select(User).where(User.keycloak_sub == sub))).scalar_one_or_none()
    if user is None:
        user = User(keycloak_sub=sub)
        db_session.add(user)
        await db_session.commit()

    original_plan = user.plan
    original_preference = user.preferred_pro_model
    yield user
    user.plan = original_plan
    user.preferred_pro_model = original_preference
    await db_session.commit()


async def test_preferred_model_requires_auth(http_client):
    resp = await http_client.patch(
        "/billing/preferred-model", json={"model_id": billing_service.DEFAULT_PRO_MODEL}
    )
    assert resp.status_code in (401, 403)


async def test_preferred_model_rejects_an_unrecognized_model_id(http_client, auth_headers):
    resp = await http_client.patch(
        "/billing/preferred-model", json={"model_id": "not/a-real-model"}, headers=auth_headers
    )
    assert resp.status_code == 400


async def test_preferred_model_persists_for_a_pro_user(
    http_client, auth_headers, student1_status_snapshot, db_session
):
    student1_status_snapshot.plan = "pro"
    await db_session.commit()

    chosen = billing_service.PRO_MODELS[-1]["id"]
    resp = await http_client.patch("/billing/preferred-model", json={"model_id": chosen}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["preferred_pro_model"] == chosen

    await db_session.refresh(student1_status_snapshot)
    assert student1_status_snapshot.preferred_pro_model == chosen


async def test_preferred_model_does_not_persist_for_a_free_user(
    http_client, auth_headers, student1_status_snapshot, db_session
):
    student1_status_snapshot.plan = "free"
    student1_status_snapshot.preferred_pro_model = None
    await db_session.commit()

    chosen = billing_service.PRO_MODELS[-1]["id"]
    resp = await http_client.patch("/billing/preferred-model", json={"model_id": chosen}, headers=auth_headers)
    assert resp.status_code == 402
    assert "pro feature" in resp.json()["detail"].lower()

    await db_session.refresh(student1_status_snapshot)
    assert student1_status_snapshot.preferred_pro_model is None


# ---------------------------------------------------------------------------
# Self-service Focus Mode (User.focus_mode_enabled) -- see app/routers/billing.py's
# PATCH /billing/focus-mode. Unlike preferred-model, this is never plan-gated: every
# signed-in user, free or Pro, can flip it for themselves.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def student1_focus_mode_snapshot(db_session, keycloak_token):
    """Snapshots+restores the shared dev student1 user's focus_mode_enabled around a
    test that flips it -- same rationale as student1_status_snapshot above: this is a
    shared dev DB row other tests/runs also rely on."""
    sub = jose_jwt.get_unverified_claims(keycloak_token)["sub"]
    user = (await db_session.execute(select(User).where(User.keycloak_sub == sub))).scalar_one_or_none()
    if user is None:
        user = User(keycloak_sub=sub)
        db_session.add(user)
        await db_session.commit()

    original = user.focus_mode_enabled
    yield user
    user.focus_mode_enabled = original
    await db_session.commit()


async def test_focus_mode_requires_auth(http_client):
    resp = await http_client.patch("/billing/focus-mode", json={"enabled": True})
    assert resp.status_code in (401, 403)


async def test_focus_mode_persists_enabling(http_client, auth_headers, student1_focus_mode_snapshot, db_session):
    student1_focus_mode_snapshot.focus_mode_enabled = False
    await db_session.commit()

    resp = await http_client.patch("/billing/focus-mode", json={"enabled": True}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["focus_mode_enabled"] is True

    await db_session.refresh(student1_focus_mode_snapshot)
    assert student1_focus_mode_snapshot.focus_mode_enabled is True


async def test_focus_mode_persists_disabling(http_client, auth_headers, student1_focus_mode_snapshot, db_session):
    student1_focus_mode_snapshot.focus_mode_enabled = True
    await db_session.commit()

    resp = await http_client.patch("/billing/focus-mode", json={"enabled": False}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["focus_mode_enabled"] is False

    await db_session.refresh(student1_focus_mode_snapshot)
    assert student1_focus_mode_snapshot.focus_mode_enabled is False


async def test_focus_mode_is_never_plan_gated(http_client, auth_headers, student1_focus_mode_snapshot, db_session):
    """Free-plan users can turn Focus Mode on just as easily as Pro users -- it's not a
    paid perk, so there's no 402 path here at all (unlike preferred-model)."""
    original_plan = student1_focus_mode_snapshot.plan
    student1_focus_mode_snapshot.plan = "free"
    student1_focus_mode_snapshot.focus_mode_enabled = False
    await db_session.commit()
    try:
        resp = await http_client.patch("/billing/focus-mode", json={"enabled": True}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["focus_mode_enabled"] is True
    finally:
        student1_focus_mode_snapshot.plan = original_plan
        await db_session.commit()


async def test_checkout_session_returns_503_when_stripe_not_configured(http_client, auth_headers):
    # Genuinely true in this dev stack: no real Stripe keys exist yet, so this proves
    # the graceful-degradation path for real rather than by mocking it away.
    resp = await http_client.post("/billing/checkout-session", headers=auth_headers)
    assert resp.status_code == 503
    assert "configured" in resp.json()["detail"].lower()


async def test_portal_session_returns_503_when_stripe_not_configured(http_client, auth_headers):
    resp = await http_client.post("/billing/portal-session", headers=auth_headers)
    assert resp.status_code == 503


async def test_topup_checkout_session_returns_503_when_stripe_not_configured(http_client, auth_headers):
    # Same genuinely-true-in-this-dev-stack proof as checkout-session's own 503 test
    # above -- no real Stripe keys exist yet.
    resp = await http_client.post(
        "/billing/topup-checkout-session",
        json={"amount_cents": billing_service.TOPUP_TIERS_CENTS[0]},
        headers=auth_headers,
    )
    assert resp.status_code == 503
    assert "configured" in resp.json()["detail"].lower()


async def test_topup_checkout_session_requires_auth(http_client):
    resp = await http_client.post(
        "/billing/topup-checkout-session", json={"amount_cents": billing_service.TOPUP_TIERS_CENTS[0]}
    )
    assert resp.status_code in (401, 403)


async def test_checkout_complete_page_is_public_and_returns_html(http_client):
    resp = await http_client.get("/billing/checkout-complete")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "close this tab" in resp.text


# ---------------------------------------------------------------------------
# Router-level, in-process — endpoints that need Stripe mocked can't go through the
# live http_client fixture (see module docstring); this drives the real `app` object
# this test process imports, through an ASGI transport, with a real bearer token.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def inprocess_client():
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client


@pytest_asyncio.fixture
async def student1_user(db_session, keycloak_token):
    """The real dev-realm student1 user (same one http_client/auth_headers
    authenticates as). Snapshots+restores stripe_customer_id around the test so a test
    that sets it (e.g. a mocked checkout-session creating a customer) doesn't leak that
    id into the shared dev DB for every test/run after it."""
    sub = jose_jwt.get_unverified_claims(keycloak_token)["sub"]
    user = (await db_session.execute(select(User).where(User.keycloak_sub == sub))).scalar_one_or_none()
    if user is None:
        user = User(keycloak_sub=sub)
        db_session.add(user)
        await db_session.commit()

    original_customer_id = user.stripe_customer_id
    yield user
    user.stripe_customer_id = original_customer_id
    await db_session.commit()


async def test_checkout_session_returns_a_url_when_stripe_is_configured_and_mocked(
    inprocess_client, auth_headers, student1_user, monkeypatch
):
    fake_settings = Settings(stripe_secret_key="sk_fake", stripe_price_id_pro="price_fake")
    monkeypatch.setattr(billing_service, "get_settings", lambda: fake_settings)

    monkeypatch.setattr(stripe.Customer, "create", lambda **kwargs: {"id": "cus_inprocess"})
    monkeypatch.setattr(
        stripe.checkout.Session, "create", lambda **kwargs: {"url": "https://checkout.stripe.com/fake-inprocess"}
    )

    resp = await inprocess_client.post("/billing/checkout-session", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {"checkout_url": "https://checkout.stripe.com/fake-inprocess"}


async def test_topup_checkout_session_returns_a_url_when_stripe_is_configured_and_mocked(
    inprocess_client, auth_headers, student1_user, monkeypatch
):
    fake_settings = Settings(stripe_secret_key="sk_fake", stripe_price_id_pro="price_fake")
    monkeypatch.setattr(billing_service, "get_settings", lambda: fake_settings)

    monkeypatch.setattr(stripe.Customer, "create", lambda **kwargs: {"id": "cus_inprocess_topup"})

    seen = {}

    def fake_create(**kwargs):
        seen.update(kwargs)
        return {"url": "https://checkout.stripe.com/fake-topup"}

    monkeypatch.setattr(stripe.checkout.Session, "create", fake_create)

    resp = await inprocess_client.post(
        "/billing/topup-checkout-session",
        json={"amount_cents": billing_service.TOPUP_TIERS_CENTS[1]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json() == {"checkout_url": "https://checkout.stripe.com/fake-topup"}

    # A one-time payment, never a subscription -- and the chosen tier's amount is what
    # actually got sent to Stripe as the line item's unit_amount.
    assert seen["mode"] == "payment"
    assert seen["line_items"][0]["price_data"]["unit_amount"] == billing_service.TOPUP_TIERS_CENTS[1]


async def test_topup_checkout_session_rejects_an_amount_outside_the_curated_tiers(
    inprocess_client, auth_headers, student1_user, monkeypatch
):
    fake_settings = Settings(stripe_secret_key="sk_fake", stripe_price_id_pro="price_fake")
    monkeypatch.setattr(billing_service, "get_settings", lambda: fake_settings)

    resp = await inprocess_client.post(
        "/billing/topup-checkout-session", json={"amount_cents": 999}, headers=auth_headers
    )
    assert resp.status_code == 400


async def test_portal_session_requires_an_existing_customer(
    inprocess_client, auth_headers, student1_user, db_session, monkeypatch
):
    # Deterministic regardless of what earlier tests did to this shared dev user: force
    # "no billing account yet" so this exercises the real 400, never an unmocked call to
    # Stripe's real API (which a leftover stripe_customer_id would otherwise trigger).
    student1_user.stripe_customer_id = None
    await db_session.commit()

    fake_settings = Settings(stripe_secret_key="sk_fake", stripe_price_id_pro="price_fake")
    monkeypatch.setattr(billing_service, "get_settings", lambda: fake_settings)

    resp = await inprocess_client.post("/billing/portal-session", headers=auth_headers)
    assert resp.status_code == 400


async def test_webhook_returns_400_on_invalid_signature(inprocess_client, monkeypatch):
    from app.routers import billing as billing_router

    monkeypatch.setattr(billing_router, "get_settings", lambda: Settings(stripe_webhook_secret="whsec_fake"))

    def fake_construct_event(payload, sig_header, secret):
        raise stripe.SignatureVerificationError("bad signature", sig_header)

    monkeypatch.setattr(stripe.Webhook, "construct_event", fake_construct_event)

    resp = await inprocess_client.post(
        "/billing/webhook", content=b'{"type": "checkout.session.completed"}', headers={"stripe-signature": "bad"}
    )
    assert resp.status_code == 400


async def test_webhook_dispatches_checkout_completed_and_updates_the_user(
    inprocess_client, billing_user, db_session, monkeypatch
):
    from app.routers import billing as billing_router

    billing_user.plan = "free"
    await db_session.commit()

    monkeypatch.setattr(billing_router, "get_settings", lambda: Settings(stripe_webhook_secret="whsec_fake"))

    fake_event = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "client_reference_id": str(billing_user.id),
                "subscription": "sub_webhook",
                "customer": "cus_webhook",
            }
        },
    }
    monkeypatch.setattr(stripe.Webhook, "construct_event", lambda payload, sig_header, secret: fake_event)

    resp = await inprocess_client.post("/billing/webhook", content=b"{}", headers={"stripe-signature": "valid"})
    assert resp.status_code == 200

    await db_session.refresh(billing_user)
    assert billing_user.plan == "pro"
    assert billing_user.stripe_subscription_id == "sub_webhook"


async def test_webhook_dispatches_a_topup_checkout_completed_and_credits_the_balance(
    inprocess_client, billing_user, db_session, monkeypatch
):
    """checkout.session.completed with mode="payment" must route to
    apply_topup_checkout_completed (credits topup_credits_cents), NOT
    apply_checkout_completed (which would incorrectly flip the user to Pro) -- proves
    the webhook's mode-based dispatch, not just the underlying handler function."""
    from app.routers import billing as billing_router

    billing_user.plan = "free"
    billing_user.topup_credits_cents = 0
    await db_session.commit()

    monkeypatch.setattr(billing_router, "get_settings", lambda: Settings(stripe_webhook_secret="whsec_fake"))

    fake_event = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "client_reference_id": str(billing_user.id),
                "mode": "payment",
                "amount_total": 500,
                "customer": "cus_webhook_topup",
            }
        },
    }
    monkeypatch.setattr(stripe.Webhook, "construct_event", lambda payload, sig_header, secret: fake_event)

    resp = await inprocess_client.post("/billing/webhook", content=b"{}", headers={"stripe-signature": "valid"})
    assert resp.status_code == 200

    await db_session.refresh(billing_user)
    # $5.00 paid -> $4.60 credited (8% margin) -- and plan must NOT have changed.
    assert billing_user.topup_credits_cents == 460
    assert billing_user.plan == "free"


async def test_webhook_dispatches_subscription_deleted(inprocess_client, billing_user, db_session, monkeypatch):
    from app.routers import billing as billing_router

    billing_user.plan = "pro"
    billing_user.stripe_subscription_id = "sub_to_delete"
    await db_session.commit()

    monkeypatch.setattr(billing_router, "get_settings", lambda: Settings(stripe_webhook_secret="whsec_fake"))

    fake_event = {
        "type": "customer.subscription.deleted",
        "data": {"object": {"id": "sub_to_delete", "status": "canceled"}},
    }
    monkeypatch.setattr(stripe.Webhook, "construct_event", lambda payload, sig_header, secret: fake_event)

    resp = await inprocess_client.post("/billing/webhook", content=b"{}", headers={"stripe-signature": "valid"})
    assert resp.status_code == 200

    await db_session.refresh(billing_user)
    assert billing_user.plan == "free"


async def test_webhook_returns_200_and_is_a_noop_for_an_unrecognized_event_type(inprocess_client, monkeypatch):
    from app.routers import billing as billing_router

    monkeypatch.setattr(billing_router, "get_settings", lambda: Settings(stripe_webhook_secret="whsec_fake"))

    fake_event = {"type": "invoice.paid", "data": {"object": {}}}
    monkeypatch.setattr(stripe.Webhook, "construct_event", lambda payload, sig_header, secret: fake_event)

    resp = await inprocess_client.post("/billing/webhook", content=b"{}", headers={"stripe-signature": "valid"})
    assert resp.status_code == 200
