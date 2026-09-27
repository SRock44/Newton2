import { continueRender, delayRender } from "remotion";
import type { CalendarEvent, Flashcard, PracticeExamDetail, PracticeExamSummary, StudyPlanItem } from "../../../desktop/src/types";
import { activeFilm } from "../filmId";
import { EXAM_GRADED, OLD_DOCS, PACKET, REVIEWS, STATS, WEAK } from "./data";

// The real panels (Documents, Study plan, Calendar, Flashcards, Practice exams, Home) fetch from
// the API on mount. This film renders frame by frame, so every request holds the frame's render
// open (delayRender) until the response has been consumed and React has committed it, and every
// answer is the REAL recorded backend output (see data.ts) for whatever moment the film is at.
const API_BASE = "http://127.0.0.1:58001";

export interface FilmDoc {
  id: string;
  filename: string;
  mime_type: string | null;
  created_at: string;
}

/** Set (synchronously, during render) by the film before the panels mount: what each endpoint
 * returns at the current moment of the story. */
export const studyState: {
  docs: FilmDoc[];
  plan: StudyPlanItem[];
  dueCards: Flashcard[];
  allCards: Flashcard[];
  exams: PracticeExamSummary[];
  examDetail: PracticeExamDetail | null;
  events: CalendarEvent[];
} = { docs: [], plan: [], dueCards: [], allCards: [], exams: [], examDetail: null, events: [] };

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (activeFilm.id !== "study" || !url.startsWith(API_BASE)) return realFetch(input, init);
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  const [path, query = ""] = url.slice(API_BASE.length).split("?");
  const p = path ?? "";

  const handle = delayRender(`api ${method} ${p}`);
  const release = () =>
    window.setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => continueRender(handle))), 90);

  // An upload that never finishes: the page sits on its real "Uploading…" state.
  if (method === "POST" && p === "/documents/upload") {
    release();
    return new Promise<Response>(() => {});
  }

  let res: Response;
  if (method === "GET" && p === "/documents") {
    res = json(studyState.docs);
  } else if (method === "GET" && /^\/documents\/[^/]+\/content$/.test(p)) {
    const id = p.split("/")[2];
    if (id === PACKET.doc.id) res = json({ content: PACKET.content, editable: false });
    else {
      const old = OLD_DOCS.find((d) => d.id === id);
      res = json({ content: old?.text ?? "", editable: !!old && !old.mime_type.includes("pdf") });
    }
  } else if (method === "GET" && p === "/study-plan") {
    res = json(studyState.plan);
  } else if (method === "GET" && p === "/flashcards") {
    res = json(query.includes("due_only=true") ? studyState.dueCards : studyState.allCards);
  } else if (method === "POST" && /^\/flashcards\/[^/]+\/review$/.test(p)) {
    const id = p.split("/")[2];
    res = json(REVIEWS.find((r) => r.id === id)?.after ?? studyState.allCards.find((c) => c.id === id) ?? {});
  } else if (method === "GET" && p === "/practice-exams") {
    res = json(studyState.exams);
  } else if (method === "GET" && /^\/practice-exams\/[^/]+$/.test(p)) {
    res = json(studyState.examDetail ?? {});
  } else if (method === "POST" && /^\/practice-exams\/[^/]+\/submit$/.test(p)) {
    res = json(EXAM_GRADED);
  } else if (method === "GET" && p === "/calendar/events") {
    res = json(studyState.events);
  } else if (method === "POST" && p === "/calendar/events") {
    const body = JSON.parse(String(init?.body ?? "{}")) as Partial<CalendarEvent>;
    res = json({ id: "ev-new", title: body.title ?? "", start_at: body.start_at ?? "", end_at: body.end_at ?? null, notes: body.notes ?? null, created_at: new Date().toISOString() });
  } else if (method === "GET" && p === "/weak-areas") {
    res = json(WEAK);
  } else if (method === "GET" && p === "/gamification/stats") {
    res = json(STATS);
  } else if (method === "GET" && p === "/integrations/classroom/status") {
    res = json({ connected: false });
  } else if (method === "GET" && p === "/billing/status") {
    res = json({
      plan: "pro",
      subscription_status: "active",
      current_period_end: null,
      credits_used_cents: 0,
      credits_limit_cents: 2000,
      credits_reset_at: null,
      preferred_pro_model: "",
      free_generation_target: 10,
      pro_generation_target: 30,
      focus_mode_enabled: false,
      topup_credits_cents: 0,
      topup_tiers_cents: [],
      learn_mode_enabled: false,
    });
  } else if (method === "GET" && (p === "/notes" || p === "/chat/sessions")) {
    res = json([]);
  } else {
    res = json({});
  }
  release();
  return res;
};
