"""Pro-tier plan/credit logic + Stripe integration helpers.

Kept as one service module (rather than spreading this logic across the router and the
tutor/tool call sites) so "does this user get Pro-tier access" is decided in exactly one
place -- see is_pro() below, reused by app/agents/tutor.py's frontier-model routing
decision and both Pro-only feature gates (app/tools/study_session.py,
app/routers/voice.py).

Every Stripe call here is a thin, mockable wrapper around the `stripe` SDK. The SDK's
calls are synchronous (blocking) HTTP, so each is pushed onto a worker thread via
asyncio.to_thread rather than blocking the event loop -- this app is otherwise async
end to end.
"""

import asyncio
import math
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
import stripe
from sqlalchemy import select
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.base import SessionLocal
from app.db.models import User

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

# Curated Pro-tier frontier model roster. Each id is one of OpenRouter's own "~...-latest"
# aliases -- the same staleness-resistant pattern already used for openrouter_vision_model
# in core/config.py: the alias tracks whatever each vendor's current flagship-tier model
# actually is, so this roster doesn't need a code change every time a vendor ships a new
# version (a pinned slug like "google/gemini-2.0-flash-001" has already bitten this repo
# once -- see that setting's own comment). Verified live against OPENROUTER_MODELS_URL on
# 2026-09-13: all three resolved and returned real per-token pricing.
# `_fallback_pricing` is that observed USD-per-token pricing, used only if a live pricing
# lookup can't reach OpenRouter at call time.
PRO_MODELS: list[dict[str, Any]] = [
    {
        "id": "~anthropic/claude-sonnet-latest",
        "label": "Claude Sonnet (Anthropic)",
        "_fallback_pricing": {"prompt": 0.000002, "completion": 0.00001},
    },
    {
        "id": "~openai/gpt-sol-latest",
        "label": "GPT Sol (OpenAI)",
        "_fallback_pricing": {"prompt": 0.000002, "completion": 0.00001},
    },
    {
        "id": "~google/gemini-pro-latest",
        "label": "Gemini Pro (Google)",
        "_fallback_pricing": {"prompt": 0.000002, "completion": 0.000012},
    },
]
DEFAULT_PRO_MODEL = PRO_MODELS[0]["id"]
_PRO_MODEL_IDS = {m["id"] for m in PRO_MODELS}

_catalog_cache: dict[str, Any] = {"models": None, "fetched_at": 0.0}
_CATALOG_TTL_SECONDS = 3600  # OpenRouter pricing doesn't move minute to minute


# ---------------------------------------------------------------------------
# OpenRouter catalog: live model list + pricing, cached (same TTL-cache shape as
# app/core/auth.py's JWKS cache).
# ---------------------------------------------------------------------------


async def _fetch_openrouter_catalog() -> dict[str, dict]:
    """Live GET of OpenRouter's public, keyless /models catalog, cached for an hour.
    Keyed by model id -> the full model object (including its `pricing` dict, USD per
    token as strings, straight from OpenRouter)."""
    now = time.monotonic()
    if _catalog_cache["models"] is not None and now - _catalog_cache["fetched_at"] < _CATALOG_TTL_SECONDS:
        return _catalog_cache["models"]

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(OPENROUTER_MODELS_URL)
        response.raise_for_status()
        data = response.json()

    by_id = {m["id"]: m for m in data.get("data", [])}
    _catalog_cache["models"] = by_id
    _catalog_cache["fetched_at"] = now
    return by_id


async def get_pro_model_catalog() -> list[dict[str, str]]:
    """The list `GET /billing/pro-models` returns: the curated roster, live-filtered
    against OpenRouter's own catalog so a model OpenRouter has since deprecated quietly
    drops out instead of being offered and then failing. Degrades to the full curated
    list (unverified) if the live catalog fetch itself fails -- a transient OpenRouter
    outage shouldn't take this endpoint down."""
    try:
        catalog = await _fetch_openrouter_catalog()
    except (httpx.HTTPError, ValueError):
        return [{"id": m["id"], "label": m["label"]} for m in PRO_MODELS]

    return [{"id": m["id"], "label": m["label"]} for m in PRO_MODELS if m["id"] in catalog]


