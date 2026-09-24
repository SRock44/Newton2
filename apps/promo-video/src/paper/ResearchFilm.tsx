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
import { continueRender, delayRender, staticFile, useCurrentFrame } from "remotion";
import TitleBar from "../../../desktop/src/components/TitleBar";
import Sidebar from "../../../desktop/src/components/Sidebar";
import ChatPane from "../../../desktop/src/components/ChatPane";
import DocumentsPanel from "../../../desktop/src/components/DocumentsPanel";
import DocumentViewerPanel from "../../../desktop/src/components/DocumentViewerPanel";
import NewtonMark from "../../../desktop/src/components/NewtonMark";
import type { ChatMessage, ChatSession, MainView, ToolActivityEntry } from "../../../desktop/src/types";
import { clamp01, easeInOut, easeOut, FPS, lerp, measure, prog, typed } from "../anim";
import { cameraTransform, cursorAt, findTarget, installFrozenTime, WALLPAPER, type Pt } from "../engine";
import { Caption, CursorArrow, ScriptedComposer } from "../ui";
import { activeFilm } from "../filmId";
import "./api";
import { filmState, type FilmDoc } from "./api";
import {
  APPROVE_TEXT,
  NOTES,
  OLD_DOCS,
  PAPER_PDF,
  PAPER_REUPLOAD,
  PAPER_TEX,
  STUDENT,
  SYNOPSIS,
  TURNS,
  safePrefix,
  typedText,
} from "./data";
import { CAPTIONS, CLICKS, CURSOR, FX, FY, Z } from "./script";
import { REVEAL_CPS, T, TYPE_CPS, type TurnMark } from "./timeline";

installFrozenTime("2026-02-03T10:24:00");

const MAIN = { left: 190, top: 30, w: 1400, h: 860, scale: 1.1 };
const M = T.marks;
const RA = T.reviewAttach;
const RP = T.reviewPanel;
// A short, plain-ASCII fragment of REVIEW_QUOTE for finding it inside pdf.js's rendered text
// layer -- see highlightRects() below. Deliberately shorter than the whole sentence: pdf.js
// splits a line into several <span>s, and the concatenated-text search this does is safest on a
// short run unlikely to straddle the exact character where the PDF's own kerning/hyphenation
// splits one span from the next.
const REVIEW_HIGHLIGHT_SNIPPET = "The SOR prediction is less satisfactory: the measured count exceeds the asymptotic prediction by";

const asDoc = (d: { id: string; filename: string; mime_type: string; created_at: string; has_bibliography?: boolean }): FilmDoc => d;
const OLD_FILM_DOCS: FilmDoc[] = OLD_DOCS.map(asDoc);
const NEW = (d: { doc: Parameters<typeof asDoc>[0] }, at: string): FilmDoc => ({ ...asDoc(d.doc), created_at: at });
const notesDoc = NEW(NOTES, "2026-02-03T10:20:00Z");
const synopsisDoc = NEW(SYNOPSIS, "2026-02-03T10:21:00Z");
// The finished PDF, re-uploaded after it was written (see paper/capture.py's stage_review) so
// the student can attach and discuss it -- a real, separate Document row, not the one
// write_research_paper made (that one only lives for the duration of one capture run).
const paperReuploadDoc = { ...asDoc(PAPER_REUPLOAD), created_at: "2026-02-03T10:42:00Z" };

const pickerEntry = (d: FilmDoc) => ({ name: d.filename, date: new Date(d.created_at).toLocaleDateString() });
/** Before the paper exists: attaching the synopsis (then the lab notes) to plan it. */
const PICKER_DOCS = [synopsisDoc, notesDoc, ...OLD_FILM_DOCS].map(pickerEntry);
/** After it's written: the finished PDF is newest, so it's first -- attaching it to discuss it. */
const PICKER_DOCS_LATE = [paperReuploadDoc, synopsisDoc, notesDoc, ...OLD_FILM_DOCS].map(pickerEntry);

const OLD_SESSIONS: ChatSession[] = [
  { id: "s2", title: null, status: "active", created_at: "2026-02-02T09:00:00Z" },
  { id: "s3", title: null, status: "active", created_at: "2026-01-30T18:00:00Z" },
];
const OLD_FIRST: Record<string, string> = {
  s2: "Why does red-black ordering keep the SOR spectral radius?",
  s3: "Summarize Young's consistently-ordered matrices",
};

