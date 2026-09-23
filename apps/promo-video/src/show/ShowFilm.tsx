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
import MessageContent from "../../../desktop/src/components/MessageContent";
import NewtonMark from "../../../desktop/src/components/NewtonMark";
import type { ChatMessage, ChatSession, MainView, ToolActivityEntry } from "../../../desktop/src/types";
import { clamp01, easeInOut, easeOut, FPS, measure, prog, typed } from "../anim";
import { cameraTransform, cursorAt, findTarget, installFrozenTime, WALLPAPER, type Pt } from "../engine";
import { Caption, CursorArrow, ScriptedComposer } from "../ui";
import { activeFilm } from "../filmId";
import "./api";
import { showState, type ShowDoc } from "./api";
import { DOC, NOTE, NOTE_TITLE, OLD_DOCS, STUDENT, TURNS, noteState, safePrefix, typedText } from "./data";
import { CAPTIONS, CLICKS, CURSOR, FX, FY, Z } from "./script";
import { NOTE_CPS, REVEAL_CPS, RESEARCH_REVEAL_CPS, STEP_DELAY, T, TYPE_CPS, type TurnMark } from "./timeline";

installFrozenTime("2026-02-03T10:24:00");

const MAIN = { left: 190, top: 30, w: 1400, h: 860, scale: 1.1 };
const NB = { left: 1090, top: 96, w: 420, h: 580, scale: 1.28 };
const M = T.marks;
const nbT = T.nb;

const DECK_DOC: ShowDoc = {
  id: DOC.id,
  filename: DOC.filename,
  mime_type: DOC.mime_type,
  created_at: "2026-02-03T10:20:00Z",
};
const OLD_SHOW_DOCS: ShowDoc[] = OLD_DOCS.map((d) => ({
  id: d.id,
  filename: d.filename,
  mime_type: d.mime_type,
  created_at: d.created_at,
}));
const PICKER_DOCS = [DECK_DOC, ...OLD_SHOW_DOCS].map((d) => ({
  name: d.filename,
  date: new Date(d.created_at).toLocaleDateString(),
}));

const OLD_SESSIONS: ChatSession[] = [
  { id: "s2", title: null, status: "active", created_at: "2026-02-02T09:00:00Z" },
  { id: "s3", title: null, status: "active", created_at: "2026-01-30T18:00:00Z" },
];
const OLD_FIRST: Record<string, string> = {
  s2: "How do I set up the volume of a solid of revolution about the y-axis?",
  s3: "Why does the ratio test fail when the limit is exactly 1?",
};

// ------------------------------------------------------------------ custom cursor targets
function customTarget(root: HTMLElement, name: string): Pt | null | undefined {
  const rect = (el: Element | null) => (el ? measure(el, root) : null);
  const last = (sel: string) => {
    const all = root.querySelectorAll(sel);
    return rect(all[all.length - 1] ?? null);
  };
  switch (name) {
    case "upload-btn": {
      const r = rect(root.querySelector(".documents-page-toolbar-actions .btn-primary"));
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }
    case "doc-card": {
      const r = rect(root.querySelector(".doc-entry"));
      return r ? { x: r.left + r.width * 0.5, y: r.top + r.height * 0.55 } : null;
    }
    case "doc-detail": {
      const r = rect(root.querySelector(".doc-detail-body"));
      return r ? { x: r.left + r.width * 0.45, y: r.top + r.height * 0.35 } : null;
    }
    case "sc-field": {
      const r = last(".step-check:not(.step-check--answered) .math-input");
      return r ? { x: r.left + r.width * 0.35, y: r.top + r.height / 2 } : null;
    }
    case "sc-submit": {
      const r = last(".step-check:not(.step-check--answered) .step-check__submit");
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }
    case "cp-field": {
      const r = last(".checkpoint:not(.checkpoint--answered) .checkpoint__input");
      return r ? { x: r.left + r.width * 0.3, y: r.top + r.height / 2 } : null;
    }
    case "cp-submit": {
      const r = last(".checkpoint:not(.checkpoint--answered) .checkpoint__submit");
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }
  }
  return undefined;
}

