import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import {
  ApiError,
  createSession,
  deleteSession,
  getMessages,
  listFlashcards,
  listSessions,
  listStudyPlan,
  openChatSocket,
  uploadChatImage,
} from "./api";
import { TokenManager, decodeJwtPayload } from "./auth";
import type { TokenSet } from "./auth";
import { notifyStudyReminders } from "./notifications";
import { getStudyRemindersEnabled } from "./lib/preferences";
import type { ChatMessage, ChatSession, ConnectionStatus } from "./types";
import { sessionDisplayTitle } from "./lib/sessionTitle";
import { latestMathStepsJson } from "./lib/notepadContent";
import LoginScreen from "./components/LoginScreen";
import TitleBar from "./components/TitleBar";
import NewtonMark from "./components/NewtonMark";
import Sidebar from "./components/Sidebar";
import ChatPane from "./components/ChatPane";
import Composer from "./components/Composer";
import DocumentsPanel from "./components/DocumentsPanel";
import StudyPlanPanel from "./components/StudyPlanPanel";
import FlashcardsPanel from "./components/FlashcardsPanel";
import PracticeExamsPanel from "./components/PracticeExamsPanel";
import SettingsPanel from "./components/SettingsPanel";
import ContextPanel from "./components/ContextPanel";
import HelpModal from "./components/HelpModal";
import ContextMenu from "./components/ContextMenu";
import ScreenSnipModal from "./components/ScreenSnipModal";

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  open: "connected",
  connecting: "connecting…",
  closed: "offline",
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function usernameFromAccessToken(accessToken: string): string {
  const claims = decodeJwtPayload(accessToken);
  return (claims.preferred_username as string) || (claims.email as string) || (claims.name as string) || "";
}

