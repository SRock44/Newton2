import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/500.css";
import "@fontsource/public-sans/600.css";
import "@fontsource/public-sans/700.css";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "../../../desktop/src/App.css";
import "katex/dist/katex.min.css";
import "../promo.css";

import React, { useEffect, useLayoutEffect, useRef } from "react";
import { continueRender, delayRender, useCurrentFrame } from "remotion";
import TitleBar from "../../../desktop/src/components/TitleBar";
import Sidebar from "../../../desktop/src/components/Sidebar";
import ChatPane from "../../../desktop/src/components/ChatPane";
import DocumentsPanel from "../../../desktop/src/components/DocumentsPanel";
import StudyPlanPanel from "../../../desktop/src/components/StudyPlanPanel";
import CalendarPanel from "../../../desktop/src/components/CalendarPanel";
import FlashcardsPanel from "../../../desktop/src/components/FlashcardsPanel";
import PracticeExamsPanel from "../../../desktop/src/components/PracticeExamsPanel";
import HomeView from "../../../desktop/src/components/HomeView";
import NewtonMark from "../../../desktop/src/components/NewtonMark";
import type { ChatMessage, ChatSession, MainView, ToolActivityEntry } from "../../../desktop/src/types";
import { clamp01, easeInOut, easeOut, FPS, measure, prog, typed } from "../anim";
import { cameraTransform, cursorAt, findTarget, installFrozenTime, WALLPAPER, type Pt } from "../engine";
import { Caption, CursorArrow, ScriptedComposer } from "../ui";
import { activeFilm } from "../filmId";
import { FOLLOW_WINDOW, FollowProbes, followSampleTimes, pinChatToBottom } from "../followProbes";
import "./api";
import { studyState, type FilmDoc } from "./api";
import {
  CARDS,
  EXAM_ANSWERS,
  EXAM_GRADED,
  EXAM_OPEN,
  EXAM_SUMMARY,
  FILM_NOW,
  GRADED_SUMMARY,
  OLD_DOCS,
  PACKET,
  PACKET_DOC,
  PLAN_ITEMS,
  REVIEWS,
  STUDENT,
  TURNS,
  WEAK,
  safePrefix,
  typedText,
} from "./data";
import { CAPTIONS, CLICKS, CURSOR, FX, FY, Z } from "./script";
import {
  ANSWER_SHOWN,
  CARD_COUNT,
  EVENT_NOTES,
  EVENT_START_LOCAL,
  EVENT_TITLE,
  FIRST_WRONG,
  REVEAL_CPS,
  T,
  TYPE_CPS,
  type TurnMark,
} from "./timeline";

installFrozenTime(FILM_NOW);

const MAIN = { left: 190, top: 30, w: 1400, h: 860, scale: 1.1 };
const M = T.marks;

const asDoc = (d: { id: string; filename: string; mime_type: string; created_at: string }): FilmDoc => d;
const OLD_FILM_DOCS: FilmDoc[] = OLD_DOCS.map(asDoc);
const packetDoc = asDoc(PACKET_DOC);
const pickerEntry = (d: FilmDoc) => ({ name: d.filename, date: new Date(d.created_at).toLocaleDateString() });
const PICKER_DOCS = [packetDoc, ...OLD_FILM_DOCS].map(pickerEntry);

const OLD_SESSIONS: ChatSession[] = [
  { id: "s2", title: null, status: "active", created_at: "2026-02-02T09:00:00Z" },
  { id: "s3", title: null, status: "active", created_at: "2026-01-30T18:00:00Z" },
];
const OLD_FIRST: Record<string, string> = {
  s2: "How do I know when to use integration by parts vs u-substitution?",
  s3: "Explain the ratio test with an example",
};

// ---------------------------------------------------------------- which panel is up, and when
type Overlay = "plan" | "cal" | "cards" | "exam" | "weak" | null;
const FADE_OUT = 0.22;
const WINDOWS: { id: Exclude<Overlay, null>; open: number; close: number }[] = [
  { id: "plan", open: T.plan.open, close: T.plan.close },
  { id: "cal", open: T.cal.open, close: T.cal.close },
  { id: "cards", open: T.cards.open, close: T.cards.close },
  { id: "exam", open: T.exam.open, close: T.exam.close },
  { id: "weak", open: T.home.scopedOpen, close: T.home.scopedClose },
];
function activeOverlay(t: number): { id: Exclude<Overlay, null>; open: number; close: number } | null {
  return WINDOWS.find((w) => t >= w.open && t < w.close + FADE_OUT) ?? null;
}

