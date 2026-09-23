import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/500.css";
import "@fontsource/public-sans/600.css";
import "@fontsource/public-sans/700.css";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "../../desktop/src/App.css";
import "katex/dist/katex.min.css";
import "./promo.css";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Audio, continueRender, delayRender, staticFile, useCurrentFrame } from "remotion";
import TitleBar from "../../desktop/src/components/TitleBar";
import Sidebar from "../../desktop/src/components/Sidebar";
import ChatPane from "../../desktop/src/components/ChatPane";
import MessageContent from "../../desktop/src/components/MessageContent";
import NewtonMark from "../../desktop/src/components/NewtonMark";
import type { ChatMessage, ChatSession, ToolActivityEntry } from "../../desktop/src/types";
import { clamp01, easeInOut, easeOut, FPS, measure, prog, track, typed, type Keyframe } from "./anim";
import { cameraTransform, cursorAt, findTarget, installFrozenTime, WALLPAPER, type Click, type CursorKey, type Pt } from "./engine";
import { artifactPoint, artifactReady, useArtifactDrive } from "./artifact";
import { Caption, CursorArrow, ScriptedComposer } from "./ui";
import * as D from "./data";
import { T } from "./timeline";
import { dragAngle } from "./drag";

import { activeFilm } from "./filmId";

installFrozenTime("2026-02-03T10:24:00");

const MAIN = { left: 190, top: 30, w: 1400, h: 860, scale: 1.1 };
const NB = { left: 1090, top: 96, w: 420, h: 580, scale: 1.28 };

// ---------------------------------------------------------------- cursor script
const CURSOR: CursorKey[] = [
  { t: T.s1CursorIn, at: { x: 1500, y: 720 }, fb: { x: 1500, y: 720 } },
  { t: T.s1ComposerClick, at: "composer", fb: { x: 900, y: 880 } },
  { t: T.s1SendClick - 0.25, at: "send", fb: { x: 1430, y: 880 } },
  { t: T.s1SendClick, at: "send", fb: { x: 1430, y: 880 } },
  { t: 8.6, at: { x: 1330, y: 560 }, fb: { x: 1330, y: 560 } },
  { t: T.nbIn + 0.9, at: { x: 1400, y: 520 }, fb: { x: 1400, y: 520 } },
  { t: T.nbBodyClick, at: "nb-body", fb: { x: 1330, y: 400 } },
  { t: T.nbPreviewClick, at: "nb-preview", fb: { x: 1500, y: 250 } },
  { t: T.nbSelStart, at: "nb-word-start", fb: { x: 1250, y: 330 } },
  { t: T.nbSelStart + T.nbSelDur, at: "nb-word-end", fb: { x: 1400, y: 330 } },
  { t: T.nbDefineClick - 0.3, at: "nb-define", fb: { x: 1400, y: 290 } },
  { t: T.nbDefineClick, at: "nb-define", fb: { x: 1400, y: 290 } },
  { t: T.nbOut + 0.4, at: { x: 1250, y: 600 }, fb: { x: 1250, y: 600 } },
  { t: T.newChatClick, at: "newchat", fb: { x: 330, y: 260 } },
  { t: T.s3ComposerClick, at: "composer", fb: { x: 900, y: 880 } },
  { t: T.s3SendClick - 0.25, at: "send", fb: { x: 1430, y: 880 } },
  { t: T.s3SendClick, at: "send", fb: { x: 1430, y: 880 } },
  { t: T.s3SendClick + 1.6, at: { x: 1280, y: 700 }, fb: { x: 1280, y: 700 } },
  { t: T.s3BuildClick, at: "buildit", fb: { x: 700, y: 820 } },
  { t: T.s3BuildClick + 1.2, at: { x: 1300, y: 640 }, fb: { x: 1300, y: 640 } },
  { t: T.s3ExpandClick - 0.35, at: "expand", fb: { x: 1450, y: 190 } },
  { t: T.s3ExpandClick, at: "expand", fb: { x: 1450, y: 190 } },
  { t: T.s3GrabAt, at: "artifact-P", fb: { x: 1140, y: 500 } },
  { t: T.s3DragEnd, at: "artifact-P", fb: { x: 1140, y: 500 } },
  { t: T.s3DragEnd + 1.0, at: { x: 1330, y: 760 }, fb: { x: 1330, y: 760 } },
];

