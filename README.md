# Newton

Newton is an Agentic Learning Environment (ALE): a native desktop study companion that connects to your real coursework (Canvas, Google Classroom), reads your syllabus to build a study plan, solves problems with actual tools (code execution, symbolic math, web search, vision), shows its work step-by-step, and remembers you across sessions without re-reading your whole history every time.

Everything runs on infrastructure we own — no Firebase, no managed cloud services. Postgres, object storage, auth, search, and code execution are all self-hosted.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the system design and [`ROADMAP.md`](./ROADMAP.md) for build status.

## Repo layout

```
apps/desktop/       Tauri app (Rust shell + React/TypeScript UI)
services/api/       FastAPI backend: agents, tools, providers, connectors
services/sandbox-runner/  Isolated code-execution service
packages/shared-types/    Types shared between backend and desktop app
infra/               docker-compose, reverse proxy config, deploy scripts
docs/                 Design notes
```

## Status

All rights reserved unless a LICENSE file is added later.
