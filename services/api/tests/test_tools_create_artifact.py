"""Tests for the Artifacts feature (app/tools/create_artifact.py + app/services/
artifact_build.py).

Follows tests/test_gamification.py's conventions: throwaway `User` rows created and
deleted per test, never student1's real data, and every row this suite creates is
removed again in the fixture's teardown -- including the MinIO object and the
DocumentChunk rows an artifact Document brings with it.

The provider call (the persona stage) and the artifact-runner call (the opencode stage)
are both substituted here -- a unit test must not spend real money or take three minutes.
The REAL end-to-end path (a real persona call, a real opencode run inside the real
container, real HTML, a real stored Document) is exercised by the `live_smoke`-marked
test at the bottom, the same split this codebase already uses for sandbox-runner and the
OpenRouter catalog.
"""

import uuid

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.core.config import get_settings
from app.db.models import Document, DocumentChunk, Flashcard, User
from app.providers.base import TextDelta
from app.services import artifact_build
from app.tools import create_artifact as artifact_tool
from app.tools.create_artifact import (
    ARTIFACT_KINDS,
    EMPTY_DOCUMENT_MESSAGE,
    FOCUS_MODE_MESSAGE,
    NO_CREDIT_MESSAGE,
    NO_SUCH_DOCUMENT_MESSAGE,
    PRO_ONLY_MESSAGE,
    CreateArtifactTool,
    _parse_brief,
    _sanitize_filename,
)

VALID_HTML = (
    "<!DOCTYPE html><html><head><style>body{font-family:system-ui}</style></head>"
    "<body><h1>Nitrogen Cycle</h1><script>document.title='x'</script></body></html>"
)


# ---------------------------------------------------------------------------
# Fixtures: throwaway users only.
# ---------------------------------------------------------------------------


async def _cleanup_user(db_session, user_id: uuid.UUID) -> None:
    doc_ids = (
        (await db_session.execute(select(Document.id).where(Document.user_id == user_id)))
        .scalars()
        .all()
    )
    if doc_ids:
        await db_session.execute(delete(DocumentChunk).where(DocumentChunk.document_id.in_(doc_ids)))
    # Quiz artifacts are built from real Flashcard rows, so this suite now creates some.
    await db_session.execute(delete(Flashcard).where(Flashcard.user_id == user_id))
    await db_session.execute(delete(Document).where(Document.user_id == user_id))
    await db_session.execute(delete(User).where(User.id == user_id))
    await db_session.commit()


@pytest_asyncio.fixture
async def pro_user(db_session):
    """A Pro user with real credit left -- the only shape that reaches a real build."""
    user = User(
        keycloak_sub=f"test-artifact-pro-{uuid.uuid4()}",
        plan="pro",
        credits_used_cents=0,
        topup_credits_cents=0,
    )
    db_session.add(user)
    await db_session.flush()
    await db_session.commit()
    yield user
    await _cleanup_user(db_session, user.id)


@pytest_asyncio.fixture
async def free_user(db_session):
    user = User(keycloak_sub=f"test-artifact-free-{uuid.uuid4()}", plan="free")
    db_session.add(user)
    await db_session.flush()
    await db_session.commit()
    yield user
    await _cleanup_user(db_session, user.id)


class _FakeProvider:
    """Stands in for a real OpenRouter stream_chat, including the `last_usage` attribute
    app/providers/openai_compatible.py sets and the tool's metering reads."""

    def __init__(self, text: str, usage: dict | None = None):
        self._text = text
        self.last_usage = usage if usage is not None else {"prompt_tokens": 800, "completion_tokens": 400}
        self.calls: list[list] = []

    async def stream_chat(self, messages, model, tools=None):
        self.calls.append(messages)
        yield TextDelta(self._text)


def _patch_pipeline(monkeypatch, *, brief_text: str, build_result: artifact_build.ArtifactBuildResult):
    # frontier_access_available (see billing.py) requires openrouter_api_key to be
    # truthy before it even looks at the user's plan/credit -- real in every deployed
    # environment, but unset in the hermetic CI suite by design (no real secrets), so
    # every test here that expects a pro_user's real build to actually proceed needs
    # this patched too, or it 402s before ever reaching _artifact_provider/build_artifact
    # below, no matter how much credit the fixture gives the user. A plain str (not a
    # real SecretStr) is fine ONLY because _artifact_provider itself is mocked below and
    # never actually calls .get_secret_value() on it in this test process.
    monkeypatch.setattr(get_settings(), "openrouter_api_key", "test-key")

    provider = _FakeProvider(brief_text)
    # _write_brief calls _artifact_provider() (not get_provider() directly) as of the
    # dedicated artifact_generation_model change -- see that function's own docstring
    # for why it bypasses get_provider()'s normal BYOK/Groq/OpenRouter priority order.
    monkeypatch.setattr(artifact_tool, "_artifact_provider", lambda: (provider, "deepseek/deepseek-v4-flash-0731"))

    calls: list[tuple[str, str]] = []

    async def fake_build(brief: str, model: str, transport=None):
        calls.append((brief, model))
        return build_result

    monkeypatch.setattr(artifact_tool, "build_artifact", fake_build)

    charged: list[tuple] = []

    async def fake_record(user_id, model_id, prompt_tokens, completion_tokens):
        charged.append((user_id, model_id, prompt_tokens, completion_tokens))
        return 7

    monkeypatch.setattr(artifact_tool.billing_service, "record_frontier_usage", fake_record)
    return provider, calls, charged


