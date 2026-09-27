import captured from "../../study/captured.json";
import { safePrefix, typedText } from "../show/data";
import type {
  Flashcard,
  GamificationStats,
  PracticeExamDetail,
  PracticeExamSummary,
  StudyPlanItem,
  WeakArea,
} from "../../../desktop/src/types";

// Everything Newton and the app produce in the study-plan film is REAL backend output recorded in
// study/captured.json (see study/capture.py): a real Calculus II Midterm 2 packet uploaded as the
// dev student, a real chat in which Newton's start_study_session builds a dated study plan, a
// deck of flashcards and a practice exam from it in one go; the real flashcard reviews (FSRS
// scheduled by the real scheduler), the real graded exam (73% -- four deliberate misses in the
// partial-fraction / right-triangle / LIATE questions) and the real weak-area analysis those
// produce; and Newton's real follow-up naming exactly what to drill. The film only re-dates it
// (the capture ran in September; the app's clock in the film is Feb 3) and drives the UI.

export interface CapDoc {
  id: string;
  filename: string;
  mime_type: string;
  created_at: string;
  has_bibliography?: boolean;
}
export interface CapturedTool {
  type: string;
  tool: string;
  label: string;
  verified: boolean | null;
}
export interface CapturedTurn {
  role: "user" | "assistant";
  content: string;
  tools?: CapturedTool[];
}

interface Captured {
  captured_at: string;
  doc: { doc: CapDoc; content: string };
  turns: CapturedTurn[];
  snapshots: {
    session: {
      study_plan: StudyPlanItem[];
      flashcards: Flashcard[];
      flashcards_due: Flashcard[];
      exams: PracticeExamSummary[];
      exam_details: Record<string, PracticeExamDetail>;
    };
  };
  reviews: { before: Flashcard; rating: 1 | 2 | 3 | 4; after: Flashcard }[];
  exam_taken: { exam_id: string; answers: Record<string, number>; graded: PracticeExamDetail };
  weak_areas: WeakArea[];
  stats: GamificationStats;
}
const cap = captured as unknown as Captured;

// ------------------------------------------------------------------------------- re-dating
/** The film's own clock (see installFrozenTime in StudyFilm). */
export const FILM_NOW = "2026-02-03T10:24:00";
const OFFSET_MS = Date.parse(cap.captured_at) - new Date(FILM_NOW).getTime();
/** A capture-time instant, moved to the film's clock. */
export const shift = (iso: string | null): string | null =>
  iso === null ? null : new Date(Date.parse(iso) - OFFSET_MS).toISOString();
const shiftCard = (c: Flashcard): Flashcard => ({
  ...c,
  due: shift(c.due)!,
  last_review: shift(c.last_review),
  created_at: shift(c.created_at)!,
});
const shiftExam = <T extends PracticeExamSummary>(e: T): T => ({
  ...e,
  created_at: shift(e.created_at)!,
  completed_at: shift(e.completed_at),
});

// -------------------------------------------------------------------------------- content
export const PACKET = { doc: cap.doc.doc, content: cap.doc.content };
export const PACKET_DOC = { ...PACKET.doc, created_at: "2026-02-03T10:21:00Z" };
export const TURNS = cap.turns;
export const turn = (k: number) => ({ user: TURNS[2 * k], assistant: TURNS[2 * k + 1] });

export const PLAN_ITEMS: StudyPlanItem[] = cap.snapshots.session.study_plan.map((i) => ({
  ...i,
  created_at: shift(i.created_at)!,
}));
/** Every generated card, in the order the real due queue serves them. */
export const CARDS: Flashcard[] = cap.snapshots.session.flashcards_due.map(shiftCard);
/** What each of the first cards really became once reviewed (real FSRS output). */
export const REVIEWS = cap.reviews.map((r) => ({ id: r.before.id, rating: r.rating, after: shiftCard(r.after) }));
export const EXAM_SUMMARY: PracticeExamSummary = shiftExam(cap.snapshots.session.exams[0]!);
export const EXAM_OPEN: PracticeExamDetail = shiftExam(Object.values(cap.snapshots.session.exam_details)[0]!);
export const EXAM_GRADED: PracticeExamDetail = shiftExam(cap.exam_taken.graded);
/** question id -> the choice the student picked (what was really submitted). */
export const EXAM_ANSWERS = cap.exam_taken.answers;
export const WEAK: WeakArea[] = cap.weak_areas;
export const STATS: GamificationStats = cap.stats;
export const GRADED_SUMMARY: PracticeExamSummary = {
  ...EXAM_SUMMARY,
  score: EXAM_GRADED.score,
  completed_at: EXAM_GRADED.completed_at,
};

/** The student's earlier documents (their own files, not generated). */
export const OLD_DOCS = [
  {
    id: "d-old-1",
    filename: "Calc2_Syllabus_Spring.pdf",
    mime_type: "application/pdf",
    created_at: "2026-01-12T09:10:00Z",
    text: "MATH 1220 Calculus II — Spring 2026\nProf. Alvarez · MWF 10:00\nGrading: homework 30%, quizzes 15%, midterms 2 x 20%, final 20%",
  },
  {
    id: "d-old-2",
    filename: "Office_Hours_and_Policies.txt",
    mime_type: "text/plain",
    created_at: "2026-01-20T14:30:00Z",
    text: "Office hours Tue/Thu 2-4pm, Kemper 214\nLate homework: -10% per day, up to 3 days",
  },
];

export const STUDENT = "Priya";
export { safePrefix, typedText };