async def _pricing_for(model_id: str) -> dict[str, float]:
    """Per-token USD prompt/completion pricing for one curated model: from the live
    catalog when reachable, else the fallback snapshot recorded in PRO_MODELS above."""
    fallback = next((m["_fallback_pricing"] for m in PRO_MODELS if m["id"] == model_id), None)
    try:
        catalog = await _fetch_openrouter_catalog()
        pricing = catalog[model_id]["pricing"]
        return {"prompt": float(pricing["prompt"]), "completion": float(pricing["completion"])}
    except (httpx.HTTPError, ValueError, KeyError):
        if fallback is None:
            raise
        return fallback


async def compute_cost_cents(model_id: str, prompt_tokens: int, completion_tokens: int) -> int:
    """Actual USD cost of one frontier-model call, in integer cents (rounded up so a
    nonzero fractional-cent call is never tracked as free)."""
    pricing = await _pricing_for(model_id)
    cost_dollars = prompt_tokens * pricing["prompt"] + completion_tokens * pricing["completion"]
    return math.ceil(cost_dollars * 100)


# ---------------------------------------------------------------------------
# Plan checks -- the single source of truth reused by tutor routing + both tool gates.
# ---------------------------------------------------------------------------


def is_pro(user: User) -> bool:
    """The one place that decides "is this user's plan Pro" -- reused by the tutor's
    frontier-model routing decision (app/agents/tutor.py) and both Pro-only feature
    gates (start_study_session, the voice endpoints) so the check never drifts between
    the three call sites."""
    return user.plan == "pro"


def pro_credits_remaining(user: User) -> bool:
    """Whether a Pro user still has frontier-model budget left this billing period.
    Only meaningful once is_pro() has already passed -- callers should check plan first,
    since a free user failing this check isn't the reason they're on the free model."""
    settings = get_settings()
    return user.credits_used_cents < settings.pro_monthly_credit_cents


def resolve_pro_model(user: User) -> str:
    """The frontier model a Pro user's tutor calls should route to: their own selection
    if it's still one of the curated options, else the roster's first (default) entry."""
    if user.preferred_pro_model in _PRO_MODEL_IDS:
        return user.preferred_pro_model
    return DEFAULT_PRO_MODEL


# How many flashcards/practice-exam questions/study-plan items a single generation call
# should aim for. A plan-scaled target, not a hard requirement -- the generation prompts
# still say "produce fewer if the material doesn't support this many" so a one-paragraph
# document doesn't get padded with low-quality filler cards just to hit the number.
FREE_GENERATION_TARGET = 5
PRO_GENERATION_TARGET = 15


def generation_target_count(user: User | None) -> int:
    """The target item count for a generation tool/endpoint call, based on the calling
    user's plan -- reused by flashcards/practice_exams/study_planner so free vs. Pro
    stays consistent across all three instead of each guessing its own number. `None`
    (no signed-in user, shouldn't normally happen but keep it safe) gets the free tier's
    target rather than erroring."""
    if user is not None and is_pro(user):
        return PRO_GENERATION_TARGET
    return FREE_GENERATION_TARGET


async def record_frontier_usage(
    user_id: uuid.UUID, model_id: str, prompt_tokens: int, completion_tokens: int
) -> int:
    """Adds one frontier-model call's real cost to this user's credit ledger. Uses a raw
    atomic UPDATE (credits_used_cents = credits_used_cents + cost) rather than a
    read-modify-write on a loaded ORM object, so two concurrent calls for the same user
    (genuinely possible -- e.g. two chat tabs) can't lose an increment to a race. Opens
    and commits its own short-lived session. Returns the cost added, in cents."""
    cost_cents = await compute_cost_cents(model_id, prompt_tokens, completion_tokens)
    if cost_cents > 0:
        async with SessionLocal() as db:
            await db.execute(
                sa_update(User)
                .where(User.id == user_id)
                .values(credits_used_cents=User.credits_used_cents + cost_cents)
            )
            await db.commit()
    return cost_cents


