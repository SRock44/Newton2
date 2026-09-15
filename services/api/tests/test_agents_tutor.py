import asyncio
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import delete

from app.agents import tutor
from app.agents.tutor import PlanChunk, TextChunk, ToolActivity, UsageInfo
from app.core.config import Settings
from app.db.models import User
from app.providers.base import ChatProvider, TextDelta, ToolCall
from app.services import billing as billing_service
from tests.fakes import ScriptedToolCallingProvider


def text_of(events) -> str:
    return "".join(e.text for e in events if isinstance(e, TextChunk))


async def test_run_tutor_streams_directly_when_no_tool_needed(monkeypatch):
    fake = ScriptedToolCallingProvider([["Hello", " there."]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi")]

    assert text_of(events) == "Hello there."
    assert not any(isinstance(e, ToolActivity) for e in events)
    assert len(fake.calls_seen) == 1
    # the tutor should always offer its tool belt, even when the model doesn't use it
    assert {t.name for t in fake.calls_seen[0]["tools"]} >= {"calculator", "unit_converter"}


async def test_run_tutor_executes_a_tool_call_then_answers(monkeypatch):
    fake = ScriptedToolCallingProvider(
        [
            [ToolCall(id="call_1", name="calculator", arguments={"expression": "6*7"})],
            ["The answer is ", "42."],
        ]
    )
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "what is 6 times 7?")]

    assert text_of(events) == "The answer is 42."
    assert len(fake.calls_seen) == 2

    # The UI-visible signal that a tool actually ran: a started event immediately
    # followed (once the tool finishes) by a finished event, both for "calculator",
    # both before any of the final answer's text.
    activity = [e for e in events if isinstance(e, ToolActivity)]
    assert [(a.tool, a.phase) for a in activity] == [("calculator", "started"), ("calculator", "finished")]
    assert activity[0].label  # a real student-facing label, not blank
    first_text_index = next(i for i, e in enumerate(events) if isinstance(e, TextChunk))
    last_activity_index = max(i for i, e in enumerate(events) if isinstance(e, ToolActivity))
    assert last_activity_index < first_text_index

    # round 2 must include the assistant's tool-call turn and the tool's real result
    second_round = fake.calls_seen[1]["messages"]
    assistant_call_turn = next(m for m in second_round if m.role == "assistant" and m.tool_calls)
    assert assistant_call_turn.tool_calls[0].name == "calculator"

    tool_result_turns = [m for m in second_round if m.role == "tool"]
    assert len(tool_result_turns) == 1
    assert tool_result_turns[0].tool_call_id == "call_1"
    assert tool_result_turns[0].content == "42"  # the calculator tool actually ran


async def test_run_tutor_handles_a_tool_error_gracefully(monkeypatch):
    fake = ScriptedToolCallingProvider(
        [
            [ToolCall(id="call_1", name="calculator", arguments={"expression": "not math"})],
            ["Couldn't compute that."],
        ]
    )
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "bad expr")]

    assert text_of(events) == "Couldn't compute that."
    tool_result_turns = [m for m in fake.calls_seen[1]["messages"] if m.role == "tool"]
    assert tool_result_turns[0].content.startswith("Error:")


async def test_run_tutor_handles_an_unknown_tool_name_gracefully(monkeypatch):
    fake = ScriptedToolCallingProvider(
        [
            [ToolCall(id="call_1", name="does_not_exist", arguments={})],
            ["ok"],
        ]
    )
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi")]

    assert text_of(events) == "ok"
    tool_result_turns = [m for m in fake.calls_seen[1]["messages"] if m.role == "tool"]
    assert "unknown tool" in tool_result_turns[0].content
    # even an unknown tool still gets a start/finish pair — the UI shouldn't hang
    # waiting for a "finished" that never arrives just because the tool name was bad
    activity = [e for e in events if isinstance(e, ToolActivity)]
    assert [(a.tool, a.phase) for a in activity] == [("does_not_exist", "started"), ("does_not_exist", "finished")]


async def test_run_tutor_stops_after_max_rounds_with_a_clear_message(monkeypatch):
    fake = ScriptedToolCallingProvider(
        [
            [ToolCall(id=f"call_{i}", name="calculator", arguments={"expression": "1+1"})]
            for i in range(tutor.MAX_TOOL_ROUNDS)
        ]
    )
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "loop forever")]

    full = text_of(events)
    assert "round limit" in full
    assert len(fake.calls_seen) == tutor.MAX_TOOL_ROUNDS


