export type Role = "user" | "assistant" | string;

export interface ToolActivityEntry {
  tool: string;
  label: string;
  done: boolean;
}

/** A deterministic "Open Flashcards"-style call to action the backend attaches right
 * after a generation tool finishes (see services/api/app/routers/chat.py's
 * _TOOL_TO_SUGGESTED_ACTION) -- keyed off which tool actually ran, never the model's
 * own reply text, so it's always correct even if the model forgets to mention it. */
export interface SuggestedAction {
  panel: string;
  label: string;
}

export interface ChatMessage {
  /** The real, persisted chat_messages.id (see services/api/app/routers/chat.py's
   * list_messages) — undefined only for a message this client just optimistically
   * appended locally (handleSend) that hasn't been echoed back yet by the WS's
   * "user_message_saved" frame (see App.tsx). Message editing uses this as the
   * truncation-point identity: DELETE /chat/sessions/{id}/messages/{id} deletes this
   * message and everything after it, so editing is only ever offered once a real id is
   * known. */
  id?: string;
  role: Role;
  content: string;
  created_at?: string;
  /** Client-side only: true while an assistant reply is still streaming in. */
  streaming?: boolean;
  /** Client-side only: true if this message represents a stream error. */
  error?: boolean;
  /** Client-side only: tool calls Newton made while producing this reply, in order,
   * each starting `done: false` and flipping to `true` once its result comes back. */
  activity?: ToolActivityEntry[];
  /** Client-side only: the model's own short "here's my plan" narration, set from a
   * `plan_chunk` WS frame (see services/api/app/agents/tutor.py's PlanChunk) — always
   * fires (if at all) before any real answer text/tool activity for the same reply.
   * Rendered as its own distinct chip in MessageBubble.tsx, never cleared once set. */
  planNarration?: string;
  /** Client-side only: one or more "Open Flashcards"-style buttons to offer on this
   * reply -- a message could plausibly earn more than one (e.g. the model calling two
   * generation tools in one turn), so this is always an array, never clobbered. */
  suggestedActions?: SuggestedAction[];
  /** Client-side only: true if the user hit Stop before this reply finished. */
  stoppedByUser?: boolean;
  /** Only ever set on assistant messages — null for user messages, and for replies
   * where the provider didn't report usage (e.g. the keyless dev EchoProvider) or that
   * were stopped before the trailing usage chunk arrived. Summed across a session's
   * messages for the "Newton Context" panel's token total. */
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  /** Client-side only: set on an assistant reply's placeholder the moment it's pushed
   * (see App.tsx's handleSend) when this turn was sent as a Conversation Practice
   * exchange (see Composer.tsx's toggle/language picker) -- carried through every
   * later in-place update via the usual `{...last, ...}` spread, so it's still true by
   * the time the reply finishes streaming. Gates MessageBubble's auto-play-on-reply
   * behavior: a plain typed/chat turn never sets this, so the manual "Listen" button
   * stays the only way to hear an ordinary reply. */
  conversationPractice?: boolean;
  /** Client-side only: the ISO 639-1 language code (e.g. "es") Conversation Practice
   * mode was set to for this turn -- passed to POST /voice/synthesize so the
   * auto-played reply uses a matching voice (see app/tools/voice_tts.py's language
   * param) instead of always the default English one. */
  ttsLanguage?: string;
}

export interface ChatSession {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
}

// "reconnecting" (distinct from the initial "connecting") is shown while an
// auto-reconnect attempt is in flight after an UNEXPECTED close -- see App.tsx's WS
// effect. Kept distinct from plain "connecting" so the UI can (if it ever wants to)
// tell "first connect" apart from "recovering from a drop", though today both render
// via the same CONNECTION_LABEL/live-dot styling.
export type ConnectionStatus = "connecting" | "reconnecting" | "open" | "closed";

/** Which UI fills the main content area next to the always-visible sidebar/title bar
 * (see App.tsx) — "chat" is ChatPane+Composer, "documents" is the Documents drive page,
 * "home" is the dashboard landing view (see HomeView.tsx) and is the default a student
 * lands on. Deliberately a general union rather than a documents-specific boolean:
 * Documents was the first panel to get the "real page, not a modal" treatment, and
 * Home is the second. */
export type MainView = "chat" | "documents" | "home";

export interface UploadedDocument {
  id: string;
  filename: string;
  mime_type: string | null;
  created_at: string;
  /** True only for a research paper Newton itself wrote that actually cited sources —
   * the backend stores that paper's real bibliography source list on the document (see
   * Document.paper_sources) and rebuilds the `.bib` from it on demand. Gates the
   * "Download bibliography (.bib)" action, which is meaningless for a plain upload.
   * Optional so an older/partial payload (or a test fixture) simply reads as "no". */
  has_bibliography?: boolean;
}