def _ok_result(html: str = VALID_HTML) -> artifact_build.ArtifactBuildResult:
    return artifact_build.ArtifactBuildResult(
        html=html,
        success=True,
        timed_out=False,
        log="ok",
        input_tokens=11000,
        output_tokens=2400,
        attempts=1,
        problems=[],
    )


# ---------------------------------------------------------------------------
# Pure helpers.
# ---------------------------------------------------------------------------


def test_parse_brief_extracts_the_title_line_and_strips_it_from_the_brief():
    title, brief = _parse_brief("TITLE: Nitrogen Cycle\n\nWHO: a bio student.", "diagram", "fallback")
    assert title == "Nitrogen Cycle"
    assert brief == "WHO: a bio student."
    assert "TITLE:" not in brief


def test_parse_brief_falls_back_to_the_students_own_words_with_no_title_line():
    title, brief = _parse_brief("WHO: a bio student.", "diagram", "the nitrogen cycle please")
    assert title == "the nitrogen cycle please"
    assert brief == "WHO: a bio student."


def test_sanitize_filename_strips_path_separators_from_a_model_supplied_title():
    assert "/" not in _sanitize_filename("../../etc/passwd")
    assert "\\" not in _sanitize_filename("a\\b")
    assert _sanitize_filename("") == "artifact"


def test_every_declared_kind_has_a_real_distinct_persona_prompt():
    prompts = {k: artifact_tool._PERSONA_PROMPTS[k] for k in ARTIFACT_KINDS}
    assert len(prompts) == 5
    # Genuinely distinct, not a template with the kind name substituted in.
    assert len(set(prompts.values())) == 5
    for kind, prompt in prompts.items():
        assert len(prompt) > 1500, f"{kind} persona is too thin to be real expertise"
        assert "TITLE:" in prompt  # every persona carries the shared output contract


def test_personas_encode_kind_specific_expertise_not_generic_filler():
    p = artifact_tool._PERSONA_PROMPTS
    assert "zero" in p["chart"].lower()  # bar charts start at zero
    assert "arrow" in p["diagram"].lower()  # arrows are claims
    assert "slide" in p["slideshow"].lower()
    assert "slider" in p["interactive"].lower()
    # The quiz persona's own opinions: immediate feedback, a visible score/streak,
    # replayability, and a real end state -- the four things that make it a game rather
    # than a list of Q&A pairs rendered flat.
    quiz = p["quiz"].lower()
    assert "streak" in quiz
    assert "shuffle" in quiz
    assert "immediate" in quiz
    assert "retry" in quiz
    assert "done state" in quiz
    # ...and each one's specific rule is NOT in the others.
    assert "bar charts start at zero" in p["chart"].lower()
    assert "bar charts start at zero" not in p["diagram"].lower()
    assert "streak" not in p["slideshow"].lower()


# ---------------------------------------------------------------------------
# Gating -- the real, established mechanism, not a new one.
# ---------------------------------------------------------------------------


async def test_free_plan_is_refused_with_the_pro_only_message(free_user, monkeypatch):
    _, calls, charged = _patch_pipeline(monkeypatch, brief_text="x", build_result=_ok_result())
    result = await CreateArtifactTool().run(kind="diagram", prompt="the nitrogen cycle", user_id=str(free_user.id))
    assert result == PRO_ONLY_MESSAGE
    # Nothing was spent: no persona call, no build, no charge.
    assert calls == []
    assert charged == []


async def test_focus_mode_is_refused_even_for_a_pro_user(pro_user, db_session, monkeypatch):
    pro_user.focus_mode_enabled = True
    await db_session.commit()
    _, calls, charged = _patch_pipeline(monkeypatch, brief_text="x", build_result=_ok_result())

    result = await CreateArtifactTool().run(kind="chart", prompt="plot this", user_id=str(pro_user.id))
    assert result == FOCUS_MODE_MESSAGE
    assert calls == []
    assert charged == []


async def test_pro_user_with_no_credit_left_is_refused_before_spending(pro_user, db_session, monkeypatch):
    from app.core.config import get_settings

    pro_user.credits_used_cents = get_settings().pro_monthly_credit_cents + 1
    pro_user.topup_credits_cents = 0
    await db_session.commit()
    _, calls, charged = _patch_pipeline(monkeypatch, brief_text="x", build_result=_ok_result())

    result = await CreateArtifactTool().run(kind="chart", prompt="plot this", user_id=str(pro_user.id))
    assert result == NO_CREDIT_MESSAGE
    assert calls == []


