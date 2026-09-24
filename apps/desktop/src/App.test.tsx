import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import type { ChatMessage, ChatSession } from "./types";

const sessions: ChatSession[] = [
  { id: "s1", title: null, status: "active", created_at: new Date().toISOString() },
  { id: "s2", title: "Physics review", status: "active", created_at: new Date().toISOString() },
];

const messagesBySession: Record<string, ChatMessage[]> = {
  s1: [
    { id: "m1", role: "user", content: "Hello from s1" },
    { id: "m2", role: "assistant", content: "Here's the file.\n\n[Attached document: doc-1|syllabus.pdf]" },
  ],
  s2: [{ id: "m3", role: "assistant", content: "Reply in s2" }],
};

function makeFakeSocket() {
  const socket = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onclose: null,
    onmessage: null,
    onerror: null,
  } as unknown as WebSocket & {
    onopen: (() => void) | null;
    onmessage: ((ev: { data: string }) => void) | null;
  };
  // Simulates the real server round trip (see services/api/app/routers/chat.py's
  // chat_ws): accept, then ack the "auth" frame App.tsx's onopen sends with an
  // "auth_ok" message, which is what App.tsx now actually waits for before treating
  // the connection as usable (readyState alone isn't enough post-fix -- see
  // wsAuthedRef's own comment in App.tsx). Deferred to a microtask, not called
  // synchronously here, because App.tsx assigns onopen/onmessage AFTER this factory
  // returns; a microtask still runs under vi.useFakeTimers() (which only fakes
  // macrotasks), so this stays reliable in the keepalive/reconnect tests below too.
  queueMicrotask(() => {
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: "auth_ok" }) });
  });
  return socket;
}

/** Like makeFakeSocket() but never simulates the server side of the handshake at all --
 * for tests that specifically want a connection attempt to never succeed (e.g. two
 * CONSECUTIVE reconnect failures, to prove the backoff keeps doubling rather than
 * resetting). makeFakeSocket()'s auto-"auth_ok" would otherwise race ahead of a test's
 * own act()/onclose() calls and reset reconnectAttempt out from under it, the same way
 * a real socket that genuinely never finished authenticating never would. */
function makeFakeSocketNoAutoAuth() {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onclose: null,
    onmessage: null,
    onerror: null,
  } as unknown as WebSocket;
}

vi.mock("./api", () => ({
  ApiError: class ApiError extends Error {},
  KEYCLOAK_URL: "http://127.0.0.1:58180",
  listSessions: vi.fn(async () => sessions),
  createSession: vi.fn(async () => "new-session-id"),
  getMessages: vi.fn(async (_token: string, sessionId: string) => messagesBySession[sessionId] ?? []),
  endSession: vi.fn(async () => ({})),
  deleteSession: vi.fn(async () => undefined),
  deleteMessageAndAfter: vi.fn(async () => undefined),
  openChatSocket: vi.fn(() => makeFakeSocket()),
  listTools: vi.fn(async () => []),
  getGamificationStats: vi.fn(async () => ({ streak_days: 0, xp: 0, level: 1, xp_to_next_level: 100 })),
  listFlashcards: vi.fn(async () => []),
  listStudyPlan: vi.fn(async () => []),
  listDocuments: vi.fn(async () => []),
  listNotes: vi.fn(async () => []),
  getNote: vi.fn(async (_token: string, noteId: string) => ({
    id: noteId,
    title: "",
    content: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags: [],
  })),
  getDocumentContent: vi.fn(async () => ({ content: "", editable: true })),
  getBillingStatus: vi.fn(async () => ({
    plan: "free",
    subscription_status: null,
    current_period_end: null,
    credits_used_cents: 0,
    credits_limit_cents: 0,
    credits_reset_at: null,
    preferred_pro_model: "deepseek/deepseek-v4-flash-0731",
    free_generation_target: 5,
    pro_generation_target: 15,
  })),
  // Age-gate scaffolding (ROADMAP.md Phase 7) — every existing test in this file
  // simulates an account that already answered the age gate, so the main app renders
  // immediately rather than every test needing to click through AgeGateScreen first.
  // See "age gate" tests below for the gate's own behavior.
  getAccountStatus: vi.fn(async () => ({
    age_band: "18_plus",
    consented_at: new Date().toISOString(),
    needs_consent: false,
  })),
  submitAgeConsent: vi.fn(async (_token: string, ageBand: string) => ({
    age_band: ageBand,
    consented_at: ageBand === "under_13" ? null : new Date().toISOString(),
    needs_consent: ageBand === "under_13",
  })),
  // The Home dashboard's "What to study next" widget (see HomeView.tsx). No weak areas
  // for this fixture account — App.tsx's own tests are about chat/session/navigation
  // behavior, and HomeView.test.tsx covers the widget's real content.
  getWeakAreas: vi.fn(async () => []),
  // MessageBubble's "Listen" action. Never actually clicked in this file; present so the
  // component can import it (this is a full, non-partial module mock).
  synthesizeSpeech: vi.fn(async () => new Blob([], { type: "audio/wav" })),
}));

vi.mock("./notifications", () => ({
  notifyStudyReminders: vi.fn(async () => undefined),
}));

const trayEventListeners: Record<string, Array<() => void>> = {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, callback: () => void) => {
    (trayEventListeners[event] ??= []).push(callback);
    return Promise.resolve(() => {
      trayEventListeners[event] = (trayEventListeners[event] ?? []).filter((cb) => cb !== callback);
    });
  }),
  emit: vi.fn(async () => undefined),
}));

function fireTrayEvent(event: string) {
  (trayEventListeners[event] ?? []).forEach((cb) => cb());
}

vi.mock("./auth", async () => {
  const actual = await vi.importActual<typeof import("./auth")>("./auth");
  return {
    ...actual,
    signInWithBrowser: vi.fn(async () => ({
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token",
      // far enough out that the periodic refresh check never fires mid-test
      expiresAt: Date.now() + 3600_000,
    })),
  };
});

import {
  deleteMessageAndAfter,
  deleteSession,
  getAccountStatus,
  getDocumentContent,
  listDocuments,
  listFlashcards,
  listSessions,
  listStudyPlan,
  openChatSocket,
  submitAgeConsent,
} from "./api";
import { notifyStudyReminders } from "./notifications";
import { signInWithBrowser } from "./auth";
import { emit } from "@tauri-apps/api/event";

async function signIn() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: /sign in/i }));
  return user;
}