# ---------------------------------------------------------------------------
# Plan-aware model routing + credit ledger (app/services/billing.py's is_pro/
# pro_credits_remaining/resolve_pro_model, wired in via tutor._select_provider). A real
# DB row is needed here (tutor._load_user reads one by user_id) -- unlike the tests
# above, which never pass user_id and so never touch the DB at all.
# ---------------------------------------------------------------------------


class _FakeFrontierProvider(ChatProvider):
    """Stands in for OpenAICompatibleProvider (monkeypatched onto `tutor.
    OpenAICompatibleProvider`, the same name tutor.py both constructs and isinstance-
    checks against) so frontier-routing tests don't need a real OpenRouter call. Always
    answers with one text chunk and then reports a scripted last_usage, mimicking the
    real provider's post-stream usage chunk."""

    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url
        self.api_key = api_key
        self.last_usage: dict | None = None
        self.calls_seen: list[dict] = []

    async def stream_chat(self, messages, model, tools=None):
        self.calls_seen.append({"messages": list(messages), "model": model, "tools": tools})
        yield TextDelta("frontier answer")
        self.last_usage = {"prompt_tokens": 100, "completion_tokens": 20}


@pytest_asyncio.fixture
async def tutor_user(db_session):
    async def _make(**kwargs):
        user = User(keycloak_sub=f"test-tutor-{uuid.uuid4()}", **kwargs)
        db_session.add(user)
        await db_session.commit()
        return user

    created: list[User] = []

    async def factory(**kwargs):
        user = await _make(**kwargs)
        created.append(user)
        return user

    yield factory

    for user in created:
        await db_session.execute(delete(User).where(User.id == user.id))
    await db_session.commit()


async def test_run_tutor_routes_a_pro_user_with_credits_to_the_frontier_model(tutor_user, monkeypatch):
    user = await tutor_user(plan="pro", credits_used_cents=0)

    monkeypatch.setattr(tutor, "get_settings", lambda: Settings(openrouter_api_key="fake-or-key"))
    monkeypatch.setattr(tutor, "OpenAICompatibleProvider", _FakeFrontierProvider)

    recorded = {}

    async def fake_record(user_id, model, prompt_tokens, completion_tokens):
        recorded.update(
            user_id=user_id, model=model, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens
        )
        return 5

    monkeypatch.setattr(billing_service, "record_frontier_usage", fake_record)

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi", user_id=str(user.id))]

    assert text_of(events) == "frontier answer"
    assert recorded["user_id"] == user.id
    assert recorded["model"] == billing_service.DEFAULT_PRO_MODEL
    assert recorded["prompt_tokens"] == 100
    assert recorded["completion_tokens"] == 20


async def test_run_tutor_routes_to_a_pro_users_selected_model(tutor_user, monkeypatch):
    chosen = billing_service.PRO_MODELS[-1]["id"]
    user = await tutor_user(plan="pro", credits_used_cents=0, preferred_pro_model=chosen)

    monkeypatch.setattr(tutor, "get_settings", lambda: Settings(openrouter_api_key="fake-or-key"))
    monkeypatch.setattr(tutor, "OpenAICompatibleProvider", _FakeFrontierProvider)

    async def fake_record(*a, **kw):
        return 0

    monkeypatch.setattr(billing_service, "record_frontier_usage", fake_record)

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi", user_id=str(user.id))]
    assert text_of(events) == "frontier answer"


async def test_run_tutor_falls_back_to_free_tier_when_pro_credits_are_exhausted(tutor_user, monkeypatch):
    user = await tutor_user(plan="pro", credits_used_cents=10_000)

    monkeypatch.setattr(
        tutor, "get_settings", lambda: Settings(openrouter_api_key="fake-or-key", pro_monthly_credit_cents=600)
    )
    monkeypatch.setattr(tutor, "OpenAICompatibleProvider", _FakeFrontierProvider)

    fake = ScriptedToolCallingProvider([["free tier answer"]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "free-model"))

    record_called = False

    async def fake_record(*a, **kw):
        nonlocal record_called
        record_called = True
        return 0

    monkeypatch.setattr(billing_service, "record_frontier_usage", fake_record)

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi", user_id=str(user.id))]

    # Exhausted-Pro-credits never errors -- it quietly gets the free-tier model, same as
    # any free user would.
    assert text_of(events) == "free tier answer"
    assert record_called is False


