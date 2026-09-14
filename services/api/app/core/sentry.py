"""Dormant-until-configured Sentry error tracking.

Same pattern as every other optional third-party integration in this codebase -- see
app/services/billing.py's Stripe wrappers (dormant until STRIPE_SECRET_KEY/etc. are set)
and infra/docker-compose.yml's x-api-env comments for the exact precedent this follows:
the `sentry-sdk` package is always installed (see requirements.txt), `init_sentry()` is
always called at startup (see app/main.py), and it silently does nothing unless a real
`SENTRY_DSN` is actually configured. Never a startup failure, never a network call,
either way.
"""

from __future__ import annotations

import logging

import sentry_sdk

from app.core.config import Settings

logger = logging.getLogger("newton.sentry")

_initialized = False


def init_sentry(settings: Settings) -> None:
    """Call once at startup. No-ops (does not call sentry_sdk.init at all) if
    `settings.sentry_dsn` isn't set -- the SDK client stays uninitialized, which is what
    makes `report_exception` below a true no-op too."""
    global _initialized
    dsn = settings.sentry_dsn.get_secret_value() if settings.sentry_dsn else ""
    if not dsn:
        return
    sentry_sdk.init(dsn=dsn, environment=settings.env, traces_sample_rate=0.0)
    _initialized = True
    logger.info("Sentry error tracking initialized environment=%s", settings.env)


def report_exception(exc: BaseException) -> None:
    """Reports `exc` to Sentry if init_sentry() actually configured a client; a genuine
    no-op otherwise -- `sentry_sdk.capture_exception` is documented-safe to call with no
    client active (it just returns None, no network I/O, no exception of its own), which
    is exactly what lets the global exception handler (app/main.py) and the WebSocket
    safety net (app/routers/chat.py) call this unconditionally rather than branching on
    whether Sentry happens to be configured."""
    sentry_sdk.capture_exception(exc)
