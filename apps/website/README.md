# Newton Website

The public marketing/sign-up site for Newton, the agentic learning environment. Next.js (App
Router) + TypeScript, independent of `apps/desktop`. See `../../WEBSITE-ROADMAP.md` for build
status and scope.

## Development

```sh
npm install
npm run dev   # http://localhost:3000
```

Deliberately local-only for now — no deploy/hosting/DNS work happens until the product owner
explicitly signs off (see `../../WEBSITE-ROADMAP.md`).

## Build & test

```sh
npm run build       # production build
npm run typecheck   # tsc --noEmit
npm run test        # vitest
```