/** The DOM element a click lands on (for the pressed-button flash). */
function elementFor(root: HTMLElement, name: string): Element | null {
  const lastOf = (sel: string) => {
    const all = root.querySelectorAll(sel);
    return all[all.length - 1] ?? null;
  };
  switch (name) {
    case "upload-btn":
      return root.querySelector(".documents-page-toolbar-actions .btn-primary");
    case "sc-submit":
      return lastOf(".step-check:not(.step-check--answered) .step-check__submit");
    case "cp-submit":
      return lastOf(".checkpoint:not(.checkpoint--answered) .checkpoint__submit");
    case "learn":
      return root.querySelector('[data-promo="learn"] .toggle');
    case "sc-field":
    case "cp-field":
    case "nb-body":
      return null;
  }
  return findTarget(root, name);
}
const PRESSABLE = new Set([
  "send", "newchat", "nav-documents", "upload-btn", "sc-submit", "cp-submit", "menu-existing",
  "picker-deck", "plus", "nb-define", "nb-explain", "nb-preview", "learn",
]);

// ------------------------------------------------------------------ chat content from time
function assistantContent(k: number, t: number, m: TurnMark): string {
  const full = TURNS[2 * k + 1].content;
  if (t < m.revealStart) return "";
  const cps = k === 5 ? RESEARCH_REVEAL_CPS : REVEAL_CPS;
  return safePrefix(full, Math.max(1, Math.floor((t - m.revealStart) * cps)));
}