async def test_an_unknown_kind_is_refused_before_any_work():
    result = await CreateArtifactTool().run(kind="sculpture", prompt="x", user_id=str(uuid.uuid4()))
    assert "unsupported artifact kind" in result


async def test_no_user_id_is_an_honest_error():
    assert "no signed-in user" in await CreateArtifactTool().run(kind="diagram", prompt="x")


# ---------------------------------------------------------------------------
# The happy path: persona -> brief -> build -> stored Document -> fenced block.
# ---------------------------------------------------------------------------


async def test_successful_build_stores_a_real_artifact_document_and_returns_a_fenced_block(
    pro_user, db_session, monkeypatch
):
    provider, calls, charged = _patch_pipeline(
        monkeypatch,
        brief_text="TITLE: Nitrogen Cycle\n\nWHO: a first-year bio student.",
        build_result=_ok_result(),
    )

    result = await CreateArtifactTool().run(
        kind="diagram", prompt="show me the nitrogen cycle", user_id=str(pro_user.id)
    )

    # The persona ran, with the kind's own system prompt.
    assert len(provider.calls) == 1
    assert provider.calls[0][0].role == "system"
    assert provider.calls[0][0].content == artifact_tool._PERSONA_PROMPTS["diagram"]
    assert provider.calls[0][1].content == "show me the nitrogen cycle"

    # The brief -- not the raw student prompt -- is what reached the coding agent.
    assert len(calls) == 1
    built_brief, built_model = calls[0]
    assert "first-year bio student" in built_brief
    assert "TITLE:" not in built_brief
    # The real build-stage model (settings.artifact_generation_model), not whatever
    # _artifact_provider's mock above returns for the persona stage -- referencing the
    # real setting rather than a hardcoded literal so this doesn't drift out of sync
    # with it again.
    assert built_model == get_settings().artifact_generation_model

    # A real Document row, kind="artifact", with the real HTML bytes in MinIO.
    doc = (
        await db_session.execute(select(Document).where(Document.user_id == pro_user.id))
    ).scalar_one()
    assert doc.kind == "artifact"
    assert doc.filename == "Nitrogen Cycle.html"
    assert doc.mime_type == "text/html"

    from app.services.documents import get_document_raw

    assert (await get_document_raw(doc)).decode("utf-8") == VALID_HTML

    # The tool result is the fenced block the Tutor relays verbatim, carrying only the id.
    assert result.startswith("```newton-artifact\n")
    assert result.endswith("\n```")
    import json

    payload = json.loads(result.removeprefix("```newton-artifact\n").removesuffix("\n```"))
    assert payload["document_id"] == str(doc.id)
    assert payload["title"] == "Nitrogen Cycle"
    assert payload["kind"] == "diagram"
    assert VALID_HTML not in result  # the page itself never goes back into the model's context


async def test_the_rag_text_is_a_description_not_the_markup(pro_user, db_session, monkeypatch):
    _patch_pipeline(
        monkeypatch,
        brief_text="TITLE: Nitrogen Cycle\n\nWHO: a first-year bio student.",
        build_result=_ok_result(),
    )
    await CreateArtifactTool().run(kind="diagram", prompt="nitrogen cycle", user_id=str(pro_user.id))

    doc = (await db_session.execute(select(Document).where(Document.user_id == pro_user.id))).scalar_one()
    chunks = (
        (await db_session.execute(select(DocumentChunk).where(DocumentChunk.document_id == doc.id)))
        .scalars()
        .all()
    )
    assert chunks, "an artifact should still be retrievable via RAG in a later session"
    joined = "\n".join(c.content for c in chunks)
    assert "first-year bio student" in joined
    assert "<style>" not in joined  # the markup is deliberately NOT what gets indexed


async def test_real_token_spend_is_charged_to_the_credit_ledger(pro_user, monkeypatch):
    _, _, charged = _patch_pipeline(
        monkeypatch, brief_text="TITLE: T\n\nbrief", build_result=_ok_result()
    )
    await CreateArtifactTool().run(kind="chart", prompt="plot it", user_id=str(pro_user.id))

    assert len(charged) == 1
    user_id, model_id, prompt_tokens, completion_tokens = charged[0]
    assert user_id == pro_user.id
    # BOTH stages are billed: the persona call (800/400) plus the agent run (11000/2400).
    assert prompt_tokens == 800 + 11000
    assert completion_tokens == 400 + 2400
    # Regression: _charge_usage used to price this against settings.openrouter_model
    # (the app-wide DEFAULT chat model) even though both real stages of an artifact
    # build run on settings.artifact_generation_model -- a different model with a
    # different real per-token price. The token COUNTS were always real, but pricing
    # them against the wrong model's rate means the cents actually deducted from the
    # student's credit ledger silently diverge from what OpenRouter actually billed
    # this app, on every single artifact build. record_frontier_usage's `model_id` arg
    # is what compute_cost_cents/_pricing_for key their lookup on (see billing.py), so
    # this must be the model that really produced these tokens.
    assert model_id == get_settings().artifact_generation_model


