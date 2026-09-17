# Architecture

> Cross-checked against the code 2026-09-17. Diagrams and per-tool detail live in
> [`docs/architecture.md`](./docs/architecture.md) (topology, auth, chat turn, memory,
> RAG, billing, isolation), [`docs/erd.md`](./docs/erd.md) (all 15 tables), and
> [`docs/tools.md`](./docs/tools.md) (the full 21-tool belt). If this file and
> `docs/` ever disagree, `docs/` wins — it is checked line-by-line against the source.

## Principles
- Own the whole stack: no Firebase/Firestore, no managed cloud services for our own state. Self-hosted Docker Compose (dev on an isolated project on a shared box; dedicated VPS as load justifies).
- A single Tutor agent calls real tools (code execution, symbolic math, web search, vision, grammar, and fifteen more — see `docs/tools.md`) instead of just generating prose.
- Native desktop app (Tauri), not a wrapped website.
- Memory is typed, deduplicated, and tiered — not a growing pile of raw transcript.

## Data layer
- **Postgres + pgvector** — relational data (users, chat sessions/messages, session summaries, profile facts, documents + chunks, study plan items, flashcards + review logs, practice exams + questions, calendar events, share links, Classroom connection) and embeddings (document chunks + profile facts, 384d, HNSW cosine) in one database.
- **MinIO** (S3-compatible) — uploaded files, chat images, notes, generated papers (PDF/TEX) and artifact HTML.
- **Redis** — Tier-1 working-memory bundles (2h TTL) + arq job queue (DB 1) for memory consolidation, session titling, and the weekly retention report.
- **Keycloak** — auth server for Newton's own login (Authorization Code + PKCE, Google brokered as an IdP), backed by its own Postgres database. Google Classroom linking is deliberately *not* via Keycloak: it is an app-managed OAuth grant with Fernet-encrypted tokens.

## API layer (`services/api`, FastAPI)
- REST + WebSocket (streaming agent responses with tool-activity, plan-chip, and suggested-action frames; ping/stop handling).
- **Provider adapter**: one interface with a fixed precedence — caller-supplied BYOK Anthropic key > Groq > OpenRouter > keyless Echo fallback. The effective default is the configured OpenRouter model; Pro/topup-funded turns route to a frontier model via `resolve_pro_model` (quiet fallback to free tier when credit is exhausted, never an error). There is no per-agent model config and no BYOK collection UI — the BYOK *selection logic* exists, the plumbing to supply a key does not.
- **Tools** (one provider-agnostic tool-calling schema; full list in `docs/tools.md`):
  - Code Interpreter + LaTeX compile — locked-down subprocess (`python3 -I`, kernel rlimits, wall-clock watchdog, throwaway scratch dir, non-root, read-only fs) on an internal Docker network with no egress; LaTeX via TeX Live multi-pass, `-no-shell-escape`, engine allowlist
  - Symbolic Math — SymPy (natural notation: `^` power, `2x` implicit multiply)
  - Web Search — self-hosted SearXNG
  - Vision / capture-to-solve — attached image via a vision-capable OpenRouter model (no OCR fallback)
  - Grammar/Writing — self-hosted LanguageTool
  - Citation Formatter — hand-rolled deterministic APA/MLA/Chicago formatter (no model call, no citeproc)
  - Calculator/Unit Converter — deterministic local functions, no model call
  - Spaced Repetition — real `fsrs` library scheduling + review-log audit trail
  - Voice — self-hosted whisper-asr (`faster_whisper`, base) for STT and a custom piper-tts REST service for TTS; plain service clients behind Pro-gated endpoints, not LLM tool calls
  - Study generation — flashcards, adaptive practice exams, study-plan extraction, and a Pro-only composite study session (all writing real DB rows)
  - Tutor intelligence — symbolic-verified work checking, real-performance weak-area analysis, SymPy-grounded leveled math hints
  - Research — SearXNG snippets plus allowlisted full-text fetch (SSRF/DNS-rebinding defenses, 15 calls/session) and Open Library textbook metadata
  - Heavy Pro-only generation — research-paper writer (plan→approve→execute, sandboxed compile) and interactive artifacts (persona brief → headless opencode coding agent, credit-metered)
- **Connectors**: Google Classroom (app-managed OAuth2; courses/courseWork read, sync tested short of the live Google consent screen, which awaits a redirect-URI registration). Canvas is not built (blocked on a developer key). Classroom/Canvas are outward integrations to services students already use — not part of "no cloud services," which governs infra we run ourselves.