const CLICKS: Click[] = [
  { t: T.s1ComposerClick, target: "composer" },
  { t: T.s1SendClick, target: "send" },
  { t: T.nbBodyClick, target: "nb-body" },
  { t: T.nbPreviewClick, target: "nb-preview" },
  { t: T.nbDefineClick, target: "nb-define" },
  { t: T.newChatClick, target: "newchat" },
  { t: T.s3ComposerClick, target: "composer" },
  { t: T.s3SendClick, target: "send" },
  { t: T.s3BuildClick, target: "buildit" },
  { t: T.s3ExpandClick, target: "expand" },
  { t: T.s3GrabAt, target: "artifact-P" },
];

const PRESSABLE = new Set(["send", "nb-preview", "nb-define", "newchat", "buildit", "expand"]);

/** Targets specific to this film: the point inside the artifact iframe. */
function customTarget(root: HTMLElement, name: string): Pt | null | undefined {
  if (name !== "artifact-P") return undefined;
  const frame = root.querySelector<HTMLElement>(".artifact-block__frame");
  if (!frame || !artifactPoint.valid) return null;
  const m = measure(frame, root);
  const s = frame.clientWidth ? m.width / frame.clientWidth : 1;
  return { x: m.left + artifactPoint.x * s, y: m.top + artifactPoint.y * s };
}

// ---------------------------------------------------------------- camera
const Z: Keyframe<number>[] = [
  { t: 0, v: 1 }, { t: 3.2, v: 1 }, { t: 4.4, v: 1.1 }, { t: 6.4, v: 1.1 }, { t: 8.0, v: 1.03 },
  { t: 12.6, v: 1.03 }, { t: 13.9, v: 1.06 }, { t: 22.4, v: 1.06 }, { t: 23.6, v: 1.0 },
  { t: 24.3, v: 1.0 }, { t: 25.0, v: 1.08 }, { t: 26.6, v: 1.08 }, { t: 28.0, v: 1.02 },
  { t: 31.0, v: 1.04 }, { t: 33.0, v: 1.02 }, { t: 36.8, v: 1.02 }, { t: 38.2, v: 1.12 },
  { t: 45.2, v: 1.12 }, { t: 46.4, v: 1.0 }, { t: T.total, v: 1.0 },
];
const FX: Keyframe<number>[] = [
  { t: 0, v: 960 }, { t: 3.2, v: 960 }, { t: 4.4, v: 1000 }, { t: 6.4, v: 1000 }, { t: 8.0, v: 1000 },
  { t: 12.6, v: 1000 }, { t: 13.9, v: 1400 }, { t: 22.4, v: 1400 }, { t: 23.6, v: 960 },
  { t: 24.3, v: 960 }, { t: 25.0, v: 1000 }, { t: 26.6, v: 1000 }, { t: 28.0, v: 990 },
  { t: 31.0, v: 980 }, { t: 33.0, v: 980 }, { t: 36.8, v: 980 }, { t: 38.2, v: 1080 },
  { t: 45.2, v: 1080 }, { t: 46.4, v: 960 }, { t: T.total, v: 960 },
];
// Zoom toward the bottom edge so the window's bottom never rides up under the caption.
const FY: Keyframe<number>[] = [{ t: 0, v: 940 }, { t: T.total, v: 940 }];

// ---------------------------------------------------------------- main window
const OLD_SESSIONS: ChatSession[] = [
  { id: "s2", title: null, status: "active", created_at: "2026-02-02T09:00:00Z" },
  { id: "s3", title: null, status: "active", created_at: "2026-01-30T18:00:00Z" },
];
const OLD_FIRST: Record<string, string> = {
  s2: "What are the correct balanced coefficients for C3H8 + O2 -> CO2 + H2O?",
  s3: "Why do transformer cores use soft iron instead of steel?",
};

