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
- # Document upload → MinIO + pgvector → RAG-aware chat — upload (txt/md/PDF via `pypdf`, 20MB cap) → chunk → embed (fastembed) → pgvector retrieval, injected into the Tutor's context via the same Tier-1-bundle pattern as profile facts. Cross-user isolation specifically tested (two users, identical content, each only ever retrieves their own chunks)
- # Tool-calling framework — provider-agnostic ToolSpec/ToolCall types, real OpenAI-compatible SSE tool-call delta accumulation (unit-tested standalone since there's no live key to test the wire format against), Anthropic tool-use translation, and a Tutor agent loop that actually executes tools and feeds results back — verified against a scripted fake model (tool-call → result → final answer, error handling, round-limit) since Echo can't exercise real tool-calling
- # Tool belt v1: calculator/unit converter — real AST-restricted (no `eval()`) arithmetic + length/mass/volume/temperature conversion, unit-tested, registered in the live tool belt
- # Tool belt v1: Code Interpreter sandbox — `services/sandbox-runner`, subprocess-in-a-locked-down-container isolation (non-root, dropped capabilities, read-only fs, `resource.setrlimit` + an independent wall-clock watchdog that kills blocking-not-just-CPU-bound code, no state leak between requests) deployed on a dedicated Docker-internal-only network with **zero** route to the internet or any other service — verified live, in the real deployed topology (not just a standalone test), that it genuinely can't resolve or reach postgres or the open internet, while `api` can reach it and get real results
- # Tool belt v1: SearXNG web search — self-hosted metasearch, JSON API enabled, verified returning real results from real upstream engines in the live deployment; graceful "search failed" string (not a crash) on upstream failure
- ! Tool belt v1: Vision capture-to-solve (photo/screenshot)
- # Minimal chat UI in the desktop app — rebuilt into a real sidebar/session/markdown/KaTeX/code-highlighted streaming chat UI, PM-reviewed and screenshot-verified against the live backend

## Phase 2 — Math notepad + visualization
- # Math Solver tool — exact solve/differentiate/integrate/simplify/factor/expand via SymPy, parses natural math notation (`^` as power, implicit multiplication like `2x`), registered in the live tool belt and reachable through the Tutor's tool-calling loop end-to-end. "Code Interpreter verification" cross-checking is not yet wired in as a distinct step (the Code Interpreter tool exists and is separately callable, just not chained automatically after a symbolic-math call)
- ! Progressive-reveal Notepad UI (no frontend work yet for step-by-step reveal — SymPy doesn't natively produce pedagogical steps either, only exact answers; a real step-by-step explainer is a bigger design task, not just a wiring one)
- # Visualizer tool — numeric function plotting (SymPy `lambdify` + numpy sampling → Plotly.js figure spec), registered in the live tool belt, discontinuities rendered as gaps rather than crashing. SVG diagram generation and RDKit chemistry structures are not built
- # Visualization panel in app — `plot_function` tool output (a fenced ` ```plotly-figure ` block) renders as an actual interactive chart (plotly.js-basic-dist-min, lazy-loaded so most sessions never download it) instead of raw JSON; theme-aware (light/dark)

## Phase 3 — Integrations
- ! Canvas OAuth2 + connector (courses, assignments, syllabus) — blocked on the user obtaining a Canvas Developer Key, which needs admin rights on a real Canvas instance (or self-hosting Canvas LMS); architecture decision made to handle this as an app-managed OAuth connection, not brokered through Keycloak, since Canvas's OAuth2 doesn't fit Keycloak's OIDC-oriented identity brokering cleanly
- ! Google Classroom OAuth2 + connector (coursework, due dates) — same app-managed-OAuth approach; blocked only on the user registering a Google Cloud OAuth client (needs just a personal Google account, no institutional access — much lower barrier than Canvas)
- # Tool belt: textbook lookup — Open Library (free, keyless, legal metadata API; never fetches full copyrighted text) by ISBN or title/author, with `no_textbook=true` as a first-class path for courses that genuinely have none. Verified against both mocked responses and one real live Open Library call
- # Study Planner → calendarized plan in-app, syllabus-upload path — `POST /study-plan/generate/{document_id}` re-extracts a document's text, asks the provider to pull out gradable items as structured JSON (real dates kept as `due_date`, anything without an exact calendar date kept as honest `due_date_text` like "Week 5" rather than guessed), and persists them; `GET /study-plan` lists them, `DELETE /study-plan/{id}` removes one, all user-scoped. Extraction quality itself is unverifiable without a real provider key (same caveat as session consolidation), but the full pipeline — parsing, date handling, persistence, auth, cross-user isolation — is verified with a scripted well-formed response

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
