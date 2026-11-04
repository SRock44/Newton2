# Newton — web

The browser build of Newton: the exact same app `apps/desktop` ships (wrapped by Tauri),
running as a plain web app instead. Full feature parity by construction, not by
reimplementation — see `apps/desktop/src/bootstrap.tsx`'s comment and the platform
abstraction in `apps/desktop/src/lib/platform.ts` (`isTauri()`) for how the one shared
source tree serves both builds.

This package has almost no source of its own on purpose:

- `src/main.tsx` — one line, imports `apps/desktop/src/bootstrap.tsx` (the exact function
  that mounts the app for the Tauri build too).
- `vite.config.ts` / `vitest.config.ts` — alias `react`/`react-dom` to
  `apps/desktop`'s own installed copies (the one place two separate copies would actually
  break something — React's hook dispatcher is a module-singleton — not just waste disk
  space) and allow Vite to serve files from `apps/desktop/src`. Every other import
  anything in that shared tree makes (katex, mathlive, tiptap, the Tauri plugin packages
  themselves, …) resolves automatically against `apps/desktop/node_modules`, because those
  files are physically located inside `apps/desktop/src` — no further aliasing needed, and
  nothing to keep in sync by hand as `apps/desktop`'s own dependencies change.

## What's actually different from the desktop build

Everything that needed a real platform-specific implementation lives in
`apps/desktop/src/` already, gated by `isTauri()`:

- Sign-in: a real browser redirect to Keycloak's hosted login (`beginWebSignIn`/
  `completeWebSignIn` in `apps/desktop/src/auth.ts`) instead of the desktop build's
  loopback-listener flow. No router/`/callback` page needed — Keycloak's `redirect_uri`
  for this build is just `${origin}/callback`, and the SPA's history-fallback serves
  `index.html` there like any other path; `App.tsx`'s bootstrap effect itself checks for
  `?code=` on the URL regardless of path and completes sign-in from it.
- File downloads: a `Blob` + synthetic `<a download>`, not a native save dialog.
- OS notifications: the standard `Notification` API, not a native one.
- Window chrome: none — just a plain brand/title strip; the browser already has its own.
- Not present at all, with no web equivalent: the Notepad companion window (becomes an
  in-app panel — separate, not-yet-done work), Newton Snip, the system tray, autostart,
  the auto-updater, and the `newton://` deep-link protocol.

## Running it locally

No `.env` needed for local development against the same dev box the desktop app's README
documents — `api.ts`'s `VITE_API_URL`/`VITE_KEYCLOAK_URL` defaults already point at the
same `127.0.0.1:58001`/`127.0.0.1:58180` loopback ports that box's SSH tunnel publishes
to, so with that tunnel open (`infra/README.md`'s "Remote dev box" section), this just
works:

```bash
npm install
npm run dev      # http://localhost:5173
```

`npm run build` runs `tsc` (type-checking the whole shared tree, not just this package's
own two files) then `vite build`. `npm test` runs this package's own tests — a real
integration smoke test proving the cross-package resolution above actually works under
`vitest`'s own module resolution too, not just Vite's dev/build bundler (a genuinely
different code path, so not a redundant check) — plus `apps/desktop`'s own 838+ tests
already cover every actual feature, since this package runs their exact same source.

## Production deploy

Not done yet — see `WEBSITE-ROADMAP.md`'s web-parity phase and the approved plan this
package was scaffolded from. Planned: a dedicated `app.newton.best` subdomain, Caddy
TLS, and the corresponding CORS/Keycloak-client/`KC_HOSTNAME` changes on the backend.