async def test_a_second_build_for_the_same_user_is_refused_while_one_is_already_spending(
    pro_user, monkeypatch
):
    """Closes a real TOCTOU gap: the credit check just above this passed on a
    pre-spend balance, but this build's real cost is only known once it finishes (up
    to a couple of minutes from now) -- see billing.try_acquire_frontier_turn_lock's
    own docstring. Simulated here by holding the lock by hand before calling run(),
    standing in for a concurrent build (or a concurrent frontier-routed chat turn) for
    the same user already in flight. Must refuse honestly and spend nothing -- never
    silently start a second build against the same not-yet-debited balance."""
    provider, calls, charged = _patch_pipeline(
        monkeypatch, brief_text="TITLE: T\n\nbrief", build_result=_ok_result()
    )

    assert await artifact_tool.billing_service.try_acquire_frontier_turn_lock(pro_user.id) is True
    try:
        result = await CreateArtifactTool().run(kind="chart", prompt="plot it", user_id=str(pro_user.id))
    finally:
        await artifact_tool.billing_service.release_frontier_turn_lock(pro_user.id)

    assert result == artifact_tool.ALREADY_SPENDING_MESSAGE
    assert calls == []  # build_artifact never ran
    assert charged == []  # nothing charged


async def test_a_successful_build_releases_the_lock_so_the_next_one_can_proceed(pro_user, monkeypatch):
    _patch_pipeline(monkeypatch, brief_text="TITLE: T\n\nbrief", build_result=_ok_result())

    result = await CreateArtifactTool().run(kind="chart", prompt="plot it", user_id=str(pro_user.id))
    assert result.startswith("```newton-artifact")

    # Not left held -- a fresh acquire for the same user right after must succeed.
    assert await artifact_tool.billing_service.try_acquire_frontier_turn_lock(pro_user.id) is True
    await artifact_tool.billing_service.release_frontier_turn_lock(pro_user.id)


async def test_a_failed_build_also_releases_the_lock(pro_user, monkeypatch):
    """Same guarantee as the success case above, but on the failure path -- a build
    that fails validation must not leave the next attempt permanently locked out."""
    failed = artifact_build.ArtifactBuildResult(
        html=None, success=False, timed_out=False, log="agent log",
        input_tokens=100, output_tokens=50, attempts=1, problems=["bad"],
    )
    _patch_pipeline(monkeypatch, brief_text="TITLE: T\n\nbrief", build_result=failed)

    result = await CreateArtifactTool().run(kind="chart", prompt="plot it", user_id=str(pro_user.id))
    assert "didn't pass validation" in result

    assert await artifact_tool.billing_service.try_acquire_frontier_turn_lock(pro_user.id) is True
    await artifact_tool.billing_service.release_frontier_turn_lock(pro_user.id)


async def test_an_exception_mid_build_still_releases_the_lock(pro_user, monkeypatch):
    """The finally-based release must fire even when build_artifact itself raises --
    an unhandled provider/network error must not permanently lock a user out of their
    own paid-for frontier access."""
    monkeypatch.setattr(get_settings(), "openrouter_api_key", "test-key")
    provider = _FakeProvider("TITLE: T\n\nbrief")
    monkeypatch.setattr(artifact_tool, "_artifact_provider", lambda: (provider, "deepseek/deepseek-v4-flash-0731"))

    async def raising_build(brief, model, transport=None):
        raise RuntimeError("simulated network failure")

    monkeypatch.setattr(artifact_tool, "build_artifact", raising_build)

    with pytest.raises(RuntimeError):
        await CreateArtifactTool().run(kind="chart", prompt="plot it", user_id=str(pro_user.id))

    assert await artifact_tool.billing_service.try_acquire_frontier_turn_lock(pro_user.id) is True
    await artifact_tool.billing_service.release_frontier_turn_lock(pro_user.id)


async def test_a_failed_build_still_charges_what_was_really_spent(pro_user, db_session, monkeypatch):
    failed = artifact_build.ArtifactBuildResult(
        html=None,
        success=False,
        timed_out=False,
        log="agent log",
        input_tokens=5000,
        output_tokens=900,
        attempts=2,
        problems=["The file references at least one external URL."],
    )
    _, _, charged = _patch_pipeline(monkeypatch, brief_text="TITLE: T\n\nbrief", build_result=failed)

    result = await CreateArtifactTool().run(kind="chart", prompt="plot it", user_id=str(pro_user.id))

    # Honest failure, surfacing the validator's real complaint -- never a false success.
    assert "didn't pass validation" in result
    assert "external URL" in result
    assert not result.startswith("```newton-artifact")
    # ...and those tokens really were billed to this app by OpenRouter, so they're charged.
    assert charged[0][2] == 800 + 5000
    # No Document row for a build that never produced anything.
    assert (
        await db_session.execute(select(Document).where(Document.user_id == pro_user.id))
    ).scalars().all() == []


async def test_a_timeout_is_reported_as_a_timeout_not_a_validation_failure(pro_user, monkeypatch):
    timed_out = artifact_build.ArtifactBuildResult(
        html=None, success=False, timed_out=True, log="", input_tokens=0, output_tokens=0, attempts=1
    )
    _patch_pipeline(monkeypatch, brief_text="TITLE: T\n\nbrief", build_result=timed_out)
    result = await CreateArtifactTool().run(kind="slideshow", prompt="explain", user_id=str(pro_user.id))
    assert "ran out of time" in result


