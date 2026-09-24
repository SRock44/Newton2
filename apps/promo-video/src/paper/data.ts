import captured from "../../paper/captured.json";
import { latexPrefixes, safePrefix, typedText } from "../show/data";

// Everything Newton says in the research film is REAL backend output recorded in
// paper/captured.json (see paper/capture.py): two real files uploaded to Documents (scratch lab
// notes and a project synopsis), the real chat that planned the paper (a real ```paper-plan
// card, revised on request), the real `write_research_paper` run — real web search and source
// fetches, real LaTeX compile — the real PDF it produced (paper/out/, copied to
// public/research-paper.pdf and rendered by the film's own DocumentViewerPanel via pdf.js, the
// same component the real app now uses), and a real follow-up turn asking about a sentence in it.
// write_research_paper's own reply ends with the real "[Attached document: id|filename]" markers
// for the PDF and its .tex source (see services/api/app/tools/write_research_paper.py) — the
// SAME markers a student's own composer attach produces — so MessageBubble renders them as real,
// clickable document cards right there; the follow-up turn opens the PDF from that card, no
// separate re-upload/re-attach needed. The student's messages are the scripted half.

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

/** The sentence highlighted in the finished PDF for the "Ask Newton" scene — a real sentence from
 * the paper's own Discussion section, and exactly what turn 3's real captured message quotes. */
export const REVIEW_QUOTE =
  "they are systematically larger than the spectral-radius prediction: the predicted counts are 50, 97, and 191, giving measured-to-predicted ratios 1.30, 1.33, and 1.37.";

/** The turn pairs, by role. Turn k = (user, assistant). */
export const turn = (k: number) => ({ user: TURNS[2 * k], assistant: TURNS[2 * k + 1] });

export { latexPrefixes, safePrefix, typedText };