## Agent layer (async Python: one Tutor + tool loop + background jobs)
1. Router — single-branch today: everything routes to the Tutor; kept as the seam future specialists plug into, not a classifier yet.
2. Tutor — conversational persona, general Q&A, with a 6-round tool loop. Every turn starts with 4 core tools + the `use_capability` meta-tool (which loads on-demand tools for the next round); `read_image` is appended deterministically on attached-image markers.
3. Math — SymPy-verified answers narrated as progressive-reveal `math-steps`, plus work-checking and leveled hints; plotting via sampled Plotly.js specs (gaps for discontinuities, slider variants in Learn Mode).
4. Study Planner — syllabus→calendarized items (honest `due_date_text` when no exact date) plus Classroom sync into the same table.
5. Flashcard/Quiz — generation from uploads + FSRS scheduling + adaptive practice exams (answer key withheld until completion).
6. Writing — grammar + deterministic citation feedback in chat; full papers only via the gated plan→approve→execute pipeline.
7. Document RAG — fastembed chunk embeddings + per-turn user-scoped top-k retrieval injected through the Tier-1 bundle.
8. Memory Consolidator — arq job, incremental: reads only messages since the per-session cursor, merges into the existing summary, upserts durable facts. Fires every 20 turns and at session end.
9. Artifacts — Pro-gated persona→coding-agent pipeline producing sandboxed single-file HTML (diagram/chart/slideshow/interactive/quiz), quiz content grounded in the student's real cards.

## Memory system
Three tiers, all on infra already listed above — no new services:

- **Tier 1 — Working memory (Redis, hot).** The live turn window (≤20 turns) plus assembled context (relevant profile facts + RAG chunks). Refreshed on every turn with a 2h TTL; rehydrated from Postgres on cold cache; fully dropped only on message-edit truncation or session delete — never by consolidation.
- **Tier 2 — Session summaries (Postgres, warm).** The consolidator merges only what's new since the `last_message_created_at` cursor into the one row per session — topics, problems solved, mistakes, actions taken — so lifetime cost grows linearly, not quadratically.
- **Tier 3 — Durable profile memory (Postgres + pgvector, cold, typed, deduplicated).** Fact rows keyed by `subject/key` (`course:MATH201`, `skill:derivatives`, `pref:explanation_style`) with `value`, `confidence`, `source_session_id`, `created_at`, `last_confirmed_at`, `superseded_by`. Writes are upsert-by-key, enforced by a partial unique index (dedup by construction, history preserved as a supersede chain). An `expires_at` column exists but nothing sets it yet — no automatic fact expiry is wired up. Retrieval is a small user-scoped top-k pgvector search, not a full dump.

## Desktop app (`apps/desktop`, Tauri + React + TS)
- Streaming chat with tool-activity chips, plan narration, and rendered `math-steps` / `plotly-figure` / `paper-plan` / `artifact-plan` / artifact blocks; sidebar sessions with server-generated titles; message edit/delete.
- Progressive-reveal math derivations mirrored into the always-on-top companion Notepad window (which also hosts notes with localStorage draft fallback and lecture-capture recording).
- Study Plan panel (syllabus items, calendar, Google Classroom connect + sync), Flashcards review (Again/Hard/Good/Easy), Practice Exams, Documents (upload, notes, generated papers, Anki/export downloads, share links), Pro model picker + credit top-ups, Settings, onboarding card, server-checked age gate.
- Desktop-native features: global-hotkey screen snip ("Newton Snip") flowing into the vision pipeline, system tray with quick actions, native notifications (due cards/plan items, once per sign-in), composer voice dictation and reply Listen playback (Pro-gated server-side), lecture capture, custom right-click menu, copy-to-clipboard on code blocks and share links, image attach in the composer.

## Infra
- Dev: isolated Docker Compose project on a shared dev box — loopback-only publishes on non-colliding ports, own project name/networks (`newton_net`, internal `sandbox_net`, `artifact_net`), per-container resource limits.
- Production (later): dedicated/multi-node as load justifies. Compose runs api, worker, sandbox-runner, artifact-runner, postgres, minio, redis, keycloak, searxng, languagetool, whisper-asr, piper-tts, caddy. GitHub Actions CI runs the API suite hermetically (self-signed JWKS, disposable DB) with 9 `live_smoke` tests excluded. No AI attribution in commits/PRs.
