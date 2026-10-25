# Newton Desktop

The Tauri + React + TypeScript desktop client for Newton, the agentic learning environment.

## Development

```sh
npm install
npm run dev      # vite dev server
npm run tauri dev  # full desktop app, via Tauri
```

## Build & test

```sh
npm run build   # tsc typecheck + production build
npm run test    # vitest
```

Requires `VITE_API_URL` and `VITE_KEYCLOAK_URL` pointing at a running Newton backend and Keycloak instance.

```sh
copy .env.example .env
```

The example values (`http://127.0.0.1:58001` and `http://127.0.0.1:58180`) match the ports published by `infra/docker-compose.yml`. Start that stack from the repo root first (`cd infra`, then `docker compose up -d`) — see `infra/README.md`.
