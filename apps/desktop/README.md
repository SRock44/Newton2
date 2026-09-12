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

Requires `VITE_API_URL` and `VITE_KEYCLOAK_URL` pointing at a running Newton backend and Keycloak instance (see the repo root for backend setup).
