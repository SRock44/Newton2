import captured from "../../paper/captured.json";
import { latexPrefixes, safePrefix, typedText } from "../show/data";

// Everything Newton says in the research film is REAL backend output recorded in
// paper/captured.json (see paper/capture.py): two real files uploaded to Documents (scratch lab
// notes and a project synopsis), the real chat that planned the paper (a real ```paper-plan
// card, revised on request), the real `write_research_paper` run — real web search and source
// fetches, real LaTeX compile — and the real PDF it produced (paper/generated/, rendered to
// public/paper-page-N.png). The student's messages are the scripted half.

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
export const PAPER_PAGES = 6;
export const paperPage = (i: number) => `paper-page-${i}.png`;

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

/** The turn pairs, by role. Turn k = (user, assistant). */
export const turn = (k: number) => ({ user: TURNS[2 * k], assistant: TURNS[2 * k + 1] });

export { latexPrefixes, safePrefix, typedText };
