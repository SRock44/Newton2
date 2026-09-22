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
- [x] Real feature sections grounded in what's actually built (verified computation
      tools, FSRS spaced repetition, sandboxed code-checking, paper compilation,
      cross-document synthesis, etc.) — copy checked against the real codebase
      (`services/api/app/tools/registry.py`'s real 26-tool list) and `ROADMAP.md`'s
      Phases 28-32, not invented. `src/app/page.tsx` replaces the Phase-1 one-paragraph
      scaffold with a full single-page site: a real header/nav (logo, Features/For
      Students/Download links, Sign In/Sign Up), a two-column hero with a headline,
      value-prop subhead, a primary "Download Newton" CTA, and a decorative mock
      "Verified" result card; a "Verified, not vibes" section with three concrete
      worked examples (a SymPy-factored polynomial, a linear-algebra-balanced chemistry
      equation, and a research-paper citation-grounding check) each carrying a real
      Verified/Grounding-checked badge; a 5-group feature grid (Verified Computation,
      Real Memory & Progress Tracking, Real Document Understanding, Honest by Design,
      Real Language Practice) covering symbolic math + linear algebra, chemistry,
      numeric methods + statistics, code/proof checking, FSRS flashcards
      (recognition + production), practice exams, the weak-areas engine, the semester
      document library, cross-document synthesis + annotation, server-enforced Focus
      Mode, the Verified badge, Conversation Practice, and production-mode flashcards;
      and a real structured footer (Product/Account/Company columns), not just a
      wordmark. The `--color-success`/`--color-success-tint` tokens were added to
      `globals.css`, copied from `apps/desktop/src/App.css`'s own
      `.tool-activity-chip--verified` values, so the landing page's Verified badge is
      the same real color as the actual in-app badge, not an invented one. Font
      pairing and core parchment/cobalt palette from Phase 1 left untouched.
- [x] A concrete Notepad-in-class section (the product owner's specific ask): a
      narrative scenario (taking live lecture notes, highlighting a confusing passage,
      getting an inline explanation without leaving the notes) paired with a mock note
      card showing the actual highlight-to-explain interaction, grounded in the real
      Notepad/`annotate_selection` feature from Phase 29.
- [x] Per-major use-case sections grounded in the real critique-review findings
      (2026-09-19 and 2026-09-21 reviews in `ROADMAP.md`): six cards (Math, Computer
      Science, Engineering & Natural Sciences, Social Sciences, Humanities, World
      Languages — the most compelling 6 of the reviews' 9 angles, per the task's own
      guidance) each citing a specific, real finding (e.g. CS's "checks your code,
      never writes it" from the `check_code_work` finding; Humanities' MLA/Chicago +
      citation-grounding from Phases 28/30; World Languages' Conversation Practice +
      production flashcards from Phase 29), plus a callout strip covering bare-topic
      generation for self-directed/test-prep students (Phase 32) without a full extra
      card.
- [x] Verification: real content review against source features (every claim traced
      to a specific ROADMAP.md phase or registry.py tool, no invented capability);
      `npx tsc --noEmit` clean; `npm run build` production build succeeds cleanly
      (static prerender of `/`); the website's test suite extended from 3 to 19 tests
      in `src/app/page.test.tsx`, covering the nav, hero CTA (and that it honestly
      doesn't claim a real download destination yet), the worked-example badges, all
      5 feature groups, the Focus Mode/Verified-badge honesty language, the Notepad
      narrative and mock card, all 6 per-major cards, and the footer's structure — all
      19 passing. Real Playwright-driven Chromium screenshots (temporary dev
      dependency, installed with `npm install --no-save playwright`, removed
      afterward along with the driver scripts) taken of the running dev server at
      1440x900 (desktop) and 390x844 (mobile), full-page and targeted section crops,
      visually reviewed: no overlapping text, no broken spacing, no unstyled elements;
      the mobile layout collapses the nav links and stacks every section correctly
      into a single column with the decorative cards reordered above their copy.

## Phase 3.5 — Visual/motion overhaul (product owner review: "looks plain... vibe-coded")
- [x] Expanded color system, still one cohesive world: kept the parchment/ivory +
      cobalt-ink foundation from Phase 1 untouched, added a warm gold/amber secondary
      accent (`--color-accent-2`) and a deep rust/terracotta tertiary accent
      (`--color-accent-3`) to `globals.css` (light + dark variants), used deliberately
      for specific moments (the demo section's plan-narration chip, the "Verified"
      circle-scribble accent, the closing CTA's gradient wash) rather than painted
      everywhere. Real depth added via a pure-CSS dot-grid texture (`--texture-dots`,
      no image asset) on the demo and Notepad sections, a radial gradient wash behind
      the hero, and a gradient behind the closing CTA — section backgrounds are no
      longer one flat `--color-bg` repeated down the whole page.
- [x] Real motion: `src/hooks/useInView.ts` (IntersectionObserver) + `src/components/
      Reveal.tsx` drive scroll-triggered fade/slide reveals across every section, all
      respecting `prefers-reduced-motion` (`src/hooks/useReducedMotion.ts`, plus a
      global reduced-motion CSS override in `globals.css`). Real hover/focus
      micro-interactions on buttons and cards (scale + shadow lift, not just a color
      change). The hero's worked-example card floats gently and reveals its computed
      result + Verified badge in a short animated sequence after mount rather than
      sitting fully static (`src/components/HeroMockCard.tsx`).
- [x] Real personality: hand-drawn-style inline SVG accents (a squiggle underline under
      "checks its work" in the hero, a circle scribble around "Verified" in the
      "Verified, not vibes" heading, a small arrow nudging toward the secondary CTA);
      an asymmetric, editorial layout for the "Verified, not vibes" section (a wide
      featured card + a narrower companion, then a full-width card offset below,
      instead of three identical boxes) with real typographic scale contrast; a
      tasteful easter egg (Newton's apple drops past the wordmark on hover/focus; a
      console log for anyone who opens devtools). All existing Phase 3 copy/claims
      left unchanged — this was a visual/motion pass, not a content rewrite.
- [x] Verification: `npx tsc --noEmit` clean; `npm run build` production build succeeds
      cleanly; the existing 19-test suite in `src/app/page.test.tsx` still passes
      unmodified (the reveal/motion wrappers don't hide or alter any existing content
      or accessible names); real Playwright-driven Chromium screenshots (temporary
      dependency, `npm install --no-save playwright`, removed afterward) at 1440x900
      and 390x844, full-page and section crops, in both light and dark
      (`prefers-color-scheme`), visually reviewed: asymmetric layout, textures,
      gradients, and hover states all render correctly; no overlapping text or broken
      spacing at either viewport.

## Phase 4 — Sign-up + download pages
- [ ] Sign-up page routes into the existing Keycloak OAuth flow (registration already
      enabled realm-side — confirmed, no new backend auth work needed).
- [ ] Download page with platform-detected buttons, linking to real GitHub Release
      artifacts (depends on Phase 2).
- [ ] Verification: a real sign-up flow walked through end-to-end against the real
      Keycloak realm; real download links confirmed to resolve to real artifacts.

## Phase 5 — Interactive demo (hybrid: scripted default + real "Try it live")
- [x] Scripted walkthrough: real captured transcripts from genuine sessions against the
      real backend (`apps/website/src/data/demo-transcripts.json` — 3 real scenarios,
      the actual WebSocket wire frames: `user_message_saved`, `tool_start`/`tool_end`
      with real `verified` flags, `plan_chunk`, real per-token `chunk` frames, `done`),
      replayed client-side (`src/components/DemoTranscript.tsx`, pure fold logic in
      `src/lib/demoTranscript.ts`). Not a port of the desktop app's components, but
      styled to match `apps/desktop/src/App.css`'s real `.tool-activity-chip`/
      `.tool-activity-chip--verified` chrome (spinner → checkmark-pop, pill shape,
      italic serif label, green Verified badge) so it reads as the same product's real
      output, not an invented mockup. Scenario tabs, autoplay-on-scroll-into-view
      (IntersectionObserver, `prefers-reduced-motion`-aware — jumps straight to the
      final state instead of animating), replay/restart, and a real progressive
      streaming reveal of the actual captured reply text (pacing is synthesized for a
      snappy feel; the CONTENT is always the exact real captured text, never altered).
      Explicitly labeled in-page as a real captured transcript replayed client-side,
      not a live chat — no network call to the real API happens anywhere in this path.
- [ ] "Try it live": a new, narrow guest-session backend — short-lived unauthenticated
      tokens, strict per-IP rate limits, a curated cheap-tool allowlist only (no
      Pro-gated tools), pre-seeded example documents instead of a real upload path,
      bot mitigation on the endpoint. Not started — no guest-auth/rate-limiting
      infrastructure exists yet; this is a separate, later, bigger task.
- [x] Verification (scripted path only): `npx tsc --noEmit` clean; `npm run build`
      succeeds; real tests in `src/lib/demoTranscript.test.ts` (frame-fold correctness
      against the real fixture — repeated same-tool calls matched independently, a
      chip stays "running" until its real `tool_end` arrives, the accumulated reply
      text is byte-identical to the real chunks joined in order, verified flags never
      defaulted) and `src/components/DemoTranscript.test.tsx` (scenario tab switching,
      a "Verified" badge rendered for exactly the real `verified: true` tool calls in
      every one of the 3 scenarios, and — via real fake-timer-driven playback, not just
      the reduced-motion instant path — the reply genuinely streams progressively
      before completing with the exact real captured text); real Playwright screenshots
      of the demo section both mid-animation (partial tool activity/reply visible) and
      after the reply has fully revealed, at both viewports, confirmed visually.
- [ ] Verification (live path): a real abuse/rate-limit test against the guest
      endpoint; real tests for the live path. Not applicable yet — the live path itself
      isn't built.

## Phase 6 — Deferred
- Full web-based chat client against the real API for signed-in users, with an honest
  capability matrix (native OS notifications and native file-save dialogs are the real
  desktop-only things; most tools would work fine in a browser). Not scheduled.

## Deployment / newton.best cutover
Not scheduled. A separate, explicitly-confirmed decision once Phases 1-5 (or however
much of them the product owner wants live first) are in a genuinely good place. No
Caddy, Docker, DNS, or hosting work happens before that conversation.