// ------------------------------------------------------------------ custom cursor targets
function customTarget(root: HTMLElement, name: string): Pt | null | undefined {
  const rect = (el: Element | null) => (el ? measure(el, root) : null);
  const last = (sel: string) => {
    const all = root.querySelectorAll(sel);
    return rect(all[all.length - 1] ?? null);
  };
  const center = (r: ReturnType<typeof rect>) => (r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null);
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
    case "plan-changes":
      return center(last(".paper-plan-card__actions .btn-secondary"));
    case "plan-approve":
      return center(last(".paper-plan-card__actions .btn-primary"));
    case "doc-download": {
      const btn = Array.from(root.querySelectorAll(".doc-detail-actions button")).find((b) => b.textContent?.trim() === "Download");
      return center(rect(btn ?? null));
    }
    // The attachment chip on the message that just attached the finished PDF — the LAST one in
    // the conversation (turn 0's own two chips, from the synopsis/notes attach, come first).
    case "doc-chip":
      return center(last(".attached-document-chip"));
  }
  return undefined;
}

function elementFor(root: HTMLElement, name: string): Element | null {
  const lastOf = (sel: string) => {
    const all = root.querySelectorAll(sel);
    return all[all.length - 1] ?? null;
  };
  switch (name) {
    case "upload-btn":
      return root.querySelector(".documents-page-toolbar-actions .btn-primary");
    case "plan-changes":
      return lastOf(".paper-plan-card__actions .btn-secondary");
    case "plan-approve":
      return lastOf(".paper-plan-card__actions .btn-primary");
    case "doc-download":
      return Array.from(root.querySelectorAll(".doc-detail-actions button")).find((b) => b.textContent?.trim() === "Download") ?? null;
    case "doc-chip":
      return lastOf(".attached-document-chip");
    case "doc-card":
    case "doc-detail":
      return null;
  }
  // "doc-ask" falls through to here: the film's own scripted toolbar button already carries a
  // matching data-promo attribute (see ResearchFilm's JSX), which this resolves directly.
  return findTarget(root, name);
}
const PRESSABLE = new Set([
  "send", "newchat", "nav-documents", "upload-btn", "menu-existing", "picker-deck", "picker-1", "plus",
  "plan-changes", "plan-approve", "doc-download", "doc-chip", "doc-ask",
]);

// ------------------------------------------------------------------ chat content from time
function userContent(k: number): string {
  return k === 2 ? APPROVE_TEXT : TURNS[2 * k].content;
}

function assistantContent(k: number, t: number, m: TurnMark): string {
  const full = TURNS[2 * k + 1].content;
  if (t < m.revealStart) return "";
  return safePrefix(full, Math.max(1, Math.floor((t - m.revealStart) * REVEAL_CPS)));
}

