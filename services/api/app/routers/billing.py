import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_user
from app.core.config import get_settings
from app.db.base import get_db
from app.db.models import User
from app.services import billing as billing_service
from app.services.users import get_or_create_user

router = APIRouter(prefix="/billing", tags=["billing"])

# Same 402 convention as voice.py's PRO_ONLY_MESSAGE / _require_pro -- a free user hitting
# this endpoint directly (the Settings UI itself never calls it for a free user, see
# SettingsPanel.tsx) gets a clear, non-punitive reason rather than a raw 402 with no body,
# and is told what they're on instead so this doubles as the "you're already covered"
# message.
PREFERRED_MODEL_PRO_ONLY_MESSAGE = (
    "Choosing a preferred model is a Pro feature. Free accounts automatically use "
    f"{billing_service.PRO_MODELS[0]['label'].removesuffix(' (default)')} — a great free default."
)


class PreferredModelUpdate(BaseModel):
    model_id: str


def _serialize_status(user: User) -> dict:
    settings = get_settings()
    return {
        "plan": user.plan,
        "subscription_status": user.stripe_subscription_status,
        "current_period_end": user.current_period_end.isoformat() if user.current_period_end else None,
        "credits_used_cents": user.credits_used_cents,
        "credits_limit_cents": settings.pro_monthly_credit_cents,
        "credits_reset_at": user.credits_period_start.isoformat() if user.credits_period_start else None,
        "preferred_pro_model": billing_service.resolve_pro_model(user),
        # Static plan constants (not user-specific) so the desktop UI can show an honest
        # "free generates up to N, Pro generates up to M" note without hardcoding numbers
        # that could drift from billing_service's actual generation_target_count() -- see
        # DocumentsPanel.tsx's generation note next to the Flashcards/Practice exam/Study
        # plan buttons.
        "free_generation_target": billing_service.FREE_GENERATION_TARGET,
        "pro_generation_target": billing_service.PRO_GENERATION_TARGET,
    }


@router.get("/status")
async def billing_status(
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await get_or_create_user(db, claims)
    await db.commit()
    return _serialize_status(user)


@router.get("/pro-models")
async def pro_models(claims: dict = Depends(require_user)) -> list[dict]:
    return await billing_service.get_pro_model_catalog()


@router.patch("/preferred-model")
async def set_preferred_model(
    body: PreferredModelUpdate,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Persists a Pro user's chosen frontier model (see billing_service.PRO_MODELS /
    resolve_pro_model). Validated against the curated roster's current ids -- never
    accept an arbitrary string here, since resolve_pro_model would then silently fall
    back to the default anyway and the user's "selection" would be a lie.

    Deliberately checks is_pro() AFTER validating the model id (so a bad id is always a
    400, regardless of plan) but BEFORE writing anything: a free user's request is never
    persisted, even transiently -- see PREFERRED_MODEL_PRO_ONLY_MESSAGE's docstring-ish
    comment above. The desktop Settings UI itself never calls this endpoint for a free
    user (clicking an option there just shows an inline upsell message locally), so this
    402 path only matters for direct/API misuse or a stale UI -- but it's still the one
    place that decides "does this persist", so it has to get it right independent of the
    frontend's own gating.
    """
    if body.model_id not in billing_service._PRO_MODEL_IDS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not a recognized Pro model id.")

    user = await get_or_create_user(db, claims)
    if not billing_service.is_pro(user):
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, PREFERRED_MODEL_PRO_ONLY_MESSAGE)

    user.preferred_pro_model = body.model_id
    await db.commit()
    return _serialize_status(user)


@router.post("/checkout-session")
async def checkout_session(
    request: Request,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not billing_service.stripe_configured():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Billing isn't configured on this server yet.",
        )

    user = await get_or_create_user(db, claims)
    customer_id = await billing_service.get_or_create_stripe_customer(db, user)
    await db.commit()

    base_url = str(request.base_url).rstrip("/")
    checkout_url = await billing_service.create_checkout_session(customer_id, user.id, base_url)
    return {"checkout_url": checkout_url}


@router.post("/portal-session")
async def portal_session(
    request: Request,
    claims: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not billing_service.stripe_configured():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Billing isn't configured on this server yet.",
        )

    user = await get_or_create_user(db, claims)
    if not user.stripe_customer_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No billing account on file yet -- start a checkout session first.",
        )
    await db.commit()

    base_url = str(request.base_url).rstrip("/")
    portal_url = await billing_service.create_portal_session(user.stripe_customer_id, base_url)
    return {"portal_url": portal_url}


@router.post("/webhook")
async def webhook(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Called by Stripe itself, not the app -- authenticated by its own signature header
    rather than require_user (see stripe.Webhook.construct_event below), so this is
    deliberately NOT behind the usual Depends(require_user)."""
    settings = get_settings()
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.stripe_webhook_secret.get_secret_value()
        )
    except (ValueError, stripe.SignatureVerificationError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid webhook signature: {exc}") from exc

    event_type = event["type"]
    event_object = event["data"]["object"]

    if event_type == "checkout.session.completed":
        await billing_service.apply_checkout_completed(db, event_object)
    elif event_type == "customer.subscription.updated":
        await billing_service.apply_subscription_updated(db, event_object)
    elif event_type == "customer.subscription.deleted":
        await billing_service.apply_subscription_deleted(db, event_object)
    # Any other event type is a deliberate no-op -- Stripe sends many this app doesn't
    # act on, and those should still come back 200 rather than erroring.

    return {"status": "ok"}


@router.get("/checkout-complete")
async def checkout_complete() -> Response:
    """Stripe Checkout's success_url/cancel_url both point here. This is a desktop app,
    not a web app with a clean post-payment page of its own to redirect back into, and
    there's no working deep-link/callback scheme yet -- so this is deliberately just a
    static "you're done" page: the desktop app opens the browser to Checkout, then polls
    GET /billing/status on its own to notice the upgrade, exactly as a human would expect
    "did it work" to be answered."""
    html = (
        "<!doctype html><html><body style=\"font-family: sans-serif; text-align: center; "
        'padding: 4rem;">'
        "<h2>You're all set</h2><p>You can close this tab and return to Newton.</p>"
        "</body></html>"
    )
    return Response(content=html, media_type="text/html")
