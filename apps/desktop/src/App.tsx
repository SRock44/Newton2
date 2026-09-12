import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:58001";
const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL ?? "http://127.0.0.1:58180";
const WS_URL = API_URL.replace(/^http/, "ws");

type Message = { role: string; content: string; streaming?: boolean };

function App() {
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState("student1");
  const [password, setPassword] = useState("newton-dev");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  async function login(e: FormEvent) {
    e.preventDefault();
    setLoginError(null);
    try {
      const res = await fetch(`${KEYCLOAK_URL}/realms/newton/protocol/openid-connect/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "password",
          client_id: "newton-api",
          username,
          password,
        }),
      });
      if (!res.ok) throw new Error(`sign-in failed (${res.status})`);
      const data = await res.json();
      setToken(data.access_token);
    } catch (err) {
      setLoginError(String(err));
    }
  }

  useEffect(() => {
    if (!token) return;
    (async () => {
      const res = await fetch(`${API_URL}/chat/sessions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setSessionId(data.session_id);
    })();
  }, [token]);

  useEffect(() => {
    if (!token || !sessionId) return;
    const ws = new WebSocket(`${WS_URL}/chat/ws/${sessionId}?token=${token}`);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "chunk") {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            return [...prev.slice(0, -1), { ...last, content: last.content + msg.content }];
          }
          return [...prev, { role: "assistant", content: msg.content, streaming: true }];
        });
      } else if (msg.type === "done") {
        setMessages((prev) => prev.map((m) => ({ ...m, streaming: false })));
      }
    };
    return () => ws.close();
  }, [token, sessionId]);

  function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !wsRef.current) return;
    setMessages((prev) => [...prev, { role: "user", content: draft }]);
    wsRef.current.send(draft);
    setDraft("");
  }

  if (!token) {
    return (
      <main className="container">
        <h1>Newton</h1>
        <p>Agentic Learning Environment — dev skeleton.</p>
        <form onSubmit={login} className="row">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="password"
          />
          <button type="submit">Sign in</button>
        </form>
        {loginError && <p>❌ {loginError}</p>}
      </main>
    );
  }

  return (
    <main className="container">
      <h1>Newton {connected ? "🟢" : "🔴"}</h1>
      <div className="chat-log">
        {messages.map((m, i) => (
          <p key={i}>
            <b>{m.role}:</b> {m.content}
          </p>
        ))}
      </div>
      <form onSubmit={sendMessage} className="row">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask Newton..." />
        <button type="submit">Send</button>
      </form>
    </main>
  );
}

export default App;
