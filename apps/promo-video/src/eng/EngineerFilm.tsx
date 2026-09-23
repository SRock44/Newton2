import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/500.css";
import "@fontsource/public-sans/600.css";
import "@fontsource/public-sans/700.css";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "../../../desktop/src/App.css";
import "katex/dist/katex.min.css";
import "../promo.css";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { continueRender, delayRender, useCurrentFrame } from "remotion";
import TitleBar from "../../../desktop/src/components/TitleBar";
import Sidebar from "../../../desktop/src/components/Sidebar";
import ChatPane from "../../../desktop/src/components/ChatPane";
import DocumentsPanel from "../../../desktop/src/components/DocumentsPanel";
import NewtonMark from "../../../desktop/src/components/NewtonMark";
import type { ChatMessage, ChatSession, MainView, ToolActivityEntry } from "../../../desktop/src/types";
import { clamp01, easeInOut, easeOut, FPS, measure, prog, typed } from "../anim";
import { cameraTransform, cursorAt, findTarget, installFrozenTime, WALLPAPER, type Pt } from "../engine";
import { Caption, CursorArrow, ScriptedComposer } from "../ui";
import "./api";
import { engineState, type EngineDoc } from "./api";
import { beamRects, useBeamDrive } from "./artifact";
import { DOC, OLD_DOCS, STUDENT, TURNS, safePrefix, typedText } from "./data";
import { CAPTIONS, CLICKS, CURSOR, FX, FY, Z } from "./script";
import { REVEAL_CPS, T, TYPE_CPS, STEP_DELAY, artifactState, type TurnMark } from "./timeline";

installFrozenTime("2026-02-03T10:24:00");

const MAIN = { left: 190, top: 30, w: 1400, h: 860, scale: 1.1 };
const M = T.marks;
const A = T.artifact;

const DECK_DOC: EngineDoc = {
  id: DOC.id,
  filename: DOC.filename,
  mime_type: DOC.mime_type,
  created_at: "2026-02-03T10:20:00Z",
};
const OLD_ENGINE_DOCS: EngineDoc[] = OLD_DOCS.map((d) => ({
  id: d.id,
  filename: d.filename,
  mime_type: d.mime_type,
  created_at: d.created_at,
}));
const PICKER_DOCS = [DECK_DOC, ...OLD_ENGINE_DOCS].map((d) => ({
  name: d.filename,
  date: new Date(d.created_at).toLocaleDateString(),
}));

const OLD_SESSIONS: ChatSession[] = [
  { id: "s2", title: null, status: "active", created_at: "2026-02-02T09:00:00Z" },
  { id: "s3", title: null, status: "active", created_at: "2026-01-30T18:00:00Z" },
];
const OLD_FIRST: Record<string, string> = {
  s2: "Balance the bending moment diagram for the stepped shaft",
  s3: "Why does the Carnot cycle set the efficiency limit?",
};

// ------------------------------------------------------------------ custom cursor targets
const ART_MIN_MAX = { L: [1, 3], P: [1, 20] } as const;

/** How the chat pane is scrolled while the expanded artifact is explored: from the artifact's
 * top (the support toggle) at fraction 0 to the chat's bottom (the sliders) at 1. Filled in by
 * `place()` from the live DOM; the cursor uses it to know where a control sat at another time. */
const pane = { now: 0, top: 0, bottom: 0, s: 1, t: 0 };
const paneScrollAt = (time: number) => pane.top + (pane.bottom - pane.top) * artifactState(time).scroll;

/** A point inside the artifact (its document coordinates), placed where it sat on screen at
 * `time` — a keyframe keeps its place as the pane and the artifact scroll. */
function iframePoint(root: HTMLElement, x: number, y: number, time: number): Pt | null {
  const frame = root.querySelector<HTMLElement>(".artifact-block__frame");
  if (!frame) return null;
  const m = measure(frame, root);
  const s = frame.clientWidth ? m.width / frame.clientWidth : 1;
  const shift = (pane.now - paneScrollAt(time)) * pane.s;
  const inner = artifactState(time).scroll * (beamRects.max ?? 0);
  return { x: m.left + x * s, y: m.top + (y - inner) * s + shift };
}