async def test_run_tutor_tracks_token_usage_on_free_tier_calls_too(monkeypatch):
    """Regression test: token accumulation used to be gated on is_frontier, so a
    free-tier call's real usage (which OpenAICompatibleProvider reports identically
    regardless of which tier is calling it) was silently dropped -- UsageInfo always
    came back (0, 0) for everyone except Pro. Fixed by tracking unconditionally; only
    the *billing* charge in run_tutor's finally block stays Pro-only."""
    fake = _FakeFrontierProvider(base_url="https://example.test", api_key="k")
    monkeypatch.setattr(tutor, "OpenAICompatibleProvider", _FakeFrontierProvider)
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "free-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi")]  # no user_id -> free path

    assert text_of(events) == "frontier answer"
    usage_events = [e for e in events if isinstance(e, UsageInfo)]
    assert len(usage_events) == 1
    assert usage_events[0].prompt_tokens == 100
    assert usage_events[0].completion_tokens == 20


async def test_run_tutor_falls_back_to_free_tier_when_openrouter_is_not_configured(tutor_user, monkeypatch):
    user = await tutor_user(plan="pro", credits_used_cents=0)

    monkeypatch.setattr(tutor, "get_settings", lambda: Settings(openrouter_api_key=None))

    fake = ScriptedToolCallingProvider([["free tier answer"]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "free-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi", user_id=str(user.id))]
    assert text_of(events) == "free tier answer"


async def test_run_tutor_uses_free_tier_for_an_explicit_free_plan_user(tutor_user, monkeypatch):
    user = await tutor_user(plan="free")

    fake = ScriptedToolCallingProvider([["free tier answer"]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "free-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi", user_id=str(user.id))]
    assert text_of(events) == "free tier answer"


# ---------------------------------------------------------------------------
# Top-up balance funding frontier routing (app/services/billing.py's
# frontier_access_available/record_frontier_usage, ROADMAP.md Phase 7) -- a real
# product decision: a FREE user with a purchased, non-expiring top-up balance can reach
# a frontier model too, without any Pro subscription at all. A Pro user whose monthly
# allowance is exhausted but who also holds a top-up balance keeps working too, funded
# by the spillover pool -- see billing_service.record_frontier_usage's own docstring for
# the exact "Pro credit spent first, top-up as overflow" ordering this proves.
# ---------------------------------------------------------------------------


async def test_run_tutor_routes_a_free_user_with_topup_balance_to_the_frontier_model(tutor_user, monkeypatch):
    user = await tutor_user(plan="free", topup_credits_cents=200)

    monkeypatch.setattr(tutor, "get_settings", lambda: Settings(openrouter_api_key="fake-or-key"))
    monkeypatch.setattr(tutor, "OpenAICompatibleProvider", _FakeFrontierProvider)

    recorded = {}

    async def fake_record(user_id, model, prompt_tokens, completion_tokens):
        recorded.update(user_id=user_id, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)
        return 5

    monkeypatch.setattr(billing_service, "record_frontier_usage", fake_record)

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi", user_id=str(user.id))]

    # A free plan, with no Pro subscription at all, still reaches the frontier model --
    # funded entirely by the purchased top-up balance.
    assert text_of(events) == "frontier answer"
    assert recorded["user_id"] == user.id


async def test_run_tutor_uses_free_tier_for_a_free_user_with_zero_topup_balance(tutor_user, monkeypatch):
    user = await tutor_user(plan="free", topup_credits_cents=0)

    monkeypatch.setattr(tutor, "get_settings", lambda: Settings(openrouter_api_key="fake-or-key"))
    monkeypatch.setattr(tutor, "OpenAICompatibleProvider", _FakeFrontierProvider)

    fake = ScriptedToolCallingProvider([["free tier answer"]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "free-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi", user_id=str(user.id))]
    assert text_of(events) == "free tier answer"


async def test_run_tutor_routes_a_pro_user_with_exhausted_credit_but_a_topup_balance(tutor_user, monkeypatch):
    user = await tutor_user(plan="pro", credits_used_cents=10_000, topup_credits_cents=200)

    monkeypatch.setattr(
        tutor, "get_settings", lambda: Settings(openrouter_api_key="fake-or-key", pro_monthly_credit_cents=600)
    )
    monkeypatch.setattr(tutor, "OpenAICompatibleProvider", _FakeFrontierProvider)

    async def fake_record(*a, **kw):
        return 0

    monkeypatch.setattr(billing_service, "record_frontier_usage", fake_record)

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi", user_id=str(user.id))]

    # Exhausted Pro monthly credit no longer falls back to the free tier once a top-up
    # balance exists -- it spills over onto that instead (see record_frontier_usage).
    assert text_of(events) == "frontier answer"


