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
import NewtonMark from "../../../desktop/src/components/NewtonMark";
import type { ChatMessage, ChatSession, MainView, ToolActivityEntry } from "../../../desktop/src/types";
import { clamp01, easeInOut, easeOut, FPS, lerp, measure, prog, track, typed, type Keyframe } from "../anim";
import { cameraTransform, cursorAt, findTarget, installFrozenTime, WALLPAPER, type Pt } from "../engine";
import { Caption, CursorArrow, ScriptedComposer } from "../ui";
import { activeFilm } from "../filmId";
import "./api";
import { filmState, type FilmDoc } from "./api";
import {
  APPROVE_TEXT,
  NOTES,
  OLD_DOCS,
  PAPER_PAGES,
  PAPER_PDF,
  PAPER_TEX,
  STUDENT,
  SYNOPSIS,
  TURNS,
  paperPage,
  safePrefix,
  typedText,
} from "./data";
import { CAPTIONS, CLICKS, CURSOR, FX, FY, Z } from "./script";
import { REVEAL_CPS, T, TYPE_CPS, VIEWER_MOVE, viewerStops, type TurnMark } from "./timeline";

installFrozenTime("2026-02-03T10:24:00");

const MAIN = { left: 190, top: 30, w: 1400, h: 860, scale: 1.1 };
const M = T.marks;
const P = T.paper;

const asDoc = (d: { id: string; filename: string; mime_type: string; created_at: string; has_bibliography?: boolean }): FilmDoc => d;
const OLD_FILM_DOCS: FilmDoc[] = OLD_DOCS.map(asDoc);
const NEW = (d: { doc: Parameters<typeof asDoc>[0] }, at: string): FilmDoc => ({ ...asDoc(d.doc), created_at: at });
const notesDoc = NEW(NOTES, "2026-02-03T10:20:00Z");
const synopsisDoc = NEW(SYNOPSIS, "2026-02-03T10:21:00Z");
const pdfDoc = NEW(PAPER_PDF, "2026-02-03T10:40:00Z");
const texDoc = NEW(PAPER_TEX, "2026-02-03T10:40:00Z");

