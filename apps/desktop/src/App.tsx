import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import {
  ApiError,
  createSession,
  getMessages,
  listSessions,
  openChatSocket,
} from "./api";
import { TokenManager, decodeJwtPayload } from "./auth";
import type { TokenSet } from "./auth";
import type { ChatMessage, ChatSession, ConnectionStatus } from "./types";
import { sessionDisplayTitle } from "./lib/sessionTitle";
import LoginScreen from "./components/LoginScreen";
import Sidebar from "./components/Sidebar";
import ChatPane from "./components/ChatPane";
import Composer from "./components/Composer";
import DocumentsPanel from "./components/DocumentsPanel";
import StudyPlanPanel from "./components/StudyPlanPanel";
import CapabilitiesPanel from "./components/CapabilitiesPanel";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function App() {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string>("");
  const [tokenManager] = useState(() => new TokenManager(setToken));

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

  const wsRef = useRef<WebSocket | null>(null);

  const rememberFirstMessage = useCallback((sessionId: string, content: string) => {
    setFirstMessageBySession((prev) => (prev[sessionId] ? prev : { ...prev, [sessionId]: content }));
  }, []);

  function handleLoginSuccess(tokens: TokenSet) {
    tokenManager.setTokens(tokens);
    const claims = decodeJwtPayload(tokens.accessToken);
    const name = (claims.preferred_username as string) || (claims.email as string) || (claims.name as string) || "";
    setUsername(name);
  }

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
  }

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
        let payload: { type?: string; content?: string };
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
        } else if (payload.type === "done") {
          setIsStreaming(false);
          setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
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
    socket.send(text);
    setIsStreaming(true);
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

  if (!token) {
    return <LoginScreen onSuccess={handleLoginSuccess} />;
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const headerTitle = activeSession
    ? sessionDisplayTitle(activeSession, activeSessionId ? firstMessageBySession[activeSessionId] : undefined)
    : "Newton";

  return (
    <div className="app-shell">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        firstMessageBySession={firstMessageBySession}
        onSelectSession={setActiveSessionId}
        onNewChat={handleNewChat}
        creatingChat={creatingChat}
        username={username || "student"}
        onSignOut={handleSignOut}
        onOpenDocuments={() => setShowDocuments(true)}
        onOpenStudyPlan={() => setShowStudyPlan(true)}
        connectionStatus={wsStatus}
      />

      {showDocuments && <DocumentsPanel token={token} onClose={() => setShowDocuments(false)} />}
      {showStudyPlan && <StudyPlanPanel token={token} onClose={() => setShowStudyPlan(false)} />}

      <main className="main-pane">
        <header className="main-header">
          <h1 className="main-header-title">{headerTitle}</h1>
          <span className={`live-dot live-dot--${wsStatus}`} title={`Connection: ${wsStatus}`} />
        </header>

        {sessionsError && <div className="chat-pane-banner chat-pane-banner--error">{sessionsError}</div>}

        {sessionsLoading && sessions.length === 0 ? (
          <div className="chat-empty-state">
            <p>Loading your chats…</p>
          </div>
        ) : (
          <>
            <ChatPane messages={messages} loading={messagesLoading} loadError={messagesError} />
            <Composer onSend={handleSend} disabled={isStreaming || !activeSessionId} />
          </>
        )}
      </main>

      <CapabilitiesPanel
        token={token}
        connectionStatus={wsStatus}
        sessionCount={sessions.length}
        messageCount={messages.length}
      />
    </div>
  );
}

export default App;