# ---------------------------------------------------------------------------
# Stripe: customer/checkout/portal creation + webhook event handling.
# ---------------------------------------------------------------------------


def stripe_configured() -> bool:
    settings = get_settings()
    return bool(settings.stripe_secret_key) and bool(settings.stripe_price_id_pro)


def _set_stripe_api_key() -> None:
    stripe.api_key = get_settings().stripe_secret_key.get_secret_value()


async def get_or_create_stripe_customer(db: AsyncSession, user: User) -> str:
    if user.stripe_customer_id:
        return user.stripe_customer_id

    _set_stripe_api_key()
    customer = await asyncio.to_thread(
        stripe.Customer.create,
        email=user.email or None,
        metadata={"newton_user_id": str(user.id)},
    )
    user.stripe_customer_id = customer["id"]
    await db.flush()
    return customer["id"]


async def create_checkout_session(customer_id: str, user_id: uuid.UUID, base_url: str) -> str:
    settings = get_settings()
    _set_stripe_api_key()
    complete_url = f"{base_url}/billing/checkout-complete"
    session = await asyncio.to_thread(
        stripe.checkout.Session.create,
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": settings.stripe_price_id_pro, "quantity": 1}],
        client_reference_id=str(user_id),
        success_url=complete_url,
        cancel_url=complete_url,
    )
    return session["url"]


async def create_portal_session(customer_id: str, base_url: str) -> str:
    _set_stripe_api_key()
    session = await asyncio.to_thread(
        stripe.billing_portal.Session.create,
        customer=customer_id,
        return_url=f"{base_url}/billing/checkout-complete",
    )
    return session["url"]


async def apply_checkout_completed(db: AsyncSession, event_object: dict) -> None:
    """checkout.session.completed: the student just finished paying. Look them up by
    the client_reference_id we set when creating the session, flip them to Pro, and
    start a fresh credit-tracking period."""
    user_id_str = event_object.get("client_reference_id")
    if not user_id_str:
        return
    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        return
    user = await db.get(User, user_id)
    if user is None:
        return

    user.plan = "pro"
    subscription_id = event_object.get("subscription")
    if subscription_id:
        user.stripe_subscription_id = subscription_id
    customer_id = event_object.get("customer")
    if customer_id:
        user.stripe_customer_id = customer_id
    user.credits_used_cents = 0
    user.credits_period_start = datetime.now(timezone.utc)
    await db.commit()


async def _find_user_by_subscription(db: AsyncSession, subscription_id: str | None) -> User | None:
    if not subscription_id:
        return None
    return (
        await db.execute(select(User).where(User.stripe_subscription_id == subscription_id))
    ).scalar_one_or_none()


async def apply_subscription_updated(db: AsyncSession, event_object: dict) -> None:
    """customer.subscription.updated: sync our cached status/period_end. If Stripe
    reports a later current_period_end than we had on file, a new billing period has
    started -- reset the credit ledger for it, same as checkout.session.completed does
    for the very first period."""
    user = await _find_user_by_subscription(db, event_object.get("id"))
    if user is None:
        return

    user.stripe_subscription_status = event_object.get("status")

    period_end_ts = event_object.get("current_period_end")
    new_period_end = datetime.fromtimestamp(period_end_ts, tz=timezone.utc) if period_end_ts else None

    if new_period_end and (user.current_period_end is None or new_period_end > user.current_period_end):
        user.credits_used_cents = 0
        user.credits_period_start = datetime.now(timezone.utc)

    user.current_period_end = new_period_end
    await db.commit()


async def apply_subscription_deleted(db: AsyncSession, event_object: dict) -> None:
    """customer.subscription.deleted: the subscription is actually gone (not just
    scheduled to cancel at period end, which Stripe reports as an `updated` event
    instead) -- revert to the free plan."""
    user = await _find_user_by_subscription(db, event_object.get("id"))
    if user is None:
        return

    user.plan = "free"
    user.stripe_subscription_status = event_object.get("status") or "canceled"
    await db.commit()