function buildChat(t: number) {
  const messages: ChatMessage[] = [];
  let composerText = "";
  M.forEach((m, k) => {
    const u = TURNS[2 * k];
    if (t >= m.userAppear) {
      messages.push({ id: `u${k}`, role: "user", content: u.content, created_at: "2026-02-03T10:24:00Z" });
    }
    if (t >= m.asstAppear) {
      const activity: ToolActivityEntry[] = m.tools
        .filter((tl) => t >= tl.start)
        .map((tl) => ({
          tool: tl.tool,
          label: tl.label,
          done: t >= tl.done,
          verified: t >= tl.done && tl.verified ? true : undefined,
        }));
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

// ------------------------------------------------------------------ main window
function MainWindow({ t }: { t: number }) {
  const inDocs = t >= T.navClick + 0.05 && t < T.newChatClick + 0.05;
  const inNewChat = t >= T.newChatClick + 0.05;
  const view: MainView = inDocs ? "documents" : "chat";
  const phase: "A" | "B" | "C" = t < T.uploadClick + 0.1 ? "A" : t < T.uploadDone ? "B" : "C";

  const { messages, composerText } = buildChat(t);
  const started = t >= M[0].userAppear;
  const learnOn = t >= T.learnClick + 0.1;
  const menuOpen = t >= T.plusClick + 0.05 && t < T.menuExistingClick + 0.05;
  const pickerOpen = t >= T.menuExistingClick + 0.05 && t < T.pickerDeckClick + 0.05;
  const attachment = t >= T.pickerDeckClick + 0.05 && t < M[0].sendClick + 0.05 ? DOC.filename : null;
  const idle = !messages.length || t < M[M.length - 1].sendClick;
  const beforeSend = M.every((m) => t < m.sendClick || t >= m.userAppear);
  const caretOn = beforeSend && idle && Math.floor(t * 2) % 2 === 0 && t > T.composerClick - 0.5;

  const title = inDocs ? "Documents" : started ? "Integration by parts" : "New chat";
  const s1: ChatSession = { id: "s1", title: null, status: "active", created_at: "2026-02-03T10:24:00Z" };
  const s0: ChatSession = { id: "s0", title: null, status: "active", created_at: "2026-02-03T10:10:00Z" };
  const sessions: ChatSession[] = inNewChat || inDocs ? [s1, ...OLD_SESSIONS] : [s0, ...OLD_SESSIONS];
  const first: Record<string, string> = { ...OLD_FIRST };
  if (started) first.s1 = typedText(TURNS[0].content);
  const activeId = inNewChat || inDocs ? "s1" : "s0";

  showState.docs = phase === "C" ? [DECK_DOC, ...OLD_SHOW_DOCS] : OLD_SHOW_DOCS;

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
                learnMode={learnOn}
                menuOpen={menuOpen}
                pickerOpen={pickerOpen}
                pickerDocs={PICKER_DOCS}
                attachment={attachment}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/** The REAL Documents page. Remounted per phase (empty list -> uploading -> uploaded) so each
 * phase is a pure function of time: the API mock serves the list for that phase, and for the
 * "uploading" phase a real file is chosen so the page sits on its own "Uploading…" state. */
function DocsView({ phase }: { phase: "A" | "B" | "C" }) {
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
    const started = Date.now();
    const step = () => {
      const input = document.querySelector<HTMLInputElement>(".documents-page-toolbar-actions input[type=file]");
      const btn = document.querySelector(".documents-page-toolbar-actions .btn-primary");
      if (input && btn && btn.textContent?.includes("Uploading")) return finish();
      if (input && !btn?.textContent?.includes("Uploading") && !(input as HTMLInputElement & { __sent?: boolean }).__sent) {
        (input as HTMLInputElement & { __sent?: boolean }).__sent = true;
        const dt = new DataTransfer();
        dt.items.add(new File(["handout"], DOC.filename, { type: DOC.mime_type }));
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (Date.now() - started > 6000) return finish();
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
      initialSelectedDocumentId={phase === "C" ? DOC.id : null}
    />
  );
}

// ------------------------------------------------------------------ Notepad (Write mode)
/** The companion Notepad window. The student writes in WRITE mode: types the note, highlights a
 * term -> Define, highlights the formula -> Explain (the response is inserted right after the
 * highlight, as a raw ```newton-note block — exactly what the real Write-mode toolbar does).
 * Only at the end does Preview show the finished note. */
function NotepadWindow({ t }: { t: number }) {
  const textRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
  const anchors = {
    ts: useRef<HTMLDivElement>(null),
    te: useRef<HTMLDivElement>(null),
    fs: useRef<HTMLDivElement>(null),
    fe: useRef<HTMLDivElement>(null),
  };
  const toolbarRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const defined = t >= nbT.defineShown;
  const explained = t >= nbT.explainShown;
  const inPreview = t >= nbT.previewClick + 0.1;
  const state = noteState(defined, explained);
  const writing = t < nbT.typeEnd + 0.05;
  const shown = writing ? typed(state.content, t, nbT.typeStart, NOTE_CPS) : state.content;
  const caretOn = Math.floor(t * 2) % 2 === 0;

  const termSel = t >= nbT.selTermStart && t < nbT.defineShown;
  const formulaSel = t >= nbT.selFormulaStart && t < nbT.explainShown;
  const selP = termSel ? easeOut(prog(t, nbT.selTermStart, nbT.selDur)) : easeOut(prog(t, nbT.selFormulaStart, nbT.selDur));
  const toolbarP = termSel
    ? easeOut(prog(t, nbT.toolbarTerm, 0.22))
    : easeOut(prog(t, nbT.toolbarFormula, 0.22));
  const toolbarOn =
    (t >= nbT.toolbarTerm && t < nbT.defineClick + 0.1) || (t >= nbT.toolbarFormula && t < nbT.explainClick + 0.1);

  useLayoutEffect(() => {
    const text = textRef.current;
    const win = rootRef.current?.closest(".promo-win") as HTMLElement | null;
    const body = bodyRef.current;
    if (body && inPreview) {
      // Preview is taller than the window: scroll through the finished note, top to bottom.
      const from = nbT.previewClick + 1.3;
      const to = nbT.nbOut - 0.5;
      const f = easeInOut(clamp01((t - from) / (to - from)));
      body.scrollTop = f * Math.max(0, body.scrollHeight - body.clientHeight);
    }
    if (!text || !win || inPreview) return;
    const node = text.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const len = (node.textContent ?? "").length;
    const c = win.getBoundingClientRect();
    const s = win.offsetWidth ? c.width / win.offsetWidth : 1;
    const rectOf = (from: number, to: number) => {
      if (to > len) return null;
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, to);
      const rr = range.getBoundingClientRect();
      return { left: (rr.left - c.left) / s, top: (rr.top - c.top) / s, width: rr.width / s, height: rr.height / s };
    };
    const term = rectOf(state.termAt, state.termAt + NOTE.term.length);
    const formula = rectOf(state.formulaAt, state.formulaAt + NOTE.formula.length);
    const put = (el: HTMLDivElement | null, x: number, y: number) => {
      if (!el) return;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    };
    if (term) {
      put(anchors.ts.current, term.left, term.top + term.height / 2);
      put(anchors.te.current, term.left + term.width, term.top + term.height / 2);
    }
    if (formula) {
      put(anchors.fs.current, formula.left, formula.top + formula.height / 2);
      put(anchors.fe.current, formula.left + formula.width, formula.top + formula.height / 2);
    }
    const active = formulaSel ? formula : term;
    const hl = hlRef.current;
    if (hl && active) {
      hl.style.left = `${active.left - 2}px`;
      hl.style.top = `${active.top - 1}px`;
      hl.style.width = `${(active.width + 4) * selP}px`;
      hl.style.height = `${active.height + 2}px`;
    }
    if (toolbarRef.current && active) {
      const tb = toolbarRef.current;
      tb.style.left = `${Math.max(4, Math.min(active.left, win.offsetWidth - tb.offsetWidth - 10))}px`;
      toolbarRef.current.style.top = `${active.top - 44}px`;
    }
  });

  return (
    <div className="app-root" ref={rootRef}>
      <TitleBar title="Newton Notepad" variant="notepad" />
      <div className="notepad-window">
        <div className="notepad-window__editor" style={{ position: "relative" }}>
          <div className="notepad-window__editor-header">
            <button type="button" className="btn-secondary notepad-window__back">
              ← Notes
            </button>
            <input type="text" className="notepad-window__title-input" value={NOTE_TITLE} readOnly />
          </div>
          <div className="notepad-window__toolbar">
            <div className="notepad-window__mode-toggle">
              <button type="button" className={inPreview ? "notepad-window__mode-btn" : "notepad-window__mode-btn--active"}>
                Write
              </button>
              <button
                type="button"
                data-promo="nb-preview"
                className={inPreview ? "notepad-window__mode-btn--active" : "notepad-window__mode-btn"}
              >
                Preview
              </button>
            </div>
            <div className="notepad-window__toolbar-right">
              <span className="notepad-window__save-status">{writing || t < nbT.explainShown + 1 ? "Saving…" : "Saved"}</span>
            </div>
          </div>
          <div className="notepad-window__body" ref={bodyRef} style={{ overflowY: "auto" }}>
            {inPreview ? (
              <div className="notepad-window__preview">
                <MessageContent content={state.content} />
              </div>
            ) : (
              <div
                ref={textRef}
                className="notepad-window__textarea"
                data-promo="nb-body"
                style={{ display: "block", whiteSpace: "pre-wrap", overflowWrap: "anywhere", height: "auto", minHeight: "100%" }}
              >
                {shown}
                <span className="promo-caret" style={{ opacity: writing && caretOn ? 1 : 0 }} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        ref={hlRef}
        style={{
          position: "absolute",
          zIndex: 30,
          borderRadius: 3,
          background: "rgba(47, 77, 140, 0.30)",
          pointerEvents: "none",
          opacity: !inPreview && (termSel || formulaSel) ? 1 : 0,
        }}
      />
      <div ref={anchors.ts} data-promo="nb-term-start" style={{ position: "absolute", width: 1, height: 1 }} />
      <div ref={anchors.te} data-promo="nb-term-end" style={{ position: "absolute", width: 1, height: 1 }} />
      <div ref={anchors.fs} data-promo="nb-formula-start" style={{ position: "absolute", width: 1, height: 1 }} />
      <div ref={anchors.fe} data-promo="nb-formula-end" style={{ position: "absolute", width: 1, height: 1 }} />
      <div
        ref={toolbarRef}
        className="notepad-window__selection-toolbar"
        style={{
          position: "absolute",
          zIndex: 40,
          opacity: toolbarOn ? toolbarP : 0,
          transform: `scale(${0.9 + 0.1 * toolbarP})`,
          transformOrigin: "0 100%",
        }}
      >
        <button type="button" data-promo="nb-explain">
          Explain
        </button>
        <button type="button" data-promo="nb-define">
          Define
        </button>
        <button type="button">Summarize</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ typing into real fields
function setNativeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Types into the real Step Check's math field / the real Checkpoint's text input. Holds the
 * frame open until the field exists (MathLive loads lazily) and shows the requested value. */
function useFieldTyping(t: number, frame: number, replace: () => void) {
  useEffect(() => {
    const m = M.find((mk) => (mk.kind === "stepcheck" || mk.kind === "checkpoint") && t >= mk.clickField! && t < mk.userAppear);
    if (!m) return;
    const handle = delayRender(`field @${frame}`);
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        continueRender(handle);
      }
    };
    const started = Date.now();
    const step = () => {
      if (m.kind === "stepcheck") {
        const n = Math.min(m.latexSteps!.length, Math.max(0, Math.floor((t - m.typeStart!) / STEP_DELAY) + 1));
        const latex = t < m.typeStart! ? "" : m.latexSteps![n - 1] ?? "";
        const fields = document.querySelectorAll<HTMLElement & { value: string }>(
          ".step-check:not(.step-check--answered) math-field",
        );
        const mf = fields[fields.length - 1];
        if (mf) {
          if (mf.value !== latex) {
            mf.value = latex;
            mf.dispatchEvent(new Event("input", { bubbles: true }));
          }
          return window.setTimeout(() => {
            replace();
            finish();
          }, 120);
        }
      } else {
        const inputs = document.querySelectorAll<HTMLInputElement>(".checkpoint:not(.checkpoint--answered) .checkpoint__input");
        const inp = inputs[inputs.length - 1];
        if (inp) {
          const want = typed(m.typed!, t, m.typeStart!, TYPE_CPS);
          if (inp.value !== want) setNativeValue(inp, want);
          return window.setTimeout(() => {
            replace();
            finish();
          }, 80);
        }
      }
      if (Date.now() - started > 6000) return finish();
      window.setTimeout(step, 40);
    };
    step();
    return finish;
  }, [frame]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ------------------------------------------------------------------ composition
export const ShowFilm: React.FC = () => {
  activeFilm.id = "show";
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
      "16px KaTeX_AMS",
      "bold 16px KaTeX_Main",
      "italic 16px KaTeX_Main",
      "16px KaTeX_Size1",
      "16px KaTeX_Size2",
      "400 14px 'JetBrains Mono', monospace",
    ].map((f) => document.fonts.load(f, "Aa1(∑"));
    Promise.all(fonts)
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

  useFieldTyping(t, frame, () => placeRef.current());

  // Markdown/KaTeX/step blocks (and the math field, which loads lazily) finish laying out
  // just after the first paint and grow the chat. Keep re-pinning the scroll and cursor until
  // the chat's height has stopped changing, so every frame shows the settled layout.
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
      Array.from(document.querySelectorAll<HTMLElement>(".chat-pane"))
        .map((el) => el.scrollHeight)
        .join(",");
    const started = Date.now();
    let last = "";
    let stable = 0;
    let timer = 0;
    const poll = () => {
      placeRef.current();
      const h = height();
      // MathLive is imported lazily: a Step Check's field appears some time after its card.
      const fieldPending = Array.from(document.querySelectorAll(".math-input")).some(
        (m) => !m.querySelector("math-field"),
      );
      stable = h === last && !fieldPending ? stable + 1 : 0;
      last = h;
      if (stable >= 4 || Date.now() - started > 4000) return finish();
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

      // Pin the chat to the bottom (instant, not the app's smooth scroll).
      root.querySelectorAll<HTMLElement>(".chat-pane").forEach((el) => {
        el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
      });

      const p = cursorAt(root, t, CURSOR, customTarget);
      cur.style.transform = `translate(${p.x - 4}px, ${p.y - 2}px)`;
      cur.style.opacity = String(clamp01((t - (nbT.cursorIn - 0.3)) / 0.3) * (t > T.outroStart ? 0 : 1));
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

  const winIn = easeOut(prog(t, nbT.windowIn, 0.9));
  const outroP = easeInOut(prog(t, T.outroStart, 0.8));
  const mainScale = MAIN.scale * (0.94 + 0.06 * winIn) * (1 - 0.05 * outroP);
  const mainOpacity = winIn * (1 - outroP);
  const nbIn = easeOut(prog(t, nbT.nbIn, nbT.nbInDur));
  const nbOut = easeInOut(prog(t, nbT.nbOut, nbT.nbOutDur));
  const nbVisible = nbIn * (1 - nbOut) * (1 - outroP);
  const dim = 1 - 0.42 * nbIn * (1 - nbOut);
  const blur = 2.5 * nbIn * (1 - nbOut);
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
        <div
          className="promo-win"
          style={{
            left: NB.left + (1 - nbVisible) * 70,
            top: NB.top,
            width: NB.w,
            height: NB.h,
            transform: `scale(${NB.scale * (0.96 + 0.04 * nbVisible)})`,
            opacity: nbVisible,
            zIndex: 20,
          }}
        >
          <NotepadWindow t={t} />
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
        <div className="promo-tagline">The first Agentic Learning Environment</div>
      </div>
      <div className="promo-center" style={{ opacity: outroOpacity, pointerEvents: "none" }}>
        <NewtonMark size={96} />
        <div className="promo-wordmark">Newton</div>
        <div className="promo-tagline">Learn it. Don't outsource it.</div>
      </div>
    </div>
  );
};