const PICKER_DOCS = [synopsisDoc, notesDoc, ...OLD_FILM_DOCS].map((d) => ({
  name: d.filename,
  date: new Date(d.created_at).toLocaleDateString(),
}));

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
    case "doc-card":
    case "doc-detail":
      return null;
  }
  return findTarget(root, name);
}
const PRESSABLE = new Set([
  "send", "newchat", "nav-documents", "upload-btn", "menu-existing", "picker-deck", "picker-1", "plus",
  "plan-changes", "plan-approve", "doc-download",
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
type DocPhase = "A" | "B" | "C" | "D" | "E" | "F";
function docPhase(t: number): DocPhase {
  if (t >= P.nav2Click) return "F";
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
  F: [pdfDoc, texDoc, synopsisDoc, notesDoc, ...OLD_FILM_DOCS],
};
const PHASE_SELECTED: Partial<Record<DocPhase, string>> = { C: notesDoc.id, E: synopsisDoc.id, F: pdfDoc.id };

/** The REAL Documents page. Remounted per phase so each phase is a pure function of time: the API
 * mock serves that phase's list, and for an "uploading" phase a real file is chosen so the page
 * sits on its own "Uploading…" state. */
function DocsView({ phase }: { phase: DocPhase }) {
  useEffect(() => {
    if (phase !== "F") return;
    // The panel only offers a PDF's embedded viewer when the document is picked from the loaded
    // list, so pick it the way a user does: click the first card once it has rendered.
    const handle = delayRender("documents: open the paper");
    let done = false;
    let steps = 0;
    const finish = () => {
      if (!done) {
        done = true;
        continueRender(handle);
      }
    };
    const step = () => {
      const card = document.querySelector<HTMLElement>(".doc-entry .recent-item-card");
      if (card) {
        card.click();
        return window.setTimeout(finish, 60);
      }
      if (++steps > 100) return finish();
      window.setTimeout(step, 40);
    };
    step();
    return finish;
  }, [phase]);

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
      initialSelectedDocumentId={phase === "F" ? null : (PHASE_SELECTED[phase] ?? null)}
    />
  );
}

// ------------------------------------------------------------------ main window
function MainWindow({ t }: { t: number }) {
  const phase = docPhase(t);
  const inDocs = (t >= T.navClick + 0.05 && t < T.newChatClick + 0.05) || t >= P.nav2Click + 0.05;
  const inNewChat = t >= T.newChatClick + 0.05;
  const view: MainView = inDocs ? "documents" : "chat";

  const { messages, composerText } = buildChat(t);
  const started = t >= M[0].userAppear;
  const menuOpen =
    (t >= T.plusClick + 0.05 && t < T.menuExistingClick + 0.05) ||
    (t >= T.plus2Click + 0.05 && t < T.menuExisting2Click + 0.05);
  const pickerOpen =
    (t >= T.menuExistingClick + 0.05 && t < T.pickerClick + 0.05) ||
    (t >= T.menuExisting2Click + 0.05 && t < T.picker2Click + 0.05);
  const sending = t < M[0].sendClick + 0.05;
  const attachments: string[] = [];
  if (sending && t >= T.pickerClick + 0.05) attachments.push(SYNOPSIS.doc.filename);
  if (sending && t >= T.picker2Click + 0.05) attachments.push(NOTES.doc.filename);
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
            <>
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
                pickerDocs={PICKER_DOCS}
                attachments={attachments}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the PDF viewer
const VIEWER = { left: 496, top: 26, w: 760, h: 840, scale: 1.22 };
const PAGE_W = 690; // layout units; the real page images are scaled to this
const PAGE_H = Math.round(PAGE_W * (1650 / 1275));
const PAGE_GAP = 14;
const PAGE_STEP = PAGE_H + PAGE_GAP;

/** The scroll offset (layout units) at time t: hold on each stop, ease to the next. */
function viewerScroll(t: number): number {
  const kfs: Keyframe<number>[] = [];
  viewerStops.forEach((s, i) => {
    const y = (s.page - 1) * PAGE_STEP;
    if (i === 0) kfs.push({ t: 0, v: y });
    kfs.push({ t: s.from, v: y });
    kfs.push({ t: s.from + s.hold, v: y });
  });
  return track(kfs, t);
}

/** An operating-system PDF viewer showing the paper Newton compiled — the real PDF's pages. */
function PdfViewer({ t }: { t: number }) {
  const y = viewerScroll(t);
  const page = Math.min(PAGE_PAGES, Math.max(1, Math.round(y / PAGE_STEP) + 1));
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#3a3d41", fontFamily: "var(--font-sans)" }}>
      <div style={{ height: 40, background: "#25272a", display: "flex", alignItems: "center", gap: 8, padding: "0 14px", color: "#d9dbde", fontSize: 13 }}>
        <span style={{ width: 12, height: 12, borderRadius: 6, background: "#ff5f57" }} />
        <span style={{ width: 12, height: 12, borderRadius: 6, background: "#febc2e" }} />
        <span style={{ width: 12, height: 12, borderRadius: 6, background: "#28c840" }} />
        <span style={{ marginLeft: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{PAPER_PDF.doc.filename}</span>
      </div>
      <div style={{ height: 32, background: "#303235", color: "#c9ccd0", fontSize: 12.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 18 }}>
        <span>
          Page {page} of {PAGE_PAGES}
        </span>
        <span style={{ opacity: 0.7 }}>100%</span>
      </div>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: (VIEWER.w - PAGE_W) / 2, top: PAGE_GAP - y, width: PAGE_W }}>
          {Array.from({ length: PAGE_PAGES }, (_, i) => (
            <img
              key={i}
              src={staticFile(paperPage(i + 1))}
              width={PAGE_W}
              height={PAGE_H}
              style={{ display: "block", marginBottom: PAGE_GAP, boxShadow: "0 2px 10px rgba(0,0,0,0.5)", background: "#fff" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
const PAGE_PAGES = PAPER_PAGES;

// ------------------------------------------------------------------ composition
export const ResearchFilm: React.FC = () => {
  activeFilm.id = "paper";
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const rootRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const rippleRef = useRef<HTMLDivElement>(null);
  const pdfPaneRef = useRef<HTMLDivElement>(null);
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
    const images = Array.from({ length: PAGE_PAGES }, (_, i) => {
      const img = new Image();
      img.src = staticFile(paperPage(i + 1));
      return img.decode().catch(() => {});
    });
    Promise.all([...fonts, ...images])
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
    const height = () =>
      Array.from(document.querySelectorAll<HTMLElement>(".chat-pane, .doc-detail-body"))
        .map((el) => el.scrollHeight)
        .join(",");
    let iterations = 0;
    let last = "";
    let stable = 0;
    let timer = 0;
    const poll = () => {
      iterations++;
      placeRef.current();
      const h = height();
      // after the paper is written the app loads the PDF for its preview a beat after the list
      const pdfPending = docPhase(t) === "F" && !document.querySelector(".doc-detail-body--pdf");
      stable = h === last && !pdfPending ? stable + 1 : 0;
      last = h;
      if (stable >= 4 || iterations > 60) return finish();
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
      const pane = pdfPaneRef.current;
      if (!root || !cur || !rip || !pane) return;

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

      // The app previews a PDF in an <iframe> (which a headless renderer can't draw): lay the
      // real compiled paper's first page over the preview pane instead.
      const body = root.querySelector<HTMLElement>(".doc-detail-body--pdf");
      if (body && docPhase(t) === "F") {
        const r = measure(body, root);
        pane.style.left = `${r.left}px`;
        pane.style.top = `${r.top}px`;
        pane.style.width = `${r.width}px`;
        pane.style.height = `${r.height}px`;
        pane.style.opacity = "1";
      } else {
        pane.style.opacity = "0";
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
  const vIn = easeOut(prog(t, P.viewerIn, P.viewerInDur));
  const vOut = easeInOut(prog(t, T.viewerOut, 0.7));
  const vVisible = vIn * (1 - vOut) * (1 - outroP);
  const dim = 1 - 0.42 * vIn * (1 - vOut);
  const blur = 2.5 * vIn * (1 - vOut);
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
            filter: dim < 1 ? `brightness(${dim}) blur(${blur}px)` : undefined,
          }}
        >
          <MainWindow t={t} />
        </div>
        {/* page 1 of the real compiled PDF, laid over the Documents preview pane */}
        {/* it belongs to the main window, so it fades, dims and blurs with it (never outlives it) */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 15,
            opacity: mainOpacity,
            filter: dim < 1 ? `brightness(${dim}) blur(${blur}px)` : undefined,
          }}
        >
        <div
          ref={pdfPaneRef}
          style={{ position: "absolute", overflow: "hidden", opacity: 0, background: "#fff", borderRadius: 4 }}
        >
          <img src={staticFile(paperPage(1))} style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
        </div>
        </div>
        <div
          className="promo-win"
          style={{
            left: VIEWER.left + (1 - vVisible) * 60,
            top: VIEWER.top,
            width: VIEWER.w,
            height: VIEWER.h,
            transform: `scale(${VIEWER.scale * (0.96 + 0.04 * vVisible)})`,
            opacity: vVisible,
            zIndex: 20,
          }}
        >
          <PdfViewer t={t} />
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

export { VIEWER_MOVE };
