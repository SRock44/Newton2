"""Tests for app/core/sentry.py's dormant-until-configured Sentry integration -- same
dormant pattern as app/services/billing.py's Stripe wrappers (see test_billing.py).
sentry_sdk itself is never mocked at the transport level (it has no keyless live check
worth making, unlike, say, the OpenRouter catalog in test_billing.py); instead
`sentry_sdk.init`/`sentry_sdk.capture_exception` are monkeypatched at the function
boundary, the same idiom test_billing.py uses for `stripe.*`.
"""

from pydantic import SecretStr

from app.core import sentry as sentry_module
from app.core.config import Settings


def test_init_sentry_is_a_true_noop_with_no_dsn_configured(monkeypatch):
    calls = []
    monkeypatch.setattr(sentry_module.sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))

    sentry_module.init_sentry(Settings(sentry_dsn=None))

    assert calls == []  # sentry_sdk.init was never called


def test_init_sentry_also_noops_on_an_explicitly_empty_dsn(monkeypatch):
    calls = []
    monkeypatch.setattr(sentry_module.sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))

    sentry_module.init_sentry(Settings(sentry_dsn=SecretStr("")))

    assert calls == []


def test_init_sentry_initializes_when_a_real_dsn_is_configured(monkeypatch):
    calls = []
    monkeypatch.setattr(sentry_module.sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))

    sentry_module.init_sentry(Settings(sentry_dsn=SecretStr("https://fake-key@fake.ingest.sentry.io/123"), env="dev"))

    assert len(calls) == 1
    assert calls[0]["dsn"] == "https://fake-key@fake.ingest.sentry.io/123"
    assert calls[0]["environment"] == "dev"


def test_report_exception_never_raises_with_no_sentry_client_configured():
    """The real, unmocked guarantee report_exception() leans on: sentry_sdk's own
    capture_exception is documented-safe to call with no client initialized -- no
    network attempt, no exception of its own. This test deliberately does NOT monkeypatch
    sentry_sdk here, so it's exercising the real SDK behavior, not an assumption about it.
    """
    sentry_module.report_exception(RuntimeError("no client is configured in this test process"))
    # Reaching this line at all is the assertion -- report_exception() must not raise.
