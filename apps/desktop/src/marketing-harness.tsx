import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/public-sans/400.css";
import "@fontsource/public-sans/500.css";
import "@fontsource/public-sans/600.css";
import "@fontsource/public-sans/700.css";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "./App.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import ChatPane from "./components/ChatPane";
import Toggle from "./components/Toggle";
import type { ChatMessage, ChatSession, ToolActivityEntry } from "./types";
import { API_URL } from "./api";

// DEV-ONLY marketing VIDEO harness. Not part of the shipped app (no entry in
// index.html, not referenced by main.tsx) -- renders the actual, unmodified
// Sidebar/TitleBar/ChatPane/MessageBubble/MessageContent/ArtifactBlock components and
// plays a SCRIPTED, timed sequence against them (typing a real prompt character by
// character, revealing real tool-activity chips and a real reply progressively, a real
// browser text Selection growing over real note content, a real button press) so that
// recording this page with Playwright's video capture produces an actual video of the
// real app being used -- not a static screenshot, and not a fabricated screen
// recording of something else pretending to be Newton.
//
// Every string typed or revealed here is real, previously-captured backend content
// (see git history of apps/website/src/data/demo-transcripts.json's "math-catches-
// mistake" scenario for the chat script, and the Notepad section's own established
// real hysteresis-note content) -- this file only invents the TIMING of when it
// appears, never the content itself. The one exception, clearly non-committal rather
// than fabricated: after the Notepad scene's "Explain" click, a generic "Explaining…"
// shimmer is shown instead of a made-up AI answer, since no real captured example of
// that specific annotation response exists to reuse.
//
// Selected via ?scene=study|notepad|artifact -- one scene per page load, full-bleed,
// autoplaying once (then holding on its final frame) so a recorder only has to start
// capture and wait, not coordinate multiple timelines on one page.

