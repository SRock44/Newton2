"""Tests for app/core/logging.py's correlation-id mechanism: a contextvar set by
`correlation_id_scope`, stamped onto LogRecords by `CorrelationIdFilter`, and preserved
across `asyncio.create_task()` boundaries -- the exact property app/routers/chat.py's WS
handler relies on to get one id across an entire chat turn's fan-out into
app/agents/tutor.py and any tool it calls.

These are pure, no-DB/no-network unit tests against the mechanism itself (no live
server needed) -- see test_error_handling.py for the HTTP-level integration (request id
header round trip, global exception handler).
"""

import asyncio
import logging

import pytest

from app.core.logging import (
    CorrelationIdFilter,
    NO_CORRELATION_ID,
    correlation_id_scope,
    get_correlation_id,
    new_correlation_id,
)


def test_new_correlation_id_is_short_and_unique():
    a, b = new_correlation_id(), new_correlation_id()
    assert a != b
    assert len(a) == 12


def test_get_correlation_id_is_none_outside_any_scope():
    assert get_correlation_id() is None


def test_correlation_id_scope_sets_and_restores():
    assert get_correlation_id() is None
    with correlation_id_scope("abc-123") as returned:
        assert returned == "abc-123"
        assert get_correlation_id() == "abc-123"
    assert get_correlation_id() is None


def test_correlation_id_scope_resets_even_after_an_exception():
    with pytest.raises(ValueError):
        with correlation_id_scope("will-be-reset"):
            assert get_correlation_id() == "will-be-reset"
            raise ValueError("boom")
    assert get_correlation_id() is None


def test_correlation_id_scopes_can_nest():
    with correlation_id_scope("outer"):
        assert get_correlation_id() == "outer"
        with correlation_id_scope("inner"):
            assert get_correlation_id() == "inner"
        assert get_correlation_id() == "outer"
    assert get_correlation_id() is None


async def test_correlation_id_propagates_into_a_spawned_asyncio_task():
    """The exact property app/routers/chat.py leans on: asyncio.create_task() copies the
    *current* context at task-creation time, so a task spawned while a correlation id
    scope is active sees that same id -- with no explicit passing."""

    async def _read_id_from_inside_a_task() -> str | None:
        return get_correlation_id()

    with correlation_id_scope("turn-xyz"):
        task = asyncio.create_task(_read_id_from_inside_a_task())
        result = await task

    assert result == "turn-xyz"


async def test_correlation_id_does_not_leak_into_a_task_spawned_outside_the_scope():
    async def _read_id_from_inside_a_task() -> str | None:
        return get_correlation_id()

    task = asyncio.create_task(_read_id_from_inside_a_task())
    with correlation_id_scope("should-not-be-seen"):
        pass
    result = await task
    assert result is None


def test_correlation_id_filter_stamps_the_ambient_id_onto_log_records(caplog):
    # Attach the real filter class directly to caplog's own handler -- this exercises
    # the exact mechanism configure_logging() wires onto the app's real handler in
    # production (see that function's docstring for why a Handler-level filter, not a
    # Logger-level one, is what makes this apply regardless of which logger emitted the
    # record), without needing to touch/clobber the root logger's actual handlers here.
    caplog.handler.addFilter(CorrelationIdFilter())
    logger = logging.getLogger("newton.test_core_logging")

    with caplog.at_level(logging.INFO, logger="newton.test_core_logging"):
        with correlation_id_scope("filter-test-id"):
            logger.info("inside the scope")
        logger.info("outside the scope")

    records = [r for r in caplog.records if r.name == "newton.test_core_logging"]
    assert len(records) == 2
    assert records[0].correlation_id == "filter-test-id"
    assert records[1].correlation_id == NO_CORRELATION_ID