export interface DocumentContent {
  content: string;
  editable: boolean;
}

export interface ToolInfo {
  name: string;
  description: string;
}

/** A Newton Notepad note — a first-class, listable Document (kind="note") on the
 * backend, see app/routers/notes.py. Summary shape (no content) for the note picker.
 * `tags`: user-created, optional, free-text course labels (e.g. "Bio 101") — set via
 * the dedicated PATCH /notes/{id}/tags, never the content-autosave PATCH /notes/{id}. */
export interface NoteSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  tags: string[];
}

/** Full note shape (NoteSummary + raw content) — GET /notes/{id}. */
export interface Note extends NoteSummary {
  content: string;
}

export type NoteAnnotateAction = "explain" | "define" | "summarize";

export interface StudyPlanItem {
  id: string;
  document_id: string | null;
  title: string;
  due_date: string | null;
  due_date_text: string | null;
  notes: string | null;
  source: string;
  created_at: string;
}

export interface ClassroomStatus {
  connected: boolean;
  google_email?: string | null;
  connected_at?: string | null;
}

export interface GamificationStats {
  streak_days: number;
  xp: number;
  level: number;
  xp_to_next_level: number;
  messages_sent: number;
  flashcards_reviewed: number;
  flashcards_created: number;
  study_plan_items: number;
}

/** One genuinely low-performing topic, straight from GET /weak-areas (see
 * services/api/app/services/weak_areas.py's WeakArea dataclass). `label` is the source
 * document's filename, or the literal "general" for cards/questions with no source
 * document — the backend groups by real Document, it does not invent topic names. The
 * two example lists are capped server-side (5 each) and are REAL card fronts / missed
 * question text, not summaries. */
export interface WeakArea {
  label: string;
  weak_flashcards: string[];
  missed_questions: string[];
  /** Real Flashcard row ids, paired 1:1 (same order, same truncation) with
   * `weak_flashcards` — what lets a caller scope a review session to exactly these
   * cards instead of the whole due queue. */
  weak_flashcard_ids: string[];
  /** Real PracticeExamQuestion row ids, paired 1:1 with `missed_questions`. */
  missed_question_ids: string[];
  /** The completed PracticeExam id each entry in `missed_questions`/`missed_question_ids`
   * came from, paired 1:1 with them — missed questions on one document can span several
   * separate completed exams. */
  missed_question_exam_ids: string[];
  /** The real Document id this area was grouped by, or null for the "general" bucket
   * (cards/questions with no source document). */
  document_id: string | null;
  /** weak_flashcards.length + missed_questions.length as the server counted it — the
   * list arrives sorted by this, worst first. */
  weak_count: number;
}

export interface PracticeExamQuestion {
  id: string;
  question_index: number;
  question: string;
  choices: string[];
  // Only present once the exam is completed (see the backend's answer-leak guard).
  correct_index?: number;
  explanation?: string | null;
  student_answer_index?: number | null;
  is_correct?: boolean | null;
}