function customTarget(root: HTMLElement, name: string, time?: number): Pt | null | undefined {
  const rect = (el: Element | null) => (el ? measure(el, root) : null);
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
      const all = root.querySelectorAll(".step-check:not(.step-check--answered) .math-input");
      const r = rect(all[all.length - 1] ?? null);
      return r ? { x: r.left + r.width * 0.35, y: r.top + r.height / 2 } : null;
    }
    case "sc-submit": {
      const all = root.querySelectorAll(".step-check:not(.step-check--answered) .step-check__submit");
      const r = rect(all[all.length - 1] ?? null);
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }
    case "art:cant":
    case "art:simply": {
      if (!beamRects.valid) return null;
      const b = name === "art:cant" ? beamRects.btnCant : beamRects.btnSimply;
      return b ? iframePoint(root, b.x + b.w / 2, b.y + b.h / 2, time ?? 0) : null;
    }
    case "art:inL":
    case "art:inP": {
      if (!beamRects.valid) return null;
      const which = name === "art:inL" ? "L" : "P";
      const rc = which === "L" ? beamRects.inL : beamRects.inP;
      if (!rc) return null;
      const v = artifactState(time ?? 0)[which];
      const [lo, hi] = ART_MIN_MAX[which];
      const frac = (v - lo) / (hi - lo);
      return iframePoint(root, rc.x + 9 + (rc.w - 18) * frac, rc.y + rc.h / 2, time ?? 0);
    }
  }
  return undefined;
}

/** The DOM element a click lands on (for the pressed-button flash). */
function elementFor(root: HTMLElement, name: string): Element | null {
  switch (name) {
    case "upload-btn":
      return root.querySelector(".documents-page-toolbar-actions .btn-primary");
    case "sc-submit": {
      const all = root.querySelectorAll(".step-check:not(.step-check--answered) .step-check__submit");
      return all[all.length - 1] ?? null;
    }
    case "learn":
      return root.querySelector('[data-promo="learn"] .toggle');
    case "art:cant":
    case "art:simply":
    case "art:inL":
    case "art:inP":
      return null;
  }
  return findTarget(root, name);
}
const PRESSABLE = new Set(["send", "newchat", "nav-documents", "upload-btn", "buildit", "expand", "sc-submit", "menu-existing", "picker-deck", "plus"]);

// ------------------------------------------------------------------ chat content from time
function assistantContent(k: number, t: number, m: TurnMark): string {
  const full = TURNS[2 * k + 1].content;
  if (k === 3) {
    if (t < (m.blockAt ?? Infinity)) return "";
    const first = full.indexOf("```");
    const close = full.indexOf("```", first + 3) + 3;
    const rest = full.slice(close);
    return full.slice(0, close) + safePrefix(rest, Math.floor(Math.max(0, t - m.revealStart) * REVEAL_CPS));
  }
  if (t < m.revealStart) return "";
  return safePrefix(full, Math.max(1, Math.floor((t - m.revealStart) * REVEAL_CPS)));
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
  const idle = !messages.length || t < M[7].sendClick;
  const beforeSend = M.every((m) => t < m.sendClick || t >= m.userAppear);
  const caretOn = beforeSend && idle && Math.floor(t * 2) % 2 === 0;

  const title = inDocs ? "Documents" : started ? "Beam deflection" : "New chat";
  const s1: ChatSession = { id: "s1", title: null, status: "active", created_at: "2026-02-03T10:24:00Z" };
  const s0: ChatSession = { id: "s0", title: null, status: "active", created_at: "2026-02-03T10:10:00Z" };
  const sessions: ChatSession[] = inNewChat || inDocs ? [s1, ...OLD_SESSIONS] : [s0, ...OLD_SESSIONS];
  const first: Record<string, string> = { ...OLD_FIRST };
  if (started) first.s1 = typedText(TURNS[0].content);
  const activeId = inNewChat || inDocs ? "s1" : "s0";

  engineState.docs = phase === "C" ? [DECK_DOC, ...OLD_ENGINE_DOCS] : OLD_ENGINE_DOCS;

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
        dt.items.add(new File(["slides"], DOC.filename, { type: DOC.mime_type }));
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

// ------------------------------------------------------------------ math field typing
/** Types into the real Step Check's math field. Holds the frame open until the field exists
 * (MathLive loads lazily) and shows the requested LaTeX. */
function useMathFieldTyping(t: number, frame: number, replace: () => void) {
  useEffect(() => {
    const m = M.find((mk) => mk.kind === "stepcheck" && t >= mk.clickField! && t < mk.userAppear);
    if (!m) return;
    const n = Math.min(m.latexSteps!.length, Math.max(0, Math.floor((t - m.typeStart!) / STEP_DELAY) + 1));
    const latex = t < m.typeStart! ? "" : m.latexSteps![n - 1] ?? "";
    const handle = delayRender(`math field @${frame}`);
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        continueRender(handle);
      }
    };
    const started = Date.now();
    const step = () => {
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
          replace(); // the field's arrival grew the card; re-pin the chat and cursor
          finish();
        }, 120);
      }
      if (Date.now() - started > 6000) return finish();
      window.setTimeout(step, 40);
    };
    step();
    return finish;
  }, [frame]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ------------------------------------------------------------------ composition
