"""Integration tests for app/main.py's correlation-id middleware and global exception
handler (Phase 7's "structured logging / global exception boundary" item).

Two kinds of test here, same split test_billing.py already uses for the same reason:
  - The request-id header round trip goes through the live `http_client` fixture
    (hits the real deployed API container), like every other router-level test in this
    suite -- there's a real, already-existing `/health` endpoint to piggyback on, no
    need for anything test-only there.
  - The global exception handler needs to observe a genuinely unhandled exception, which
    the live API's real routes never raise on purpose. Rather than reaching into a real
    router (risking a conflict with the other agents currently touching those files, per
    this task's scope boundary), this registers one temporary, test-only route directly
    on the `app` object imported in-process (same ASGITransport idiom test_billing.py's
    `inprocess_client` fixture already uses) and removes it again in a `finally`.
"""

import logging

import httpx
import pytest_asyncio


async def test_request_id_header_present_when_not_supplied(http_client):
    resp = await http_client.get("/health")
    assert resp.status_code == 200
    assert resp.headers.get("x-request-id")


async def test_request_id_header_echoed_verbatim_when_supplied(http_client):
    resp = await http_client.get("/health", headers={"X-Request-ID": "fixed-test-request-id-123"})
    assert resp.status_code == 200
    assert resp.headers.get("x-request-id") == "fixed-test-request-id-123"


@pytest_asyncio.fixture
async def inprocess_boom_route():
    """Registers a route on the real `app` object that always raises, for the duration
    of one test, via httpx's ASGI transport (in-process, no live network hop -- the
    same idiom test_billing.py's `inprocess_client` fixture uses for Stripe-mocked
    tests). `raise_app_exceptions=False` is required here specifically: Starlette's
    ServerErrorMiddleware re-raises the original exception after handing it to our
    custom handler (so it's still visible to the ASGI server's own logging) -- with the
    default True, httpx would propagate that re-raise into the test instead of handing
    back the response our handler actually built."""
    from app.main import app

    async def _boom() -> None:
        raise RuntimeError("deliberately injected test exception for the global handler")

    app.add_api_route("/__test_unhandled_exception", _boom, methods=["GET"])
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        try:
            yield client
        finally:
            app.router.routes = [
                r for r in app.router.routes if getattr(r, "path", None) != "/__test_unhandled_exception"
            ]


async def test_global_exception_handler_returns_clean_response_not_a_traceback(inprocess_boom_route):
    resp = await inprocess_boom_route.get("/__test_unhandled_exception")

    assert resp.status_code == 500
    body = resp.json()
    assert body["error"] == "internal_server_error"
    assert body["request_id"]  # non-empty
    # The actual proof this isn't FastAPI/Starlette's default debug-shaped traceback
    # response: neither the exception type name nor a traceback marker anywhere in the
    # body text.
    assert "RuntimeError" not in resp.text
    assert "Traceback" not in resp.text
    assert "deliberately injected" not in resp.text


async def test_global_exception_handler_echoes_and_logs_the_correlation_id(inprocess_boom_route, caplog):
    with caplog.at_level(logging.ERROR, logger="newton.main"):
        resp = await inprocess_boom_route.get(
            "/__test_unhandled_exception", headers={"X-Request-ID": "boom-test-correlation-id"}
        )

    assert resp.status_code == 500
    assert resp.headers["x-request-id"] == "boom-test-correlation-id"
    assert resp.json()["request_id"] == "boom-test-correlation-id"

    error_records = [r for r in caplog.records if r.name == "newton.main" and r.levelno == logging.ERROR]
    assert error_records, "expected the global exception handler to log at ERROR level"
    assert any("boom-test-correlation-id" in r.getMessage() for r in error_records)
    assert any(r.exc_info is not None for r in error_records)  # real traceback captured server-side
