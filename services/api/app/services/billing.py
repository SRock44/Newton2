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

Two SEPARATE frontier-model funding pools live on User, both spent via the same
compute_cost_cents/record_frontier_usage machinery: `credits_used_cents`, a Pro
subscriber's monthly allowance (resets every billing period, funded by the recurring
Stripe subscription above), and `topup_credits_cents`, a real, purchased,
NON-expiring balance (funded by a one-time Stripe Checkout purchase, see
create_topup_checkout_session/apply_topup_checkout_completed below -- ROADMAP.md Phase
7). See frontier_access_available for whether a call routes to a frontier model at all,
and record_frontier_usage's docstring for exactly how a call that runs gets charged
against one or both pools.
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
from app.core.redis_client import get_redis
from app.db.base import SessionLocal
from app.db.models import User

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

# Curated Pro-tier model roster.
#
# DELIBERATE, INFORMED DECISION (2026-09-13, product owner) -- do not add back the
# previous frontier roster (Claude Sonnet / GPT Sol / Gemini Pro, all via OpenRouter's
# "~...-latest" staleness-resistant aliases) without asking first. All three resolved to
# real per-token pricing around $2/M input, $10-12/M output -- confirmed live, not
# assumed -- which the product owner decided was not worth paying for this project right
# now given DeepSeek's price/performance at a fraction of the cost. Restricted to exactly
# two options until that changes: DeepSeek (already the free-tier default, real 1M+
# context, real quality at this price point) and Muse Spark Contributor (see its own
# entry's comment for the training-data-consent tradeoff already decided on separately).
# `_fallback_pricing` is real observed USD-per-token pricing, used only if a live pricing
# lookup can't reach OpenRouter at call time.
PRO_MODELS: list[dict[str, Any]] = [
    {
        # Same model id as the free-tier default (see app/agents/tutor.py's
        # _select_provider / get_provider) -- offered explicitly here too so a Pro user
        # who wants it can pin it as their preferred_pro_model rather than relying on
        # whatever the free-tier default happens to be. Pinned to the literal versioned
        # slug (no "~deepseek/deepseek-v4-flash-...-latest" alias exists on OpenRouter),
        # matching this app's already-established practice of tracking DeepSeek's model
        # ids by hand (see infra/README.md).
        "id": "deepseek/deepseek-v4-flash-0731",
        "label": "DeepSeek V4 Flash (default)",
        "_fallback_pricing": {"prompt": 0.000000065, "completion": 0.00000018},
    },
    {
        # No "~meta/muse-spark-...-latest" alias exists on OpenRouter yet (checked
        # 2026-09-13) -- this is pinned to a literal versioned slug, the exact staleness
        # risk the comment above warns about, so this needs a manual bump whenever Meta
        # ships a 1.4 (or later) Contributor tier.
        #
        # DELIBERATE, INFORMED DECISION (2026-09-13, product owner) -- do not "fix" this
        # by swapping to the Standard (non-Contributor) tier without asking first: the
        # Contributor tier is the literal same model weights as full-price Muse Spark
        # 1.3 (confirmed against Meta's own provider docs, not just marketing), priced
        # ~20x cheaper specifically because using it grants Meta permission to train on
        # submitted prompts/completions -- unlike Standard Services, which explicitly
        # exclude user data from training. Meta's own docs warn against sending sensitive
        # content through this tier. Newton routes real student conversations (homework,
        # essays, uploaded documents) through whatever Pro model is selected, with no
        # disclosure to students/parents that this specific option trains on their data.
        # This was flagged explicitly and the product owner chose to proceed anyway on
        # the price/performance case, without adding disclosure -- see ROADMAP.md's
        # "Independent product & engineering review" section for the full record.
        "id": "meta/muse-spark-1.3-contributor",
        "label": "Muse Spark Contributor (Meta)",
        "_fallback_pricing": {"prompt": 0.0000001, "completion": 0.0000002},
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


def frontier_access_available(user: User | None, openrouter_configured: bool) -> bool:
    """Whether this user's tutor calls should route to a frontier (Pro-tier) model at
    all right now -- the single place that decision is made, reused by
    app/agents/tutor.py's _select_provider so the real routing logic and any future
    caller never drift apart. True when OpenRouter is actually configured AND either:

      - the user is Pro and still has monthly subscription credit left this period
        (is_pro + pro_credits_remaining, the original, pre-top-up condition), OR
      - regardless of plan, the user has a nonzero PURCHASED top-up balance
        (topup_credits_cents > 0) -- see the module docstring's "Pro-monthly-credit vs.
        top-up-balance" note and record_frontier_usage below for how a call that
        actually runs gets charged against whichever pool(s) fund it.

    A free user with a top-up balance is a deliberate, real product decision (see
    ROADMAP.md Phase 7): topping up buys real spendable credit, not a Pro subscription,
    so it has to work standalone without requiring Pro at all.
    """
    if user is None or not openrouter_configured:
        return False
    if is_pro(user) and pro_credits_remaining(user):
        return True
    return user.topup_credits_cents > 0


# ---------------------------------------------------------------------------
# Frontier-turn lock -- closes a real TOCTOU gap between the check above and the charge
# below. frontier_access_available reads the balance fresh per turn, but a turn's real
# cost (and therefore the actual debit via record_frontier_usage) is only known once
# the WHOLE turn finishes -- 25-110s later for a multi-tool-call chat turn, up to a
# couple of minutes for an artifact build. Two concurrent frontier-metered turns for the
# SAME user (a second device, or a chat message sent while an artifact is still
# building) could both read the same pre-spend balance and both pass the check before
# either one writes back, letting the user overdraw their own balance by more than one
# call's worth rather than the single bounded overage record_frontier_usage's own
# docstring already accepts as normal.
#
# Serializes at the APPLICATION level via a Redis SET NX, not a Postgres row lock --
# holding a DB transaction (and therefore a pooled connection) open for the full 25s-2min
# duration of a real provider call would be a much worse problem at scale than the gap
# this closes. Callers acquire this once frontier_access_available has already said yes,
# and release it in a finally once the turn's charge (if any) is done -- see
# app/agents/tutor.py's run_tutor and app/tools/create_artifact.py's CreateArtifactTool
# for the two real call sites.
_FRONTIER_TURN_LOCK_PREFIX = "newton:frontier-turn-lock:"
# Generous margin over any real turn's observed worst case (create_artifact's own
# longest confirmed build was ~130s) -- self-healing if a process crashes mid-turn
# without ever reaching the release, rather than permanently locking a user out of
# their own paid-for frontier access.
FRONTIER_TURN_LOCK_TTL_SECONDS = 300


async def try_acquire_frontier_turn_lock(user_id: uuid.UUID) -> bool:
    """True if this call just acquired the lock (no other frontier-metered turn is
    currently in flight for this user) -- the caller may proceed to spend. False if
    another one already holds it; the caller must NOT route to a frontier model for
    this turn (see call sites for what each does instead)."""
    acquired = await get_redis().set(
        f"{_FRONTIER_TURN_LOCK_PREFIX}{user_id}", "1", nx=True, ex=FRONTIER_TURN_LOCK_TTL_SECONDS
    )
    return bool(acquired)


async def release_frontier_turn_lock(user_id: uuid.UUID) -> None:
    """Only ever called by whichever call actually acquired the lock (see
    try_acquire_frontier_turn_lock's return value) -- never unconditionally, since that
    would let a turn that never held the lock release one a DIFFERENT concurrent turn
    for the same user is still legitimately holding."""
    await get_redis().delete(f"{_FRONTIER_TURN_LOCK_PREFIX}{user_id}")


async def record_frontier_usage(
    user_id: uuid.UUID, model_id: str, prompt_tokens: int, completion_tokens: int
) -> int:
    """Adds one frontier-model call's real cost to this user's credit ledger(s). Returns
    the cost added, in cents.

    PRODUCT DECISION -- which pool pays for a call, when a user has both a Pro monthly
    allowance and a purchased top-up balance (see ROADMAP.md Phase 7): the Pro monthly
    allowance is spent FIRST, up to its per-period cap (Settings.pro_monthly_credit_cents),
    and only the remainder spills onto the user's non-expiring topup_credits_cents
    balance. Reasoning: the monthly allowance is use-it-or-lose-it -- whatever's unspent
    at period end is simply gone -- while a top-up balance carries over indefinitely, so
    burning the expiring allowance first is the only ordering that never leaves value on
    the table for a Pro+top-up user. A free (non-Pro) user has no monthly allowance at
    all, so their usage is funded entirely from topup_credits_cents.

    The split is decided HERE, at charge time, from a fresh read of the row -- not by
    trusting whatever frontier_access_available saw when the call started -- because the
    real cost of a (possibly long, multi-tool-call) conversation turn is only known once
    every round of it has actually run.

    Same unclamped-overage behavior this ledger already had before top-up balances
    existed (see the original raw-UPDATE version of this function): a single call's real
    cost can end up a little past whatever authorized it, since that authorization
    necessarily happened before the cost was known. Before, that meant
    credits_used_cents could end up past pro_monthly_credit_cents; now it can also mean
    topup_credits_cents goes slightly negative. Either way it's the *next* call that
    actually gets blocked (frontier_access_available then reads false), not this one --
    same tradeoff as before, just extended to the second pool.

    Uses atomic column-delta UPDATE expressions (`X = X + delta`) for the actual writes,
    same as before, so two concurrent calls for the same user (e.g. two chat tabs) can't
    lose an increment to a race -- only the *split* between the two pools (computed from
    a prior read) can be marginally imprecise under real concurrency, never the totals.
    """
    cost_cents = await compute_cost_cents(model_id, prompt_tokens, completion_tokens)
    if cost_cents <= 0:
        return cost_cents

    async with SessionLocal() as db:
        user = await db.get(User, user_id)
        if user is None:
            return cost_cents

        pro_budget_left = 0
        if is_pro(user):
            settings = get_settings()
            pro_budget_left = max(0, settings.pro_monthly_credit_cents - user.credits_used_cents)

        from_pro = min(cost_cents, pro_budget_left)
        from_topup = cost_cents - from_pro

        await db.execute(
            sa_update(User)
            .where(User.id == user_id)
            .values(
                credits_used_cents=User.credits_used_cents + from_pro,
                topup_credits_cents=User.topup_credits_cents - from_topup,
            )
        )
        await db.commit()
    return cost_cents


# ---------------------------------------------------------------------------
# Top-up balance: a real, purchased, non-expiring credit balance -- separate from the
# Pro monthly subscription allowance above. See ROADMAP.md Phase 7 and User.
# topup_credits_cents's own comment (app/db/models.py) for the full framing.
# ---------------------------------------------------------------------------

# Newton's cut of a top-up purchase -- the rest becomes real spendable credit, tracked
# against actual per-token OpenRouter cost via compute_cost_cents, same as everything
# else this ledger already charges for. "~8%, exact number TBD" per ROADMAP.md Phase 7
# -- a plain module constant (not a Settings field) since, unlike the Stripe keys/price
# id, this is a product number the codebase itself should own, not something a deployer
# tunes per-environment.
TOPUP_MARGIN = 0.08

# Fixed purchase tiers ($5 / $10 / $25), in cents -- kept simple for a first pass rather
# than an open-amount field (easier to validate server-side, easier for the Settings UI
# to render as a few buttons, and avoids having to think about a sane min/max on an
# arbitrary amount). Revisit if product wants an open amount later.
TOPUP_TIERS_CENTS: list[int] = [500, 1000, 2500]


def compute_topup_credit_cents(amount_paid_cents: int) -> int:
    """Real spendable credit added to a user's top-up balance from a one-time Stripe
    payment of `amount_paid_cents` (Stripe's own `amount_total`, already real integer
    cents -- no unit conversion needed), after Newton's TOPUP_MARGIN cut.

    Integer-only math throughout (basis points, floor-divided) -- no float dollars
    anywhere in this calculation, so there's no float rounding drift on real money, same
    care compute_cost_cents takes on the spend side of this ledger. Floors the result,
    so a sub-cent remainder always rounds in NEWTON's favor (the user is credited
    slightly less, never slightly more) -- the credit-side mirror of compute_cost_cents
    always rounding a fractional cent UP (never under-charging): both directions bias
    toward Newton, never against it.
    """
    margin_basis_points = round(TOPUP_MARGIN * 10_000)  # e.g. 800 for 8%
    return amount_paid_cents * (10_000 - margin_basis_points) // 10_000


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


async def create_topup_checkout_session(
    customer_id: str, user_id: uuid.UUID, amount_cents: int, base_url: str
) -> str:
    """A one-time (mode="payment", NOT "subscription") Stripe Checkout session for a
    top-up purchase of `amount_cents` (must be one of TOPUP_TIERS_CENTS -- validated by
    the caller, app/routers/billing.py's topup_checkout_session). Unlike the Pro
    subscription flow's create_checkout_session (which references a pre-created Stripe
    Price object, stripe_price_id_pro), there's no fixed Price object per tier here --
    price_data builds the line item inline from the chosen amount, since tiers are a
    plain Python list this app owns, not something requiring Dashboard setup."""
    _set_stripe_api_key()
    complete_url = f"{base_url}/billing/checkout-complete"
    session = await asyncio.to_thread(
        stripe.checkout.Session.create,
        mode="payment",
        customer=customer_id,
        line_items=[
            {
                "price_data": {
                    "currency": "usd",
                    "product_data": {"name": "Newton credit top-up"},
                    "unit_amount": amount_cents,
                },
                "quantity": 1,
            }
        ],
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
    """checkout.session.completed for the Pro SUBSCRIPTION flow (mode="subscription",
    see create_checkout_session) -- the student just finished paying. Look them up by
    the client_reference_id we set when creating the session, flip them to Pro, and
    start a fresh credit-tracking period.

    NOT called for a top-up purchase (mode="payment") -- see
    apply_topup_checkout_completed below, and app/routers/billing.py's webhook handler,
    which dispatches checkout.session.completed to one or the other based on
    event_object["mode"]."""
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


async def apply_topup_checkout_completed(db: AsyncSession, event_object: dict) -> None:
    """checkout.session.completed for a TOP-UP purchase (mode="payment", see
    create_topup_checkout_session) -- distinct from apply_checkout_completed's
    subscription flow above, routed here by app/routers/billing.py's webhook handler on
    event_object["mode"]. Credits the user's non-expiring topup_credits_cents balance
    with the post-margin amount (compute_topup_credit_cents), computed from
    `amount_total` -- Stripe's own record of what was actually collected, already real
    integer cents, never something this code invents or re-derives from the line item.

    Uses an atomic column-delta UPDATE (same shape as record_frontier_usage's writes),
    not a read-modify-write on a loaded ORM object -- a real payment webhook must never
    lose an increment to a race against, say, a concurrent frontier-usage debit for the
    same user."""
    user_id_str = event_object.get("client_reference_id")
    if not user_id_str:
        return
    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        return

    amount_total = event_object.get("amount_total")
    if not amount_total or amount_total <= 0:
        return

    credit_cents = compute_topup_credit_cents(amount_total)
    if credit_cents <= 0:
        return

    await db.execute(
        sa_update(User)
        .where(User.id == user_id)
        .values(topup_credits_cents=User.topup_credits_cents + credit_cents)
    )
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
