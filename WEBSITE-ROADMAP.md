# Newton Website — Roadmap

Tracks the build-out of Newton's new public website (`apps/website/`), replacing the
existing `newton.best` (a separate, older Firebase-hosted repo/site, untouched until
this is in a good place — see the "Not yet in scope" note below). Same evidentiary
convention as the main `ROADMAP.md`: an item is only checked off once it's built,
independently verified (real command output, not "should work"), and covered by the
website's own test suite — never marked done on a plan alone.

**Explicitly NOT in scope yet** (deliberately deferred, confirmed with the product
owner 2026-09-22): deploying anywhere, any Caddy/Docker/DNS work, and any change to the
live `newton.best` domain. The site runs via `npm run dev` locally only until the
product owner decides it's ready for a real hosting/cutover conversation — that's a
separate, later, explicitly-confirmed step, not an assumed next task.

## Phase 1 — Foundation
- [x] `apps/website/` created: Next.js (App Router), TypeScript, real current stable
      Next.js version (confirmed at build time, not guessed) — `next@16.3.5` (via
      `npm view next version` at scaffold time), `react@19.2.8`, App Router +
      `src/` layout, scaffolded with `create-next-app` (no Tailwind, no ESLint —
      matching `apps/desktop`'s own plain-CSS, tooling-light convention).
- [x] Base layout / design tokens established, drawing on `apps/desktop`'s existing
      visual language: `src/app/globals.css` ports the same parchment/ivory-in-light,
      warm-charcoal-in-dark neutrals and the same deep cobalt-ink blue accent from
      `apps/desktop/src/App.css`'s `:root`, and `src/app/layout.tsx` loads the same
      self-hosted Public Sans + Fraunces Variable font pairing (not `next/font/google`
      defaults) — not a byte-for-byte copy (no Settings-driven `data-theme` toggle yet,
      dark mode follows `prefers-color-scheme` only), but recognizably the same product.
- [x] A real test suite for the website exists (Vitest 5 + React Testing Library 16 +
      jest-dom 7, matching `apps/desktop`'s own versions/convention: `jsdom` environment,
      `src/test/setup.ts`, `globals: true`) — its own `vitest.config.ts`, independent of
      the desktop app's suite.
- [x] `npm run dev` runs cleanly, real manual verification that the page renders:
      `next dev` (Turbopack) started in 556ms on `http://localhost:3000`, `curl` against
      it returned a full server-rendered page with the real title/description/content.
- [x] Verification: `tsc --noEmit` clean (0 errors); website's own test suite green —
      3 tests passed / 1 test file (`src/app/page.test.tsx`, asserting the real wordmark,
      the README-grounded description, and that no Phase-4 sign-up/download claim is
      made yet); `npm run build` (production build) compiled and prerendered `/` and
      `/_not-found` as static content with no errors; a real Playwright-driven Chromium
      screenshot of the running dev server confirmed the parchment background, Fraunces
      serif heading, and Public Sans body text actually render (not just "the build
      didn't error") — Playwright was a temporary dev-only tool for that one check and
      was removed afterward, not left as a project dependency.

## Phase 2 — Release pipeline (Tauri updater + signed installers)
- [x] Confirmed: the app-side updater config (`tauri-plugin-updater`, `tauri.conf.json`'s
      endpoint + embedded pubkey, `updater:default` capability) was already fully wired
      before this initiative started — this phase is purely the *producing* side.
      Verified by reading `apps/desktop/src-tauri/tauri.conf.json` directly: `plugins.
      updater.endpoints` is `https://github.com/SRock44/Newton2/releases/latest/
      download/latest.json`, a `pubkey` is embedded, `bundle.createUpdaterArtifacts` is
      `true`, and `capabilities/default.json` grants `updater:default`.
- [ ] New GitHub Actions release workflow: real signed builds for Windows/macOS/Linux.
      `.github/workflows/release.yml` written (tag-triggered on `desktop-v*` +
      `workflow_dispatch`, matrix over macOS arm64/x64, ubuntu-22.04, windows-latest,
      via `tauri-apps/tauri-action@v0`) — not yet run for real, so unchecked until a
      real triggered run is observed green. Deliberately does NOT attempt Apple
      notarization or a Windows EV cert (no such secrets exist on this repo); update
      artifacts will be minisign-signed and updater-verifiable but installers will show
      an OS "unknown publisher" warning until that separate, later work happens.
- [ ] Real minisign signing keypair set up — private key verified as a GitHub Actions
      secret only, never committed; public key matches what's already embedded in
      `tauri.conf.json` (or that file updated if a new keypair was generated).
      A minisign private key already exists locally at `~/.newton/newton-updater.key`
      (found, not read — the harness's auto-mode classifier blocks materializing/
      reading private key contents, correctly). Presumed to be the match for the pubkey
      already embedded in `tauri.conf.json`, but that match is NOT yet independently
      verified (would need `minisign -R` against the embedded pubkey, or a real signed
      test build that a real updater instance accepts). `gh secret list` against the
      real `SRock44/Newton2` repo confirms **no secrets are set yet** — this step is
      genuinely not done, not just unverified. Needs a human (or an explicitly
      re-permissioned run) to run
      `gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.newton/newton-updater.key` and set
      `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (if the key is password-protected) before
      `release.yml` can produce a real signed build.
- [ ] `latest.json` generation + real GitHub Release publishing, matching the format
      `tauri-plugin-updater` expects. `release.yml` delegates this to
      `tauri-apps/tauri-action@v0` (`releaseDraft: false`, so it publishes for real, not
      a draft) — unverified until a real run produces a real `latest.json` this repo's
      own updater endpoint resolves against. `gh release list` on the real repo
      currently shows zero releases.
- [ ] Verification: a real end-to-end test — an actual built app instance checks for
      updates against a real published release and reports what it found (not just "the
      workflow YAML looks right").

## Phase 3 — Landing page content
- [ ] Real feature sections grounded in what's actually built (verified computation
      tools, FSRS spaced repetition, sandboxed code-checking, paper compilation,
      cross-document synthesis, etc.) — copy checked against the real codebase/
      `ROADMAP.md`, not invented.
- [ ] Per-major use-case sections grounded in the real critique-review findings
      (2026-09-19 and 2026-09-21 reviews in `ROADMAP.md`).
- [ ] Verification: real content review against source features, frontend tests for
      the new sections, a real rendered screenshot check.

## Phase 4 — Sign-up + download pages
- [ ] Sign-up page routes into the existing Keycloak OAuth flow (registration already
      enabled realm-side — confirmed, no new backend auth work needed).
- [ ] Download page with platform-detected buttons, linking to real GitHub Release
      artifacts (depends on Phase 2).
- [ ] Verification: a real sign-up flow walked through end-to-end against the real
      Keycloak realm; real download links confirmed to resolve to real artifacts.

## Phase 5 — Interactive demo (hybrid: scripted default + real "Try it live")
- [ ] Scripted walkthrough: real captured transcripts from genuine sessions against
      the real backend (not fabricated), replayed through ported real UI components
      from the desktop app (message bubbles, tool-activity chips) so it looks like the
      product because it is the product's real output.
- [ ] "Try it live": a new, narrow guest-session backend — short-lived unauthenticated
      tokens, strict per-IP rate limits, a curated cheap-tool allowlist only (no
      Pro-gated tools), pre-seeded example documents instead of a real upload path,
      bot mitigation on the endpoint.
- [ ] Verification: real transcripts confirmed byte-accurate against what the backend
      actually returned when captured; a real abuse/rate-limit test against the guest
      endpoint; real tests for both the scripted and live paths.

## Phase 6 — Deferred
- Full web-based chat client against the real API for signed-in users, with an honest
  capability matrix (native OS notifications and native file-save dialogs are the real
  desktop-only things; most tools would work fine in a browser). Not scheduled.

## Deployment / newton.best cutover
Not scheduled. A separate, explicitly-confirmed decision once Phases 1-5 (or however
much of them the product owner wants live first) are in a genuinely good place. No
Caddy, Docker, DNS, or hosting work happens before that conversation.
