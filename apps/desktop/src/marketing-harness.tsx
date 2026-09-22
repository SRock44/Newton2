import React from "react";
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
import Composer from "./components/Composer";
import type { ChatMessage, ChatSession } from "./types";
import { API_URL } from "./api";

// DEV-ONLY marketing screenshot harness. Not part of the shipped app (no entry in
// index.html, not referenced by main.tsx) -- built to capture REAL screenshots of the
// REAL app components (Sidebar/TitleBar/ChatPane/MessageBubble/MessageContent/
// ArtifactBlock, unmodified) for the website's product walkthrough, instead of the
// website hand-recreating an approximation of the app's look. Deleted after the
// screenshots are captured -- see the capture script for the exact steps.
//
// The one thing genuinely faked here is the network: these components normally get
// their data from a live backend over a WS + token. This harness feeds ChatPane real,
// previously-captured backend transcript content directly as a `messages` prop instead
// (see git history of apps/website/src/data/demo-transcripts.json, scenario
// "math-catches-mistake", for the real chunk-by-chunk backend transcript this
// reconstructs verbatim) and stubs `window.fetch` only for the couple of REST calls
// these components make on mount (billing status, the artifact's raw HTML). No chat
// content, tool-activity label, or artifact is invented for this harness -- only the
// account plumbing around them (avatar name, gamification stub) is placeholder.

const REAL_TOKEN = "harness-token";