# ---------------------------------------------------------------------------
# kind="quiz" -- the one kind whose CONTENT comes from the database rather than from
# the student's free-text description.
#
# The whole risk this section exists to pin down: a quiz over "my Bio 101 deck" that
# quietly contains plausible-looking Bio 101 questions the model wrote is a convincing
# fake -- it looks completely fine, and the student reviews material that isn't theirs.
# So these assert on the EXACT strings, never on a paraphrase or a "contains the word
# mitosis" proxy.
# ---------------------------------------------------------------------------

CARD_FRONTS = [
    "Which enzyme unwinds the DNA double helix at the replication fork?",
    "What does the Krebs cycle produce per turn of acetyl-CoA?",
    "Define allopatric speciation.",
]
CARD_BACKS = [
    "Helicase.",
    "3 NADH, 1 FADH2, 1 GTP and 2 CO2.",
    "Speciation caused by a geographic barrier splitting one population.",
]


@pytest_asyncio.fixture
async def deck_document(db_session, pro_user):
    """A real source Document with real Flashcard rows hanging off it -- exactly the shape
    the already-shipped generate_flashcards flow leaves behind, which is what a student
    means by "my deck". No MinIO object is needed: a deck's quiz never reads the file,
    only the cards."""
    document = Document(
        user_id=pro_user.id,
        filename="bio-101-lecture-4.pdf",
        mime_type="application/pdf",
        minio_key="never-read/1",
    )
    db_session.add(document)
    await db_session.flush()
    db_session.add_all(
        [
            Flashcard(user_id=pro_user.id, document_id=document.id, front=front, back=back)
            for front, back in zip(CARD_FRONTS, CARD_BACKS)
        ]
    )
    await db_session.commit()
    # Teardown is pro_user's own _cleanup_user, which now removes flashcards too.
    return document


async def test_quiz_is_accepted_as_a_real_kind_and_uses_its_own_persona(pro_user, monkeypatch):
    provider, calls, _ = _patch_pipeline(
        monkeypatch, brief_text="TITLE: Photosynthesis Round\n\nA 10-question game.", build_result=_ok_result()
    )
    result = await CreateArtifactTool().run(
        kind="quiz", prompt="quiz me on photosynthesis", user_id=str(pro_user.id)
    )

    assert "unsupported artifact kind" not in result
    assert result.startswith("```newton-artifact\n")
    assert '"kind": "quiz"' in result
    assert provider.calls[0][0].content == artifact_tool._PERSONA_PROMPTS["quiz"]
    assert len(calls) == 1


async def test_quiz_with_no_document_id_reads_nothing_from_the_database(
    pro_user, deck_document, monkeypatch
):
    """With no material named, this kind behaves exactly like the other four: the request
    is the whole spec. In particular it must NOT helpfully grab the student's most recent
    deck -- questions from a deck they didn't ask about would be just as wrong as
    invented ones."""
    provider, calls, _ = _patch_pipeline(
        monkeypatch, brief_text="TITLE: Photosynthesis Round\n\nA 10-question game.", build_result=_ok_result()
    )
    await CreateArtifactTool().run(
        kind="quiz", prompt="quiz me on photosynthesis", user_id=str(pro_user.id)
    )

    assert provider.calls[0][1].content == "quiz me on photosynthesis"
    built_brief = calls[0][0]
    assert CARD_FRONTS[0] not in built_brief
    assert "THE STUDENT'S OWN FLASHCARDS" not in built_brief


async def test_quiz_over_a_real_deck_embeds_every_real_card_verbatim(
    pro_user, deck_document, monkeypatch
):
    provider, calls, _ = _patch_pipeline(
        monkeypatch,
        brief_text="TITLE: Bio 101 Drill\n\nA shuffled 3-question game with a streak counter.",
        build_result=_ok_result(),
    )

    result = await CreateArtifactTool().run(
        kind="quiz",
        prompt="turn my bio 101 deck into a game",
        document_id=str(deck_document.id),
        user_id=str(pro_user.id),
    )
    assert result.startswith("```newton-artifact\n")

    built_brief = calls[0][0]
    # The exact strings, character for character -- not paraphrased, not summarized.
    for front, back in zip(CARD_FRONTS, CARD_BACKS):
        assert front in built_brief, f"card front missing from the brief: {front}"
        assert back in built_brief, f"card back missing from the brief: {back}"
    # ...carried with the instruction that makes them binding rather than suggestive.
    assert "Use ONLY these exact questions and answers" in built_brief
    assert "do not invent" in built_brief.lower()
    assert deck_document.filename in built_brief

    # The persona saw them too -- it needs the real material to make real decisions about
    # distractors and question format.
    assert CARD_FRONTS[0] in provider.calls[0][1].content


