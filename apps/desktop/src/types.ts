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
}

export interface ChatSession {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
}

export type ConnectionStatus = "connecting" | "open" | "closed";

/** Which UI fills the main content area next to the always-visible sidebar/title bar
 * (see App.tsx) — "chat" is ChatPane+Composer, "documents" is the Documents drive page.
 * Deliberately a general union rather than a documents-specific boolean: Documents is
 * the first panel to get the "real page, not a modal" treatment, but not meant to be
 * the last. */
export type MainView = "chat" | "documents";

export interface UploadedDocument {
  id: string;
  filename: string;
  mime_type: string | null;
  created_at: string;
}

export interface DocumentContent {
  content: string;
  editable: boolean;
}

export interface ToolInfo {
  name: string;
  description: string;
}

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

export interface Flashcard {
  id: string;
  document_id: string | null;
  front: string;
  back: string;
  due: string;
  state: string;
  last_review: string | null;
  created_at: string;
}
