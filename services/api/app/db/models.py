import uuid
from datetime import date as date_, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

EMBEDDING_DIM = 384  # fastembed BAAI/bge-small-en-v1.5


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    keycloak_sub: Mapped[str] = mapped_column(String, unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Pro subscription (see app/services/billing.py) -- "free" until a Stripe checkout
    # webhook flips it, reverted to "free" on subscription deletion. The three
    # stripe_* fields are all null until this user has ever started a checkout.
    plan: Mapped[str] = mapped_column(String, default="free", server_default="free")
    stripe_customer_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    stripe_subscription_status: Mapped[str | None] = mapped_column(String, nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Cumulative frontier-model cost (in cents) consumed this billing period -- reset to
    # 0 whenever a new period starts (checkout completed, or a subscription-renewal
    # webhook reports a later current_period_end than we had on file). Compared against
    # Settings.pro_monthly_credit_cents to decide whether a Pro user's tutor calls still
    # route to a frontier model or quietly fall back to the free-tier one.
    credits_used_cents: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    credits_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # A Pro user's chosen frontier model (one of app/services/billing.py's PRO_MODELS
    # ids) -- set by a future Settings UI action, not by this migration. Null means "use
    # the roster's default" (see billing.resolve_pro_model), not "no access".
    preferred_pro_model: Mapped[str | None] = mapped_column(String, nullable=True)

    # Minor-consent / age-gate scaffolding (ROADMAP.md Phase 7's "explicit FERPA/COPPA/
    # GDPR data-retention posture" item -- a first-pass DRAFT, not a lawyer-reviewed
    # compliance flow; see docs/data-retention-and-privacy.md for the real design
    # decision and its honest gaps). age_band is one of "under_13" / "13_17" / "18_plus"
    # -- validated in app/routers/account.py, not a DB-level constraint/enum, same style
    # as this file's other free-text status columns (flashcards.fsrs_state,
    # practice_exams.difficulty). consented_at is set ONLY when age_band is "13_17" or
    # "18_plus" -- an "under_13" answer deliberately leaves this null forever, because a
    # student's own self-attestation is NOT COPPA's required verifiable PARENTAL
    # consent; see the docs file for why this app doesn't claim to have that yet and
    # what a real implementation would still need.
    age_band: Mapped[str | None] = mapped_column(String, nullable=True)
    consented_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # A real, purchased, NON-expiring credit balance (in cents) -- see ROADMAP.md's
    # Phase 7 "Newton balance" item and app/services/billing.py's TOPUP_MARGIN/
    # compute_topup_credit_cents/apply_topup_checkout_completed. Deliberately a SEPARATE
    # pool from credits_used_cents above: that one tracks spend against a Pro
    # subscriber's monthly allowance and resets to 0 every billing period; this one is
    # topped up via a one-time Stripe Checkout purchase (mode="payment", not
    # "subscription") and only ever goes up (a purchase) or down (real frontier-model
    # spend, see record_frontier_usage) -- never reset on a timer. Available to ANY
    # user, Pro or free -- see billing.frontier_access_available, the single place that
    # decides whether a call routes to a frontier model, reused by
    # app/agents/tutor.py's _select_provider.
    topup_credits_cents: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    # Self-service "Focus Mode" (see app/routers/billing.py's PATCH /billing/focus-mode,
    # SettingsPanel.tsx) -- a student opting THEMSELVES into a stricter, Socratic-only
    # standard. Deliberately not a teacher/guardian-administered control: this codebase
    # has no such account concept at all (see ROADMAP.md Phase 7's deferred
    # "teacher-configurable academic-integrity mode" item). Available regardless of plan
    # (free or Pro) -- see app/agents/tutor.py's FOCUS_MODE_SYSTEM_ADDENDUM and
    # app/tools/write_research_paper.py's FOCUS_MODE_MESSAGE for the real effects.
    focus_mode_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    # Self-service "Learn Mode" (see app/routers/billing.py's PATCH /billing/learn-mode,
    # Composer.tsx's chat-interface toggle, SettingsPanel.tsx's mirrored toggle) -- a
    # student opting THEMSELVES into an interactive teaching layer (step-by-step math
    # requires a real attempt before the next step is revealed, plots of a function with
    # a natural free parameter offer a slider, substantive explanations pause for a
    # comprehension checkpoint) instead of today's passive-reveal behavior. Independent
    # of focus_mode_enabled above -- a student can have either, both, or neither; the two
    # are deliberately not coupled. Available regardless of plan (free or Pro), same
    # reasoning as focus_mode_enabled: this is a pedagogy toggle, not a paywall. See
    # app/agents/tutor.py's LEARN_MODE_SYSTEM_ADDENDUM for the real effects.
    learn_mode_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    # The per-user secret embedded in this student's subscribable ICS calendar URL
    # (GET /calendar/feed/{user_id}/{token}.ics -- see app/routers/calendar.py). This is
    # deliberately NOT the app's normal Keycloak bearer token and deliberately NOT a JWT
    # of any kind: a calendar client (Google Calendar, Apple Calendar, Outlook) refetching
    # a subscribed URL on its own 12-24h schedule has no way to run an OAuth refresh, so
    # the credential has to live in the URL itself and has to be long-lived. Same shape as
    # Google Calendar's own "secret address in iCal format".
    #
    # NULLABLE and lazily minted: no secret exists for a user until they actually ask for
    # their feed URL (GET /calendar/feed-url), so a student who never uses this feature
    # never has a shareable credential sitting in the database at all. Regenerated in
    # place by POST /calendar/feed-url/regenerate, which instantly and permanently breaks
    # every previously-handed-out link -- the leak-recovery path.
    calendar_feed_token: Mapped[str | None] = mapped_column(String, nullable=True)


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="active")  # active | ended
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # passive_deletes=True: trust the DB's ON DELETE CASCADE (migration 0004) instead of
    # SQLAlchemy's default behavior of loading this collection on parent delete and trying
    # to null out each child's session_id itself -- session_id is NOT NULL, so that default
    # behavior would raise an IntegrityError deleting any session that has messages.
    messages: Mapped[list["ChatMessage"]] = relationship(back_populates="session", passive_deletes=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String)  # user | assistant | system
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Only ever set on assistant messages (see app/agents/tutor.py's UsageInfo) -- null
    # for user messages, and for assistant messages predating this column or ones ended
    # by Stop before the provider's trailing usage chunk arrived. Summed client-side for
    # the "Newton Context" panel's per-chat token total.
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)

    session: Mapped[ChatSession] = relationship(back_populates="messages")


class SessionSummary(Base):
    """Memory Tier 2: one structured summary per ended session."""

    __tablename__ = "session_summaries"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE"), unique=True, index=True
    )
    topics: Mapped[list] = mapped_column(JSONB, default=list)
    problems_solved: Mapped[list] = mapped_column(JSONB, default=list)
    mistakes: Mapped[list] = mapped_column(JSONB, default=list)
    actions_taken: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # The incremental-consolidation cursor (see migration 0020): the created_at of the
    # newest ChatMessage folded into topics/problems_solved/mistakes/actions_taken so
    # far. NULL means "no cursor yet" -- either this row predates the cursor (migration
    # ran on an existing summary) or this is a session's first-ever consolidation.
    # app/jobs/consolidate.py reads only messages strictly after this on each run and
    # merges them into the existing summary, rather than re-reading the whole transcript
    # from turn 1 every time -- without it, a periodically-refired consolidation job
    # (see app/memory/working.py's CONSOLIDATION_INTERVAL_TURNS) re-sends the ENTIRE
    # transcript so far on every run, so total tokens processed over a session's life
    # grows with the SQUARE of its length rather than linearly.
    last_message_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ProfileFact(Base):
    """Memory Tier 3: typed, deduplicated, cross-session facts about a user.

    At most one row per (user_id, subject_key) has superseded_by IS NULL — that's the
    current value; writes upsert onto it instead of appending, enforced by a partial
    unique index (see migration 0001).
    """

    __tablename__ = "profile_facts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    subject_key: Mapped[str] = mapped_column(String, index=True)  # e.g. "course:MATH201"
    value: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM), nullable=True)
    source_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="SET NULL"), nullable=True
    )
    superseded_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("profile_facts.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String)
    mime_type: Mapped[str | None] = mapped_column(String, nullable=True)
    minio_key: Mapped[str] = mapped_column(String)
    # "upload" (default -- every row that existed before this column, and every
    # student-uploaded file since), "note" (see app/routers/notes.py's "Newton
    # Notepad" feature), or "artifact" (a generated, self-contained HTML mini-app --
    # see app/tools/create_artifact.py and app/services/documents.py's
    # store_artifact_html, which reuses this exact table rather than introducing a
    # third one for what is, structurally, another per-user named file with bytes).
    # A note is a REAL Document row created empty and grown via
    # PATCH /notes/{id} -- it runs through the exact same chunk+embed pipeline an
    # upload does (app.memory.rag.store_document_chunks), so it's automatically
    # retrievable via RAG in ANY chat session with zero new retrieval logic: see
    # retrieve_relevant_chunks below, which has no kind filter at all.
    kind: Mapped[str] = mapped_column(String, default="upload", server_default="upload")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Didn't exist before migration 0016 -- existing rows backfilled to NOW() via that
    # migration's server_default, harmless since nothing depended on this column's
    # absence. Bumped explicitly (see update_document_content) on every content/title
    # save; what GET /notes sorts/displays by for the note picker.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    # User-created, optional course tags (Newton Notepad, ROADMAP.md) -- free-text
    # labels a student assigns to their OWN notes, e.g. "Bio 101" or "Midterm 2". Only
    # ever set/read through PATCH /notes/{id}/tags (app/routers/notes.py), deliberately
    # separate from the content-autosave PATCH /notes/{id} so clicking a tag pill is
    # reflected immediately rather than waiting on that debounce. Meaningless (always
    # []) on kind="upload" documents -- no UI ever surfaces it for plain uploads.
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    # The real, de-duplicated bibliography source list that produced this document --
    # set ONLY by app/tools/write_research_paper.py on the PDF/.tex it generates, and
    # exactly the list it already handed to app/services/bibliography.py's assemble_bib()
    # to build the .bib the LaTeX compile consumed. Stored so that .bib remains a
    # downloadable artifact in its own right (GET /documents/{id}/bibliography.bib
    # re-runs the same pure assemble_bib() over it) instead of being discarded the
    # moment the compile finishes, which is what used to happen.
    #
    # NULL -- never [] -- for every other document: a plain uploaded PDF, a .txt, a
    # note. That NULL is precisely the "this wasn't a research-paper output" signal the
    # bibliography endpoint and the frontend's menu gating both read, so there is no
    # separate boolean flag to keep in sync with it. A paper that genuinely cited
    # nothing also stores NULL (write_research_paper only passes a non-empty list),
    # which is correct: there is no bibliography to offer for it either.
    paper_sources: Mapped[list | None] = mapped_column(JSONB, nullable=True)


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StudyPlanItem(Base):
    """A single extracted assignment/deadline. `document_id` traces it back to the
    syllabus it came from; `source` distinguishes syllabus-upload extraction from a
    future Canvas-sourced item once that connector exists, so both can coexist here."""

    __tablename__ = "study_plan_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(500))
    due_date: Mapped[date_ | None] = mapped_column(Date, nullable=True)
    # The model's original wording for *when* something is due (e.g. "Week 5"), kept
    # even when due_date parses cleanly -- and the only record at all when it doesn't,
    # rather than forcing a guessed date.
    due_date_text: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String, default="syllabus_upload")
    # The source system's own id for this item (e.g. a Classroom courseWork id) — lets a
    # re-sync upsert in place instead of creating a duplicate row every time. Unused (and
    # unenforced-unique, since it's meaningless) for syllabus_upload items.
    external_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GoogleClassroomConnection(Base):
    """One row per user who has opted into the Classroom data connector — a separate
    OAuth grant from Keycloak-brokered Google *login*, even though both reuse the same
    Google Cloud OAuth client (see google_classroom_client_id in core/config.py): login
    only ever requests `openid email profile`; this requests Classroom-specific read
    scopes and nothing else, and a user can sign in with Google without ever connecting
    this. Tokens are encrypted at the application layer (app/core/crypto.py) before they
    touch this table."""

    __tablename__ = "google_classroom_connections"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
    )
    google_email: Mapped[str | None] = mapped_column(String, nullable=True)
    encrypted_access_token: Mapped[str] = mapped_column(Text)
    encrypted_refresh_token: Mapped[str] = mapped_column(Text)
    access_token_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    scopes: Mapped[str] = mapped_column(Text)
    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Flashcard(Base):
    """Scheduling state mirrors the `fsrs` library's own `Card` fields (see
    app/services/flashcards.py's _card_from_row/_apply_card_to_row) rather than
    reinventing spaced-repetition math -- a freshly generated card with no fsrs_stability/
    fsrs_difficulty yet is exactly what the library itself considers "never reviewed",
    which conveniently also means there's no separate "new" bucket to track by hand.
    `reps`/`lapses` aren't stored here since FlashcardReviewLog already answers those
    (count of rows, count of rows with rating=Again) without a redundant counter to
    keep in sync.

    `direction` is what makes this more than a recognition-only trainer. "recognition"
    (and NULL, which every row predating migration 0021 carries) is the original
    behaviour: see `front`, recall `back`, self-rate. "production" is the harder,
    pedagogically distinct skill second-language teaching cares about -- being shown the
    meaning and having to PRODUCE the target term -- and a production card is its own
    ordinary row, with `front`/`back` already swapped at generation time so that
    front is always "the prompt shown" and back is always "the expected answer",
    whichever direction it is. Everything that reads a flashcard (the Anki/PowerPoint
    exports, the public share page, weak-area rollups) therefore keeps working with no
    knowledge of direction at all, and -- the point of modelling it this way -- the FSRS
    columns above are per-ROW, so a term's recognition and production cards schedule
    completely independently with zero scheduling-logic changes. See
    app/services/flashcards.py."""

    __tablename__ = "flashcards"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True, index=True
    )
    front: Mapped[str] = mapped_column(Text)
    back: Mapped[str] = mapped_column(Text)
    # Nullable with NO default, column-side or Python-side: backfilling a column on a
    # table that grows with every generated card is a write this feature doesn't need,
    # and NULL already means exactly "recognition" everywhere it's read (see
    # flashcards.card_direction), so a default would only add a second way to say the
    # same thing. generate_flashcards writes the value explicitly on every row it makes.
    direction: Mapped[str | None] = mapped_column(String, nullable=True)
    fsrs_state: Mapped[str] = mapped_column(String, default="learning")
    fsrs_step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fsrs_stability: Mapped[float | None] = mapped_column(Float, nullable=True)
    fsrs_difficulty: Mapped[float | None] = mapped_column(Float, nullable=True)
    due: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    last_review: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FlashcardReviewLog(Base):
    """One row per review, ever -- the audit trail FSRS scheduling itself doesn't keep,
    and what streak/XP gamification will read from later without needing its own
    separate activity log."""

    __tablename__ = "flashcard_review_logs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    flashcard_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("flashcards.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    rating: Mapped[int] = mapped_column(Integer)  # 1=Again, 2=Hard, 3=Good, 4=Easy (fsrs.Rating)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class PracticeExam(Base):
    """`difficulty` is picked per-generation by app/services/practice_exams.py from the
    user's recent exam scores (higher average -> harder next time) -- this table doesn't
    do that math itself, it just records what was chosen. `score`/`completed_at` are
    both null until the exam is submitted; a generated-but-never-taken exam is a normal,
    unremarkable state, not an error."""

    __tablename__ = "practice_exams"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(500))
    difficulty: Mapped[str] = mapped_column(String, default="medium")  # easy | medium | hard
    score: Mapped[float | None] = mapped_column(Float, nullable=True)  # fraction correct, 0.0-1.0
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CalendarEvent(Base):
    """A student's OWN calendar entry -- typed in by hand, not extracted from anything.

    Deliberately a separate table from StudyPlanItem rather than a new `source` value on
    it: a study plan item is a *deadline* derived from a syllabus/Classroom sync (it has a
    due_date DATE, a free-text due_date_text for "Week 5", and a document_id tracing it
    back to where it came from), whereas this is a real scheduled block of time the
    student chose -- an actual timestamp, an optional end, and nothing to trace back.
    Folding the two together would mean every column of each being meaningless on half the
    rows. They are merged only where merging is genuinely what's wanted: the ICS feed (see
    app/services/ics.py), which emits both.

    `end_at` is nullable on purpose -- "Chem lab 2-4pm" and "Dentist, 9am" are both normal
    things to put on a calendar, and forcing an invented end time on the second one would
    be storing a guess. See ics.py for how a null end is rendered into a real VEVENT.
    """

    __tablename__ = "calendar_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ShareLink(Base):
    """One unguessable, revocable, PUBLIC read-only link to something a student owns.

    Same credential-in-the-URL reasoning as User.calendar_feed_token above, for the same
    reason: the recipient of a shared deck has no Newton account at all, so there is no
    login to do and nothing to put in an Authorization header. The token IS the
    authorization, which is why it's 256 bits of `secrets`-grade randomness (see
    app/services/share_tokens.py) rather than anything derived from the owner's identity.

    Kept as a generic (kind, target_id) pair rather than two separate tables because the
    *sharing* concern is genuinely identical for both things being shared -- mint a
    secret, look content up by it, revoke it -- and only the rendering differs (see
    app/routers/share.py). What is NOT shared with User.calendar_feed_token is the
    storage: that one is exactly one per user, forever, and lives as a column on `users`;
    these are many-per-user, per-object, and disposable.

    The target is two real, separately-cascading nullable FKs rather than one untyped
    `target_id` column, precisely so the database can clean up after itself: deleting a
    practice exam (or the document a deck was generated from) takes its share links with
    it, instead of leaving a live public URL pointing at content that no longer exists.
    Which one is meaningful is decided by `kind`:
      - "flashcards":    `document_id` scopes the deck to one source document, or is NULL
                         for every card the student owns (mirrors GET
                         /flashcards/export.apkg's optional document_id). `exam_id` unused.
      - "practice_exam": `exam_id` is the exam. Never NULL. `document_id` unused.

    Revocation is a real row DELETE, not a soft-delete flag: there is no audit story this
    app tells about share links, and a deleted row can't be resurrected by a bug in a
    `WHERE revoked_at IS NULL` clause someone forgets to write.
    """

    __tablename__ = "share_links"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String)  # flashcards | practice_exam
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=True, index=True
    )
    exam_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("practice_exams.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # Unique because it's the sole lookup key for the public endpoint -- a collision would
    # be a cross-account content leak, so the database enforces it rather than trusting
    # the RNG alone.
    token: Mapped[str] = mapped_column(String, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PracticeExamQuestion(Base):
    __tablename__ = "practice_exam_questions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    exam_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("practice_exams.id", ondelete="CASCADE"), index=True
    )
    question_index: Mapped[int] = mapped_column(Integer)
    question: Mapped[str] = mapped_column(Text)
    choices: Mapped[list] = mapped_column(JSONB)  # list[str], always 4 options
    correct_index: Mapped[int] = mapped_column(Integer)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    student_answer_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