async def test_real_cards_reach_the_coding_agent_even_if_the_persona_never_mentions_them(
    pro_user, deck_document, monkeypatch
):
    """The actual guarantee. The persona is a language model asked to carry 30 Q/A pairs
    through a generation step that is also restructuring and summarizing, and its reply is
    truncated at MAX_BRIEF_CHARS -- so the verbatim block is re-attached by code
    (_ground_brief), not trusted to it. Here the persona returns a brief that mentions no
    card at all, the worst realistic case, and the real cards must still be in what
    opencode reads."""
    _, calls, _ = _patch_pipeline(
        monkeypatch,
        brief_text="TITLE: A Game\n\nMake a quiz game. Questions: whatever seems relevant.",
        build_result=_ok_result(),
    )

    await CreateArtifactTool().run(
        kind="quiz",
        prompt="game from my deck",
        document_id=str(deck_document.id),
        user_id=str(pro_user.id),
    )

    built_brief = calls[0][0]
    for front, back in zip(CARD_FRONTS, CARD_BACKS):
        assert front in built_brief
        assert back in built_brief
    assert len(built_brief) <= artifact_tool.MAX_BRIEF_CHARS


async def test_a_big_deck_is_trimmed_by_whole_cards_never_mid_answer(
    pro_user, db_session, monkeypatch
):
    """The brief has a real size budget, so a 60-card deck can't all fit. Dropping whole
    cards is fine; slicing the block at a character count is not -- a half-written answer
    carried under "use these exact answers" is a WRONG answer presented to the student as
    their own."""
    document = Document(
        user_id=pro_user.id, filename="big-deck.pdf", mime_type="application/pdf", minio_key="x/big"
    )
    db_session.add(document)
    await db_session.flush()
    backs = [f"Answer number {i} " + "y" * 120 + f" END{i}" for i in range(60)]
    db_session.add_all(
        [
            Flashcard(
                user_id=pro_user.id,
                document_id=document.id,
                front=f"Question number {i}?",
                back=backs[i],
            )
            for i in range(60)
        ]
    )
    await db_session.commit()

    _, calls, _ = _patch_pipeline(
        monkeypatch, brief_text="TITLE: Big\n\nA game.", build_result=_ok_result()
    )
    await CreateArtifactTool().run(
        kind="quiz", prompt="game", document_id=str(document.id), user_id=str(pro_user.id)
    )
    built_brief = calls[0][0]

    assert len(built_brief) <= artifact_tool.MAX_BRIEF_CHARS
    # Some cards were dropped...
    assert backs[59] not in built_brief
    # ...but every card that IS there is there in full, terminator and all.
    included = [i for i in range(60) if f"Question number {i}?" in built_brief]
    assert included, "the whole deck was dropped"
    for i in included:
        assert backs[i] in built_brief, f"card {i}'s answer was cut off mid-string"
    assert "complete set for this artifact" in built_brief


async def test_a_deck_can_be_named_by_filename_because_the_tutor_never_sees_ids(
    pro_user, deck_document, monkeypatch
):
    """Retrieved RAG chunks carry filenames, never document ids, so the model's only real
    handle on a document is its name -- the same substring hint generate_flashcards and
    generate_practice_exam take through resolve_document."""
    _, calls, _ = _patch_pipeline(
        monkeypatch, brief_text="TITLE: Bio Drill\n\nA game.", build_result=_ok_result()
    )

    await CreateArtifactTool().run(
        kind="quiz",
        prompt="quiz me on the bio lecture",
        document_id="bio-101",
        user_id=str(pro_user.id),
    )
    assert CARD_FRONTS[0] in calls[0][0]


async def test_quiz_over_a_note_with_no_flashcards_falls_back_to_its_real_text(
    pro_user, db_session, monkeypatch
):
    """A plain note is not a deck -- there are no cards to embed. The grounding is then the
    document's own real extracted text, fetched through documents.get_document_text (a
    real MinIO round trip here, not a stub), with instructions to write questions from it
    and fabricate nothing."""
    from app.services.documents import create_note, update_document_content

    note_text = (
        "Lab 7 notes. The titration endpoint was reached at 24.30 mL of 0.100 M NaOH. "
        "Phenolphthalein turned faint pink and held for 30 seconds."
    )
    note = await create_note(db_session, pro_user.id, "lab-7-notes.md")
    await update_document_content(db_session, note, note_text)

    _, calls, _ = _patch_pipeline(
        monkeypatch, brief_text="TITLE: Lab 7 Recall\n\nA game.", build_result=_ok_result()
    )

    result = await CreateArtifactTool().run(
        kind="quiz",
        prompt="make my lab 7 notes into a review game",
        document_id=str(note.id),
        user_id=str(pro_user.id),
    )
    assert result.startswith("```newton-artifact\n")

    built_brief = calls[0][0]
    assert note_text in built_brief  # the real text, verbatim
    assert "THE STUDENT'S OWN DOCUMENT" in built_brief
    assert "Never fabricate" in built_brief
    assert "THE STUDENT'S OWN FLASHCARDS" not in built_brief  # it has no cards


