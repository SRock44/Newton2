# Roadmap

Status ledger. `#` = done and verified. `!` = not started / in progress.
Update this file as work lands — it's the source of truth for what's actually built, not the plan doc that proposed it.

## Phase 0 — Foundations
- # Monorepo scaffold, ROADMAP.md, ARCHITECTURE.md (public GitHub repo pending)
- # `infra/docker-compose.yml`: Postgres+pgvector, MinIO, Redis, Keycloak, Caddy — running isolated on the shared dev box (loopback-only ports, own network/project name, resource-limited)
- # FastAPI skeleton with `/health` endpoint
- # FastAPI health check behind Keycloak auth — verified end-to-end with a real token (`/health/secure` 200 with token, 401 without)
- # Tauri + React + TS skeleton — builds and runs, hits the health endpoint over an SSH tunnel to the dev box

## Phase 1 — Core tutor loop + tool-use foundation
- # Postgres schema + Alembic migrations (users, chat_sessions/messages, session_summaries, profile_facts, documents/document_chunks, pgvector + HNSW indexes)
- # Provider adapter (Groq + OpenRouter + BYOK Anthropic) — code complete with a keyless EchoProvider fallback; pipeline verified end-to-end on Echo. Not yet exercised against a real Groq/OpenRouter/Anthropic key (none configured — see infra/README.md)
- # Router + Tutor agent, WebSocket streaming chat, Postgres chat history — verified end-to-end (session create → WS stream → persisted messages → session end)
- # Memory Tier 1: Redis working-memory bundle — verified (TTL-refreshed, reused across turns)
- # Memory Tier 2: Memory Consolidator session-summary job (arq, Redis-queued) — verified (runs on session end, writes structured summary)
- # Memory Tier 3: typed + deduplicated profile fact table with pgvector retrieval — verified both directions: write (dedup-by-construction upsert) and read (top-k similarity retrieval injected into the Tier 1 bundle before the Tutor answers)
- ! Document upload → MinIO + pgvector → RAG-aware chat (schema exists; upload/chunk/embed pipeline not built)
- # Tool-calling framework — provider-agnostic ToolSpec/ToolCall types, real OpenAI-compatible SSE tool-call delta accumulation (unit-tested standalone since there's no live key to test the wire format against), Anthropic tool-use translation, and a Tutor agent loop that actually executes tools and feeds results back — verified against a scripted fake model (tool-call → result → final answer, error handling, round-limit) since Echo can't exercise real tool-calling
- # Tool belt v1: calculator/unit converter — real AST-restricted (no `eval()`) arithmetic + length/mass/volume/temperature conversion, wired into the Tutor's tool belt, unit-tested
- ! Tool belt v1: Code Interpreter sandbox
- ! Tool belt v1: SearXNG web search
- ! Tool belt v1: Vision capture-to-solve (photo/screenshot)
- # Minimal chat UI in the desktop app — rebuilt into a real sidebar/session/markdown/KaTeX/code-highlighted streaming chat UI, PM-reviewed and screenshot-verified against the live backend

## Phase 2 — Math notepad + visualization
- ! Math Solver agent (SymPy + Code Interpreter verification)
- ! Progressive-reveal Notepad UI
- ! Visualizer agent (Plotly.js specs, SVG diagram specs, RDKit chemistry structures)
- ! Visualization panel in app

## Phase 3 — Integrations
- ! Keycloak-mediated OAuth2 for Canvas
- ! Keycloak-mediated OAuth2 for Google Classroom
- ! Canvas connector (courses, assignments, syllabus)
- ! Google Classroom connector (coursework, due dates)
- ! Study Planner agent → calendarized plan in-app

## Phase 4 — Depth, breadth, and native polish
- ! Flashcard/Quiz agent with FSRS scheduling
- ! Adaptive practice-exam generation
- ! Writing/Essay agent (LanguageTool + citation formatter)
- ! Composite "Study Session" multi-agent workflow
- ! Global hotkey capture ("Newton Snip")
- ! System tray quick actions
- ! Always-on-top companion Notepad window
- ! Voice I/O (Whisper.cpp/Piper)
- ! Native OS notifications
- ! Gamification (streaks/XP)

## Phase 5 — Scale path + stretch (deferred, documented not built)
- ! Move from single OVH VPS to dedicated/multi-node
- ! Collaborative study rooms
- ! Bundled offline local model
- ! Third-party plugin architecture
