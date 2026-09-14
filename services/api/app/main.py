import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import check_no_default_secrets, get_settings
from app.core.logging import configure_logging, correlation_id_scope, get_correlation_id, new_correlation_id
from app.core.sentry import init_sentry, report_exception
from app.routers import (
    account,
    billing,
    chat,
    classroom,
    documents,
    flashcards,
    gamification,
    health,
    practice_exams,
    study_plan,
    tools,
    voice,
)

settings = get_settings()
# Refuses to import (i.e. refuses to start) if this is a non-dev deployment still
# running with a publicly-known default secret from this open-source repo. See
# check_no_default_secrets()'s docstring in app/core/config.py.
check_no_default_secrets(settings)

# Wires up the root logger so every `logging.getLogger("newton.*")` call site -- old and
# new -- gets a correlation id automatically. See app/core/logging.py's module docstring
# for the full mechanism; this is the one place it's configured.
configure_logging()
# Dormant until SENTRY_DSN is actually set (see app/core/sentry.py) -- never a startup
# failure either way.
init_sentry(settings)

logger = logging.getLogger("newton.main")

app = FastAPI(title="Newton API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def correlation_id_middleware(request: Request, call_next):
    """Generates (or reuses an incoming X-Request-ID header's) correlation id for this
    one HTTP request, makes it the ambient id for every log line emitted while handling
    it (see app/core/logging.py), stashes it on request.state (read by the global
    exception handler below -- more robust than the contextvar there, since the `with`
    block's own reset already runs, unwinding through this frame, before an exception
    reaches that outer handler), and echoes it back in the response so a client/log
    correlation is possible from either side."""
    correlation_id = request.headers.get("x-request-id") or new_correlation_id()
    request.state.correlation_id = correlation_id
    with correlation_id_scope(correlation_id):
        response = await call_next(request)
    response.headers["X-Request-ID"] = correlation_id
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Global safety net: anything unhandled anywhere below this (a router, a
    dependency, ORM code, ...) lands here instead of FastAPI's default traceback-shaped
    response. Logs full context at ERROR level (including the correlation id, so this
    line can be found from the response's X-Request-ID alone), reports to Sentry if
    configured (report_exception is a no-op otherwise -- see app/core/sentry.py), and
    returns a clean, non-leaky error body."""
    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id() or "-"
    logger.error(
        "Unhandled exception request_id=%s method=%s path=%s: %s",
        correlation_id,
        request.method,
        request.url.path,
        exc,
        exc_info=exc,
    )
    report_exception(exc)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_server_error", "request_id": correlation_id},
        headers={"X-Request-ID": correlation_id},
    )


app.include_router(health.router)
app.include_router(chat.router)
app.include_router(documents.router)
app.include_router(tools.router)
app.include_router(study_plan.router)
app.include_router(classroom.router)
app.include_router(flashcards.router)
app.include_router(gamification.router)
app.include_router(practice_exams.router)
app.include_router(voice.router)
app.include_router(billing.router)
app.include_router(account.router)