export const EngineerFilm: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const rootRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const rippleRef = useRef<HTMLDivElement>(null);
  const placeRef = useRef<() => void>(() => {});
  const [assetHandle] = useState(() => delayRender("fonts"));

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

  useMathFieldTyping(t, frame, () => placeRef.current());

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
  useBeamDrive(t >= A.readyAt, artifactState(t), () => placeRef.current());

  useLayoutEffect(() => {
    const place = () => {
      const root = rootRef.current;
      const cur = cursorRef.current;
      const rip = rippleRef.current;
      if (!root || !cur || !rip) return;

      // Drive the real ArtifactBlock's Expand button exactly once per desired state.
      const blockEl = root.querySelector<HTMLElement>(".artifact-block");
      if (blockEl) {
        const want = t >= A.expandClick ? "1" : "0";
        if (blockEl.getAttribute("data-promo-want") !== want) {
          const isExpanded = blockEl.classList.contains("artifact-block--expanded");
          const btn = blockEl.querySelector<HTMLButtonElement>(".artifact-block__actions button");
          if (btn && isExpanded !== (want === "1")) btn.click();
          blockEl.setAttribute("data-promo-want", want);
        }
      }
      // Pin the chat to the bottom (instant, not the app's smooth scroll); while the artifact
      // is being explored, frame the expanded block from its top instead.
      root.querySelectorAll<HTMLElement>(".chat-pane").forEach((el) => {
        let top = el.scrollHeight;
        const block = el.querySelector<HTMLElement>(".artifact-block");
        if (block && t >= A.expandClick && t < M[4].userAppear) {
          const pr = el.getBoundingClientRect();
          const s = el.offsetWidth ? pr.width / el.offsetWidth : 1;
          pane.top = (block.getBoundingClientRect().top - pr.top) / s + el.scrollTop - 10;
          pane.bottom = Math.max(pane.top, el.scrollHeight - el.clientHeight);
          pane.s = s / (root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1); // pane px -> root units
          top = paneScrollAt(t);
        }
        el.scrollTo({ top, behavior: "instant" });
        pane.now = el.scrollTop;
      });
      // ArtifactBlock's iframe is loading="lazy"; a headless frame render never loads it.
      root.querySelectorAll<HTMLIFrameElement>(".artifact-block__frame").forEach((f) => {
        if (f.loading !== "eager") f.loading = "eager";
      });

      const p = cursorAt(root, t, CURSOR, customTarget);
      cur.style.transform = `translate(${p.x - 4}px, ${p.y - 2}px)`;
      cur.style.opacity = String(clamp01((t - (T.cursorIn - 0.3)) / 0.3) * (t > T.outroStart ? 0 : 1));
      let ripple = 0;
      for (const c of CLICKS) {
        const d = t - c.t;
        if (d >= 0 && d < 0.5) ripple = d / 0.5;
        if (PRESSABLE.has(c.target) || c.target === "learn") {
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