async def test_quiz_over_a_document_that_doesnt_exist_refuses_before_spending_anything(
    pro_user, monkeypatch
):
    """Refusing is the point. Falling back to "build it from general knowledge anyway"
    would produce a quiz with the student's deck name on it and none of their cards in
    it -- the exact failure this kind exists to avoid."""
    provider, calls, charged = _patch_pipeline(
        monkeypatch, brief_text="TITLE: T\n\nbrief", build_result=_ok_result()
    )

    result = await CreateArtifactTool().run(
        kind="quiz",
        prompt="quiz me on my deck",
        document_id=str(uuid.uuid4()),
        user_id=str(pro_user.id),
    )

    assert result == NO_SUCH_DOCUMENT_MESSAGE
    assert provider.calls == []
    assert calls == []
    assert charged == []


async def test_quiz_never_reads_another_students_document(pro_user, free_user, db_session, monkeypatch):
    """db.get() by primary key is not user-scoped; the ownership check is explicit."""
    other = Document(
        user_id=free_user.id, filename="someone-elses.pdf", mime_type="application/pdf", minio_key="x/9"
    )
    db_session.add(other)
    await db_session.flush()
    db_session.add(
        Flashcard(user_id=free_user.id, document_id=other.id, front="Their card", back="Their answer")
    )
    await db_session.commit()

    _, calls, _ = _patch_pipeline(monkeypatch, brief_text="TITLE: T\n\nbrief", build_result=_ok_result())
    result = await CreateArtifactTool().run(
        kind="quiz", prompt="quiz me", document_id=str(other.id), user_id=str(pro_user.id)
    )

    assert result == NO_SUCH_DOCUMENT_MESSAGE
    assert calls == []


async def test_quiz_over_an_empty_note_says_so_instead_of_inventing_a_quiz(
    pro_user, db_session, monkeypatch
):
    from app.services.documents import create_note

    note = await create_note(db_session, pro_user.id, "empty-note.md")
    _, calls, _ = _patch_pipeline(monkeypatch, brief_text="TITLE: T\n\nbrief", build_result=_ok_result())

    result = await CreateArtifactTool().run(
        kind="quiz", prompt="quiz me on this note", document_id=str(note.id), user_id=str(pro_user.id)
    )
    assert result == EMPTY_DOCUMENT_MESSAGE
    assert calls == []


async def test_document_id_is_ignored_for_the_other_four_kinds(pro_user, deck_document, monkeypatch):
    """The other kinds are specified entirely by the request -- that IS the difference
    between them and a quiz -- so a stray document_id must not start dumping flashcards
    into a diagram brief."""
    _, calls, _ = _patch_pipeline(
        monkeypatch, brief_text="TITLE: T\n\nbrief", build_result=_ok_result()
    )
    await CreateArtifactTool().run(
        kind="diagram",
        prompt="the nitrogen cycle",
        document_id=str(deck_document.id),
        user_id=str(pro_user.id),
    )
    assert CARD_FRONTS[0] not in calls[0][0]


async def test_quiz_is_gated_and_metered_exactly_like_every_other_kind(
    pro_user, deck_document, monkeypatch
):
    """No special case: it flows through the same Pro gate and the same
    billing.record_frontier_usage as the other four, because it is just another entry in
    ARTIFACT_KINDS."""
    _, _, charged = _patch_pipeline(
        monkeypatch, brief_text="TITLE: T\n\nbrief", build_result=_ok_result()
    )
    await CreateArtifactTool().run(
        kind="quiz", prompt="game", document_id=str(deck_document.id), user_id=str(pro_user.id)
    )
    assert charged[0][2] == 800 + 11000
    assert charged[0][3] == 400 + 2400


async def test_a_free_user_is_refused_a_quiz_before_any_document_is_even_read(free_user, monkeypatch):
    _, calls, charged = _patch_pipeline(monkeypatch, brief_text="x", build_result=_ok_result())
    result = await CreateArtifactTool().run(
        kind="quiz", prompt="game", document_id="bio", user_id=str(free_user.id)
    )
    assert result == PRO_ONLY_MESSAGE
    assert calls == []


# ---------------------------------------------------------------------------
# The artifact-runner client: never raises, same contract as latex_compile.
# ---------------------------------------------------------------------------


async def test_build_artifact_parses_a_real_response():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/build-artifact"
        import json as _json

        body = _json.loads(request.content)
        assert body["brief"] == "the brief"
        assert body["model"] == "deepseek/deepseek-v4-flash-0731"
        return httpx.Response(
            200,
            json={
                "html": VALID_HTML,
                "success": True,
                "timed_out": False,
                "log": "l",
                "input_tokens": 12,
                "output_tokens": 3,
                "attempts": 1,
                "problems": [],
            },
        )

    result = await artifact_build.build_artifact(
        "the brief", "deepseek/deepseek-v4-flash-0731", transport=httpx.MockTransport(handler)
    )
    assert result.success is True
    assert result.html == VALID_HTML
    assert (result.input_tokens, result.output_tokens) == (12, 3)


