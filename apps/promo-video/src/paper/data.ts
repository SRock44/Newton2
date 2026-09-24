import captured from "../../paper/captured.json";
import { latexPrefixes, safePrefix, typedText } from "../show/data";

// Everything Newton says in the research film is REAL backend output recorded in
// paper/captured.json (see paper/capture.py): two real files uploaded to Documents (scratch lab
// notes and a project synopsis), the real chat that planned the paper (a real ```paper-plan
// card, revised on request), the real `write_research_paper` run — real web search and source
// fetches, real LaTeX compile — the real PDF it produced (paper/generated/, copied to
// public/research-paper.pdf and rendered by the film's own DocumentViewerPanel via pdf.js, the
// same component the real app now uses), and a real follow-up conversation reviewing it (a
// second real capture stage, stage_review, re-uploading that same PDF once it was written). The
// student's messages are the scripted half.

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
interface CapDoc {
  id: string;
  filename: string;
  mime_type: string;
  created_at: string;
  has_bibliography?: boolean;
}

export const NOTES = captured.docs.notes as { doc: CapDoc; content: string };
export const SYNOPSIS = captured.docs.synopsis as { doc: CapDoc; content: string };
// The finished PDF, re-uploaded so the student can attach and discuss it — a real, separate
// upload (see paper/capture.py's stage_review), not the same Document row write_research_paper
// created (that account snapshot only lives for the duration of one capture run).
export const PAPER_REUPLOAD = (captured.docs as Record<string, { doc: CapDoc }>).paper_reupload.doc;
export const TURNS = captured.turns as CapturedTurn[];

const paperEntries = Object.values(captured.paper) as { doc: CapDoc; content: string }[];
export const PAPER_PDF = paperEntries.find((e) => e.doc.filename.endsWith(".pdf"))!;
export const PAPER_TEX = paperEntries.find((e) => e.doc.filename.endsWith(".tex"))!;

/** The student's earlier documents (their own files, not Newton output). */
export const OLD_DOCS = [
  {
    id: "d-old-1",
    filename: "NumAnalysis_Reading_List.md",
    mime_type: "text/markdown",
    created_at: "2026-01-12T09:10:00Z",
    text: "# Numerical analysis reading group\n\nYoung — Iterative solution of large linear systems\nVarga — Matrix iterative analysis\nGolub & Van Loan — Matrix computations, ch. 11",
  },
  {
    id: "d-old-2",
    filename: "Seminar_Schedule_Spring.txt",
    mime_type: "text/plain",
    created_at: "2026-01-20T14:30:00Z",
    text: "Thursdays 3pm — Applied math seminar\nFeb 12: multigrid for beginners\nFeb 26: randomized linear algebra",
  },
];

export const STUDENT = "Priya";
export const APPROVE_TEXT = "Looks good — go ahead and write it.";

/** The sentence highlighted in the finished PDF for the "Ask Newton" scene — a real sentence
 * from the paper's own Introduction (page 1), and exactly what turn 4's real captured message
 * quotes (see paper/capture.py's stage_review). */
export const REVIEW_QUOTE =
  "The SOR prediction is less satisfactory: the measured count exceeds the asymptotic prediction by roughly 30–37% on these grids.";

/** The turn pairs, by role. Turn k = (user, assistant). */
export const turn = (k: number) => ({ user: TURNS[2 * k], assistant: TURNS[2 * k + 1] });

export { latexPrefixes, safePrefix, typedText };