function MainWindow({ t }: { t: number }) {
  const inS3 = t >= T.newChatClick;
  const beforeSend = inS3 ? t < T.s3SendClick : t < T.s1SendClick;
  const caretOn = beforeSend && Math.floor(t * 2) % 2 === 0;

  const messages: ChatMessage[] = [];
  let composerText = "";
  let title = "New chat";
  const first: Record<string, string> = { ...OLD_FIRST };

  if (!inS3) {
    composerText = t < T.s1SendClick ? typed(D.STUDY_PROMPT, t, T.s1TypeStart, T.s1TypeCps) : "";
    if (t >= T.s1UserMsg) {
      first.s1 = D.STUDY_PROMPT;
      title = "Factoring practice";
      messages.push({ id: "u1", role: "user", content: D.STUDY_PROMPT, created_at: "2026-02-03T10:24:00Z" });
    }
    if (t >= T.s1AssistantIn) {
      const activity: ToolActivityEntry[] = D.STUDY_TOOLS.flatMap((tool, i) =>
        t >= T.s1ChipStart[i]
          ? [{ tool: tool.tool, label: tool.label, done: t >= T.s1ChipDone[i], verified: t >= T.s1ChipDone[i] ? true : undefined }]
          : [],
      );
      const n = Math.floor(prog(t, T.s1ReplyStart, T.s1ReplyDur) * D.STUDY_REPLY.length);
      messages.push({ id: "a1", role: "assistant", content: D.STUDY_REPLY.slice(0, n), created_at: "2026-02-03T10:24:05Z", activity });
    }
  } else {
    composerText = t < T.s3SendClick ? typed(D.ARTIFACT_PROMPT, t, T.s3TypeStart, T.s3TypeCps) : "";
    if (t >= T.s3UserMsg) {
      first.s4 = D.ARTIFACT_PROMPT;
      title = "Unit circle explorer";
      messages.push({ id: "u2", role: "user", content: D.ARTIFACT_PROMPT, created_at: "2026-02-03T10:31:00Z" });
    }
    if (t >= T.s3AssistantIn) {
      let content = typed(D.PLAN_INTRO, t, T.s3AssistantIn, T.s3IntroCps);
      if (t >= T.s3PlanAt) {
        content += "\n\n```artifact-plan\n" + D.PLAN_JSON + "\n```\n\n" + typed(D.PLAN_TAIL, t, T.s3TailStart, T.s3TailCps);
      }
      messages.push({ id: "a2", role: "assistant", content, created_at: "2026-02-03T10:31:05Z" });
    }
    if (t >= T.s3BuildMsg) {
      messages.push({ id: "u3", role: "user", content: D.BUILD_MESSAGE, created_at: "2026-02-03T10:32:00Z" });
    }
    if (t >= T.s3BuildChipStart) {
      const done = t >= T.s3ArtifactAt;
      messages.push({
        id: "a3",
        role: "assistant",
        content: done ? "```newton-artifact\n" + D.ARTIFACT_BLOCK + "\n```" : "",
        created_at: "2026-02-03T10:32:05Z",
        activity: [{ tool: "create_artifact", label: "Building your interactive demo", done }],
      });
    }
  }

  const s1: ChatSession = { id: "s1", title: null, status: "active", created_at: "2026-02-03T10:24:00Z" };
  const s4: ChatSession = { id: "s4", title: null, status: "active", created_at: "2026-02-03T10:30:00Z" };
  const sessions: ChatSession[] = inS3 ? [s4, s1, ...OLD_SESSIONS] : [s1, ...OLD_SESSIONS];
  if (inS3) first.s1 = D.STUDY_PROMPT;
  const activeId = inS3 ? "s4" : "s1";

  return (
    <div className="app-root">
      <TitleBar title={title} />
      <div className="app-shell">
        <Sidebar
          sessions={sessions}
          activeSessionId={activeId}
          firstMessageBySession={first}
          onSelectSession={() => {}}
          onNewChat={() => {}}
          onDeleteSession={() => {}}
          creatingChat={false}
          username="Priya"
          onSignOut={() => {}}
          onOpenHome={() => {}}
          onOpenDocuments={() => {}}
          onOpenStudyPlan={() => {}}
          onOpenCalendar={() => {}}
          onOpenFlashcards={() => {}}
          onOpenPracticeExams={() => {}}
          onOpenSettings={() => {}}
          onOpenHelp={() => {}}
          mainView="chat"
        />
        <main className="main-pane">
          <header className="main-header">
            <h1 className="main-header-title">{title}</h1>
            <span className="main-header-status">
              <span className="live-dot live-dot--open" aria-hidden="true" />
              Live
            </span>
          </header>
          <ChatPane
            messages={messages}
            loading={false}
            loadError={null}
            token="promo"
            sessionId={activeId}
            onOpenSuggestedPanel={() => {}}
            onOpenDocument={() => {}}
          />
          <div className="math-keyboard-dock" />
          <ScriptedComposer text={composerText} caretOn={caretOn} />
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- notepad window
function NotepadWindow({ t, winRef }: { t: number; winRef: React.RefObject<HTMLDivElement | null> }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<HTMLDivElement>(null);
  const weRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const inPreview = t >= T.nbPreviewClick + 0.1;
  const typedWord = typed(D.NOTE_WORD, t, T.nbTypeStart, T.nbTypeCps);
  const showDefine = t >= T.nbDefineShown;
  const content =
    D.NOTE_INTRO + "\n\n" + D.NOTE_WORD + (showDefine ? "\n\n```newton-note\n" + JSON.stringify({ action: "define", text: D.DEFINE_TEXT }) + "\n```\n" : "");
  const selP = easeOut(prog(t, T.nbSelStart, T.nbSelDur));
  const toolbarP = easeOut(prog(t, T.nbToolbarIn, 0.22));
  const toolbarOn = t >= T.nbToolbarIn && t < T.nbDefineClick + 0.1;
  const caretOn = Math.floor(t * 2) % 2 === 0;

  useLayoutEffect(() => {
    const preview = previewRef.current;
    // closest() rather than winRef: on a first render the parent's ref isn't attached yet
    // when this child layout effect runs.
    const win = (preview?.closest(".promo-win") as HTMLElement | null) ?? winRef.current;
    if (!win || !preview || !inPreview) return;
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
    let node: Node | null = null;
    while ((node = walker.nextNode())) {
      if (node.textContent?.includes(D.NOTE_WORD)) break;
    }
    if (!node) return;
    const idx = (node.textContent as string).indexOf(D.NOTE_WORD);
    const range = document.createRange();
    range.setStart(node, idx);
    range.setEnd(node, idx + D.NOTE_WORD.length);
    const rr = range.getBoundingClientRect();
    const c = win.getBoundingClientRect();
    const s = win.offsetWidth ? c.width / win.offsetWidth : 1;
    const rect = { left: (rr.left - c.left) / s, top: (rr.top - c.top) / s, width: rr.width / s, height: rr.height / s };
    const hl = hlRef.current;
    if (hl) {
      hl.style.left = `${rect.left - 3}px`;
      hl.style.top = `${rect.top - 2}px`;
      hl.style.width = `${(rect.width + 6) * selP}px`;
      hl.style.height = `${rect.height + 4}px`;
    }
    if (wsRef.current) {
      wsRef.current.style.left = `${rect.left}px`;
      wsRef.current.style.top = `${rect.top + rect.height / 2}px`;
    }
    if (weRef.current) {
      weRef.current.style.left = `${rect.left + rect.width}px`;
      weRef.current.style.top = `${rect.top + rect.height / 2}px`;
    }
    if (toolbarRef.current) {
      toolbarRef.current.style.left = `${rect.left}px`;
      toolbarRef.current.style.top = `${rect.top - 44}px`;
    }
  });

  return (
    <div className="app-root">
      <TitleBar title="Newton Notepad" variant="notepad" />
      <div className="notepad-window">
        <div className="notepad-window__editor" style={{ position: "relative" }}>
          <div className="notepad-window__editor-header">
            <button type="button" className="btn-secondary notepad-window__back">
              ← Notes
            </button>
            <input type="text" className="notepad-window__title-input" value={D.NOTE_TITLE} readOnly />
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
              <span className="notepad-window__save-status">Saved</span>
            </div>
          </div>
          <div className="notepad-window__body">
            {inPreview ? (
              <div className="notepad-window__preview" ref={previewRef}>
                <MessageContent content={content} />
              </div>
            ) : (
              <div className="notepad-window__textarea promo-typed" data-promo="nb-body" style={{ alignItems: "flex-start" }}>
                {D.NOTE_INTRO + "\n\n" + typedWord}
                <span className="promo-caret" style={{ opacity: caretOn ? 1 : 0, marginTop: 2 }} />
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
          opacity: inPreview && selP > 0 && !showDefine ? 1 : 0,
        }}
      />
      <div ref={wsRef} data-promo="nb-word-start" style={{ position: "absolute", width: 1, height: 1 }} />
      <div ref={weRef} data-promo="nb-word-end" style={{ position: "absolute", width: 1, height: 1 }} />
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
        <button type="button">Explain</button>
        <button type="button" data-promo="nb-define">
          Define
        </button>
        <button type="button">Summarize</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- captions + composition
const CAPTIONS = [
  { from: 3.0, to: 13.0, text: "Newton checks your work — with real computation." },
  { from: 14.0, to: 22.6, text: "In class: highlight anything. Instant definitions." },
  { from: 24.2, to: 45.6, text: "Ask for a visual. Approve the plan. Watch it build." },
];

export const NewtonPromo: React.FC = () => {
  activeFilm.id = "promo";
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const rootRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const rippleRef = useRef<HTMLDivElement>(null);
  const nbRef = useRef<HTMLDivElement>(null);
  const placeRef = useRef<() => void>(() => {});
  const [assetHandle] = useState(() => delayRender("fonts + artifact"));

  useEffect(() => {
    const fonts = [
      "400 16px 'Public Sans'",
      "500 16px 'Public Sans'",
      "600 16px 'Public Sans'",
      "700 16px 'Public Sans'",
      "600 16px 'Fraunces Variable'",
      "italic 500 16px 'Fraunces Variable'",
      "400 16px 'Fraunces Variable'",
    ].map((f) => document.fonts.load(f));
    Promise.all([...fonts, artifactReady])
      .then(() => document.fonts.ready)
      .catch(() => {})
      .finally(() => continueRender(assetHandle));
  }, [assetHandle]);

  const artifactActive = t >= T.s3ArtifactAt;
  const angle = dragAngle(t);
  useArtifactDrive(artifactActive, artifactActive ? angle : 30, () => placeRef.current());

  useLayoutEffect(() => {
    const place = () => {
      const root = rootRef.current;
      const cur = cursorRef.current;
      const rip = rippleRef.current;
      if (!root || !cur || !rip) return;
      // ChatPane pins itself to the bottom in a passive effect, which can land a frame
      // late in a frame-by-frame render; do it synchronously, before any target is
      // measured (cursor targets move with the scroll position).
      // The real ArtifactBlock owns its `expanded` state, so drive it the way a user does
      // -- but exactly ONCE per desired state. place() runs several times per frame
      // (artifact polling), and React applies the click asynchronously, so keying off the
      // DOM's own aria-pressed re-clicked (= toggled back) within the same frame and made
      // the block flip between expanded and collapsed. A marker attribute records the
      // state we've already asked for.
      const blockEl = root.querySelector<HTMLElement>(".artifact-block");
      if (blockEl) {
        const want = t >= T.s3ExpandClick ? "1" : "0";
        if (blockEl.getAttribute("data-promo-want") !== want) {
          const isExpanded = blockEl.classList.contains("artifact-block--expanded");
          const btn = blockEl.querySelector<HTMLButtonElement>(".artifact-block__actions button");
          if (btn && isExpanded !== (want === "1")) btn.click();
          blockEl.setAttribute("data-promo-want", want);
        }
      }
      root.querySelectorAll<HTMLElement>(".chat-pane").forEach((el) => {
        // the app's CSS smooth-scrolls; a frame-by-frame render needs the jump immediately
        let top = el.scrollHeight;
        const block = el.querySelector<HTMLElement>(".artifact-block");
        if (block && t >= T.s3ExpandClick) {
          // once expanded the block is taller than the pane: frame the block from its top
          const pr = el.getBoundingClientRect();
          const s = el.offsetWidth ? pr.width / el.offsetWidth : 1;
          top = (block.getBoundingClientRect().top - pr.top) / s + el.scrollTop - 10;
        }
        el.scrollTo({ top, behavior: "instant" });
      });
      // ArtifactBlock's iframe is loading="lazy": in a headless frame render it may never
      // count as near-viewport, so it would never load.
      root.querySelectorAll<HTMLIFrameElement>(".artifact-block__frame").forEach((f) => {
        if (f.loading !== "eager") f.loading = "eager";
      });
      const p = cursorAt(root, t, CURSOR, customTarget);
      cur.style.transform = `translate(${p.x - 4}px, ${p.y - 2}px)`;
      cur.style.opacity = String(clamp01((t - (CURSOR[0].t - 0.3)) / 0.3) * (t > T.outroStart ? 0 : 1));
      let ripple = 0;
      for (const c of CLICKS) {
        const d = t - c.t;
        if (d >= 0 && d < 0.5) ripple = d / 0.5;
        const el = findTarget(root, c.target);
        if (el && PRESSABLE.has(c.target)) el.classList.toggle("promo-pressed", d >= 0 && d < 0.16);
      }
      rip.style.transform = `translate(${p.x}px, ${p.y}px) scale(${0.3 + ripple * 1.5})`;
      rip.style.opacity = ripple > 0 ? String(0.9 * (1 - ripple)) : "0";
    };
    placeRef.current = place;
    place();
  });

  // window choreography
  const winIn = easeOut(prog(t, T.windowIn, 0.9));
  const outroP = easeInOut(prog(t, T.outroStart, 0.8));
  const mainScale = MAIN.scale * (0.94 + 0.06 * winIn) * (1 - 0.05 * outroP);
  const mainOpacity = winIn * (1 - outroP);
  const nbIn = easeOut(prog(t, T.nbIn, T.nbInDur));
  const nbOut = easeInOut(prog(t, T.nbOut, T.nbOutDur));
  const nbVisible = nbIn * (1 - nbOut) * (1 - outroP);
  const dim = 1 - 0.42 * nbIn * (1 - nbOut);
  const blur = 2.5 * nbIn * (1 - nbOut);

  const captionOpacity = (from: number, to: number) =>
    easeOut(prog(t, from, 0.35)) * (1 - easeOut(prog(t, to - 0.35, 0.35)));

  const introOpacity = easeOut(prog(t, 0.25, 0.7)) * (1 - easeInOut(prog(t, 1.25, 0.6)));
  const outroOpacity =
    easeOut(prog(t, T.outroStart + 0.9, 0.7)) * (1 - easeInOut(prog(t, T.total - 0.55, 0.5)));

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
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: WALLPAPER,
          }}
        />
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
          ref={nbRef}
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
          <NotepadWindow t={t} winRef={nbRef} />
        </div>
        <div ref={rippleRef} className="promo-ripple" />
        <div ref={cursorRef} className="promo-cursor">
          <CursorArrow />
        </div>
      </div>

      {/* Generated by `npm run audio` (make_audio.py) from the same timeline. The website
          copy is rendered with --muted, so this only ever reaches the standalone film. */}
      <Audio src={staticFile("promo-audio.wav")} />

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
        <div className="promo-tagline">Built to teach you, not do it for you.</div>
      </div>
    </div>
  );
};
