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
}));

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

import { deleteSession, openChatSocket } from "./api";
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
    await waitFor(() => expect(sendButton).toBeDisabled());
    expect(screen.getByPlaceholderText(/responding/i)).toBeInTheDocument();

    act(() => {
      socket.onmessage?.({ data: JSON.stringify({ type: "done" }) });
    });
    await waitFor(() => expect(screen.getByPlaceholderText(/ask newton/i)).not.toBeDisabled());
    expect(sendButton).not.toBeDisabled();
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
});