async def test_build_artifact_never_raises_on_a_transport_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    result = await artifact_build.build_artifact(
        "b", "m", transport=httpx.MockTransport(handler)
    )
    assert result.success is False
    assert result.html is None
    assert "could not reach artifact-runner" in result.log


async def test_build_artifact_never_raises_on_a_5xx():
    result = await artifact_build.build_artifact(
        "b", "m", transport=httpx.MockTransport(lambda r: httpx.Response(500))
    )
    assert result.success is False
    assert result.timed_out is False


# ---------------------------------------------------------------------------
# The real thing. Excluded from the hermetic CI run -- it spends real money and takes
# minutes. See pytest.ini's `live_smoke` marker.
# ---------------------------------------------------------------------------


@pytest.mark.live_smoke
async def test_live_real_artifact_build_end_to_end(pro_user, db_session):
    """A REAL persona call and a REAL opencode run in the real artifact-runner container,
    producing real HTML stored as a real Document row. No mocks anywhere."""
    result = await CreateArtifactTool().run(
        kind="diagram",
        prompt="Show the three parts of a neuron - dendrites, cell body, axon - and what each does.",
        user_id=str(pro_user.id),
    )
    assert result.startswith("```newton-artifact\n"), result

    doc = (await db_session.execute(select(Document).where(Document.user_id == pro_user.id))).scalar_one()
    assert doc.kind == "artifact"

    from app.services.documents import get_document_raw

    html = (await get_document_raw(doc)).decode("utf-8")
    assert "<html" in html.lower()
    assert "<!doctype" in html.lower()
    assert len(html) > 500

    # Genuinely self-contained. Checked the way the runner's own validator checks it --
    # by looking for an external RESOURCE reference -- not by grepping for the substring
    # "http://", which a first draft of this test did and which false-failed on
    # `xmlns="http://www.w3.org/2000/svg"`: the SVG namespace URI is an identifier, never
    # fetched, and appears in essentially every inline SVG ever written.
    import re as _re

    assert not _re.search(r"""(?:src|href)\s*=\s*["']\s*(?:https?:)?//""", html, _re.IGNORECASE)
    assert not _re.search(r"""url\(\s*["']?\s*(?:https?:)?//""", html, _re.IGNORECASE)
    assert not _re.search(r"\b(?:fetch\s*\(|XMLHttpRequest|importScripts\s*\()", html)
    # And nothing that would throw inside the app's sandbox="allow-scripts" iframe.
    assert not _re.search(r"\b(?:localStorage|sessionStorage|document\.cookie)\b", html)


@pytest.mark.live_smoke
async def test_live_real_quiz_artifact_uses_the_students_real_cards(pro_user, db_session):
    """The anti-hallucination claim, proved against the REAL pipeline: a real persona call
    and a real opencode run, with no mocks anywhere, over real Flashcard rows.

    The cards below are deliberately about an invented organism with invented terminology.
    No amount of general knowledge can produce the string "Zyrmoplast" or "Hollund's
    membrane" — so if those exact words are in the generated HTML, the agent genuinely
    used the student's own cards, and if they aren't, it invented questions instead. A
    test over real biology cards could not tell those two outcomes apart, which is exactly
    how a quiz that quietly makes things up would ship unnoticed."""
    document = Document(
        user_id=pro_user.id,
        filename="xenobiology-unit-3.pdf",
        mime_type="application/pdf",
        minio_key="never-read/live",
    )
    db_session.add(document)
    await db_session.flush()

    pairs = [
        ("What organelle stores hollundic acid in a Zyrmoplast?", "The vesperal cistern."),
        ("How many lobes does Hollund's membrane have?", "Seven."),
        ("What triggers zyrmic collapse?", "A drop in ambient thalline below 4 units."),
    ]
    db_session.add_all(
        [
            Flashcard(user_id=pro_user.id, document_id=document.id, front=front, back=back)
            for front, back in pairs
        ]
    )
    await db_session.commit()

    result = await CreateArtifactTool().run(
        kind="quiz",
        prompt="Turn my xenobiology unit 3 deck into a review game I can replay.",
        document_id=str(document.id),
        user_id=str(pro_user.id),
    )
    assert result.startswith("```newton-artifact\n"), result

    from app.services.documents import get_document_raw

    artifact = (
        await db_session.execute(
            select(Document).where(Document.user_id == pro_user.id, Document.kind == "artifact")
        )
    ).scalar_one()
    html = (await get_document_raw(artifact)).decode("utf-8")

    # THE assertion this whole kind exists for: the student's own words, in the artifact.
    for front, back in pairs:
        assert front in html, f"the agent did not use the student's real question: {front}"
        assert back in html, f"the agent did not use the student's real answer: {back}"

    # ...and it is a real game, not the cards rendered flat: something scores, something
    # responds to being answered, and it can be played again.
    lowered = html.lower()
    assert any(word in lowered for word in ("score", "streak")), "no visible score or streak"
    assert "addeventlistener" in lowered or "onclick" in lowered, "nothing to interact with"
    assert any(word in lowered for word in ("again", "restart", "retry", "replay")), "not replayable"
