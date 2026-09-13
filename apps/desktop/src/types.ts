export type Role = "user" | "assistant" | string;

export interface ToolActivityEntry {
  tool: string;
  label: string;
  done: boolean;
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
  /** Client-side only: true if the user hit Stop before this reply finished. */
  stoppedByUser?: boolean;
}

export interface ChatSession {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
}

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface UploadedDocument {
  id: string;
  filename: string;
  mime_type: string | null;
  created_at: string;
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
}

export interface ProModel {
  id: string;
  label: string;
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