// ------------------------------------------------------------------ custom cursor targets
function customTarget(root: HTMLElement, name: string): Pt | null | undefined {
  const rect = (el: Element | null | undefined) => (el ? measure(el, root) : null);
  const center = (r: ReturnType<typeof rect>) => (r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null);
  const nth = (sel: string, n: number) => root.querySelectorAll(sel)[n] ?? null;
  const sidebarBtn = (text: string) =>
    Array.from(root.querySelectorAll(".sidebar button")).find((b) => b.textContent?.trim() === text) ?? null;
  switch (name) {
    case "upload-btn":
      return center(rect(root.querySelector(".documents-page-toolbar-actions .btn-primary")));
    case "doc-card": {
      const r = rect(root.querySelector(".doc-entry"));
      return r ? { x: r.left + r.width * 0.5, y: r.top + r.height * 0.55 } : null;
    }
    case "doc-detail": {
      const r = rect(root.querySelector(".doc-detail-body"));
      return r ? { x: r.left + r.width * 0.45, y: r.top + r.height * 0.35 } : null;
    }
    // the study plan / flashcards / practice exam cards Newton's reply ends with (click to open)
    case "card-plan":
    case "card-flashcards":
    case "card-exam":
      return center(rect(root.querySelector(`.study-item-card--${name.slice(5) === "plan" ? "plan" : name.slice(5)}`)));
    case "nav-plan":
      return center(rect(sidebarBtn("Study plan")));
    case "nav-cal":
      return center(rect(sidebarBtn("Calendar")));
    case "nav-cards":
      return center(rect(sidebarBtn("Flashcards")));
    case "nav-exams":
      return center(rect(sidebarBtn("Practice exams")));
    case "nav-home":
      return center(rect(root.querySelector('.sidebar [aria-label="Home"]')));
    case "modal-close":
      return center(rect(root.querySelector(".modal-close")));
    case "session-first":
      return center(rect(root.querySelector(".sidebar .session-item-main")));
    case "plan-first":
      return center(rect(nth(".modal-panel .item-row", 0)));
    case "plan-last":
      return center(rect(nth(".modal-panel .item-row", PLAN_ITEMS.length - 1)));
    case "cal-deadline":
      return center(rect(nth(".calendar-day .item-row", 1)));
    case "cal-new":
      return center(rect(root.querySelector(".calendar-add-btn")));
    case "cal-title":
      return center(rect(root.querySelector('.calendar-form input[type="text"]')));
    case "cal-start":
      return center(rect(root.querySelector('.calendar-form input[type="datetime-local"]')));
    case "cal-add":
      return center(rect(root.querySelector(".calendar-form .btn-primary")));
    case "card-box":
      return center(rect(root.querySelector(".flashcard-box")));
    case "rate-1":
    case "rate-2":
    case "rate-3":
    case "rate-4":
      return center(rect(nth(".flashcard-ratings button", Number(name.slice(5)) - 1)));
    case "tab-all":
      return center(rect(nth(".flashcards-tab", 1)));
    case "export-anki":
      return center(rect(nth(".flashcards-toolbar-btn", 0)));
    case "exam-title":
      return center(rect(root.querySelector(".exam-list-title")));
    case "exam-submit":
      return center(rect(root.querySelector(".exam-taking > .btn-primary")));
    case "exam-explain":
      return center(rect(nth(".exam-explanation", 0)));
    case "home-due":
      return center(rect(root.querySelector(".home-widget--due-soon .item-title, .home-widget--due-soon li")));
    case "home-weak":
      return center(rect(root.querySelector(".home-weak-area-examples")));
    case "home-review":
      return center(rect(nth(".home-weak-area-actions button", 0)));
    default:
      // a chat question's answer index: "exam-choice-<i>" = the choice really submitted for question i
      if (name.startsWith("exam-choice-")) {
        const i = Number(name.slice(12));
        const q = EXAM_OPEN.questions[i];
        const choice = q ? EXAM_ANSWERS[q.id] : undefined;
        return center(rect(root.querySelectorAll(".exam-question")[i]?.querySelectorAll(".exam-choice")[choice ?? 0]));
      }
      return undefined;
  }
}

