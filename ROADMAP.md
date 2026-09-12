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
- ! Provider adapter (Groq + OpenRouter + BYOK Anthropic)
- ! Router + Tutor agent, WebSocket streaming chat, Postgres chat history
- ! Document upload → MinIO + pgvector → RAG-aware chat
- ! Tool belt v1: Code Interpreter sandbox
- ! Tool belt v1: SearXNG web search
- ! Tool belt v1: Vision capture-to-solve (photo/screenshot)
- ! Tool belt v1: calculator/unit converter
- ! Memory Tier 1: Redis working-memory bundle
- ! Memory Tier 2: Memory Consolidator session-summary job
- ! Memory Tier 3: typed + deduplicated profile fact table with pgvector retrieval

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
