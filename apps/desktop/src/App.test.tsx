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
  s1: [{ role: "user", content: "Hello from s1" }],
  s2: [{ role: "assistant", content: "Reply in s2" }],
};

function makeFakeSocket() {
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
  openChatSocket: vi.fn(() => makeFakeSocket()),
  listTools: vi.fn(async () => []),
  getGamificationStats: vi.fn(async () => ({ streak_days: 0, xp: 0, level: 1, xp_to_next_level: 100 })),
  listFlashcards: vi.fn(async () => []),
  listStudyPlan: vi.fn(async () => []),
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

import { deleteSession, listFlashcards, listStudyPlan, openChatSocket } from "./api";
import { notifyStudyReminders } from "./notifications";
import { signInWithBrowser } from "./auth";

async function signIn() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: /sign in/i }));
  return user;
}

async function messageList() {
  return within(await screen.findByTestId("message-list"));
}

describe("App", () => {
  beforeEach(() => {
    vi.mocked(openChatSocket).mockClear();
    vi.mocked(signInWithBrowser).mockClear();
    vi.mocked(deleteSession).mockClear();
    vi.mocked(listFlashcards).mockClear();
    vi.mocked(listStudyPlan).mockClear();
    vi.mocked(notifyStudyReminders).mockClear();
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
    await waitFor(() =>
      expect(vi.mocked(openChatSocket)).toHaveBeenCalledWith("refreshed-token", expect.any(String)),
    );
    // The stale token must never reach a socket connection.
    expect(vi.mocked(openChatSocket)).not.toHaveBeenCalledWith("stale-access-token", expect.any(String));
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
    vi.mocked(listFlashcards).mockResolvedValueOnce([
      { id: "c1", document_id: null, front: "Q", back: "A", due: "2020-01-01T00:00:00Z", state: "review", last_review: null, created_at: "2020-01-01T00:00:00Z" },
    ]);
    vi.mocked(listStudyPlan).mockResolvedValueOnce([
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
    ]);

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
});
