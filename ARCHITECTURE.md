# Architecture

## Principles
- Own the whole stack: no Firebase/Firestore, no managed cloud services. Self-hosted on OVH.
- Agents call real tools (code execution, symbolic math, web search, vision, grammar) instead of just generating prose.
- Native desktop app (Tauri), not a wrapped website.
- Memory is typed, deduplicated, and tiered — not a growing pile of raw transcript.

## Data layer
- **Postgres + pgvector** — relational data (users, courses, assignments, chat sessions, flashcards, study plans, memory profile facts) and embeddings (documents + memory) in one database.
- **MinIO** (S3-compatible) — uploaded files, generated diagrams, exports.
- **Redis** — cache + job queue (embeddings, syllabus parsing, quiz generation, memory consolidation) + working-memory context bundles.
- **Keycloak** — auth server for Newton's own login and the OAuth2 client flows used to link Canvas / Google Classroom.

## API layer (`services/api`, FastAPI)
- REST + WebSocket (streaming agent responses).
- **Provider adapter**: one interface over Groq, OpenRouter, and BYOK Anthropic (user-supplied key, encrypted at rest via pgcrypto, cost is theirs). Per-agent config picks provider/model.
- **Tools** (exposed via one provider-agnostic tool-calling schema):
  - Code Interpreter — sandboxed (gVisor/nsjail, no network egress) Python execution
  - Symbolic Math — SymPy
  - Web Search — self-hosted SearXNG
  - Vision / capture-to-solve — image sent to a vision-capable model; Tesseract/PaddleOCR fallback for clean printed text
  - Grammar/Writing — self-hosted LanguageTool
  - Citation Formatter — self-hosted citeproc-js
  - Calculator/Unit Converter — deterministic function, no model call
  - Spaced Repetition — FSRS
  - Voice — self-hosted Whisper.cpp (STT) / Piper (TTS)
- **Connectors**: Canvas API (OAuth2), Google Classroom API (OAuth2). These are outward integrations to services students already use — not part of "no cloud services," which governs infra we run ourselves.

## Agent layer (async Python, Router → specialists → Composer)
1. Router — classifies request, fans out to specialist(s) concurrently
2. Tutor — conversational persona, general Q&A
3. Math Solver — SymPy-verified derivation + Code Interpreter checks → structured steps
4. Visualizer — Plotly.js graph specs, SVG diagram specs, RDKit chemistry structures
5. Study Planner — syllabus/assignments → calendarized plan
6. Flashcard/Quiz — generation + FSRS scheduling + adaptive practice exams
7. Writing/Essay — grammar + citation feedback
8. Document RAG — pgvector retrieval over uploaded course material
9. Memory Consolidator — session-end summarization + profile-fact upsert

## Memory system
Three tiers, all on infra already listed above — no new services:

- **Tier 1 — Working memory (Redis, hot).** The live turn window plus an assembled context bundle (recent turns + retrieved profile facts). Cached and TTL-refreshed per session; rebuilt only when something underlying changes (new fact confirmed, new session summary written), not on a timer.
- **Tier 2 — Session summaries (Postgres, warm).** At session end / length threshold, the Memory Consolidator (cheap model, background job) writes a structured summary of that session — topics, problems solved, mistakes, actions taken.
- **Tier 3 — Durable profile memory (Postgres + pgvector, cold, typed, deduplicated).** Fact rows keyed by `subject/key` (`course:MATH201`, `skill:derivatives`, `pref:explanation_style`) with `value`, `confidence`, `source_session_id`, `created_at`, `last_confirmed_at`, `superseded_by`. Writes are upsert-by-key (dedup by construction). Course facts expire at semester boundaries (from Canvas term dates); skill-mastery facts decay via the same FSRS curve used for flashcards. Retrieval is a small top-k pgvector search filtered by domain, not a full dump.

## Desktop app (`apps/desktop`, Tauri + React + TS)
- Streaming chat, progressive-reveal math Notepad, interactive Visualization panel.
- Canvas/Classroom account linking, BYOK Anthropic key field (server-side encrypted).
- Desktop-native power features: global hotkey capture ("Newton Snip"), system tray quick actions, always-on-top companion Notepad window, offline-friendly local SQLite cache, voice I/O, native notifications, clipboard-aware paste.

## Infra
- Dev: isolated Docker Compose project on a shared dev box — all services bound to `127.0.0.1` on non-colliding ports, own Compose project name/network, resource-limited per container.
- Production (later): OVH VPS → dedicated/multi-node as load justifies. Docker Compose (api, sandbox-runner, postgres, minio, redis, keycloak, searxng, languagetool, caddy). GitHub Actions CI/CD. No AI attribution in commits/PRs.
