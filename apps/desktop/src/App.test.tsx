import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
  openChatSocket: vi.fn(() => makeFakeSocket()),
  listTools: vi.fn(async () => []),
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

import { openChatSocket } from "./api";
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
});
