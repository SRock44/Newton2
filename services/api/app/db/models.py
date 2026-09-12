import uuid
from datetime import date as date_, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, func
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


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
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


class ProfileFact(Base):
    """Memory Tier 3: typed, deduplicated, cross-session facts about a user.

    At most one row per (user_id, subject_key) has superseded_by IS NULL — that's the
    current value; writes upsert onto it instead of appending, enforced by a partial
    unique index (see migration 0001).
    """

    __tablename__ = "profile_facts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
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
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    filename: Mapped[str] = mapped_column(String)
    mime_type: Mapped[str | None] = mapped_column(String, nullable=True)
    minio_key: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id"), index=True)
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
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
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
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
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
    keep in sync."""

    __tablename__ = "flashcards"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True, index=True
    )
    front: Mapped[str] = mapped_column(Text)
    back: Mapped[str] = mapped_column(Text)
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
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
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
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(500))
    difficulty: Mapped[str] = mapped_column(String, default="medium")  # easy | medium | hard
    score: Mapped[float | None] = mapped_column(Float, nullable=True)  # fraction correct, 0.0-1.0
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


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