function App() {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string>("");
  // One handler for every path that lands a token — a fresh sign-in, a launch-time
  // session restore, or an ordinary background refresh — so username is always derived
  // consistently instead of each caller re-deriving it (or, worse, forgetting to).
  const [tokenManager] = useState(
    () =>
      new TokenManager((accessToken) => {
        setToken(accessToken);
        setUsername(accessToken ? usernameFromAccessToken(accessToken) : "");
      }),
  );
  // True only for the brief moment on launch where we're checking whether a
  // previously signed-in session can be silently resumed (see auth.ts's
  // tryRestoreSession) — avoids flashing the login screen for someone who's actually
  // already signed in.
  const [bootstrapping, setBootstrapping] = useState(true);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [creatingChat, setCreatingChat] = useState(false);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [firstMessageBySession, setFirstMessageBySession] = useState<Record<string, string>>({});

  const [isStreaming, setIsStreaming] = useState(false);
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>("closed");
  const [showDocuments, setShowDocuments] = useState(false);
  const [showStudyPlan, setShowStudyPlan] = useState(false);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [showPracticeExams, setShowPracticeExams] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [snipDataUrl, setSnipDataUrl] = useState<string | null>(null);
  const [snipError, setSnipError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const lastSyncedNotepadJson = useRef<string | null>(null);
  const remindersCheckedRef = useRef(false);

  const rememberFirstMessage = useCallback((sessionId: string, content: string) => {
    setFirstMessageBySession((prev) => (prev[sessionId] ? prev : { ...prev, [sessionId]: content }));
  }, []);

  function handleLoginSuccess(tokens: TokenSet) {
    tokenManager.setTokens(tokens);
  }

  // Runs once, before rendering the login screen: try to silently resume whatever
  // session a previous run of the app persisted (see auth.ts) so signing in isn't
  // required every single time the app is opened.
  useEffect(() => {
    let cancelled = false;
    tokenManager.tryRestoreSession().finally(() => {
      if (!cancelled) setBootstrapping(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSignOut() {
    wsRef.current?.close();
    wsRef.current = null;
    tokenManager.clear();
    setUsername("");
    setSessions([]);
    setActiveSessionId(null);
    setMessages([]);
    setFirstMessageBySession({});
    setIsStreaming(false);
    setWsStatus("closed");
    setShowDocuments(false);
    setShowStudyPlan(false);
    setShowFlashcards(false);
    setShowPracticeExams(false);
    setShowSettings(false);
    setShowHelp(false);
    setSnipDataUrl(null);
    setSnipError(null);
    remindersCheckedRef.current = false;
  }

  // The crop modal hands back a File the same way Composer's own file-attach input does
  // — reuse that exact upload-then-tag-in-message path rather than inventing a second one.
  async function handleSnipCapture(file: File) {
    if (!activeSessionId) {
      setSnipDataUrl(null);
      setSnipError("Open a chat before sending a snip.");
      return;
    }
    try {
      const imageId = await uploadChatImage(token as string, activeSessionId, file);
      setSnipDataUrl(null);
      handleSend(`[Attached image: ${imageId}]`);
    } catch (err) {
      setSnipError(errorMessage(err, "Couldn't send that snip."));
    }
  }

  // System tray "Review flashcards" quick action: the Rust side shows/focuses the
  // window itself and emits this event, so all the frontend needs to do is open the
  // right panel once it arrives. Dynamically imported and defensively caught since
  // there's no real Tauri IPC bridge under a test runner (jsdom) — listen() would have
  // nothing to attach to there.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen("tray-open-flashcards", () => setShowFlashcards(true)))
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // No Tauri context — nothing to listen to.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // "Newton Snip" (global hotkey or tray "Take a Newton Snip"): Rust captures the screen
  // and emits it here as a data URL for the crop modal — see src-tauri/src/lib.rs's
  // `capture_and_emit_snip`. Same dynamic-import/defensive-catch pattern as the tray
  // listener above, for the same reason (no real Tauri IPC bridge under jsdom).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ dataUrl: string }>("newton-snip-captured", (event) => {
          setSnipError(null);
          setSnipDataUrl(event.payload.dataUrl);
        }),
      )
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // No Tauri context — nothing to listen to.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Keeps the always-on-top Notepad window (if open) mirroring whatever step-by-step
  // derivation most recently appeared in this chat — see NotepadWindow.tsx, which listens
  // for this same event. Only re-emits when the content actually changes, not on every
  // render/message-list update.
  useEffect(() => {
    const json = latestMathStepsJson(messages);
    if (json === lastSyncedNotepadJson.current) return;
    lastSyncedNotepadJson.current = json;
    import("@tauri-apps/api/event")
      .then(({ emit }) => emit("notepad-sync", { json }))
      .catch(() => {
        // No Tauri context — nothing listening on the other end.
      });
  }, [messages]);

  // Keeps the displayed/passed-down `token` fresh even when nothing is actively
  // fetching — otherwise a session left idle for over an hour would only discover
  // its token expired the next time some component happened to make a request.
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(() => {
      tokenManager.getValidAccessToken().catch(() => handleSignOut());
    }, 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Once per sign-in (not a repeating poll — that would just nag), nudge the user if
  // they have flashcards due or study plan deadlines coming up soon. Only fires while
  // the app is actually open; see notifications.ts.
  useEffect(() => {
    if (!token || remindersCheckedRef.current) return;
    remindersCheckedRef.current = true;
    if (!getStudyRemindersEnabled()) return;
    const DUE_SOON_DAYS = 3;

    (async () => {
      try {
        const accessToken = await tokenManager.getValidAccessToken();
        const [dueFlashcards, studyPlan] = await Promise.all([
          listFlashcards(accessToken, true),
          listStudyPlan(accessToken),
        ]);
        const dueSoonCutoff = Date.now() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000;
        const dueSoonItems = studyPlan.filter((item) => {
          if (!item.due_date) return false;
          const dueTime = new Date(item.due_date).getTime();
          return !Number.isNaN(dueTime) && dueTime <= dueSoonCutoff;
        });
        await notifyStudyReminders(dueFlashcards.length, dueSoonItems.length);
      } catch {
        // A missed reminder shouldn't disrupt sign-in or show an error banner.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Load the user's sessions once signed in; start a first chat if they have none.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setSessionsLoading(true);
    setSessionsError(null);
    (async () => {
      try {
        const accessToken = await tokenManager.getValidAccessToken();
        let list = await listSessions(accessToken);
        if (!cancelled && list.length === 0) {
          const newId = await createSession(accessToken);
          list = await listSessions(accessToken);
          if (list.length === 0) {
            list = [{ id: newId, title: null, status: "active", created_at: new Date().toISOString() }];
          }
        }
        if (cancelled) return;
        setSessions(list);
        setActiveSessionId((current) => current ?? list[0]?.id ?? null);
      } catch (err) {
        if (!cancelled) setSessionsError(errorMessage(err, "Couldn't load your chats."));
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Load message history whenever the active session changes.
  useEffect(() => {
    if (!token || !activeSessionId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setMessagesLoading(true);
    setMessagesError(null);
    setIsStreaming(false);
    (async () => {
      try {
        const accessToken = await tokenManager.getValidAccessToken();
        const history = await getMessages(accessToken, activeSessionId);
        if (cancelled) return;
        setMessages(history);
        const firstUser = history.find((m) => m.role === "user");
        if (firstUser) rememberFirstMessage(activeSessionId, firstUser.content);
      } catch (err) {
        if (!cancelled) setMessagesError(errorMessage(err, "Couldn't load this conversation."));
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, activeSessionId, rememberFirstMessage]);

  // Keep exactly one live socket, following the active session. Deliberately does NOT
  // depend on `token` — a WebSocket is only auth-checked once, at connect time, so an
  // in-place token refresh must never force a reconnect. Instead, every time we're about
  // to open a *new* socket (i.e. activeSessionId changed), we ask the TokenManager for a
  // guaranteed-fresh token first. This is the direct fix for "clicking between chats says
  // invalid or expired token": previously this effect closed over whatever `token` value
  // was current when the effect last ran, which could be minutes stale by the time the
  // user actually switched chats.
  useEffect(() => {
    if (!tokenManager.hasSession() || !activeSessionId) return;
    let cancelled = false;
    let ws: WebSocket | null = null;
    setWsStatus("connecting");

    (async () => {
      let accessToken: string;
      try {
        accessToken = await tokenManager.getValidAccessToken();
      } catch {
        if (!cancelled) setWsStatus("closed");
        return;
      }
      if (cancelled) return;

      ws = openChatSocket(accessToken, activeSessionId);
      wsRef.current = ws;

      ws.onopen = () => setWsStatus("open");
      ws.onclose = () => setWsStatus("closed");
      ws.onerror = () => setWsStatus("closed");
      ws.onmessage = (event) => {
        let payload: {
          type?: string;
          content?: string;
          tool?: string;
          label?: string;
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
        };
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }

        if (payload.type === "chunk") {
          setIsStreaming(true);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && last.streaming) {
              const updated = { ...last, content: last.content + (payload.content ?? "") };
              return [...prev.slice(0, -1), updated];
            }
            return [...prev, { role: "assistant", content: payload.content ?? "", streaming: true }];
          });
        } else if (payload.type === "tool_start" || payload.type === "tool_end") {
          setIsStreaming(true);
          const tool = payload.tool ?? "";
          const label = payload.label ?? tool;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== "assistant" || !last.streaming) {
              // A tool call can be the very first event of a reply (before any text) —
              // start the streaming assistant message here if it doesn't exist yet.
              if (payload.type === "tool_start") {
                return [
                  ...prev,
                  { role: "assistant", content: "", streaming: true, activity: [{ tool, label, done: false }] },
                ];
              }
              return prev;
            }
            const activity = last.activity ?? [];
            if (payload.type === "tool_start") {
              return [...prev.slice(0, -1), { ...last, activity: [...activity, { tool, label, done: false }] }];
            }
            // tool_end: mark the most recent not-yet-done entry for this tool as done.
            let markedIndex = -1;
            for (let i = activity.length - 1; i >= 0; i -= 1) {
              if (activity[i]!.tool === tool && !activity[i]!.done) {
                markedIndex = i;
                break;
              }
            }
            if (markedIndex === -1) return prev;
            const nextActivity = activity.map((entry, i) => (i === markedIndex ? { ...entry, done: true } : entry));
            return [...prev.slice(0, -1), { ...last, activity: nextActivity }];
          });
        } else if (payload.type === "done" || payload.type === "stopped") {
          setIsStreaming(false);
          const stoppedByUser = payload.type === "stopped";
          setMessages((prev) =>
            prev.map((m) =>
              m.streaming
                ? {
                    ...m,
                    streaming: false,
                    stoppedByUser,
                    prompt_tokens: payload.prompt_tokens ?? null,
                    completion_tokens: payload.completion_tokens ?? null,
                  }
                : m,
            ),
          );
        } else if (payload.type === "error") {
          setIsStreaming(false);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant" && last.streaming) {
              return [
                ...prev.slice(0, -1),
                { ...last, streaming: false, error: true, content: payload.content ?? "Something went wrong." },
              ];
            }
            return [
              ...prev,
              { role: "assistant", content: payload.content ?? "Something went wrong.", error: true },
            ];
          });
        }
      };
    })();

    return () => {
      cancelled = true;
      ws?.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  function handleSend(text: string) {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !activeSessionId) {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: "Not connected right now — please wait a moment and try again.", error: true },
      ]);
      return;
    }
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    rememberFirstMessage(activeSessionId, text);
    socket.send(JSON.stringify({ type: "user_message", content: text }));
    setIsStreaming(true);
  }

  function handleStop() {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop" }));
    }
  }

  async function handleNewChat() {
    if (!tokenManager.hasSession() || creatingChat) return;
    setCreatingChat(true);
    try {
      const accessToken = await tokenManager.getValidAccessToken();
      const id = await createSession(accessToken);
      const newSession: ChatSession = {
        id,
        title: null,
        status: "active",
        created_at: new Date().toISOString(),
      };
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(id);
    } catch (err) {
      setSessionsError(errorMessage(err, "Couldn't start a new chat."));
    } finally {
      setCreatingChat(false);
    }
  }

  async function handleDeleteSession(sessionId: string) {
    try {
      const accessToken = await tokenManager.getValidAccessToken();
      await deleteSession(accessToken, sessionId);
    } catch (err) {
      setSessionsError(errorMessage(err, "Couldn't delete this chat."));
      return;
    }

    const remaining = sessions.filter((s) => s.id !== sessionId);
    setSessions(remaining);
    setFirstMessageBySession((prev) => {
      if (!(sessionId in prev)) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    if (activeSessionId === sessionId) {
      setActiveSessionId(remaining[0]?.id ?? null);
    }
  }

  if (bootstrapping) {
    return (
      <div className="app-root">
        <TitleBar title="Newton" />
        <div className="login-screen">
          <span className="bootstrap-mark" aria-label="Signing you in…">
            <NewtonMark size={26} />
          </span>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="app-root">
        <TitleBar title="Newton" />
        <LoginScreen onSuccess={handleLoginSuccess} />
        <ContextMenu onDeleteSession={handleDeleteSession} />
      </div>
    );
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const headerTitle = activeSession
    ? sessionDisplayTitle(activeSession, activeSessionId ? firstMessageBySession[activeSessionId] : undefined)
    : "Newton";

  return (
    <div className="app-root">
      <TitleBar title={headerTitle} />
      <div className="app-shell">
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          firstMessageBySession={firstMessageBySession}
          onSelectSession={setActiveSessionId}
          onNewChat={handleNewChat}
          onDeleteSession={handleDeleteSession}
          creatingChat={creatingChat}
          username={username || "student"}
          onSignOut={handleSignOut}
          onOpenDocuments={() => setShowDocuments(true)}
          onOpenStudyPlan={() => setShowStudyPlan(true)}
          onOpenFlashcards={() => setShowFlashcards(true)}
          onOpenPracticeExams={() => setShowPracticeExams(true)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenHelp={() => setShowHelp(true)}
        />

        <main className="main-pane">
          <header className="main-header">
            <h1 className="main-header-title">{headerTitle}</h1>
            <span className="main-header-status" title={`Connection: ${wsStatus}`}>
              <span className={`live-dot live-dot--${wsStatus}`} aria-hidden="true" />
              {CONNECTION_LABEL[wsStatus]}
            </span>
          </header>

          {sessionsError && <div className="banner banner--error chat-pane-banner">{sessionsError}</div>}

          {sessionsLoading && sessions.length === 0 ? (
            <div className="chat-empty-state">
              <p>Loading your chats…</p>
            </div>
          ) : (
            <>
              <ChatPane
                messages={messages}
                loading={messagesLoading}
                loadError={messagesError}
                token={token}
                sessionId={activeSessionId}
              />
              <Composer
                onSend={handleSend}
                onStop={handleStop}
                disabled={isStreaming || !activeSessionId}
                streaming={isStreaming}
                token={token}
                sessionId={activeSessionId}
              />
            </>
          )}
        </main>

        <ContextPanel
          token={token}
          sessionCount={sessions.length}
          messageCount={messages.length}
          totalTokens={messages.reduce(
            (sum, m) => sum + (m.prompt_tokens ?? 0) + (m.completion_tokens ?? 0),
            0,
          )}
        />
      </div>

      {showDocuments && <DocumentsPanel token={token} onClose={() => setShowDocuments(false)} />}
      {showStudyPlan && <StudyPlanPanel token={token} onClose={() => setShowStudyPlan(false)} />}
      {showFlashcards && <FlashcardsPanel token={token} onClose={() => setShowFlashcards(false)} />}
      {showPracticeExams && (
        <PracticeExamsPanel token={token} onClose={() => setShowPracticeExams(false)} />
      )}
      {showSettings && (
        <SettingsPanel token={token} username={username || "student"} onClose={() => setShowSettings(false)} />
      )}
      {showHelp && <HelpModal token={token} onClose={() => setShowHelp(false)} />}

      <ContextMenu onDeleteSession={handleDeleteSession} />

      {snipDataUrl && (
        <ScreenSnipModal
          dataUrl={snipDataUrl}
          onCancel={() => setSnipDataUrl(null)}
          onCapture={handleSnipCapture}
        />
      )}
      {snipError && (
        <div className="banner banner--error snip-error-toast">
          {snipError}
          <button type="button" onClick={() => setSnipError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