function buildChat(t: number) {
  const messages: ChatMessage[] = [];
  let composerText = "";
  M.forEach((m, k) => {
    if (t >= m.userAppear) {
      messages.push({ id: `u${k}`, role: "user", content: userContent(k), created_at: "2026-02-03T10:24:00Z" });
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
    if (m.kind === "composer" && m.typed !== undefined && t >= m.clickField! && t < m.sendClick) {
      composerText = typed(m.typed, t, m.typeStart!, TYPE_CPS);
    }
  });
  return { messages, composerText };
}

// ------------------------------------------------------------------ documents phases
type DocPhase = "A" | "B" | "C" | "D" | "E";
function docPhase(t: number): DocPhase {
  if (t < T.up1Click + 0.1) return "A";
  if (t < T.up1Done) return "B";
  if (t < T.up2Click + 0.1) return "C";
  if (t < T.up2Done) return "D";
  return "E";
}
const PHASE_DOCS: Record<DocPhase, FilmDoc[]> = {
  A: OLD_FILM_DOCS,
  B: OLD_FILM_DOCS,
  C: [notesDoc, ...OLD_FILM_DOCS],
  D: [notesDoc, ...OLD_FILM_DOCS],
  E: [synopsisDoc, notesDoc, ...OLD_FILM_DOCS],
};
const PHASE_SELECTED: Partial<Record<DocPhase, string>> = { C: notesDoc.id, E: synopsisDoc.id };

/** The REAL Documents page. Remounted per phase so each phase is a pure function of time: the API
 * mock serves that phase's list, and for an "uploading" phase a real file is chosen so the page
 * sits on its own "Uploading…" state. */
function DocsView({ phase }: { phase: DocPhase }) {
  useEffect(() => {
    if (phase !== "B" && phase !== "D") return;
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
        const doc = phase === "B" ? NOTES.doc : SYNOPSIS.doc;
        const dt = new DataTransfer();
        dt.items.add(new File(["x"], doc.filename, { type: doc.mime_type }));
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
      initialSelectedDocumentId={PHASE_SELECTED[phase] ?? null}
    />
  );
}

// ------------------------------------------------------------------ main window
function MainWindow({ t }: { t: number }) {
  const phase = docPhase(t);
  const inDocs = t >= T.navClick + 0.05 && t < T.newChatClick + 0.05;
  const inNewChat = t >= T.newChatClick + 0.05;
  const view: MainView = inDocs ? "documents" : "chat";
  const docOpen = t >= RP.chipClick + 0.1 && t < T.viewerOut;

  const { messages, composerText } = buildChat(t);
  const started = t >= M[0].userAppear;
  const menuOpen =
    (t >= T.plusClick + 0.05 && t < T.menuExistingClick + 0.05) ||
    (t >= T.plus2Click + 0.05 && t < T.menuExisting2Click + 0.05) ||
    (t >= RA.plusClick + 0.05 && t < RA.menuExistingClick + 0.05);
  const pickerOpen =
    (t >= T.menuExistingClick + 0.05 && t < T.pickerClick + 0.05) ||
    (t >= T.menuExisting2Click + 0.05 && t < T.picker2Click + 0.05) ||
    (t >= RA.menuExistingClick + 0.05 && t < RA.pickerClick + 0.05);
  const pickerDocs = t < RA.plusClick ? PICKER_DOCS : PICKER_DOCS_LATE;
  const sending = t < M[0].sendClick + 0.05;
  const reviewSending = t >= RA.plusClick && t < M[3].sendClick + 0.05;
  const attachments: string[] = [];
  if (sending && t >= T.pickerClick + 0.05) attachments.push(SYNOPSIS.doc.filename);
  if (sending && t >= T.picker2Click + 0.05) attachments.push(NOTES.doc.filename);
  if (reviewSending && t >= RA.pickerClick + 0.05) attachments.push(paperReuploadDoc.filename);
  const typingNow = M.some((m) => m.kind === "composer" && t >= m.clickField! && t < m.sendClick);
  const idle = !messages.length || t < M[1].sendClick;
  const beforeSend = M.every((m) => t < m.sendClick || t >= m.userAppear);
  const caretOn = beforeSend && (idle || typingNow) && Math.floor(t * 2) % 2 === 0 && t > T.composerClick - 0.5;

  const title = inDocs ? "Documents" : started ? "arXiv paper" : "New chat";
  const s1: ChatSession = { id: "s1", title: null, status: "active", created_at: "2026-02-03T10:24:00Z" };
  const s0: ChatSession = { id: "s0", title: null, status: "active", created_at: "2026-02-03T10:10:00Z" };
  const sessions: ChatSession[] = inNewChat || inDocs ? [s1, ...OLD_SESSIONS] : [s0, ...OLD_SESSIONS];
  const first: Record<string, string> = { ...OLD_FIRST };
  if (started) first.s1 = typedText(TURNS[0].content);
  const activeId = inNewChat || inDocs ? "s1" : "s0";

  filmState.docs = PHASE_DOCS[phase];

  return (
    <div className="app-root">
      <TitleBar title={title} />
      <div className="app-shell">
        <Sidebar
          sessions={sessions}
          activeSessionId={inDocs ? null : activeId}
          firstMessageBySession={first}
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
                <div className="math-keyboard-dock" />
                <ScriptedComposer
                  text={composerText}
                  caretOn={caretOn}
                  placeholder="Ask Newton anything…"
                  learnMode={false}
                  menuOpen={menuOpen}
                  pickerOpen={pickerOpen}
                  pickerDocs={pickerDocs}
                  attachments={attachments}
                />
              </div>
              {/* The real DocumentViewerPanel — opened from the attachment chip on the message
                  that just attached the finished PDF, split with the chat exactly like the real
                  app now does. pdf.js renders the real bytes (public/research-paper.pdf); the
                  highlight and its toolbar are drawn by the film (see PdfHighlight below), not
                  the panel's own internal selection state, so their look is directed rather than
                  left to wherever a real browser selection happens to land. */}
              {docOpen && (
                <DocumentViewerPanel
                  token="promo"
                  documentId={paperReuploadDoc.id}
                  initialFilename={paperReuploadDoc.filename}
                  onClose={() => {}}
                  onAskAboutSelection={() => {}}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the highlighted sentence
/** Every real, positioned run of text pdf.js drew (see DocumentViewerPanel.tsx's PdfPage) that
 * overlaps `needle`, found by searching the container's ENTIRE text-layer content as one
 * concatenated string — a single `<span>` per page is usually one short run, not a whole
 * sentence, so a plain "find the node containing this text" search (fine for the Notepad's own
 * highlight, see show/ShowFilm.tsx's textRect) would not find anything here at all. One rect per
 * overlapping span is exactly how a real, wrapped text selection would render, too. */
function findSpanElements(container: HTMLElement, needle: string): HTMLElement[] {
  const spans = Array.from(container.querySelectorAll<HTMLElement>(".textLayer span"));
  let acc = "";
  const bounds: { el: HTMLElement; start: number; end: number }[] = [];
  for (const el of spans) {
    const text = el.textContent ?? "";
    bounds.push({ el, start: acc.length, end: acc.length + text.length });
    acc += text;
  }
  const idx = acc.indexOf(needle);
  if (idx < 0) return [];
  const end = idx + needle.length;
  return bounds.filter((b) => b.start < end && b.end > idx).map((b) => b.el);
}

// ------------------------------------------------------------------ composition
export const ResearchFilm: React.FC = () => {
  activeFilm.id = "paper";
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const rootRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const rippleRef = useRef<HTMLDivElement>(null);
  const highlightBoxRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
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
    ].map((f) => document.fonts.load(f, "Aa1(∑"));
    // Warms the browser cache for the real PDF DocumentViewerPanel is about to fetch (through
    // the mocked /raw route, see api.ts) — not required for correctness (that fetch has its own
    // delayRender), just avoids paying its latency twice.
    const pdf = fetch(staticFile("research-paper.pdf")).catch(() => {});
    Promise.all([...fonts, pdf])
      .then(() => document.fonts.ready)
      .catch(() => {})
      .finally(() => continueRender(assetHandle));
  }, [assetHandle]);

  // The per-frame "settle" handle must exist before the frame paints — a handle opened only in
  // an effect can lose the race with the renderer's screenshot — so open it during render.
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
    // scrollTop alongside scrollHeight: a chat pane pinned to the bottom can have its height
    // stabilize a poll BEFORE place()'s own scrollTo has actually landed there (a real, observed
    // one-frame flicker — the previous scroll position briefly reappears) — this makes "settled"
    // require the actual on-screen position to have stopped moving too, not just its ceiling.
    const height = () =>
      Array.from(document.querySelectorAll<HTMLElement>(".chat-pane, .doc-detail-body, .doc-viewer-panel__body"))
        .map((el) => `${el.scrollHeight}@${el.scrollTop}`)
        .join(",");
    let iterations = 0;
    let last = "";
    let stable = 0;
    let timer = 0;
    const poll = () => {
      iterations++;
      placeRef.current();
      const h = height();
      stable = h === last ? stable + 1 : 0;
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
      const hlBox = highlightBoxRef.current;
      const toolbar = toolbarRef.current;
      if (!root || !cur || !rip || !hlBox || !toolbar) return;

      // The chat stays pinned to the bottom (instant, not the app's smooth scroll) — except while
      // it pans across a freshly written plan card, from the card's top to its buttons.
      root.querySelectorAll<HTMLElement>(".chat-pane").forEach((el) => {
        const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
        let top = el.scrollHeight;
        const m = M.find((mk) => mk.planPan && t >= mk.planPan.from && t < mk.planPan.to);
        const cards = el.querySelectorAll<HTMLElement>(".paper-plan-card");
        if (m && cards.length) {
          const card = cards[cards.length - 1];
          const pr = el.getBoundingClientRect();
          const s = el.offsetWidth ? pr.width / el.offsetWidth : 1;
          const cardTop = (card.getBoundingClientRect().top - pr.top) / s + el.scrollTop - 10;
          const f = easeInOut(clamp01((t - m.planPan!.from) / (m.planPan!.to - m.planPan!.from)));
          top = lerp(Math.min(cardTop, maxTop), maxTop, f);
        }
        el.scrollTo({ top, behavior: "instant" });
      });

      // The highlighted sentence in the real, pdf.js-rendered PDF, and the toolbar over it —
      // both directed by the film (see findSpanElements above), not the panel's own real
      // selection state. Scrolled into a nice reading position first, since the sentence sits
      // near the bottom of page 1 and the panel opens on page 1's top.
      hlBox.replaceChildren();
      toolbar.style.opacity = "0";
      const panelBody = root.querySelector<HTMLElement>(".doc-viewer-panel__body");
      if (panelBody && t >= RP.highlightStart - 0.4) {
        let els = findSpanElements(panelBody, REVIEW_HIGHLIGHT_SNIPPET);
        if (els.length) {
          const first = measure(els[0], panelBody);
          panelBody.scrollTop = Math.max(0, first.top + panelBody.scrollTop - panelBody.clientHeight * 0.4);
          els = findSpanElements(panelBody, REVIEW_HIGHLIGHT_SNIPPET); // re-measure after the scroll
        }
        if (els.length && t >= RP.highlightStart) {
          const sweep = easeOut(clamp01((t - RP.highlightStart) / RP.highlightDur));
          let top = Infinity;
          let left = Infinity;
          for (const el of els) {
            const r = measure(el, root);
            const box = document.createElement("div");
            box.className = "promo-doc-highlight";
            box.style.left = `${r.left + 1}px`;
            box.style.top = `${r.top}px`;
            box.style.width = `${Math.max(0, r.width - 2) * sweep}px`;
            box.style.height = `${r.height}px`;
            hlBox.appendChild(box);
            top = Math.min(top, r.top);
            left = Math.min(left, r.left);
          }
          if (t >= RP.toolbarIn) {
            toolbar.style.left = `${Math.max(left, 4)}px`;
            toolbar.style.top = `${Math.max(top - 44, 4)}px`;
            toolbar.style.opacity = String(easeOut(clamp01((t - RP.toolbarIn) / 0.25)));
          }
        }
      }

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
  const captionOpacity = (from: number, to: number) =>
    easeOut(prog(t, from, 0.35)) * (1 - easeOut(prog(t, to - 0.35, 0.35)));
  const introOpacity = easeOut(prog(t, 0.25, 0.7)) * (1 - easeInOut(prog(t, 1.25, 0.6)));
  const outroOpacity = easeOut(prog(t, T.outroStart + 0.9, 0.7)) * (1 - easeInOut(prog(t, T.total - 0.55, 0.5)));

  return (
    <div
      style={
        {
          width: 1920,
          height: 1080,
          position: "relative",
          overflow: "hidden",
          "--promo-spin": `${(frame * 24) % 360}deg`,
        } as React.CSSProperties
      }
    >
      <div
        ref={rootRef}
        style={{ position: "absolute", inset: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: cameraTransform(t, Z, FX, FY) }}
      >
        <div style={{ position: "absolute", inset: 0, background: WALLPAPER }} />
        <div
          className="promo-win"
          style={{
            left: MAIN.left,
            top: MAIN.top,
            width: MAIN.w,
            height: MAIN.h,
            transform: `scale(${mainScale})`,
            opacity: mainOpacity,
          }}
        >
          <MainWindow t={t} />
        </div>
        {/* the highlighted sentence in the real PDF, and its toolbar — see findSpanElements
            above; belongs to the main window, so it fades with it (never outlives it) */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 15, opacity: mainOpacity }}>
          <div ref={highlightBoxRef} style={{ position: "absolute", inset: 0 }} />
          <div ref={toolbarRef} className="notepad-window__selection-toolbar doc-annotate-toolbar" style={{ position: "absolute", opacity: 0 }}>
            <button type="button" tabIndex={-1}>
              Explain
            </button>
            <button type="button" tabIndex={-1}>
              Define
            </button>
            <button type="button" tabIndex={-1}>
              Summarize
            </button>
            <button type="button" tabIndex={-1} data-promo="doc-ask">
              Ask Newton
            </button>
          </div>
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
        <div className="promo-tagline">From first lessons to research papers</div>
      </div>
      <div className="promo-center" style={{ opacity: outroOpacity, pointerEvents: "none" }}>
        <NewtonMark size={96} />
        <div className="promo-wordmark">Newton</div>
        <div className="promo-tagline">Every level. Your work, done properly.</div>
      </div>
    </div>
  );
};