async def test_run_tutor_falls_back_to_free_tier_for_a_pro_user_with_no_credit_and_no_topup(
    tutor_user, monkeypatch
):
    user = await tutor_user(plan="pro", credits_used_cents=10_000, topup_credits_cents=0)

    monkeypatch.setattr(
        tutor, "get_settings", lambda: Settings(openrouter_api_key="fake-or-key", pro_monthly_credit_cents=600)
    )
    monkeypatch.setattr(tutor, "OpenAICompatibleProvider", _FakeFrontierProvider)

    fake = ScriptedToolCallingProvider([["free tier answer"]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "free-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi", user_id=str(user.id))]
    assert text_of(events) == "free tier answer"


# ---------------------------------------------------------------------------
# Self-service Focus Mode (User.focus_mode_enabled) -- see app/agents/tutor.py's
# FOCUS_MODE_SYSTEM_ADDENDUM. A direct string-content assertion is enough to prove the
# prompt text itself is correct; no live-model call needed for that.
# ---------------------------------------------------------------------------


async def test_run_tutor_appends_focus_mode_addendum_for_an_enabled_user(tutor_user, monkeypatch):
    user = await tutor_user(focus_mode_enabled=True)
    fake = ScriptedToolCallingProvider([["ok"]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi", user_id=str(user.id))]

    assert text_of(events) == "ok"
    system_content = fake.calls_seen[0]["messages"][0].content
    assert system_content == tutor.SYSTEM_PROMPT + tutor.FOCUS_MODE_SYSTEM_ADDENDUM


async def test_run_tutor_does_not_append_focus_mode_addendum_when_disabled(tutor_user, monkeypatch):
    user = await tutor_user(focus_mode_enabled=False)
    fake = ScriptedToolCallingProvider([["ok"]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi", user_id=str(user.id))]

    assert text_of(events) == "ok"
    system_content = fake.calls_seen[0]["messages"][0].content
    assert system_content == tutor.SYSTEM_PROMPT
    assert tutor.FOCUS_MODE_SYSTEM_ADDENDUM not in system_content


async def test_run_tutor_does_not_append_focus_mode_addendum_for_an_anonymous_caller(monkeypatch):
    """No user_id at all (e.g. a keyless/dev path) must never crash looking up a flag
    that doesn't exist -- same "no user" shape as every other user_id=None test above."""
    fake = ScriptedToolCallingProvider([["ok"]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi")]

    assert text_of(events) == "ok"
    assert fake.calls_seen[0]["messages"][0].content == tutor.SYSTEM_PROMPT


def test_focus_mode_addendum_genuinely_describes_socratic_behavior_and_the_tool_block():
    """Pure string-content assertions on the addendum text itself: it must describe real
    Socratic guiding-question behavior (not just refuse to help), explicitly allow
    confirming/correcting after a real attempt (not be uselessly evasive), and mention
    write_research_paper being unavailable while Focus Mode is on."""
    addendum = tutor.FOCUS_MODE_SYSTEM_ADDENDUM
    lowered = addendum.lower()
    assert "socratic" in lowered
    assert "guiding questions" in lowered
    assert "write_research_paper" in addendum
    # Explicitly not adversarial/evasive -- a real attempt should get a real answer.
    assert "confirm" in lowered or "correct" in lowered


# ---------------------------------------------------------------------------
# Self-service Learn Mode (User.learn_mode_enabled) -- see app/agents/tutor.py's
# LEARN_MODE_SYSTEM_ADDENDUM. Deliberately independent of Focus Mode: mirrors the Focus
# Mode test shapes above, plus explicit coverage of all 4 on/off combinations.
# ---------------------------------------------------------------------------


async def test_run_tutor_appends_learn_mode_addendum_for_an_enabled_user(tutor_user, monkeypatch):
    user = await tutor_user(learn_mode_enabled=True)
    fake = ScriptedToolCallingProvider([["ok"]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi", user_id=str(user.id))]

    assert text_of(events) == "ok"
    system_content = fake.calls_seen[0]["messages"][0].content
    assert system_content == tutor.SYSTEM_PROMPT + tutor.LEARN_MODE_SYSTEM_ADDENDUM


async def test_run_tutor_does_not_append_learn_mode_addendum_when_disabled(tutor_user, monkeypatch):
    user = await tutor_user(learn_mode_enabled=False)
    fake = ScriptedToolCallingProvider([["ok"]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi", user_id=str(user.id))]

    assert text_of(events) == "ok"
    system_content = fake.calls_seen[0]["messages"][0].content
    assert system_content == tutor.SYSTEM_PROMPT
    assert tutor.LEARN_MODE_SYSTEM_ADDENDUM not in system_content


async def test_run_tutor_does_not_append_learn_mode_addendum_for_an_anonymous_caller(monkeypatch):
    """No user_id at all (e.g. a keyless/dev path) must never crash looking up a flag
    that doesn't exist -- same "no user" shape as every other user_id=None test above."""
    fake = ScriptedToolCallingProvider([["ok"]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi")]

    assert text_of(events) == "ok"
    assert fake.calls_seen[0]["messages"][0].content == tutor.SYSTEM_PROMPT


@pytest.mark.parametrize(
    "focus_enabled,learn_enabled",
    [(False, False), (True, False), (False, True), (True, True)],
)
async def test_run_tutor_focus_and_learn_mode_addenda_are_independent_and_stackable(
    tutor_user, monkeypatch, focus_enabled, learn_enabled
):
    """All 4 on/off combinations produce the exact expected prompt -- proves neither
    addendum is coupled to (or accidentally gated by) the other."""
    user = await tutor_user(focus_mode_enabled=focus_enabled, learn_mode_enabled=learn_enabled)
    fake = ScriptedToolCallingProvider([["ok"]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi", user_id=str(user.id))]

    assert text_of(events) == "ok"
    expected = tutor.SYSTEM_PROMPT
    if focus_enabled:
        expected += tutor.FOCUS_MODE_SYSTEM_ADDENDUM
    if learn_enabled:
        expected += tutor.LEARN_MODE_SYSTEM_ADDENDUM
    system_content = fake.calls_seen[0]["messages"][0].content
    assert system_content == expected


def test_learn_mode_addendum_genuinely_describes_step_check_and_checkpoint_blocks():
    """Pure string-content assertions on the addendum text itself: it must name both new
    block schemas by their exact fence language, describe evaluating a real attempt
    rather than just handing over the answer, and scope every behavior to "while Learn
    Mode is on" rather than describing it as an always-on default."""
    addendum = tutor.LEARN_MODE_SYSTEM_ADDENDUM
    lowered = addendum.lower()

    assert "```step-check" in addendum
    assert "```checkpoint" in addendum
    assert '"prompt"' in addendum
    assert '"question"' in addendum
    assert "my attempt:" in lowered
    assert "never hand over the next step unprompted" in lowered
    assert "evaluate" in lowered
    assert "vary" in lowered and "plot_function" in addendum
    assert "while learn mode is on" in lowered or "while it's on" in lowered or "learn mode is on" in lowered


# ---------------------------------------------------------------------------
# The plan-narration "thinking" chip (app/agents/tutor.py's PlanChunk / _plan_narration)
# -- a single short, cheap, unbilled OpenRouter call fired before the main tool-calling/
# answer loop starts, dormant until settings.openrouter_api_key is configured, and
# never allowed to delay or break the real reply on any failure or timeout.
# ---------------------------------------------------------------------------


class _FakePlanProvider(ChatProvider):
    """Stands in for OpenAICompatibleProvider for the plan-narration call specifically
    -- a separate instance from whatever answers the main loop, so tests can tell the
    two calls apart."""

    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url
        self.api_key = api_key

    async def stream_chat(self, messages, model, tools=None):
        yield TextDelta("I'll explain the chain rule with an example.")


class _BoomPlanProvider(ChatProvider):
    """A plan-narration provider that always errors -- proves a failure here is fully
    swallowed rather than propagating and breaking the real reply."""

    def __init__(self, base_url: str, api_key: str):
        pass

    async def stream_chat(self, messages, model, tools=None):
        raise RuntimeError("boom")
        yield  # pragma: no cover - unreachable; keeps this a real async generator


class _SlowPlanProvider(ChatProvider):
    """A plan-narration provider that never finishes in time -- proves a timeout here
    is fully swallowed rather than delaying the real reply."""

    def __init__(self, base_url: str, api_key: str):
        pass

    async def stream_chat(self, messages, model, tools=None):
        await asyncio.sleep(10)
        yield TextDelta("too slow to matter")  # pragma: no cover - never reached


async def test_run_tutor_yields_a_plan_chunk_before_the_main_answer_when_openrouter_is_configured(monkeypatch):
    monkeypatch.setattr(tutor, "get_settings", lambda: Settings(openrouter_api_key="fake-or-key"))
    monkeypatch.setattr(tutor, "OpenAICompatibleProvider", _FakePlanProvider)
    fake = ScriptedToolCallingProvider([["The answer."]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "explain the chain rule")]

    assert isinstance(events[0], PlanChunk), "the plan chunk must be yielded before any other event"
    assert events[0].text == "I'll explain the chain rule with an example."
    plan_events = [e for e in events if isinstance(e, PlanChunk)]
    assert len(plan_events) == 1
    assert text_of(events) == "The answer."


async def test_run_tutor_yields_no_plan_chunk_when_openrouter_is_not_configured(monkeypatch):
    monkeypatch.setattr(tutor, "get_settings", lambda: Settings(openrouter_api_key=None))
    fake = ScriptedToolCallingProvider([["ok"]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi")]

    assert not any(isinstance(e, PlanChunk) for e in events)
    assert text_of(events) == "ok"


async def test_run_tutor_skips_the_plan_chunk_gracefully_when_the_plan_call_errors(monkeypatch):
    monkeypatch.setattr(tutor, "get_settings", lambda: Settings(openrouter_api_key="fake-or-key"))
    monkeypatch.setattr(tutor, "OpenAICompatibleProvider", _BoomPlanProvider)
    fake = ScriptedToolCallingProvider([["ok"]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi")]

    assert not any(isinstance(e, PlanChunk) for e in events)
    # The real reply must proceed completely normally -- no visible error of any kind.
    assert text_of(events) == "ok"


async def test_run_tutor_skips_the_plan_chunk_when_the_call_times_out(monkeypatch):
    monkeypatch.setattr(tutor, "get_settings", lambda: Settings(openrouter_api_key="fake-or-key"))
    monkeypatch.setattr(tutor, "OpenAICompatibleProvider", _SlowPlanProvider)
    monkeypatch.setattr(tutor, "PLAN_NARRATION_TIMEOUT_SECONDS", 0.05)
    fake = ScriptedToolCallingProvider([["ok"]])
    monkeypatch.setattr(tutor, "get_provider", lambda **kwargs: (fake, "fake-model"))

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi")]

    assert not any(isinstance(e, PlanChunk) for e in events)
    assert text_of(events) == "ok"


async def test_run_tutor_plan_chunk_is_never_billed_to_the_pro_credit_ledger(tutor_user, monkeypatch):
    """The plan-narration call must never be tracked via billing_service.
    record_frontier_usage -- it's an unbilled operational cost, not a routed frontier
    call. Uses a Pro user with real frontier routing on the main loop too, so this
    proves exactly one billed call is recorded (the main loop's real answer), never a
    second one for the plan-narration call that ran alongside it."""
    user = await tutor_user(plan="pro", credits_used_cents=0)
    monkeypatch.setattr(tutor, "get_settings", lambda: Settings(openrouter_api_key="fake-or-key"))
    monkeypatch.setattr(tutor, "OpenAICompatibleProvider", _FakeFrontierProvider)

    recorded: list[tuple] = []

    async def fake_record(user_id, model, prompt_tokens, completion_tokens):
        recorded.append((user_id, model, prompt_tokens, completion_tokens))
        return 5

    monkeypatch.setattr(billing_service, "record_frontier_usage", fake_record)

    events = [c async for c in tutor.run_tutor(str(uuid.uuid4()), "hi", user_id=str(user.id))]

    assert any(isinstance(e, PlanChunk) for e in events)
    assert len(recorded) == 1


def test_system_prompt_honestly_describes_the_free_vs_pro_generation_target():
    """The Tutor's own system prompt should be able to set expectations conversationally
    if a free-plan student asks for a large flashcard/exam/study-plan set -- see
    ROADMAP.md's "Free-tier usage-ceiling visibility" item. It must name the real numbers
    (kept in sync with billing_service's actual constants, never a hardcoded copy that
    could drift) and must never imply a time-based limit, since no daily/weekly cap
    exists anywhere in this codebase."""
    prompt = tutor.SYSTEM_PROMPT

    assert str(billing_service.FREE_GENERATION_TARGET) in prompt
    assert str(billing_service.PRO_GENERATION_TARGET) in prompt

    lowered = prompt.lower()
    for phrase in ("per day", "daily", "per week", "weekly", "per hour", "hourly", "per month", "monthly", "24 hours"):
        assert phrase not in lowered, f"system prompt must not imply a time-based limit ({phrase!r} found)"
