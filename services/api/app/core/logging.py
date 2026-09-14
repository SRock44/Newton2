"""Structured logging plumbing: a correlation/request id that automatically appears in
every log line emitted while processing one HTTP request or one WebSocket chat turn,
without threading it explicitly through every function signature.

Mechanism: a `contextvars.ContextVar` holds the current correlation id; a
`logging.Filter` attached to the handler configured in `configure_logging()` stamps it
onto every `logging.LogRecord` (as `record.correlation_id`) right before that handler
formats/emits it, and the format string includes `%(correlation_id)s`. This is the
standard stdlib-documented way to thread ambient per-request context into logging
without changing every function signature along the call chain (see the `logging`
cookbook's "using a context variable" recipe) -- and it composes correctly with asyncio:
`asyncio.create_task()` captures a copy of the *current* context at task-creation time,
so anything set here (via `correlation_id_scope`) before spawning a task is automatically
visible to that task, and to whatever tools/awaits it performs, with zero manual passing.
This is exactly how one chat turn's id (set in app/routers/chat.py's WS loop) ends up on
every log line emitted deep inside app/agents/tutor.py's tool-calling loop and any tool
it calls (e.g. app/tools/research_fetch.py's existing logger calls) with no changes
needed in those callees.

This module is deliberately NOT a rewrite of every `logging.getLogger(...)` call site in
the codebase -- see ROADMAP.md Phase 7. It's the shared mechanism plus a couple of
demonstration call sites (app/routers/chat.py's WS handler, app/agents/tutor.py's
tool-calling loop). Any other module adopts the same behavior "for free" simply by
calling `logging.getLogger("newton.<module>")` and logging normally, once
`configure_logging()` has run at startup (see app/main.py) -- no per-module import of
this file required.
"""

from __future__ import annotations

import contextvars
import logging
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

_correlation_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "newton_correlation_id", default=None
)

# What an emitted-outside-any-scope log line shows for %(correlation_id)s -- e.g. a
# background job or something logged before the first request. Never a crash from the
# formatter hitting a missing attribute.
NO_CORRELATION_ID = "-"

LOG_FORMAT = "%(asctime)s %(levelname)s [%(correlation_id)s] %(name)s: %(message)s"


def new_correlation_id() -> str:
    """A short, header/log-line-friendly id -- not a full UUID's worth of noise, but
    enough entropy that two concurrent requests/turns are never confused with each
    other."""
    return uuid.uuid4().hex[:12]


def get_correlation_id() -> str | None:
    """The ambient correlation id for whatever request/turn is currently executing, or
    None if nothing has set one (e.g. code running outside `correlation_id_scope`)."""
    return _correlation_id.get()


@contextmanager
def correlation_id_scope(correlation_id: str) -> Iterator[str]:
    """Sets the current correlation id for the duration of the `with` block -- and for
    any `asyncio.create_task()` spawned inside it, see module docstring -- then restores
    whatever was set before. Always use this (rather than calling the ContextVar
    directly) so the reset happens even when the block raises."""
    token = _correlation_id.set(correlation_id)
    try:
        yield correlation_id
    finally:
        _correlation_id.reset(token)


class CorrelationIdFilter(logging.Filter):
    """Stamps the ambient correlation id onto every LogRecord passing through the
    Handler this is attached to. Deliberately attached to a *Handler* rather than a
    Logger: `logging.Logger.handle()` only runs filters attached to the exact logger
    that originated the call, but `callHandlers()` runs each Handler's own filters for
    every record that reaches it regardless of which logger (e.g. any
    `logging.getLogger("newton.whatever")`) originated it -- attaching here, once, is
    what makes this apply codebase-wide without touching every call site."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.correlation_id = get_correlation_id() or NO_CORRELATION_ID
        return True


_configured = False


def configure_logging(level: int = logging.INFO) -> None:
    """Wires up the root logger with one StreamHandler carrying the correlation-id
    filter + a format string that includes it. Call once at startup (see app/main.py).
    Idempotent -- safe to call more than once (e.g. re-imported under a test runner)
    without stacking up duplicate handlers.
    """
    global _configured
    if _configured:
        return

    handler = logging.StreamHandler()
    handler.addFilter(CorrelationIdFilter())
    handler.setFormatter(logging.Formatter(LOG_FORMAT))

    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(level)
    _configured = True