function elementFor(root: HTMLElement, name: string): Element | null {
  switch (name) {
    case "upload-btn":
      return root.querySelector(".documents-page-toolbar-actions .btn-primary");
    case "card-plan":
    case "card-flashcards":
    case "card-exam":
      return root.querySelector(`.study-item-card--${name.slice(5)}`);
    case "cal-new":
      return root.querySelector(".calendar-add-btn");
    case "cal-add":
      return root.querySelector(".calendar-form .btn-primary");
    case "exam-submit":
      return root.querySelector(".exam-taking > .btn-primary");
    case "home-review":
      return root.querySelectorAll(".home-weak-area-actions button")[0] ?? null;
    case "modal-close":
      return root.querySelector(".modal-close");
    case "doc-card":
    case "doc-detail":
      return null;
  }
  return findTarget(root, name);
}
const PRESSABLE = new Set([
  "card-plan", "card-flashcards", "card-exam",
  "send", "newchat", "nav-documents", "upload-btn", "menu-existing", "picker-deck", "plus",
  "cal-new", "cal-add", "exam-submit", "home-review", "modal-close",
]);

// ------------------------------------------------------------------ chat content from time
function assistantContent(k: number, t: number, m: TurnMark): string {
  const full = TURNS[2 * k + 1]!.content;
  if (t < m.revealStart) return "";
  return safePrefix(full, Math.max(1, Math.floor((t - m.revealStart) * REVEAL_CPS)));
}

function buildChat(t: number) {
  const messages: ChatMessage[] = [];
  let composerText = "";
  M.forEach((m, k) => {
    if (t >= m.userAppear) {
      messages.push({ id: `u${k}`, role: "user", content: TURNS[2 * k]!.content, created_at: "2026-02-03T10:24:00Z" });
    }
    if (t >= m.asstAppear) {
      const activity: ToolActivityEntry[] = m.tools
        .filter((tl) => t >= tl.start)
        .map((tl) => ({ tool: tl.tool, label: tl.label, done: t >= tl.done, verified: undefined }));
      messages.push({
        id: `a${k}`,
        role: "assistant",
        content: assistantContent(k, t, m),
        created_at: "2026-02-03T10:24:05Z",
        activity,
      });
    }
    if (t >= m.clickField && t < m.sendClick) composerText = typed(m.typed, t, m.typeStart, TYPE_CPS);
  });
  return { messages, composerText };
}

// ------------------------------------------------------------------ documents phases
type DocPhase = "A" | "B" | "C";
function docPhase(t: number): DocPhase {
  if (t < T.uploadClick + 0.1) return "A";
  if (t < T.uploadDone) return "B";
  return "C";
}
const PHASE_DOCS: Record<DocPhase, FilmDoc[]> = {
  A: OLD_FILM_DOCS,
  B: OLD_FILM_DOCS,
  C: [packetDoc, ...OLD_FILM_DOCS],
};

/** The REAL Documents page, remounted per phase so each phase is a pure function of time; for the
 * "uploading" phase a real file is chosen so the page sits on its own "Uploading…" state. */
function DocsView({ phase }: { phase: DocPhase }) {
  useEffect(() => {
    if (phase !== "B") return;
    const handle = delayRender("documents: choose file");
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        continueRender(handle);
      }
    };
    let steps = 0;
    const step = () => {
      const input = document.querySelector<HTMLInputElement>(".documents-page-toolbar-actions input[type=file]");
      const btn = document.querySelector(".documents-page-toolbar-actions .btn-primary");
      if (input && btn && btn.textContent?.includes("Uploading")) return finish();
      if (input && !btn?.textContent?.includes("Uploading") && !(input as HTMLInputElement & { __sent?: boolean }).__sent) {
        (input as HTMLInputElement & { __sent?: boolean }).__sent = true;
        const dt = new DataTransfer();
        dt.items.add(new File(["x"], PACKET.doc.filename, { type: PACKET.doc.mime_type }));
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (++steps > 150) return finish();
      window.setTimeout(step, 40);
    };
    step();
    return finish;
  }, [phase]);

  return (
    <DocumentsPanel
      key={phase}
      token="promo"
      onClose={() => {}}
      onChatAboutDocument={() => {}}
      initialSelectedDocumentId={phase === "C" ? packetDoc.id : null}
    />
  );
}

// ---------------------------------------------------- driving the real panels' own state
/** What the real panels must be showing right now -- each panel is remounted when its phase key
 * changes (so a frame never depends on what an earlier frame did), then aligned to this by
 * clicking / typing into its own controls, idempotently. */
interface Align {
  calForm: boolean;
  calTitle: string;
  calStart: string;
  cardRevealed: boolean;
  cardsBrowse: boolean;
  examOpen: boolean;
  examAnswered: number;
}
const align: Align = { calForm: false, calTitle: "", calStart: "", cardRevealed: false, cardsBrowse: false, examOpen: false, examAnswered: 0 };