export interface PracticeExamSummary {
  id: string;
  document_id: string | null;
  title: string;
  difficulty: string;
  score: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface PracticeExamDetail extends PracticeExamSummary {
  questions: PracticeExamQuestion[];
}

export interface BillingStatus {
  plan: "free" | "pro";
  subscription_status: string | null;
  current_period_end: string | null;
  credits_used_cents: number;
  credits_limit_cents: number;
  credits_reset_at: string | null;
  // The frontier model that will actually be used — the user's own saved pick if
  // they're Pro and it's still a curated option, else the roster's default (see
  // app/services/billing.py's resolve_pro_model, which this field always mirrors).
  preferred_pro_model: string;
  // Static plan constants (not user-specific) — how many items a single flashcard/
  // practice-exam/study-plan generation call aims for on each plan. Not a rate limit of
  // any kind (no daily/weekly cap exists anywhere in this app) — see
  // app/services/billing.py's FREE_GENERATION_TARGET/PRO_GENERATION_TARGET, which these
  // always mirror, and DocumentsPanel.tsx's generation note.
  free_generation_target: number;
  pro_generation_target: number;
  // Self-service "Focus Mode" (see SettingsPanel.tsx, app/routers/billing.py's PATCH
  // /billing/focus-mode) -- a student opting THEMSELVES into Socratic-only tutoring and
  // no full write_research_paper drafts. Available on every plan, free or Pro -- not a
  // paid perk being gated, unlike preferred_pro_model above.
  focus_mode_enabled: boolean;
  // Real, purchased, NON-expiring credit balance (see app/db/models.py's
  // User.topup_credits_cents, app/services/billing.py's TOPUP_MARGIN). Separate from
  // credits_used_cents/credits_limit_cents above, which track a Pro subscriber's
  // monthly allowance -- this balance is bought via a one-time Stripe Checkout purchase
  // and available on every plan, free or Pro (see SettingsPanel.tsx's "Add credits").
  topup_credits_cents: number;
  // The fixed purchase-tier amounts (in cents) topup-checkout-session accepts -- always
  // the real app/services/billing.py's TOPUP_TIERS_CENTS, never a hardcoded copy here
  // that could drift.
  topup_tiers_cents: number[];
  // Self-service "Learn Mode" (see Composer.tsx's chat-interface toggle,
  // SettingsPanel.tsx's mirrored toggle, app/routers/billing.py's PATCH
  // /billing/learn-mode) -- a student opting THEMSELVES into an interactive teaching
  // layer (step-check/checkpoint blocks, slider-enabled plots) instead of today's
  // passive-reveal behavior. Available on every plan, free or Pro, and deliberately
  // independent of focus_mode_enabled above -- a student can have either, both, or
  // neither.
  learn_mode_enabled: boolean;
}

export interface ProModel {
  id: string;
  label: string;
}

// Minor-consent / age-gate scaffolding (ROADMAP.md Phase 7 -- see
// docs/data-retention-and-privacy.md for the real design decision and its honest
// gaps). "under_13" is a real, valid answer that gets recorded but never clears
// needs_consent -- see AgeGateScreen.tsx and app/routers/account.py's
// submit_age_consent for why.
export type AgeBand = "under_13" | "13_17" | "18_plus";

export interface AccountConsentStatus {
  age_band: AgeBand | null;
  consented_at: string | null;
  needs_consent: boolean;
}

/** `front` is always the prompt shown and `back` always the expected answer, in BOTH
 * directions — the backend swaps them when it creates a production card, so nothing
 * that merely displays a card has to know about direction. */
export interface Flashcard {
  id: string;
  document_id: string | null;
  front: string;
  back: string;
  /** "recognition" (see the prompt, recall the answer, self-rate) or "production" (type
   * the answer, graded by the server). Optional here only so older fixtures and any
   * response predating the field still typecheck; the live API always sends it, and an
   * absent value means recognition. */
  direction?: FlashcardDirection;
  due: string;
  state: string;
  last_review: string | null;
  created_at: string;
}

export type FlashcardDirection = "recognition" | "production";

/** The server's verdict on a typed production answer. `result` maps to an FSRS rating
 * server-side (correct→Good, close→Hard, wrong→Again); "close" specifically means the
 * answer matched apart from accent marks. */
export interface ProductionGrading {
  result: "correct" | "close" | "wrong";
  rating: 1 | 2 | 3 | 4;
  answer: string;
  expected: string;
}

export interface GradedFlashcard extends Flashcard {
  grading: ProductionGrading;
}

/** A student's OWN calendar entry -- typed in by hand, distinct from a StudyPlanItem,
 * which is a deadline Newton extracted from a syllabus or a Classroom sync. See
 * services/api/app/db/models.py's CalendarEvent for why they're separate tables.
 * `end_at` is genuinely optional: "Dentist, 9am" is a normal thing to put on a calendar
 * and inventing an end time for it would be storing a guess. */
export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO-8601 with an offset, as produced by the backend. */
  start_at: string;
  end_at: string | null;
  notes: string | null;
  created_at: string;
}

/** The student's personal, subscribable ICS feed address (see
 * services/api/app/routers/calendar.py). Both fields point at the same endpoint --
 * `webcal_url` is the semantically-correct "subscribe, don't download" scheme, `url` is
 * the plain http(s) form every calendar app accepts in its own "add by URL" box without
 * needing an OS protocol handler registered. SettingsPanel copies `url`. */
export interface CalendarFeedUrls {
  url: string;
  webcal_url: string;
}

/** A public, revocable read-only link to a flashcard deck or a practice exam. `url` is a
 * plain http(s) address served by the API itself -- the recipient has no Newton account
 * and no desktop app, so it deliberately isn't a deep link into this app. */
export interface ShareLink {
  id: string;
  kind: "flashcards" | "practice_exam";
  document_id: string | null;
  exam_id: string | null;
  url: string;
  created_at: string;
}