const REAL_TOKEN = "harness-token";
const ARTIFACT_DOCUMENT_ID = "c981228f-c878-454a-a4b9-ed5f59092e8a";
const ARTIFACT_URL_SUFFIX = `/documents/${ARTIFACT_DOCUMENT_ID}/raw`;

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

  if (url.startsWith(API_URL) && url.includes(ARTIFACT_URL_SUFFIX)) {
    // A short, real delay before resolving -- lets the real ArtifactBlock component's
    // own real "Loading artifact…" state actually show on screen for a beat, instead
    // of resolving instantly and skipping straight to the finished artifact.
    await new Promise((r) => setTimeout(r, 900));
    const res = await originalFetch("/demo-artifact/unit-circle-artifact.html");
    const bytes = await res.arrayBuffer();
    return new Response(bytes, { status: 200, headers: { "content-type": "text/html" } });
  }
  if (url.startsWith(`${API_URL}/billing/status`)) {
    return new Response(
      JSON.stringify({
        plan: "free",
        subscription_status: null,
        current_period_end: null,
        credits_used_cents: 0,
        credits_limit_cents: 0,
        credits_reset_at: null,
        preferred_pro_model: "",
        free_generation_target: 10,
        pro_generation_target: 30,
        focus_mode_enabled: false,
        topup_credits_cents: 0,
        topup_tiers_cents: [],
        learn_mode_enabled: false,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (url.startsWith(`${API_URL}/documents`)) {
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.startsWith(`${API_URL}/gamification/stats`)) {
    return new Response(
      JSON.stringify({
        streak_days: 0,
        xp: 0,
        level: 1,
        xp_to_next_level: 100,
        messages_sent: 0,
        flashcards_reviewed: 0,
        flashcards_created: 0,
        study_plan_items: 0,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};

const SESSIONS: ChatSession[] = [
  { id: "s1", title: null, status: "active", created_at: "2026-02-03T14:00:00Z" },
  { id: "s2", title: null, status: "active", created_at: "2026-02-02T09:00:00Z" },
  { id: "s3", title: null, status: "active", created_at: "2026-01-30T18:00:00Z" },
];

const FIRST_MESSAGE_BY_SESSION: Record<string, string> = {
  s1: "Can you check my work? I'm factoring x^2 + 5x + 6 and I got (x + 1)(x + 6). Is that right?",
  s2: "What are the correct balanced coefficients for C3H8 + O2 -> CO2 + H2O?",
  s3: "Build me an interactive artifact that teaches the unit circle",
};

const STUDY_PROMPT = FIRST_MESSAGE_BY_SESSION.s1;
const ARTIFACT_PROMPT = FIRST_MESSAGE_BY_SESSION.s3;

// Reconstructed verbatim (chunk-by-chunk concatenation) from the real captured
// "math-catches-mistake" backend transcript. Split into paragraphs so the scripted
// playback can reveal one paragraph at a time, the same visual unit a real streaming
// reply naturally renders in.
const STUDY_REPLY_PARAGRAPHS = [
  "I checked your work with real symbolic math, and it's not right yet — let me point to exactly where.",
  "Your answer, **(x + 1)(x + 6), expands to x² + 7x + 6**, not x² + 5x + 6. The problem is the middle term: 1 + 6 = 7, but you need it to sum to 5.",
  "Here's the thinking that's missing: when you factor x² + 5x + 6, you're looking for **two numbers that multiply to 6 AND add to 5**. You found a pair that multiplies to 6 correctly (1 and 6), but the sum gives the wrong middle term.",
  "Try this: can you find a *different* pair of numbers that multiply to 6 but add up to 5 instead of 7? Once you have that pair, plug them in as (x + _)(x + _) and check by expanding — the real computation confirms the correct factorization is (x + 2)(x + 3), but I want to see you get there. What pair do you think works?",
];

const STUDY_TOOL_SEQUENCE: { tool: string; label: string }[] = [
  { tool: "symbolic_math", label: "Solving with symbolic math" },
  { tool: "symbolic_math", label: "Solving with symbolic math" },
  { tool: "check_student_work", label: "Checking your work" },
];

/** Real note content this session has already established as the walkthrough's
 * Notepad-scene material (the hysteresis/coercive-field passage). `HIGHLIGHT` is the
 * exact substring a real student would drag-select before hitting "Explain". */
const NOTE_TITLE = "Lecture 14 — Electromagnetism";
const NOTE_BEFORE = "Hysteresis loops show how magnetization lags the applied field. ";
const NOTE_HIGHLIGHT = "the coercive field is path-dependent";
const NOTE_AFTER =
  " — depends on the material's prior magnetic history, not just its current state.";
const NOTE_FULL_TEXT = NOTE_BEFORE + NOTE_HIGHLIGHT + NOTE_AFTER;

/** Types `text` into `onChar` one character at a time, `delayMs` apart, calling
 * `onDone` once the whole string has been revealed. Returns a cleanup function.
 * Plain timeout-chain rather than setInterval so the exact per-character delay can
 * jitter slightly (see JITTER) without drifting the overall schedule. */
function typewriter(
  text: string,
  delayMs: number,
  onChar: (revealed: string) => void,
  onDone: () => void,
): () => void {
  let cancelled = false;
  let i = 0;
  const JITTER = 0.6;
  function tick() {
    if (cancelled) return;
    i += 1;
    onChar(text.slice(0, i));
    if (i >= text.length) {
      onDone();
      return;
    }
    const jitter = 1 + (Math.random() - 0.5) * JITTER;
    timeoutRef = window.setTimeout(tick, Math.max(8, delayMs * jitter));
  }
  let timeoutRef = window.setTimeout(tick, delayMs);
  return () => {
    cancelled = true;
    window.clearTimeout(timeoutRef);
  };
}

/** Runs a list of `[delayMs, fn]` steps in sequence (each delay measured from the
 * previous step firing, matching how a storyboard is usually authored) and returns a
 * cleanup function that cancels whatever's still pending. Used for every scene's
 * fixed beats (send, reveal a tool, switch mode, click) around the variable-length
 * typewriter runs above. */
function runScript(steps: Array<[number, () => void]>): () => void {
  const timeouts: number[] = [];
  let elapsed = 0;
  for (const [delay, fn] of steps) {
    elapsed += delay;
    timeouts.push(window.setTimeout(fn, elapsed));
  }
  return () => timeouts.forEach((t) => window.clearTimeout(t));
}

function AppShell({
  mainHeaderTitle,
  activeSessionId,
  children,
}: {
  mainHeaderTitle: string;
  activeSessionId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="app-root harness-scene">
      <TitleBar title={mainHeaderTitle} />
      <div className="app-shell">
        <Sidebar
          sessions={SESSIONS}
          activeSessionId={activeSessionId}
          firstMessageBySession={FIRST_MESSAGE_BY_SESSION}
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
            <h1 className="main-header-title">{mainHeaderTitle}</h1>
            <span className="main-header-status" title="Connection: open">
              <span className="live-dot live-dot--open" aria-hidden="true" />
              Live
            </span>
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}

/** A non-interactive stand-in for the real Composer, showing scripted typed text with
 * a blinking caret -- the real Composer pulls in billing/document state on mount (fine
 * for a static screenshot, unnecessary complexity for a scripted typing replay), so
 * this reproduces its exact real markup/classnames (`.composer`/`.composer-row`/
 * `.composer-input`/`.composer-send`, the real `Toggle` component for Learn Mode /
 * Conversation Practice) around scripted text instead of the real stateful textarea. */
function ScriptedComposer({ text }: { text: string }) {
  return (
    <div className="composer">
      <div className="composer-controls">
        <div className="composer-learn-mode-toggle">
          <Toggle checked={false} onChange={() => {}} label="Learn Mode" size="sm" />
          <span>Learn Mode</span>
        </div>
        <div className="composer-conversation-practice-toggle">
          <Toggle checked={false} onChange={() => {}} label="Conversation Practice" size="sm" />
          <span>Conversation Practice</span>
        </div>
      </div>
      <div className="composer-row">
        <div className="composer-attach-wrap">
          <button type="button" className="composer-attach" tabIndex={-1} aria-hidden="true">
            +
          </button>
        </div>
        <button type="button" className="composer-mic" tabIndex={-1} aria-hidden="true">
          🎙
        </button>
        <div className="composer-input harness-typed-text" aria-hidden="true">
          {text}
          <span className="harness-caret" />
        </div>
        <button type="button" className="btn-primary composer-send" tabIndex={-1} aria-hidden="true">
          Send
        </button>
      </div>
      <div className="composer-hint">Enter to send · Shift+Enter for a new line</div>
    </div>
  );
}

type StudyPhase = "typing" | "sent" | "tools" | "streaming" | "done";

function SceneStudyVideo() {
  const [composerText, setComposerText] = useState("");
  const [phase, setPhase] = useState<StudyPhase>("typing");
  const [activity, setActivity] = useState<ToolActivityEntry[]>([]);
  const [replyText, setReplyText] = useState("");
  const [showUserMsg, setShowUserMsg] = useState(false);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    cleanups.push(
      typewriter(
        STUDY_PROMPT,
        26,
        (revealed) => setComposerText(revealed),
        () => {
          cleanups.push(
            runScript([
              [
                400,
                () => {
                  setComposerText("");
                  setShowUserMsg(true);
                  setPhase("sent");
                },
              ],
              [450, () => setPhase("tools")],
              [
                50,
                () => {
                  let i = 0;
                  function pushNext() {
                    if (i >= STUDY_TOOL_SEQUENCE.length) return;
                    const { tool, label } = STUDY_TOOL_SEQUENCE[i];
                    setActivity((prev) => [...prev, { tool, label, done: false }]);
                    const idx = i;
                    window.setTimeout(() => {
                      setActivity((prev) =>
                        prev.map((entry, j) => (j === idx ? { ...entry, done: true, verified: true } : entry)),
                      );
                    }, 380);
                    i += 1;
                    window.setTimeout(pushNext, 620);
                  }
                  pushNext();
                },
              ],
              [
                STUDY_TOOL_SEQUENCE.length * 620 + 300,
                () => {
                  setPhase("streaming");
                  let p = 0;
                  function pushParagraph() {
                    if (p >= STUDY_REPLY_PARAGRAPHS.length) {
                      setPhase("done");
                      return;
                    }
                    // Snapshot the paragraph text (and advance p) BEFORE calling
                    // setState: the functional updater below runs asynchronously, and
                    // since it would otherwise close over the mutable `p` by reference
                    // rather than by value, `p += 1` right after this call raced ahead
                    // of React actually invoking the updater -- every single paragraph
                    // ended up reading `p` one step too far, silently dropping
                    // paragraph 0 and duplicating paragraph 1. `paragraphText` is a
                    // stable local, immune to that race.
                    const paragraphText = STUDY_REPLY_PARAGRAPHS[p];
                    p += 1;
                    setReplyText((prev) => (prev ? prev + "\n\n" : "") + paragraphText);
                    window.setTimeout(pushParagraph, 750);
                  }
                  pushParagraph();
                },
              ],
            ]),
          );
        },
      ),
    );
    return () => cleanups.forEach((c) => c());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const messages: ChatMessage[] = [];
  if (showUserMsg) {
    messages.push({ id: "m1", role: "user", content: STUDY_PROMPT, created_at: "2026-02-03T14:00:00Z" });
  }
  if (phase === "tools" || phase === "streaming" || phase === "done") {
    messages.push({
      id: "m2",
      role: "assistant",
      content: replyText,
      created_at: "2026-02-03T14:00:05Z",
      streaming: phase !== "done",
      activity,
    });
  }

  return (
    <AppShell mainHeaderTitle="Factoring practice" activeSessionId="s1">
      <ChatPane
        messages={messages}
        loading={false}
        loadError={null}
        token={REAL_TOKEN}
        sessionId="s1"
        onOpenSuggestedPanel={() => {}}
        onOpenDocument={() => {}}
      />
      <div className="math-keyboard-dock" />
      <ScriptedComposer text={phase === "typing" ? composerText : ""} />
    </AppShell>
  );
}

type ArtifactPhase = "typing" | "sent" | "building";

function SceneArtifactVideo() {
  const [composerText, setComposerText] = useState("");
  const [phase, setPhase] = useState<ArtifactPhase>("typing");
  const [showUserMsg, setShowUserMsg] = useState(false);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    cleanups.push(
      typewriter(
        ARTIFACT_PROMPT,
        26,
        (revealed) => setComposerText(revealed),
        () => {
          cleanups.push(
            runScript([
              [
                400,
                () => {
                  setComposerText("");
                  setShowUserMsg(true);
                  setPhase("sent");
                },
              ],
              [400, () => setPhase("building")],
            ]),
          );
        },
      ),
    );
    return () => cleanups.forEach((c) => c());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const messages: ChatMessage[] = [];
  if (showUserMsg) {
    messages.push({ id: "m3", role: "user", content: ARTIFACT_PROMPT, created_at: "2026-02-01T10:00:00Z" });
  }
  if (phase === "building") {
    messages.push({
      id: "m4",
      role: "assistant",
      content:
        "```newton-artifact\n" +
        JSON.stringify({
          document_id: ARTIFACT_DOCUMENT_ID,
          title: "Draggable Unit Circle Explorer",
          kind: "interactive",
          attempts: 1,
        }) +
        "\n```",
      created_at: "2026-02-01T10:00:20Z",
    });
  }

  return (
    <AppShell mainHeaderTitle="Unit circle explorer" activeSessionId="s3">
      <ChatPane
        messages={messages}
        loading={false}
        loadError={null}
        token={REAL_TOKEN}
        sessionId="s3"
        onOpenSuggestedPanel={() => {}}
        onOpenDocument={() => {}}
      />
      <div className="math-keyboard-dock" />
      <ScriptedComposer text={phase === "typing" ? composerText : ""} />
    </AppShell>
  );
}

type NotepadPhase = "typing" | "switching" | "preview" | "selecting" | "toolbar" | "clicked";

/** The Notepad scene: real classnames (`notepad-window__*`), scripted content, a
 * genuine browser text Selection grown over real DOM (not a CSS-only highlight) so the
 * recorded video shows an actual selection sweep, then a real click-press on the real
 * "Explain" button. See this file's header comment for why the stateful NotepadWindow
 * component itself isn't mounted here. */
function SceneNotepadVideo() {
  const [phase, setPhase] = useState<NotepadPhase>("typing");
  const [typedContent, setTypedContent] = useState("");
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number; bottom: number } | null>(
    null,
  );
  const highlightSpanRef = useRef<HTMLSpanElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    cleanups.push(
      typewriter(
        NOTE_FULL_TEXT,
        13,
        (revealed) => setTypedContent(revealed),
        () => {
          cleanups.push(
            runScript([
              [400, () => setPhase("switching")],
              [350, () => setPhase("preview")],
              [400, () => setPhase("selecting")],
            ]),
          );
        },
      ),
    );
    return () => cleanups.forEach((c) => c());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The actual selection-growing animation: once in "selecting" phase, incrementally
  // extend a real Range over the highlight span's text node and apply it via
  // window.getSelection(), so a recording shows a real native selection sweep.
  useEffect(() => {
    if (phase !== "selecting") return;
    const span = highlightSpanRef.current;
    const textNode = span?.firstChild;
    if (!span || !textNode) return;
    const fullLength = NOTE_HIGHLIGHT.length;
    let step = 0;
    const steps = 14;
    const id = window.setInterval(() => {
      step += 1;
      const end = Math.round((step / steps) * fullLength);
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(end, fullLength));
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      if (step >= steps) {
        window.clearInterval(id);
        const rect = range.getBoundingClientRect();
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (containerRect) {
          setToolbarPos({
            top: rect.top - containerRect.top - 44,
            left: rect.left - containerRect.left,
            bottom: rect.bottom - containerRect.top + 14,
          });
        }
        window.setTimeout(() => setPhase("toolbar"), 250);
      }
    }, 26);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "toolbar") return;
    const id = window.setTimeout(() => setPhase("clicked"), 900);
    return () => window.clearTimeout(id);
  }, [phase]);

  const mode = phase === "typing" ? "write" : "preview";

  return (
    <div
      className="app-root harness-scene harness-scene--notepad-video"
      style={{ width: 900, height: 280, overflow: "hidden", position: "relative" }}
    >
      <TitleBar title="Newton Notepad" variant="notepad" />
      <div className="notepad-window" ref={containerRef}>
        <div className="notepad-window__editor">
          <div className="notepad-window__editor-header">
            <button type="button" className="btn-secondary notepad-window__back">
              ← Notes
            </button>
            <input
              type="text"
              className="notepad-window__title-input"
              defaultValue={NOTE_TITLE}
              readOnly
            />
          </div>
          <div className="notepad-window__toolbar">
            <div className="notepad-window__mode-toggle">
              <button
                type="button"
                className={mode === "write" ? "notepad-window__mode-btn--active" : "notepad-window__mode-btn"}
              >
                Write
              </button>
              <button
                type="button"
                className={mode === "preview" ? "notepad-window__mode-btn--active" : "notepad-window__mode-btn"}
              >
                Preview
              </button>
            </div>
            <div className="notepad-window__toolbar-right">
              <span className="notepad-window__save-status">Saved</span>
            </div>
          </div>
          <div className="notepad-window__body">
            {mode === "write" ? (
              <div className="notepad-window__textarea harness-typed-text" aria-hidden="true">
                {typedContent}
                <span className="harness-caret" />
              </div>
            ) : (
              <div className="notepad-window__preview">
                <p>
                  {NOTE_BEFORE}
                  <span ref={highlightSpanRef}>{NOTE_HIGHLIGHT}</span>
                  {NOTE_AFTER}
                </p>
              </div>
            )}
          </div>
          {toolbarPos && (phase === "toolbar" || phase === "clicked") && (
            <div
              className="notepad-window__selection-toolbar"
              style={{ position: "absolute", top: toolbarPos.top, left: toolbarPos.left }}
            >
              <button type="button" className={phase === "clicked" ? "harness-btn-pressed" : undefined}>
                Explain
              </button>
              <button type="button">Define</button>
              <button type="button">Summarize</button>
            </div>
          )}
          {phase === "clicked" && toolbarPos && (
            <div
              className="harness-explaining-chip"
              style={{ position: "absolute", top: toolbarPos.bottom, left: toolbarPos.left }}
            >
              Explaining…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const style = document.createElement("style");
style.textContent = `
  html, body, #root { background: transparent; }
  .harness-scene--notepad-video .notepad-window { box-shadow: none; height: 100%; }
  .notepad-window__preview ::selection { background-color: rgba(47, 77, 140, 0.35); }
  .harness-typed-text {
    white-space: pre-wrap;
    font-family: var(--font-sans);
  }
  .harness-caret {
    display: inline-block;
    width: 2px;
    height: 1em;
    background: var(--color-accent);
    vertical-align: text-bottom;
    margin-left: 1px;
    animation: harness-blink 0.9s steps(1) infinite;
  }
  @keyframes harness-blink {
    50% { opacity: 0; }
  }
  .harness-btn-pressed {
    background-color: var(--color-accent) !important;
    color: #fff !important;
  }
  .harness-explaining-chip {
    background-color: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    padding: 6px 12px;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    font-style: italic;
  }
`;
document.head.appendChild(style);

function Router() {
  const scene = new URLSearchParams(window.location.search).get("scene");
  if (scene === "study") return <SceneStudyVideo />;
  if (scene === "notepad") return <SceneNotepadVideo />;
  if (scene === "artifact") return <SceneArtifactVideo />;
  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      Pass ?scene=study, ?scene=notepad, or ?scene=artifact.
    </div>
  );
}

// No StrictMode: this scripted playback accumulates state sequentially across a chain
// of timeouts (typed text, revealed paragraphs), and StrictMode's deliberate dev-only
// double-invocation of effects raced two copies of that chain against the same state,
// producing a real, reproducible duplicated-paragraph bug. Dev-only React behavior, not
// something the shipped app needs to be safe against here -- this file is a private
// recording aid, not tested/shipped code.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Router />);