function setInput(el: HTMLInputElement | null, value: string) {
  if (!el || el.value === value) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function alignPanels(root: HTMLElement) {
  if (align.calForm) {
    const add = root.querySelector<HTMLButtonElement>(".calendar-add-btn");
    if (add) add.click();
    setInput(root.querySelector('.calendar-form input[type="text"]'), align.calTitle);
    setInput(root.querySelector('.calendar-form input[type="datetime-local"]'), align.calStart);
    const notes = root.querySelectorAll<HTMLInputElement>('.calendar-form input[type="text"]')[1];
    setInput(notes ?? null, align.calStart ? EVENT_NOTES : "");
  }
  if (align.cardsBrowse) {
    const tab = root.querySelectorAll<HTMLButtonElement>(".flashcards-tab")[1];
    if (tab && !tab.classList.contains("flashcards-tab--active")) tab.click();
  }
  if (align.cardRevealed) {
    const box = root.querySelector<HTMLElement>(".flashcard-box");
    if (box && box.querySelector(".flashcard-box-label")?.textContent === "Question") box.click();
  }
  if (align.examOpen) {
    const questions = root.querySelectorAll<HTMLElement>(".exam-question");
    for (let i = 0; i < Math.min(align.examAnswered, questions.length); i++) {
      const id = EXAM_OPEN.questions[i]?.id;
      const choice = id ? questions[i]!.querySelectorAll<HTMLButtonElement>(".exam-choice")[EXAM_ANSWERS[id] ?? 0] : null;
      if (choice && !choice.disabled && !choice.classList.contains("exam-choice--selected")) choice.click();
    }
  }
}

/** The modal panels scroll internally; the film drives that with a transform on their content (the
 * panel is `overflow-y: clip`, its header opaque above the content sliding under it -- see
 * promo.css) rather than scrollTop, for the same paint-lag reason as the chat. Everything below the
 * header moves together. `id` says which panel is up, and so which scroll it wants at time `t`. */
function panelScroll(root: HTMLElement, t: number, id: Overlay) {
  const panel = root.querySelector<HTMLElement>(".modal-panel");
  if (!panel) return;
  const kids = Array.from(panel.children).filter((c) => !c.classList.contains("modal-header")) as HTMLElement[];
  kids.forEach((k) => (k.style.transform = ""));
  if (!id) return;
  const pr = panel.getBoundingClientRect();
  const s = panel.offsetWidth ? pr.width / panel.offsetWidth : 1;
  const bottom = Math.max(0, ...kids.map((k) => (k.getBoundingClientRect().bottom - pr.top) / s));
  const maxScroll = Math.max(0, bottom + 24 - panel.clientHeight);
  const ease = (from: number, to: number) => easeInOut(clamp01((t - from) / (to - from)));

  let y = 0;
  if (id === "plan") {
    y = maxScroll * ease(T.plan.hoverFirst, T.plan.closeClick - 0.8);
  } else if (id === "cal") {
    y = maxScroll * 0.92 * ease(T.cal.added + 1.9, T.cal.closeClick - 0.4);
  } else if (id === "cards") {
    y = Math.min(maxScroll, 260) * ease(T.cards.browse + 0.9, T.cards.closeClick - 0.3);
  } else if (id === "exam") {
    const taking = root.querySelector<HTMLElement>(".exam-taking");
    if (taking && t >= T.exam.graded - 0.05) {
      const q = root.querySelectorAll<HTMLElement>(".exam-question")[FIRST_WRONG];
      const tr = taking.getBoundingClientRect();
      const target = q ? Math.min(maxScroll, (q.getBoundingClientRect().top - tr.top) / s + (tr.top - pr.top) / s - 96) : 0;
      y = Math.max(0, target) * ease(T.exam.explainStart, T.exam.explainEnd);
    } else if (taking) {
      // Follow the answering: each question the student answers is scrolled up to the top of the
      // panel just before its click, so the click always lands on screen (it used to answer
      // questions that were below the fold). Then, once the rest fill in, on to Submit.
      const qs = Array.from(root.querySelectorAll<HTMLElement>(".exam-question"));
      const tr = taking.getBoundingClientRect();
      const targetOf = (i: number) => Math.min(maxScroll, Math.max(0, ((qs[i]?.getBoundingClientRect().top ?? tr.top) - tr.top) / s - 6));
      let from = 0;
      y = 0;
      for (let i = 1; i < ANSWER_SHOWN; i++) {
        const to = targetOf(i);
        const p = ease(T.exam.answer(i) - 0.6, T.exam.answer(i) - 0.15);
        if (p > 0) y = from + (to - from) * p;
        if (p >= 1) from = to;
        else break;
      }
      if (t >= T.exam.scrollStart) y = from + (maxScroll - from) * ease(T.exam.scrollStart, T.exam.scrollEnd);
    }
  }
  kids.forEach((k) => (k.style.transform = `translateY(${-y}px)`));
}

/** Whether the real panel on screen has finished loading what it should be showing at time `t`. The
 * panels fetch on mount, and a frame captured a beat before a response landed would show a
 * half-loaded panel for one frame (a real one-frame glitch the flicker check caught in the calendar),
 * so the settle loop holds the frame until this is true. */
function panelReady(root: HTMLElement, t: number): boolean {
  const id = activeOverlay(t)?.id;
  const count = (sel: string) => root.querySelectorAll(sel).length;
  if (id === "plan") return count(".modal-panel .item-row") >= PLAN_ITEMS.length;
  if (id === "cal") return count(".calendar-day .item-row") >= PLAN_ITEMS.length + (t >= T.cal.added ? 1 : 0);
  if (id === "cards" || id === "weak") return count(".flashcard-box, .flashcards-tab--active, .empty-state-text") > 0 && !root.textContent?.includes("Loading…");
  if (id === "exam") return count(".exam-question") >= EXAM_OPEN.questions.length;
  if (t >= T.home.navClick + 0.2 && t < T.back.sessionClick) return count(".home-weak-area") > 0 && count(".home-widget--due-soon li") > 0;
  return true;
}

/** The Home dashboard is taller than the window; the film scrolls it (a transform on its content, the
 * view being `overflow-y: clip` -- see promo.css) down to the "What to study next" widget, then holds. */
function homeScroll(root: HTMLElement, t: number) {
  const view = root.querySelector<HTMLElement>(".home-view");
  if (!view) return;
  const kids = Array.from(view.children) as HTMLElement[];
  kids.forEach((k) => (k.style.transform = ""));
  const vr = view.getBoundingClientRect();
  const s = view.offsetWidth ? vr.width / view.offsetWidth : 1;
  const bottom = Math.max(0, ...kids.map((k) => (k.getBoundingClientRect().bottom - vr.top) / s));
  const maxScroll = Math.max(0, bottom + 24 - view.clientHeight);
  const weak = view.querySelector<HTMLElement>(".home-widget--weak-areas");
  const target = weak ? Math.min(maxScroll, (weak.getBoundingClientRect().top - vr.top) / s - 28) : maxScroll;
  const y = Math.max(0, target) * easeInOut(clamp01((t - T.home.scrollStart) / (T.home.scrollEnd - T.home.scrollStart)));
  kids.forEach((k) => (k.style.transform = `translateY(${-y}px)`));
}

// ------------------------------------------------------------------ main window
function MainWindow({ t }: { t: number }) {
  const phase = docPhase(t);
  const inDocs = t >= T.navClick + 0.05 && t < T.newChatClick + 0.05;
  const inNewChat = t >= T.newChatClick + 0.05;
  const inHome = t >= T.home.navClick + 0.05 && t < T.back.sessionClick + 0.05;
  const view: MainView = inDocs ? "documents" : inHome ? "home" : "chat";

  const { messages, composerText } = buildChat(t);
  const started = t >= M[0].userAppear;
  const menuOpen = t >= T.plusClick + 0.05 && t < T.menuExistingClick + 0.05;
  const pickerOpen = t >= T.menuExistingClick + 0.05 && t < T.pickerClick + 0.05;
  const sending = t < M[0].sendClick + 0.05;
  const attachments: string[] = [];
  if (sending && t >= T.pickerClick + 0.05) attachments.push(PACKET.doc.filename);
  const typingNow = M.some((m) => t >= m.clickField && t < m.sendClick);
  const followMark = M.find((mk) => t >= mk.revealStart && t < mk.revealEnd + FOLLOW_WINDOW);
  const followContents = followMark ? followSampleTimes(t).map((ts) => assistantContent(followMark.k, ts, followMark)) : [];
  const idle = !messages.length || t < M[0].sendClick;
  const beforeSend = M.every((m) => t < m.sendClick || t >= m.userAppear);
  const caretOn = beforeSend && (idle || typingNow) && Math.floor(t * 2) % 2 === 0 && t > T.composerClick - 0.5;

  const title = inDocs ? "Documents" : inHome ? "Home" : started ? "Midterm 2 study plan" : "New chat";
  const s1: ChatSession = { id: "s1", title: null, status: "active", created_at: "2026-02-03T10:24:00Z" };
  const s0: ChatSession = { id: "s0", title: null, status: "active", created_at: "2026-02-03T10:10:00Z" };
  const sessions: ChatSession[] = inNewChat || inDocs ? [s1, ...OLD_SESSIONS] : [s0, ...OLD_SESSIONS];
  const firstBy: Record<string, string> = { ...OLD_FIRST };
  if (started) firstBy.s1 = typedText(TURNS[0]!.content);
  const activeId = inNewChat || inDocs ? "s1" : "s0";

  // ---- what every endpoint returns right now (see api.ts)
  const ov = activeOverlay(t);
  const reviewed = Array.from({ length: CARD_COUNT }, (_, i) => i).filter((i) => t >= T.cards.rate(i) + 0.12).length;
  const cardRevealed = t >= T.cards.reveal(reviewed) + 0.05;
  const inBrowse = t >= T.cards.browse;
  const graded = t >= T.exam.graded;
  const examAnswered =
    t >= T.exam.fillRest ? EXAM_OPEN.questions.length : Math.max(0, Math.min(ANSWER_SHOWN, Math.floor((t - T.exam.answer(0)) / 0.6) + 1));
  const eventAdded = t >= T.cal.added;
  studyState.docs = PHASE_DOCS[phase];
  studyState.plan = PLAN_ITEMS;
  studyState.dueCards = CARDS.slice(reviewed);
  const nReviewed = t >= T.home.navClick ? REVIEWS.length : CARD_COUNT;
  studyState.allCards = CARDS.map((c) => REVIEWS.slice(0, nReviewed).find((r) => r.id === c.id)?.after ?? c);
  studyState.exams = [graded || t >= T.home.navClick ? GRADED_SUMMARY : EXAM_SUMMARY];
  studyState.examDetail = graded || t >= T.home.navClick ? EXAM_GRADED : EXAM_OPEN;
  studyState.events = eventAdded
    ? [{ id: "ev-new", title: EVENT_TITLE, start_at: new Date(EVENT_START_LOCAL).toISOString(), end_at: null, notes: EVENT_NOTES, created_at: FILM_NOW }]
    : [];

  // ---- how the real panels must be aligned (see alignPanels)
  const typedTitle = typed(EVENT_TITLE, t, T.cal.titleTypeStart, 18);
  align.calForm = ov?.id === "cal" && t >= T.cal.formOpen && !eventAdded;
  align.calTitle = t >= T.cal.titleTypeStart ? typedTitle : "";
  align.calStart = t >= T.cal.startSet ? EVENT_START_LOCAL : "";
  align.cardRevealed = ov?.id === "cards" ? cardRevealed && !inBrowse : ov?.id === "weak" && t >= T.home.scopedOpen + 1.7;
  align.cardsBrowse = ov?.id === "cards" && inBrowse;
  align.examOpen = ov?.id === "exam" && t >= T.exam.opened;
  align.examAnswered = ov?.id === "exam" && !graded ? examAnswered : 0;

  const calKey = eventAdded ? "cal-added" : t >= T.cal.formOpen ? "cal-form" : "cal-agenda";
  const cardKey = inBrowse ? "browse" : `c${reviewed}${cardRevealed ? "r" : "q"}`;
  const examKey = graded ? "graded" : `open-${examAnswered}`;

  const overlayIn = ov ? easeOut(prog(t, ov.open, 0.28)) : 0;
  const overlayOut = ov ? easeInOut(prog(t, ov.close, FADE_OUT)) : 0;

  return (
    <div className="app-root">
      <TitleBar title={title} />
      <div className="app-shell">
        <Sidebar
          sessions={sessions}
          activeSessionId={inDocs || inHome ? null : activeId}
          firstMessageBySession={firstBy}
          onSelectSession={() => {}}
          onNewChat={() => {}}
          onDeleteSession={() => {}}
          creatingChat={false}
          username={STUDENT}
          onSignOut={() => {}}
          onOpenHome={() => {}}
          onOpenDocuments={() => {}}
          onOpenStudyPlan={() => {}}
          onOpenCalendar={() => {}}
          onOpenFlashcards={() => {}}
          onOpenPracticeExams={() => {}}
          onOpenSettings={() => {}}
          onOpenHelp={() => {}}
          mainView={view}
        />
        <main className="main-pane">
          <header className="main-header">
            <h1 className="main-header-title">{title}</h1>
            {view === "chat" && (
              <span className="main-header-status">
                <span className="live-dot live-dot--open" aria-hidden="true" />
                Live
              </span>
            )}
          </header>
          {inDocs ? (
            <DocsView phase={phase} />
          ) : inHome ? (
            <HomeView
              key="home"
              token="promo"
              userId="promo-user"
              sessions={[s1, ...OLD_SESSIONS]}
              firstMessageBySession={{ ...OLD_FIRST, s1: typedText(TURNS[0]!.content) }}
              onSelectSession={() => {}}
              onNewChat={() => {}}
              creatingChat={false}
              onOpenDocument={() => {}}
              onOpenDocuments={() => {}}
              onOpenStudyPlan={() => {}}
              onOpenFlashcards={() => {}}
              onOpenPracticeExams={() => {}}
            />
          ) : (
            <div className="chat-split">
              <div className="chat-split__chat">
                <ChatPane
                  messages={messages}
                  loading={false}
                  loadError={null}
                  token="promo"
                  sessionId={activeId}
                  onOpenSuggestedPanel={() => {}}
                  onOpenDocument={() => {}}
                  onSend={() => {}}
                />
                <FollowProbes contents={followContents} />
                <div className="math-keyboard-dock" />
                <ScriptedComposer
                  text={composerText}
                  caretOn={caretOn}
                  placeholder="Ask Newton anything…"
                  learnMode={false}
                  menuOpen={menuOpen}
                  pickerOpen={pickerOpen}
                  pickerDocs={PICKER_DOCS}
                  attachments={attachments}
                />
              </div>
            </div>
          )}
        </main>
      </div>

      {/* The real panels, exactly as the app mounts them (modal overlays over the window). The
          wrapper is only the film's own fade; it is also what makes the overlay's `position: fixed`
          fill this window rather than the whole stage. */}
      {ov && (
        <div
          className="promo-overlay"
          style={{
            opacity: overlayIn * (1 - overlayOut),
            transform: `translateY(${(1 - overlayIn) * 14}px) scale(${0.985 + 0.015 * overlayIn})`,
          }}
        >
          {ov.id === "plan" && <StudyPlanPanel key="plan" token="promo" onClose={() => {}} />}
          {ov.id === "cal" && <CalendarPanel key={calKey} token="promo" onClose={() => {}} />}
          {ov.id === "cards" && <FlashcardsPanel key={cardKey} getAccessToken={async () => "promo"} onClose={() => {}} />}
          {ov.id === "exam" && <PracticeExamsPanel key={examKey} token="promo" onClose={() => {}} initialExamId={EXAM_OPEN.id} />}
          {ov.id === "weak" && (
            <FlashcardsPanel
              key={`weak-${align.cardRevealed ? "r" : "q"}`}
              getAccessToken={async () => "promo"}
              onClose={() => {}}
              initialCardIds={WEAK[0]?.weak_flashcard_ids ?? []}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ composition
export const StudyFilm: React.FC = () => {
  activeFilm.id = "study";
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const rootRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const rippleRef = useRef<HTMLDivElement>(null);
  const placeRef = useRef<() => void>(() => {});
  const assetRef = useRef<number | null>(null);
  if (assetRef.current === null) assetRef.current = delayRender("fonts");
  const assetHandle = assetRef.current;

  useEffect(() => {
    const fonts = [
      "400 16px 'Public Sans'",
      "500 16px 'Public Sans'",
      "600 16px 'Public Sans'",
      "700 16px 'Public Sans'",
      "600 16px 'Fraunces Variable'",
      "italic 500 16px 'Fraunces Variable'",
      "400 16px 'Fraunces Variable'",
      "16px KaTeX_Main",
      "italic 16px KaTeX_Math",
    ].map((f) => document.fonts.load(f, "Aa1(∑"));
    Promise.all(fonts)
      .then(() => document.fonts.ready)
      .catch(() => {})
      .finally(() => continueRender(assetHandle));
  }, [assetHandle]);

  // The per-frame "settle" handle must exist before the frame paints (see ResearchFilm).
  const settleHandle = useRef<{ frame: number; handle: number } | null>(null);
  if (!settleHandle.current || settleHandle.current.frame !== frame) {
    settleHandle.current = { frame, handle: delayRender(`settle @${frame}`) };
  }

  useEffect(() => {
    const handle = settleHandle.current!.handle;
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        continueRender(handle);
      }
    };
    const height = () =>
      Array.from(document.querySelectorAll<HTMLElement>(".chat-pane, .doc-detail-body, .modal-panel, .home-view"))
        .map((el) => `${el.scrollHeight}@${el.style.transform}@${(el.querySelector(".message-list") as HTMLElement | null)?.style.transform ?? ""}@${Array.from(el.children).map((c) => (c as HTMLElement).style.transform).join("|")}`)
        .join(",");
    let iterations = 0;
    let last = "";
    let stable = 0;
    let timer = 0;
    const poll = () => {
      iterations++;
      placeRef.current();
      const h = height();
      const ready = !rootRef.current || panelReady(rootRef.current, t);
      stable = h === last && ready ? stable + 1 : 0;
      last = h;
      if (stable >= 8 || iterations > 90) return finish();
      timer = window.setTimeout(poll, 60);
    };
    timer = window.setTimeout(poll, 60);
    return () => {
      window.clearTimeout(timer);
      finish();
    };
  }, [frame]);

  useLayoutEffect(() => {
    const place = () => {
      const root = rootRef.current;
      const cur = cursorRef.current;
      const rip = rippleRef.current;
      if (!root || !cur || !rip) return;

      alignPanels(root);
      pinChatToBottom(root);
      panelScroll(root, t, activeOverlay(t)?.id ?? null);
      homeScroll(root, t);

      const p = cursorAt(root, t, CURSOR, customTarget);
      cur.style.transform = `translate(${p.x - 4}px, ${p.y - 2}px)`;
      cur.style.opacity = String(clamp01((t - (T.cursorIn - 0.3)) / 0.3) * (t > T.outroStart ? 0 : 1));
      let ripple = 0;
      for (const c of CLICKS) {
        const d = t - c.t;
        if (d >= 0 && d < 0.5) ripple = d / 0.5;
        if (PRESSABLE.has(c.target)) {
          const el = elementFor(root, c.target);
          if (el) el.classList.toggle("promo-pressed", d >= 0 && d < 0.16);
        }
      }
      rip.style.transform = `translate(${p.x}px, ${p.y}px) scale(${0.3 + ripple * 1.5})`;
      rip.style.opacity = ripple > 0 ? String(0.9 * (1 - ripple)) : "0";
    };
    placeRef.current = place;
    place();
  });

  const winIn = easeOut(prog(t, T.windowIn, 0.9));
  const outroP = easeInOut(prog(t, T.outroStart, 0.8));
  const mainScale = MAIN.scale * (0.94 + 0.06 * winIn) * (1 - 0.05 * outroP);
  const mainOpacity = winIn * (1 - outroP);
  const captionOpacity = (from: number, to: number) => easeOut(prog(t, from, 0.35)) * (1 - easeOut(prog(t, to - 0.35, 0.35)));
  const introOpacity = easeOut(prog(t, 0.25, 0.7)) * (1 - easeInOut(prog(t, 1.25, 0.6)));
  const outroOpacity = easeOut(prog(t, T.outroStart + 0.9, 0.7)) * (1 - easeInOut(prog(t, T.total - 0.55, 0.5)));

  return (
    <div
      className="promo-study"
      style={{ width: 1920, height: 1080, position: "relative", overflow: "hidden", "--promo-spin": `${(t * 720) % 360}deg` } as React.CSSProperties}
    >
      <div
        ref={rootRef}
        style={{ position: "absolute", inset: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: cameraTransform(t, Z, FX, FY) }}
      >
        <div style={{ position: "absolute", inset: 0, background: WALLPAPER }} />
        <div
          className="promo-win"
          style={{ left: MAIN.left, top: MAIN.top, width: MAIN.w, height: MAIN.h, transform: `scale(${mainScale})`, opacity: mainOpacity }}
        >
          <MainWindow t={t} />
        </div>
        <div ref={rippleRef} className="promo-ripple" />
        <div ref={cursorRef} className="promo-cursor">
          <CursorArrow />
        </div>
      </div>

      {CAPTIONS.map((c) => (
        <Caption key={c.text} opacity={captionOpacity(c.from, c.to) * (1 - outroP)}>
          {c.text}
        </Caption>
      ))}

      <div className="promo-center" style={{ opacity: introOpacity, pointerEvents: "none" }}>
        <NewtonMark size={96} />
        <div className="promo-wordmark">Newton</div>
        <div className="promo-tagline">Your whole study plan, in one request</div>
      </div>
      <div className="promo-center" style={{ opacity: outroOpacity, pointerEvents: "none" }}>
        <NewtonMark size={96} />
        <div className="promo-wordmark">Newton</div>
        <div className="promo-tagline">Plan it. Practice it. Know what's next.</div>
      </div>
    </div>
  );
};