const ARTIFACT_DOCUMENT_ID = "c981228f-c878-454a-a4b9-ed5f59092e8a";
const ARTIFACT_URL_SUFFIX = `/documents/${ARTIFACT_DOCUMENT_ID}/raw`;

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

  if (url.startsWith(API_URL) && url.includes(ARTIFACT_URL_SUFFIX)) {
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

// Reconstructed verbatim (chunk-by-chunk concatenation) from the real captured
// "math-catches-mistake" backend transcript -- see this file's header comment.
const STUDY_MODE_REPLY =
  "I checked your work with real symbolic math, and it's not right yet — let me point to exactly where.\n\n" +
  "Your answer, **(x + 1)(x + 6), expands to x² + 7x + 6**, not x² + 5x + 6. The problem is the middle term: 1 + 6 = 7, but you need it to sum to 5.\n\n" +
  "Here's the thinking that's missing: when you factor x² + 5x + 6, you're looking for **two numbers that multiply to 6 AND add to 5**. You found a pair that multiplies to 6 correctly (1 and 6), but the sum gives the wrong middle term.\n\n" +
  "Try this: can you find a *different* pair of numbers that multiply to 6 but add up to 5 instead of 7? Once you have that pair, plug them in as (x + _)(x + _) and check by expanding — the real computation confirms the correct factorization is (x + 2)(x + 3), but I want to see you get there. What pair do you think works?";

const STUDY_MODE_MESSAGES: ChatMessage[] = [
  {
    id: "m1",
    role: "user",
    content: FIRST_MESSAGE_BY_SESSION.s1,
    created_at: "2026-02-03T14:00:00Z",
  },
  {
    id: "m2",
    role: "assistant",
    content: STUDY_MODE_REPLY,
    created_at: "2026-02-03T14:00:05Z",
    prompt_tokens: 812,
    completion_tokens: 190,
    activity: [
      { tool: "symbolic_math", label: "Solving with symbolic math", done: true, verified: true },
      { tool: "symbolic_math", label: "Solving with symbolic math", done: true, verified: true },
      { tool: "check_student_work", label: "Checking your work", done: true, verified: true },
    ],
  },
];

// The real backend response contract for a generated artifact (see ArtifactBlock.tsx's
// own doc comment): the chat message carries only this fenced block, never invented
// explanatory prose -- ArtifactBlock renders its own real title/kind chip UI around it.
const ARTIFACT_MESSAGES: ChatMessage[] = [
  {
    id: "m3",
    role: "user",
    content: FIRST_MESSAGE_BY_SESSION.s3,
    created_at: "2026-02-01T10:00:00Z",
  },
  {
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
  },
];

function Scene({
  id,
  username,
  activeSessionId,
  messages,
  mainHeaderTitle,
}: {
  id: string;
  username: string;
  activeSessionId: string;
  messages: ChatMessage[];
  mainHeaderTitle: string;
}) {
  return (
    <div id={id} className="app-root harness-scene">
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
          username={username}
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
          <ChatPane
            messages={messages}
            loading={false}
            loadError={null}
            token={REAL_TOKEN}
            sessionId={activeSessionId}
            onOpenSuggestedPanel={() => {}}
            onOpenDocument={() => {}}
          />
          <div id={`${id}-keyboard-dock`} className="math-keyboard-dock" />
          <Composer
            onSend={() => {}}
            disabled
            token={REAL_TOKEN}
            sessionId={activeSessionId}
            placeholder="Ask Newton anything…"
          />
        </main>
      </div>
    </div>
  );
}

// Real note content, carried over from the earlier hand-built Notepad section (traced
// to the real captured "document-reference"/hysteresis backend transcript). The
// surrounding chrome here (.notepad-window / .notepad-window__editor / .toolbar /
// .selection-toolbar) is the real Notepad companion window's own CSS, unmodified — the
// one thing NOT literally the live stateful NotepadWindow component, since that
// component's data comes from a `notepad-auth` Tauri event this harness has no bridge
// for. Reproduced markup, real classnames, real content; noted here for anyone auditing
// what's "real app" vs "recreated" in this harness the way ArtifactBlock/ChatPane are.
function NotepadScene() {
  return (
    <div
      id="scene-notepad"
      className="app-root harness-scene harness-scene--notepad"
      style={{ width: 640, height: 230, overflow: "hidden", position: "relative" }}
    >
      <TitleBar title="Newton Notepad" variant="notepad" />
      <div className="notepad-window">
        <div className="notepad-window__editor">
          <div className="notepad-window__editor-header">
            <button type="button" className="btn-secondary notepad-window__back">
              ← Notes
            </button>
            <input
              type="text"
              className="notepad-window__title-input"
              defaultValue="Lecture 14 — Electromagnetism"
              readOnly
            />
          </div>
          <div className="notepad-window__toolbar">
            <div className="notepad-window__mode-toggle">
              <button type="button" className="notepad-window__mode-btn">
                Write
              </button>
              <button type="button" className="notepad-window__mode-btn--active">
                Preview
              </button>
            </div>
            <div className="notepad-window__toolbar-right">
              <span className="notepad-window__save-status">Saved</span>
            </div>
          </div>
          <div className="notepad-window__body">
            <div className="notepad-window__preview">
              <p>
                Hysteresis loops show how magnetization lags the applied field.{" "}
                <span className="harness-selection">the coercive field is path-dependent</span>{" "}
                — depends on the material&apos;s prior magnetic history, not just its
                current state.
              </p>
            </div>
          </div>
          <div
            className="notepad-window__selection-toolbar"
            style={{ position: "absolute", top: 78, left: 372 }}
          >
            <button type="button">Explain</button>
            <button type="button">Define</button>
            <button type="button">Summarize</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Harness() {
  return (
    <div className="harness-root">
      <NotepadScene />
      <Scene
        id="scene-study"
        username="Priya"
        activeSessionId="s1"
        messages={STUDY_MODE_MESSAGES}
        mainHeaderTitle="Factoring practice"
      />
      <Scene
        id="scene-artifact"
        username="Priya"
        activeSessionId="s3"
        messages={ARTIFACT_MESSAGES}
        mainHeaderTitle="Unit circle explorer"
      />
    </div>
  );
}

const style = document.createElement("style");
style.textContent = `
  .harness-selection { background-color: rgba(47, 77, 140, 0.16); border-radius: 2px; }
  .harness-scene--notepad .notepad-window { box-shadow: none; }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
);