// Home (HomeView.tsx) is now the default landing view (see App.tsx's mainView) — every
// test in this file below was written back when "chat" was that default and reaches
// for the chat pane via this same helper, so it transparently lands there first,
// exactly the way a student would: picking the already-active session from the
// sidebar's own list, which is always visible regardless of mainView. Scoped to the
// active session's own row (found via its stable data-session-id, not display text,
// since that text depends on data that may not have finished loading yet) so this
// never risks switching to the WRONG chat.
async function messageList() {
  if (!document.querySelector('[data-testid="message-list"]')) {
    const activeItem = await waitFor(() => {
      const el = document.querySelector(".session-item--active .session-item-main");
      if (!el) throw new Error("no active session item to click into chat with yet");
      return el as HTMLElement;
    });
    fireEvent.click(activeItem);
  }
  return within(await screen.findByTestId("message-list"));
}

describe("App", () => {
  beforeEach(() => {
    vi.mocked(openChatSocket).mockClear();
    vi.mocked(signInWithBrowser).mockClear();
    vi.mocked(deleteSession).mockClear();
    vi.mocked(deleteMessageAndAfter).mockReset();
    vi.mocked(deleteMessageAndAfter).mockResolvedValue(undefined);
    vi.mocked(listFlashcards).mockClear();
    vi.mocked(listStudyPlan).mockClear();
    vi.mocked(listSessions).mockClear();
    vi.mocked(listDocuments).mockClear();
    vi.mocked(getDocumentContent).mockClear();
    vi.mocked(notifyStudyReminders).mockClear();
    vi.mocked(getAccountStatus).mockClear();
    vi.mocked(submitAgeConsent).mockClear();
    vi.mocked(emit).mockClear();
    // Every render now calls the real TokenManager.tryRestoreSession() on mount (see
    // App.tsx's bootstrap effect), which reads real localStorage — clear it so one
    // test's sign-in never leaks a stale session into the next, which would otherwise
    // trigger a real (unmocked) network refresh attempt at the start of an unrelated test.
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Regression test for "clicking between chats says invalid or expired token": the bug
  // was that App.tsx closed over a token value that could be stale by the time a new
  // socket was opened. This asserts the fix — a near-expiry token is refreshed *before*
  // any socket connects, so switching (or even just opening the first) chat never hands
  // the WebSocket a token past its buffer window.
  it("refreshes a near-expiry token before opening a chat socket", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: "refreshed-token",
        refresh_token: "refreshed-refresh-token",
        expires_in: 3600,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    vi.mocked(signInWithBrowser).mockResolvedValueOnce({
      accessToken: "stale-access-token",
      refreshToken: "stale-refresh-token",
      expiresAt: Date.now() + 5_000, // already inside the refresh buffer
    });

    await signIn();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // openChatSocket itself no longer takes a token (see its own comment in api.ts —
    // the auth token moved to a post-connect frame to stop it leaking into access
    // logs), so the real assertion is on what onopen actually sends over the socket.
    await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalled());
    const socket = vi.mocked(openChatSocket).mock.results[0]!.value as { send: (d: string) => void };
    await waitFor(() =>
      expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "auth", token: "refreshed-token" })),
    );
    // The stale token must never reach the socket at all.
    expect(socket.send).not.toHaveBeenCalledWith(JSON.stringify({ type: "auth", token: "stale-access-token" }));
  });

  // The actual "stay signed in" feature: a previous run's persisted tokens should let
  // the app resume straight into the signed-in view on launch, with no click required.
  it("silently restores a signed-in session on launch from persisted tokens", async () => {
    window.localStorage.setItem(
      "newton:auth:tokens",
      JSON.stringify({ accessToken: "old-access", refreshToken: "persisted-refresh", expiresAt: 0 }),
    );
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: "restored-access-token",
        refresh_token: "rotated-refresh-token",
        expires_in: 3600,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    // Never shown — the session resumes silently, no "Sign in" click needed.
    expect(screen.queryByRole("button", { name: /sign in/i })).not.toBeInTheDocument();
    expect(await (await messageList()).findByText("Hello from s1")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/protocol/openid-connect/token"),
      expect.objectContaining({ body: expect.any(URLSearchParams) }),
    );
    await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalled());
    const socket = vi.mocked(openChatSocket).mock.results[0]!.value as { send: (d: string) => void };
    await waitFor(() =>
      expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "auth", token: "restored-access-token" })),
    );
    // The rotated refresh token must be what's now persisted, not the original one —
    // Keycloak invalidates the old one once a new one's been issued.
    const stored = JSON.parse(window.localStorage.getItem("newton:auth:tokens") ?? "{}");
    expect(stored.refreshToken).toBe("rotated-refresh-token");
  });

  it("falls back to the login screen, and clears the bad entry, when a persisted session can't be restored", async () => {
    window.localStorage.setItem(
      "newton:auth:tokens",
      JSON.stringify({ accessToken: "old-access", refreshToken: "revoked-refresh", expiresAt: 0 }),
    );
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));

    render(<App />);

    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(window.localStorage.getItem("newton:auth:tokens")).toBeNull();
  });

  it("with nothing persisted, goes straight to the login screen (no restore attempt)", async () => {
    render(<App />);
    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("signing out clears the persisted session so the next launch doesn't silently resume it", async () => {
    const user = await signIn();
    expect(window.localStorage.getItem("newton:auth:tokens")).not.toBeNull();

    await user.click(await screen.findByText("Sign out"));
    expect(window.localStorage.getItem("newton:auth:tokens")).toBeNull();
  });

  it("loads the active session's history and switches sessions from the sidebar", async () => {
    const user = await signIn();

    expect(await (await messageList()).findByText("Hello from s1")).toBeInTheDocument();

    await user.click(screen.getByText("Physics review"));

    const list = await messageList();
    expect(await list.findByText("Reply in s2")).toBeInTheDocument();
    expect(list.queryByText("Hello from s1")).not.toBeInTheDocument();
  });

  it("disables the composer while a response is streaming and re-enables it on done", async () => {
    await signIn();
    await (await messageList()).findByText("Hello from s1");

    await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalled());
    const socket = vi.mocked(openChatSocket).mock.results[0]!.value as {
      onmessage: ((event: { data: string }) => void) | null;
    };

    const sendButton = screen.getByRole("button", { name: /send/i });
    const textarea = screen.getByPlaceholderText(/ask newton/i);
    expect(textarea).not.toBeDisabled();

    const user = userEvent.setup();
    await user.type(textarea, "Explain gravity");
    expect(sendButton).not.toBeDisabled();

    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: "chunk", content: "Echoing" }) });
    });
    // While streaming, Send is replaced by an enabled Stop button (not just a disabled
    // Send) so the user can actually interrupt generation.
    await waitFor(() => expect(screen.queryByRole("button", { name: /send message/i })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /stop/i })).not.toBeDisabled();
    expect(textarea).toBeDisabled();
    expect(screen.getByPlaceholderText(/responding/i)).toBeInTheDocument();

    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: "done" }) });
    });
    await waitFor(() => expect(screen.getByPlaceholderText(/ask newton/i)).not.toBeDisabled());
    expect(screen.queryByRole("button", { name: /stop/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).not.toBeDisabled();
  });

  it("sends a stop frame when Stop is clicked mid-stream, and shows tool activity as it arrives", async () => {
    const user = await signIn();
    await (await messageList()).findByText("Hello from s1");

    await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalled());
    const socket = vi.mocked(openChatSocket).mock.results[0]!.value as {
      onmessage: ((event: { data: string }) => void) | null;
      send: (data: string) => void;
    };

    const textarea = screen.getByPlaceholderText(/ask newton/i);
    await user.type(textarea, "Search the web for today's date");
    await user.keyboard("{Enter}");

    expect(socket.send).toHaveBeenLastCalledWith(
      JSON.stringify({ type: "user_message", content: "Search the web for today's date" }),
    );

    act(() => {
      socket.onmessage?.({
        data: JSON.stringify({ type: "tool_start", tool: "web_search", label: "Searching the web" }),
      });
    });
    expect(await screen.findByText("Searching the web")).toBeInTheDocument();

    act(() => {
      socket.onmessage?.({
        data: JSON.stringify({ type: "tool_end", tool: "web_search", label: "Searching the web" }),
      });
    });
    // still shown, now in its resolved state
    expect(screen.getByText("Searching the web")).toBeInTheDocument();

    const stopButton = await screen.findByRole("button", { name: /stop/i });
    await user.click(stopButton);
    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: "stop" }));

    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: "stopped" }) });
    });
    // Streaming is over: the textarea is usable again and Stop is gone, replaced by
    // Send (still disabled only because the draft is empty after sending, not because
    // of streaming state).
    await waitFor(() => expect(screen.queryByRole("button", { name: /^stop/i })).not.toBeInTheDocument());
    expect(textarea).not.toBeDisabled();
    await user.type(textarea, "one more thing");
    expect(screen.getByRole("button", { name: /send/i })).not.toBeDisabled();
  });

  // Item 4 (ROADMAP.md): the plan-narration chip. plan_chunk can arrive as the very
  // first frame of a reply, before any text or tool activity -- mirrors the existing
  // tool_start-as-first-frame handling exercised above.
  it("updates the already-live thinking placeholder from a plan_chunk frame, and marks the plan chip done once real text lands", async () => {
    const user = await signIn();
    await (await messageList()).findByText("Hello from s1");

    await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalled());
    const socket = vi.mocked(openChatSocket).mock.results[0]!.value as {
      onmessage: ((event: { data: string }) => void) | null;
    };

    const textarea = screen.getByPlaceholderText(/ask newton/i);
    await user.type(textarea, "Explain the chain rule");
    await user.keyboard("{Enter}");

    // handleSend already pushed a synchronous "Newton is thinking" placeholder --
    // plan_chunk updates that same message in place rather than creating a new one.
    expect(await screen.findByLabelText("Newton is thinking")).toBeInTheDocument();

    act(() => {
      socket.onmessage?.({
        data: JSON.stringify({ type: "plan_chunk", content: "I'll explain the chain rule with an example." }),
      });
    });
    expect(await screen.findByText("I'll explain the chain rule with an example.")).toBeInTheDocument();
    // The plan chip itself is already a "still working" signal -- the thinking
    // indicator doesn't stack on top of it.
    expect(screen.queryByLabelText("Newton is thinking")).not.toBeInTheDocument();

    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: "chunk", content: "The chain rule says..." }) });
    });
    expect(await screen.findByText(/The chain rule says/)).toBeInTheDocument();
    // Once real text has landed, the plan chip gets marked done rather than vanishing.
    const chip = screen.getByText("I'll explain the chain rule with an example.").closest(".plan-chip");
    expect(chip).toHaveClass("tool-activity-chip--done");
  });

  // Item 6 (ROADMAP.md): an immediate, unconditional, zero-network-dependency "Newton
  // is thinking" placeholder -- there must always be visible activity from the instant
  // Send is pressed, regardless of whether the backend's plan-narration race (see
  // app/agents/tutor.py) wins or loses, or how long the first real WS frame takes.
  describe("the synchronous thinking placeholder", () => {
    it("appears the instant a message is sent, with zero async wait for any WS frame", async () => {
      const user = await signIn();
      await (await messageList()).findByText("Hello from s1");
      await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalled());

      const textarea = screen.getByPlaceholderText(/ask newton/i);
      await user.type(textarea, "Explain gravity");
      await user.keyboard("{Enter}");

      // Synchronous: no findBy/waitFor needed, it's already there right after send.
      expect(screen.getByLabelText("Newton is thinking")).toBeInTheDocument();
    });

    it("gets replaced in place (never duplicated) by whichever real content arrives first", async () => {
      const user = await signIn();
      await (await messageList()).findByText("Hello from s1");
      await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalled());
      const socket = vi.mocked(openChatSocket).mock.results[0]!.value as {
        onmessage: ((event: { data: string }) => void) | null;
      };

      const textarea = screen.getByPlaceholderText(/ask newton/i);
      await user.type(textarea, "Search the web for today's date");
      await user.keyboard("{Enter}");

      expect(screen.getByLabelText("Newton is thinking")).toBeInTheDocument();
      const list = await messageList();
      const assistantMessagesBefore = list.getAllByLabelText("Newton").length;

      act(() => {
        socket.onmessage?.({
          data: JSON.stringify({ type: "tool_start", tool: "web_search", label: "Searching the web" }),
        });
      });

      // The thinking indicator is gone -- tool activity is now the "still working"
      // signal -- and no second assistant message was created for this turn.
      expect(screen.queryByLabelText("Newton is thinking")).not.toBeInTheDocument();
      expect(await screen.findByText("Searching the web")).toBeInTheDocument();
      expect(list.getAllByLabelText("Newton").length).toBe(assistantMessagesBefore);
    });

    it("never lingers alongside real answer text once it starts streaming in", async () => {
      const user = await signIn();
      await (await messageList()).findByText("Hello from s1");
      await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalled());
      const socket = vi.mocked(openChatSocket).mock.results[0]!.value as {
        onmessage: ((event: { data: string }) => void) | null;
      };

      const textarea = screen.getByPlaceholderText(/ask newton/i);
      await user.type(textarea, "Explain gravity");
      await user.keyboard("{Enter}");
      expect(screen.getByLabelText("Newton is thinking")).toBeInTheDocument();

      act(() => {
        socket.onmessage?.({ data: JSON.stringify({ type: "chunk", content: "Gravity is a force..." }) });
      });

      expect(await screen.findByText(/Gravity is a force/)).toBeInTheDocument();
      expect(screen.queryByLabelText("Newton is thinking")).not.toBeInTheDocument();
    });
  });

  // Item 5 (ROADMAP.md): auto-generated conversation titles. The backend enqueues a
  // real titling job right after the 2nd assistant reply; the frontend can't know when
  // that job finishes, so it schedules exactly ONE bounded follow-up listSessions()
  // fetch a little later rather than polling repeatedly.
  it("schedules one bounded sessions refetch after the session's 2nd assistant reply to pick up an auto-generated title", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /sign in/i }));
    await (await messageList()).findByText("Hello from s1");

    await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalled());
    const socket = vi.mocked(openChatSocket).mock.results[0]!.value as {
      onmessage: ((event: { data: string }) => void) | null;
      send: (data: string) => void;
    };

    // s1's fixture history already has one assistant reply -- sending one more turn
    // makes this its 2nd.
    const textarea = screen.getByPlaceholderText(/ask newton/i);
    await user.type(textarea, "One more question");
    await user.keyboard("{Enter}");

    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: "chunk", content: "Second reply text" }) });
    });
    await screen.findByText("Second reply text");

    vi.mocked(listSessions).mockClear();
    vi.mocked(listSessions).mockResolvedValueOnce([
      { id: "s1", title: "A Real Generated Title", status: "active", created_at: sessions[0]!.created_at },
      sessions[1]!,
    ]);

    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: "done", prompt_tokens: 1, completion_tokens: 1 }) });
    });

    // Not an instant refetch -- it's a bounded follow-up, not immediate.
    expect(vi.mocked(listSessions)).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(16_000);

    await waitFor(() => expect(vi.mocked(listSessions)).toHaveBeenCalledTimes(1));
    // The title now appears in more than one place (titlebar, main header, sidebar
    // item) -- any of them is proof the new title actually landed in app state.
    expect((await screen.findAllByText("A Real Generated Title")).length).toBeGreaterThan(0);

    vi.useRealTimers();
  });

  it("does not schedule a sessions refetch when the session already has a real title", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /sign in/i }));
    // "Physics review" (s2) already has a real title — Home's own "Continue a
    // conversation" widget shows it too now, so this is scoped to the sidebar's own
    // session row (by its stable data-session-id) rather than an ambiguous text query.
    await waitFor(() => expect(document.querySelector('[data-session-id="s2"] .session-item-main')).not.toBeNull());
    await user.click(document.querySelector('[data-session-id="s2"] .session-item-main') as HTMLElement);
    await (await messageList()).findByText("Reply in s2");

    await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalled());
    const results = vi.mocked(openChatSocket).mock.results;
    const socket = results[results.length - 1]!.value as {
      onmessage: ((event: { data: string }) => void) | null;
    };

    const textarea = screen.getByPlaceholderText(/ask newton/i);
    await user.type(textarea, "One more question");
    await user.keyboard("{Enter}");

    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: "chunk", content: "Second reply text" }) });
    });
    await screen.findByText("Second reply text");

    vi.mocked(listSessions).mockClear();

    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: "done" }) });
    });
    await vi.advanceTimersByTimeAsync(16_000);

    expect(vi.mocked(listSessions)).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("deletes a chat via the sidebar's hover delete button", async () => {
    const user = await signIn();
    await (await messageList()).findByText("Hello from s1");

    const deleteButtons = screen.getAllByLabelText("Delete chat");
    expect(deleteButtons).toHaveLength(2);
    await user.click(deleteButtons[1]!); // s2, "Physics review" — not the active session

    await waitFor(() => expect(vi.mocked(deleteSession)).toHaveBeenCalledWith(expect.any(String), "s2"));
    expect(screen.queryByText("Physics review")).not.toBeInTheDocument();
    // deleting a non-active session must not disturb the currently active one
    expect(await (await messageList()).findByText("Hello from s1")).toBeInTheDocument();
  });

  it("deletes a chat from the custom right-click context menu", async () => {
    const user = await signIn();
    await (await messageList()).findByText("Hello from s1");

    const sessionItem = screen.getByText("Physics review").closest('[data-context-menu="session"]');
    expect(sessionItem).not.toBeNull();

    fireEvent.contextMenu(sessionItem!);
    const deleteItem = await screen.findByRole("menuitem", { name: "Delete chat" });
    await user.click(deleteItem);

    await waitFor(() => expect(vi.mocked(deleteSession)).toHaveBeenCalledWith(expect.any(String), "s2"));
    expect(screen.queryByText("Physics review")).not.toBeInTheDocument();
  });

  // Directly verifies the user's complaint: the WebView's default context menu
  // (Reload/Print/Inspect) must never appear anywhere in the app, even where there's no
  // custom menu item to offer instead.
  it("always suppresses the native context menu, even with nothing custom to show", async () => {
    await signIn();
    await (await messageList()).findByText("Hello from s1");

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 4, clientY: 4 });
    fireEvent(document.body, event);

    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("checks for due flashcards and upcoming deadlines once per sign-in and notifies about them", async () => {
    // Queued twice (not a single ...Once): Home's own "Due soon" widget (see
    // HomeView.tsx) also calls listFlashcards/listStudyPlan as soon as the app signs
    // in, so there are two consumers of this fixture data now, not one — queuing it
    // twice covers both without leaking a persistent mock into later tests.
    const dueFlashcard = { id: "c1", document_id: null, front: "Q", back: "A", due: "2020-01-01T00:00:00Z", state: "review", last_review: null, created_at: "2020-01-01T00:00:00Z" };
    vi.mocked(listFlashcards).mockResolvedValueOnce([dueFlashcard]).mockResolvedValueOnce([dueFlashcard]);
    const dueSoonItems = [
      {
        id: "i1",
        document_id: null,
        title: "Problem set",
        due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10), // tomorrow
        due_date_text: null,
        notes: null,
        source: "syllabus_upload",
        created_at: "2020-01-01T00:00:00Z",
      },
      {
        id: "i2",
        document_id: null,
        title: "Far-off final",
        due_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), // 90 days out
        due_date_text: null,
        notes: null,
        source: "syllabus_upload",
        created_at: "2020-01-01T00:00:00Z",
      },
    ];
    vi.mocked(listStudyPlan).mockResolvedValueOnce(dueSoonItems).mockResolvedValueOnce(dueSoonItems);

    await signIn();
    await (await messageList()).findByText("Hello from s1");

    await waitFor(() => expect(vi.mocked(listFlashcards)).toHaveBeenCalledWith(expect.any(String), true));
    // 1 due flashcard, 1 study plan item due within the next 3 days (the 90-day-out one excluded)
    await waitFor(() => expect(vi.mocked(notifyStudyReminders)).toHaveBeenCalledWith(1, 1));
  });

  it("still reports zero counts when nothing is due — notifyStudyReminders itself no-ops on that", async () => {
    await signIn();
    await (await messageList()).findByText("Hello from s1");

    await waitFor(() => expect(vi.mocked(listStudyPlan)).toHaveBeenCalled());
    await waitFor(() => expect(vi.mocked(notifyStudyReminders)).toHaveBeenCalledWith(0, 0));
  });

  // Regression test for the "tacky and redundant" triple connection dot: Sidebar,
  // the right-hand context panel, and the main chat header all used to render their
  // own copy of the same wsStatus-driven dot. Now there's exactly one, in the header.
  it("shows the connection status exactly once, in the main chat header", async () => {
    await signIn();
    await (await messageList()).findByText("Hello from s1");

    const dots = document.querySelectorAll(".live-dot");
    expect(dots).toHaveLength(1);
    expect(dots[0]!.closest(".main-header")).not.toBeNull();
  });

  // Regression test for the capabilities list no longer squatting on permanent
  // screen space: it's reference material now reachable via the sidebar's "?".
  it("keeps the tool/capabilities list out of the always-visible layout, behind the sidebar's help button", async () => {
    await signIn();
    await (await messageList()).findByText("Hello from s1");

    expect(screen.queryByText("What Newton can do")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "What Newton can do" }));
    expect(await screen.findByRole("heading", { name: "What Newton can do" })).toBeInTheDocument();
  });

  it("opens the Flashcards panel when the system tray's quick action fires", async () => {
    await signIn();
    await (await messageList()).findByText("Hello from s1");

    expect(screen.queryByRole("heading", { name: "Flashcards" })).not.toBeInTheDocument();

    // The listener registers via an async dynamic import — wait for it to actually be
    // attached before firing, rather than racing it.
    await waitFor(() => expect(trayEventListeners["tray-open-flashcards"]?.length).toBeGreaterThan(0));
    act(() => {
      fireTrayEvent("tray-open-flashcards");
    });

    expect(await screen.findByRole("heading", { name: "Flashcards" })).toBeInTheDocument();
  });

  // Item 1: Documents is a real page that replaces chat in the main pane, not a modal
  // popup — the sidebar and title bar stay put, and there's no backdrop/overlay.
  it("shows Documents as a full page in place of chat, keeping the sidebar visible, with no modal backdrop — and toggles back", async () => {
    const user = await signIn();
    await (await messageList()).findByText("Hello from s1");

    await user.click(screen.getByRole("button", { name: "Documents" }));

    // Sidebar (nav + other chats) is still there — this replaced only the main pane.
    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
    expect(screen.getByText("Physics review")).toBeInTheDocument();
    // Chat is gone, not just covered by an overlay.
    expect(screen.queryByTestId("message-list")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/ask newton/i)).not.toBeInTheDocument();
    expect(document.querySelector(".modal-overlay")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(await screen.findByText(/no documents yet/i)).toBeInTheDocument();

    // A second click on the same nav button is the obvious way back.
    await user.click(screen.getByRole("button", { name: "Documents" }));
    expect(await (await messageList()).findByText("Hello from s1")).toBeInTheDocument();
  });

  // Item 1 (continued): picking a chat session from the sidebar is another obvious way
  // back to chat from the Documents page.
  it("selecting a chat session from the sidebar returns from Documents to chat", async () => {
    const user = await signIn();
    await (await messageList()).findByText("Hello from s1");

    await user.click(screen.getByRole("button", { name: "Documents" }));
    await screen.findByText(/no documents yet/i);

    await user.click(screen.getByText("Physics review"));
    expect(await (await messageList()).findByText("Reply in s2")).toBeInTheDocument();
    expect(screen.queryByText(/no documents yet/i)).not.toBeInTheDocument();
  });

  // Item 2: an attached-document chip in a message is a real, clickable attachment —
  // clicking it opens that document split alongside the chat it's a message in
  // (DocumentViewerPanel), not a navigation away from that conversation. Product
  // owner, verbatim: "I should be able to open the final PDF in the chat ... it should
  // then open split with the chatbox."
  it("clicking an attached-document chip in a message opens it split with the chat, not a navigation away", async () => {
    await signIn();
    await (await messageList()).findByText("Hello from s1");

    const chip = await (await messageList()).findByRole("button", { name: /syllabus\.pdf/i });
    await userEvent.click(chip);

    expect(screen.getByRole("region", { name: /syllabus\.pdf/i })).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(getDocumentContent)).toHaveBeenCalledWith(expect.any(String), "doc-1"));
    // Still in the same chat — nothing navigated away from it.
    expect(screen.queryByRole("heading", { name: "Documents" })).not.toBeInTheDocument();
    expect((await messageList()).getByText("Hello from s1")).toBeInTheDocument();
  });

  it("closing the document panel leaves the chat exactly as it was", async () => {
    await signIn();
    await (await messageList()).findByText("Hello from s1");
    await userEvent.click(await (await messageList()).findByRole("button", { name: /syllabus\.pdf/i }));
    await screen.findByRole("region", { name: /syllabus\.pdf/i });

    await userEvent.click(screen.getByRole("button", { name: /close document viewer/i }));
    expect(screen.queryByRole("region", { name: /syllabus\.pdf/i })).not.toBeInTheDocument();
    expect((await messageList()).getByText("Hello from s1")).toBeInTheDocument();
  });

  // Product owner, verbatim, on the document card: "clicking on it expands/closes."
  it("clicking the same document's card again closes the panel instead of reopening it", async () => {
    await signIn();
    await (await messageList()).findByText("Hello from s1");
    const chip = await (await messageList()).findByRole("button", { name: /syllabus\.pdf/i });

    await userEvent.click(chip);
    const region = await screen.findByRole("region", { name: /syllabus\.pdf/i });
    expect(chip).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(chip);
    expect(region).not.toBeInTheDocument();
    expect(chip).toHaveAttribute("aria-pressed", "false");
  });

  it("highlighting text in the document panel and choosing Ask Newton quotes it into the composer", async () => {
    vi.mocked(getDocumentContent).mockResolvedValueOnce({ content: "The residual should be under 1e-8.", editable: true });
    await signIn();
    await (await messageList()).findByText("Hello from s1");
    await userEvent.click(await (await messageList()).findByRole("button", { name: /syllabus\.pdf/i }));

    const body = await screen.findByTestId("doc-viewer-text");
    const textNode = await within(body).findByText(/residual should be under/);
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    // jsdom doesn't compute real layout, but getBoundingClientRect exists and the
    // component only reads its numbers for positioning, not for correctness (same
    // helper as DocumentsPanel.test.tsx's own selectTextIn).
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({ top: 100, left: 50, bottom: 120, right: 200, width: 150, height: 20 }),
    });
    fireEvent.mouseUp(body);

    await userEvent.click(await screen.findByRole("button", { name: "Ask Newton" }));
    const composerInput = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(composerInput.value).toContain("syllabus.pdf");
    expect(composerInput.value).toContain("residual should be under");
    expect(composerInput).toHaveFocus();
  });

  // "Chat about this document" must behave exactly like manually clicking "+" ->
  // "Attach an existing document" and picking it there: the document lands as a
  // pending attachment in the composer, ready for the student to write and send their
  // own opening message. It must NOT auto-send anything on their behalf.
  it("'Chat about this document' pre-attaches the document to the composer without sending anything", async () => {
    // Queued twice (not a single ...Once): Home's own "Recent documents & notes"
    // widget (see HomeView.tsx) also calls listDocuments as soon as the app signs in,
    // so there are two consumers of this fixture now, not one — queuing it twice
    // covers both without leaking a persistent mockResolvedValue into later tests.
    const resumeDoc = { id: "doc-42", filename: "resume (4).pdf", mime_type: "application/pdf", created_at: new Date().toISOString() };
    vi.mocked(listDocuments).mockResolvedValueOnce([resumeDoc]).mockResolvedValueOnce([resumeDoc]);

    const user = await signIn();
    await (await messageList()).findByText("Hello from s1");

    await user.click(screen.getByRole("button", { name: "Documents" }));
    // The grid view's own "⋮" overflow-menu trigger is separately labeled "More actions
    // for resume (4).pdf", which also matches a loose /resume \(4\)\.pdf/i regex — find
    // both and take the one that isn't the menu trigger, rather than the entry tile.
    const matches = await screen.findAllByRole("button", { name: /resume \(4\)\.pdf/i });
    const entryTile = matches.find((el) => !el.getAttribute("aria-label")?.startsWith("More actions"));
    await user.click(entryTile!);
    await user.click(await screen.findByRole("button", { name: /chat about this document/i }));

    // Lands back in chat (a fresh, empty session) with the document attached to the
    // composer — the same end state "+" -> "Attach an existing document" produces.
    expect(await screen.findByText(/resume \(4\)\.pdf/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove attached document/i })).toBeInTheDocument();

    // Nothing was sent on the student's behalf: no new message, no WS user_message send
    // call, and the marker text never leaks into a visible message. (The socket's own
    // "auth" frame legitimately did send, via makeFakeSocket()'s simulated handshake --
    // that's not a message on the student's behalf, so it's excluded here rather than
    // asserting send() was never called at all.)
    const list = await messageList();
    expect(list.queryByText(/\[Attached document:/)).not.toBeInTheDocument();
    expect(list.queryByText(/Let's talk about/i)).not.toBeInTheDocument();
    const sentSocket = vi.mocked(openChatSocket).mock.results.slice(-1)[0]!.value as { send: (d: string) => void };
    expect(sentSocket.send).not.toHaveBeenCalledWith(expect.stringContaining("user_message"));
  });

  // Phase 7 first-run onboarding: a brand-new account (no sessions yet, so App.tsx
  // auto-creates one — see the mount effect) should see the welcome card instead of
  // the generic empty-chat placeholder, exactly once.
  describe("first-run onboarding welcome", () => {
    function mockBrandNewAccount() {
      // The mount effect calls listSessions once, and — finding none — createSession
      // then listSessions again to refetch; both calls must come back empty for the
      // "no existing chats at all" path to run.
      vi.mocked(listSessions).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    }

    it("shows the welcome card for a brand-new account's first empty chat", async () => {
      mockBrandNewAccount();
      await signIn();

      expect(await screen.findByRole("heading", { name: /welcome to newton/i })).toBeInTheDocument();
      expect(screen.queryByText("Ask Newton anything")).not.toBeInTheDocument();
    });

    it("never shows for a returning account that already dismissed it", async () => {
      window.localStorage.setItem("newton:onboarding-seen:unknown-user", "1");
      mockBrandNewAccount();
      await signIn();

      await (await messageList());
      expect(screen.queryByRole("heading", { name: /welcome to newton/i })).not.toBeInTheDocument();
      expect(await screen.findByText("Ask Newton anything")).toBeInTheDocument();
    });

    it("dismissing the welcome card persists so it never comes back, even in a later new chat", async () => {
      mockBrandNewAccount();
      const user = await signIn();
      expect(await screen.findByRole("heading", { name: /welcome to newton/i })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /dismiss welcome/i }));
      expect(screen.queryByRole("heading", { name: /welcome to newton/i })).not.toBeInTheDocument();
      expect(window.localStorage.getItem("newton:onboarding-seen:unknown-user")).toBe("1");

      // Starting a second brand-new (empty) chat in the same running app must not
      // replay it either.
      await user.click(screen.getByRole("button", { name: "New chat" }));
      expect(await screen.findByText("Ask Newton anything")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /welcome to newton/i })).not.toBeInTheDocument();
    });

    it("clicking an example prompt sends it through the normal onSend path and dismisses the card", async () => {
      mockBrandNewAccount();
      const user = await signIn();
      await screen.findByRole("heading", { name: /welcome to newton/i });

      await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalled());
      const socket = vi.mocked(openChatSocket).mock.results.slice(-1)[0]!.value as { send: (d: string) => void };

      await user.click(screen.getByRole("button", { name: /solve an equation step by step/i }));

      expect(socket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "user_message", content: "Solve this step by step: 2x + 5 = 15" }),
      );
      expect(await (await messageList()).findByText("Solve this step by step: 2x + 5 = 15")).toBeInTheDocument();
      // Acted on, so it's gone for good — same as an explicit dismiss.
      expect(window.localStorage.getItem("newton:onboarding-seen:unknown-user")).toBe("1");
      expect(screen.queryByRole("heading", { name: /welcome to newton/i })).not.toBeInTheDocument();
    });
  });

  // Minor-consent / age-gate scaffolding (ROADMAP.md Phase 7 — see
  // docs/data-retention-and-privacy.md). Every other test in this file mocks
  // getAccountStatus as already-consented (see the top-level vi.mock("./api", ...)
  // above) so this is the only place the gate itself is exercised end-to-end.
  describe("age gate", () => {
    it("blocks the main app and shows the age question when consent is still needed", async () => {
      vi.mocked(getAccountStatus).mockResolvedValueOnce({
        age_band: null,
        consented_at: null,
        needs_consent: true,
      });

      await signIn();

      expect(await screen.findByText(/how old are you/i)).toBeInTheDocument();
      expect(screen.queryByTestId("message-list")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "New chat" })).not.toBeInTheDocument();
    });

    it("choosing 18 or older unlocks the main app", async () => {
      vi.mocked(getAccountStatus).mockResolvedValueOnce({
        age_band: null,
        consented_at: null,
        needs_consent: true,
      });

      const user = await signIn();
      await screen.findByText(/how old are you/i);

      await user.click(screen.getByRole("button", { name: "18 or older" }));

      expect(vi.mocked(submitAgeConsent)).toHaveBeenCalledWith(expect.any(String), "18_plus");
      expect(await (await messageList()).findByText("Hello from s1")).toBeInTheDocument();
    });

    it("choosing under 13 stays blocked with the parent/guardian message, never reaching the main app", async () => {
      vi.mocked(getAccountStatus).mockResolvedValueOnce({
        age_band: null,
        consented_at: null,
        needs_consent: true,
      });

      const user = await signIn();
      await screen.findByText(/how old are you/i);

      await user.click(screen.getByRole("button", { name: "Under 13" }));

      expect(await screen.findByText(/needs to create and manage this account/i)).toBeInTheDocument();
      expect(screen.queryByTestId("message-list")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "New chat" })).not.toBeInTheDocument();
    });
  });

  // Message editing (ROADMAP.md): a student can edit a PREVIOUS message they sent.
  // Editing permanently discards that message's original reply and everything after it
  // (no branch history/undo), then resends the edited text exactly like a brand new
  // message. See App.tsx's handleSend/handleEditMessage and ContextMenu.tsx's "Edit
  // message" item.
  describe("message editing", () => {
    async function openMessageContextMenu(text: string) {
      // Scoped to the message list -- "Hello from s1" (this fixture's first user
      // message) also doubles as the auto-derived session title shown in several other
      // places (titlebar, sidebar, main header), so an unscoped screen.findByText would
      // ambiguously match more than one element.
      const list = await messageList();
      const bubble = (await list.findByText(text)).closest('[data-context-menu="message"]');
      expect(bubble).not.toBeNull();
      fireEvent.contextMenu(bubble!);
      return bubble!;
    }

    it("offers Edit message only on the student's own messages, never on Newton's replies", async () => {
      await signIn();
      await (await messageList()).findByText("Hello from s1");

      await openMessageContextMenu("Hello from s1"); // user message
      expect(await screen.findByRole("menuitem", { name: "Edit message" })).toBeInTheDocument();
      await userEvent.keyboard("{Escape}");

      await openMessageContextMenu("Here's the file."); // assistant message
      expect(screen.queryByRole("menuitem", { name: "Edit message" })).not.toBeInTheDocument();
    });

    it("clicking Edit populates the composer with the exact original text and marks edit mode", async () => {
      const user = await signIn();
      await (await messageList()).findByText("Hello from s1");

      await openMessageContextMenu("Hello from s1");
      await user.click(await screen.findByRole("menuitem", { name: "Edit message" }));

      const textarea = screen.getByPlaceholderText(/ask newton/i) as HTMLTextAreaElement;
      expect(textarea.value).toBe("Hello from s1");
      expect(screen.getByText("Editing message")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save edit" })).toBeInTheDocument();
    });

    it("cancel leaves the composer, the messages, and the delete endpoint completely untouched", async () => {
      const user = await signIn();
      await (await messageList()).findByText("Hello from s1");

      await openMessageContextMenu("Hello from s1");
      await user.click(await screen.findByRole("menuitem", { name: "Edit message" }));
      expect(screen.getByText("Editing message")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByText("Editing message")).not.toBeInTheDocument();
      expect((screen.getByPlaceholderText(/ask newton/i) as HTMLTextAreaElement).value).toBe("");
      expect(vi.mocked(deleteMessageAndAfter)).not.toHaveBeenCalled();
      // The original conversation is exactly as it was.
      const list = await messageList();
      expect(await list.findByText("Hello from s1")).toBeInTheDocument();
      expect(await list.findByText("Here's the file.")).toBeInTheDocument();
    });

    it("sending an edit calls the delete-and-truncate endpoint before resending, then removes the old reply", async () => {
      const user = await signIn();
      await (await messageList()).findByText("Hello from s1");
      await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalled());
      const socket = vi.mocked(openChatSocket).mock.results[0]!.value as { send: (d: string) => void };

      const callOrder: string[] = [];
      vi.mocked(deleteMessageAndAfter).mockImplementation(async () => {
        callOrder.push("delete");
      });
      const originalSend = socket.send;
      socket.send = (d: string) => {
        callOrder.push("send");
        originalSend(d);
      };

      await openMessageContextMenu("Hello from s1");
      await user.click(await screen.findByRole("menuitem", { name: "Edit message" }));

      const textarea = screen.getByPlaceholderText(/ask newton/i);
      await user.clear(textarea);
      await user.type(textarea, "Hello, edited");
      await user.click(screen.getByRole("button", { name: "Save edit" }));

      await waitFor(() => expect(vi.mocked(deleteMessageAndAfter)).toHaveBeenCalledWith(expect.any(String), "s1", "m1"));
      expect(callOrder).toEqual(["delete", "send"]);

      // The old reply (and the edited message's own old copy) are gone locally; the new
      // edited text is sent as a normal message.
      const list = await messageList();
      expect(list.queryByText("Here's the file.")).not.toBeInTheDocument();
      expect(await list.findByText("Hello, edited")).toBeInTheDocument();
      expect(screen.queryByText("Editing message")).not.toBeInTheDocument();
    });

    it("a failed delete shows an error and leaves the original message and conversation untouched", async () => {
      const user = await signIn();
      await (await messageList()).findByText("Hello from s1");
      await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalled());

      vi.mocked(deleteMessageAndAfter).mockRejectedValueOnce(new Error("network down"));

      await openMessageContextMenu("Hello from s1");
      await user.click(await screen.findByRole("menuitem", { name: "Edit message" }));
      await user.click(screen.getByRole("button", { name: "Save edit" }));

      expect(await screen.findByText(/couldn.t save that edit/i)).toBeInTheDocument();
      // Nothing sent, nothing truncated.
      const list = await messageList();
      expect(await list.findByText("Hello from s1")).toBeInTheDocument();
      expect(await list.findByText("Here's the file.")).toBeInTheDocument();
      expect(list.queryByText("Hello, edited")).not.toBeInTheDocument();
    });

    it("blocks editing while a reply is streaming, same as sending a new message is blocked", async () => {
      const user = await signIn();
      await (await messageList()).findByText("Hello from s1");
      await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalled());
      const socket = vi.mocked(openChatSocket).mock.results[0]!.value as {
        onmessage: ((event: { data: string }) => void) | null;
      };

      const textarea = screen.getByPlaceholderText(/ask newton/i);
      await user.type(textarea, "Explain gravity");
      await user.keyboard("{Enter}");

      act(() => {
        socket.onmessage?.({ data: JSON.stringify({ type: "chunk", content: "Gravity is..." }) });
      });
      await screen.findByText(/Gravity is/);

      await openMessageContextMenu("Hello from s1");
      const editItem = await screen.findByRole("menuitem", { name: "Edit message" });
      expect(editItem).toBeDisabled();
    });
  });

  // Bug: "the chat WebSocket dies when the app is backgrounded and never reconnects"
  // (ROADMAP.md). Confirmed root cause was ws.onclose just sitting in "closed" forever
  // -- no keepalive, no reconnect logic at all. These test the fix: a periodic ping
  // while connected, a real capped-backoff auto-reconnect after an UNEXPECTED close
  // only (never for a deliberate teardown), and an immediate reconnect on regaining
  // visibility/focus rather than waiting out the backoff.
  describe("chat WebSocket keepalive and auto-reconnect", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("sends a keepalive ping frame on the socket at a steady interval while connected", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await user.click(await screen.findByRole("button", { name: /sign in/i }));
      await (await messageList()).findByText("Hello from s1");
      await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalledTimes(1));
      const socket = vi.mocked(openChatSocket).mock.results[0]!.value as {
        send: (d: string) => void;
      };

      // makeFakeSocket() already simulates the real onopen -> "auth" -> "auth_ok"
      // handshake (a queued microtask, so it's done by the time this runs), which is
      // what actually starts the keepalive interval -- nothing to trigger by hand here.
      await vi.advanceTimersByTimeAsync(25_000);
      expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "ping" }));
    });

    it("auto-reconnects after an unexpected close with a capped exponential backoff, showing a reconnecting status meanwhile", async () => {
      // Every attempt here deliberately fails before ever authenticating (that's the
      // whole point -- proving TWO CONSECUTIVE failures double the backoff rather than
      // resetting it), so none of them should get makeFakeSocket()'s default auto-
      // "auth_ok", which would incorrectly reset reconnectAttempt as if one succeeded.
      vi.mocked(openChatSocket)
        .mockImplementationOnce(() => makeFakeSocketNoAutoAuth())
        .mockImplementationOnce(() => makeFakeSocketNoAutoAuth())
        .mockImplementationOnce(() => makeFakeSocketNoAutoAuth());
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await user.click(await screen.findByRole("button", { name: /sign in/i }));
      await (await messageList()).findByText("Hello from s1");
      await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalledTimes(1));
      const socket1 = vi.mocked(openChatSocket).mock.results[0]!.value as { onclose: (() => void) | null };

      act(() => {
        socket1.onclose?.(); // unexpected -- neither an unmount nor a session switch
      });

      expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
      // 1st retry delay is ~1s -- must not have reconnected yet.
      expect(vi.mocked(openChatSocket)).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalledTimes(2));

      // A 2nd consecutive failure should back off further (~2s), not reset to ~1s.
      const socket2 = vi.mocked(openChatSocket).mock.results[1]!.value as { onclose: (() => void) | null };
      act(() => {
        socket2.onclose?.();
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(vi.mocked(openChatSocket)).toHaveBeenCalledTimes(2); // not yet after only ~1s
      await vi.advanceTimersByTimeAsync(1_000); // total ~2s
      await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalledTimes(3));
    });

    it("does not schedule a reconnect for a deliberate teardown (session switch), even if the old socket's close event arrives afterward", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await user.click(await screen.findByRole("button", { name: /sign in/i }));
      await (await messageList()).findByText("Hello from s1");
      await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalledTimes(1));
      const firstSocket = vi.mocked(openChatSocket).mock.results[0]!.value as { onclose: (() => void) | null };

      await user.click(screen.getByText("Physics review")); // deliberate: activeSessionId changes
      await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalledTimes(2));

      // Simulate the real world: closing a socket doesn't fire onclose synchronously --
      // it can arrive well after this effect's own cleanup already ran and set torndown.
      act(() => {
        firstSocket.onclose?.();
      });

      // Well past even the capped backoff -- an erroneous reconnect would show by now.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(vi.mocked(openChatSocket)).toHaveBeenCalledTimes(2);
    });

    it("reconnects immediately on regaining visibility, without waiting out the backoff delay", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await user.click(await screen.findByRole("button", { name: /sign in/i }));
      await (await messageList()).findByText("Hello from s1");
      await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalledTimes(1));
      const socket1 = vi.mocked(openChatSocket).mock.results[0]!.value as { onclose: (() => void) | null };

      act(() => {
        socket1.onclose?.();
      });
      expect(vi.mocked(openChatSocket)).toHaveBeenCalledTimes(1); // backoff pending, not yet reconnected

      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      // No timer advance needed -- this is the whole point of the immediate path.
      await waitFor(() => expect(vi.mocked(openChatSocket)).toHaveBeenCalledTimes(2));
    });
  });

  // Notepad auth race fix (ROADMAP.md "stuck on Waiting... even when signed in"): a
  // Notepad window opened well after sign-in emits "notepad-ready" (see
  // NotepadWindow.test.tsx for that side); this is App.tsx's half of the round trip --
  // it must answer with the CURRENT token, not one captured when its own listener was
  // first set up.
  it("responds to the Notepad's notepad-ready request by immediately re-emitting the current token", async () => {
    await signIn();
    await (await messageList()).findByText("Hello from s1");

    await waitFor(() => expect(trayEventListeners["notepad-ready"]?.length).toBeGreaterThan(0));
    const notepadAuthEmitsBefore = vi
      .mocked(emit)
      .mock.calls.filter(([eventName]) => eventName === "notepad-auth").length;

    act(() => {
      fireTrayEvent("notepad-ready");
    });

    await waitFor(() => {
      const calls = vi.mocked(emit).mock.calls.filter(([eventName]) => eventName === "notepad-auth");
      expect(calls.length).toBeGreaterThan(notepadAuthEmitsBefore);
    });
    const lastNotepadAuthCall = vi
      .mocked(emit)
      .mock.calls.filter(([eventName]) => eventName === "notepad-auth")
      .slice(-1)[0];
    expect(lastNotepadAuthCall?.[1]).toEqual({ token: expect.any(String) });
  });
});
