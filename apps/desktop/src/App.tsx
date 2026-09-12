import { useEffect, useState } from "react";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:58001";

type HealthState = { status: "loading" | "ok" | "error"; detail?: string };

function App() {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setHealth({ status: "ok", detail: JSON.stringify(data) }))
      .catch((err) => setHealth({ status: "error", detail: String(err) }));
  }, []);

  return (
    <main className="container">
      <h1>Newton</h1>
      <p>Agentic Learning Environment — dev skeleton.</p>
      <p>
        API ({API_URL}):{" "}
        {health.status === "loading" && "checking…"}
        {health.status === "ok" && `✅ ${health.detail}`}
        {health.status === "error" && `❌ ${health.detail}`}
      </p>
    </main>
  );
}

export default App;
