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

## Phase 3.6 — FAQ/About/Changelog/Roadmap pages + a real Pro section
- [x] A real Pro section added to the homepage (`#pro`, between "Built for every
      student" and the closing CTA): a two-column Free-vs-Pro comparison. Every listed
      Pro feature (full research paper writing, AI-generated artifacts, Deep Research,
      composite study sessions, voice/Conversation Practice, frontier-model access,
      higher generation limits) confirmed gated behind the real backend's
      `billing_service.is_pro()`, reused by `write_research_paper.py`,
      `create_artifact.py`, `deep_research.py`, `study_session.py`, and
      `app/routers/voice.py`. Deliberately no dollar figure anywhere — the real Pro
      price lives in Stripe config, not this codebase, and isn't something the site can
      honestly state; the section says so explicitly instead of guessing. "Upgrade to
      Pro" links to `#` for the same Phase-4 reason every other sign-up/billing CTA on
      this page does.
- [x] Four new standalone routes — `/faq`, `/about`, `/changelog`, `/roadmap` — each a
      real Next.js page (`src/app/{faq,about,changelog,roadmap}/page.tsx`), not a modal
      or an anchor on the homepage. FAQ answers 9 real questions grounded in the actual
      codebase, explicitly declining to invent a free-tier number or link a privacy
      policy that doesn't exist yet (`PRIVACY_POLICY.md` at the repo root is an
      engineer-authored draft, not published). About states Newton's real mission via
      four concrete mechanisms (computed-vs-reasoned answers, server-enforced Focus
      Mode, check-don't-write code/proof checking, FSRS + weak-areas memory) with no
      invented team, founding year, or company history. Changelog lists real shipped
      capability in plain language, newest first, sourced from `ROADMAP.md`'s actual
      history — no internal phase numbers. Roadmap lists 8 items pulled directly from
      `ROADMAP.md`'s own real deferred/planned/not-scheduled items (the live "Try it
      live" demo, a web chat client, OS notification review reminders, academic-search
      integration, a Conversation Practice session report, a weekly digest,
      collaborative study rooms, a bundled offline mode), every one framed honestly as
      "Planned" with no delivery date.
- [x] Shared chrome instead of four copies: `src/lib/siteNav.ts` holds one real source
      of truth for the nav/footer link data (used by both `page.tsx` and every new
      route), so the five real routes and the two in-page anchors never drift between
      the homepage and the standalone pages. `src/components/SiteChrome.tsx`
      (`SiteHeader`/`SiteFooter`) and `src/components/ContentPage.tsx`
      (`ContentPage`/`ContentHero`) factor out the header/footer/page-shell chrome for
      the four new routes only — `page.tsx` deliberately keeps its own inline
      header/footer untouched, so this pass never touches the hero/demo/"Verified, not
      vibes" region. The homepage's own header/footer were updated in place to read
      from `siteNav.ts` too (previously inline, incomplete `NAV_LINKS`/`FOOTER_COLUMNS`
      arrays that stubbed About/Contact to `#` even though About is now real), so both
      surfaces now render from the identical data.
- [x] Verification: `npx tsc --noEmit` clean; `npm run build` production build succeeds,
      all 6 routes (`/`, `/about`, `/changelog`, `/faq`, `/roadmap`, `/_not-found`)
      statically prerendered; 4 new test files
      (`src/app/{faq,about,changelog,roadmap}/page.test.tsx`) plus
      `src/components/SiteChrome.test.tsx` and new assertions in `src/app/page.test.tsx`
      covering the Pro section and the nav/footer's real-route links — 55 of the
      website's 58 tests passing (the 3 failing are pre-existing, unrelated to this
      phase: a `document-reference` demo-transcript scenario added by a prior commit
      without updating `demoTranscript.test.ts`/`DemoTranscript.test.tsx`'s expected
      scenario count — reproduced identically against a clean `main` checkout, so not a
      regression introduced here; tracked separately). Real Playwright-driven Chromium
      screenshots (temporary dev dependency, `npm install --no-save playwright`,
      removed afterward along with the driver script) of all 5 routes at 1440x900 and
      390x844, visually reviewed: no overlapping text, no broken spacing, the FAQ
      accordion, About's principle list, Changelog's timeline, and Roadmap's card grid
      all collapse cleanly to a single column on mobile, consistent with the rest of the
      site's responsive convention. Real Playwright-driven interaction checks (not just
      static screenshots): the header's "Pro" nav link clicked and confirmed to scroll
      `#pro` into view; every footer link (FAQ, About, Changelog, Roadmap) clicked and
      confirmed to navigate to its real route via `page.waitForURL`; nav/footer hrefs
      captured and confirmed to point at real internal routes rather than `#` stubs,
      except the genuinely-unbuilt destinations (Sign In/Up, Download, Contact) which
      stay honestly stubbed.

## Phase 3.7 — Third design iteration: graded-paper visual, real app-chrome demo, hero repositioned
Phase 3.5's visual overhaul was rejected a second and third time by the product owner ("I hate it. It looks like vibe coded slop... 'Verified, not vibes.' entire section is terrible... the demo... doesn't demonstrate the actual power and use-cases of Newton"). This phase responds to that specific, verbatim feedback rather than iterating vaguely on the prior pass.
- [x] **"Verified, not vibes" section replaced entirely.** The three-times-rejected card grid is gone. In its place: `GradedPaper.tsx` — a single dominant visual, a real marked-up notebook page (self-hosted Caveat handwriting font) showing the real captured `math-catches-mistake` scenario's actual wrong answer `(x+1)(x+6)`, a red-pen strikethrough/margin correction, and the real verified answer `(x+2)(x+3)` with a green "Verified" stamp — leaning into "checks its work" as a literal visual metaphor instead of a phrase. The chemistry/code/citation examples that used to be separate cards are now a compact strip beneath it, not dropped.
- [x] **A real document-grounded demo scenario added.** A genuine document (`Physics 201 - Lecture 14.txt`, real lecture notes on magnetic hysteresis) was uploaded to `student1`'s real Documents via the live backend, then a real question asked that's only answerable from that document — the captured reply repeatedly cites "your notes" and the document's actual content. This is real captured data (`demo-transcripts.json`), not fabricated, proving the persistent-document-memory differentiator the product owner specifically asked to see, not just computation.
- [x] **The demo rebuilt as a real app-chrome recreation**, not an abstract snippet: a title bar, a sidebar showing the real uploaded document, and a chat panel styled on the real desktop app's `MessageBubble`/`.tool-activity-chip` conventions — modeled on `apps/desktop/src/components/Sidebar.tsx` and `App.css`, not invented from scratch. The document-grounded scenario is now the default/leading one; the other three (math mistake, chemistry, code) remain reachable via the existing tab-switching.
- [x] **Demo repositioned above the fold.** The hero collapsed to a single centered block with the demo directly beneath it in the same shell — per the product owner's literal instruction ("The demo should be on the LANDING page once once you go to the website") — rather than scrolled-to further down the page.
- [x] Verification: `tsc --noEmit` clean; 41/41 tests passing in this branch (65/65 across the full merged site including Phase 3.6's work); `npm run build` clean; real Playwright screenshots using incremental `window.scrollTo` steps rather than a single `fullPage: true` capture (a real false-positive was caught in an earlier round — Playwright's fullPage capture resizes instantly rather than scrolling like a real user, racing the `IntersectionObserver` reveals and making fully-working content look broken; incremental scrolling avoids that) — reviewed at 1440x900 and 390px, plus a dark-mode pass confirming the new red-pen/verified-stamp colors use the existing CSS-token system with real dark variants.
- **Coordinating-session verification.** Both this branch and Phase 3.6's branch were built in parallel and both modified `page.tsx` substantially — merged sequentially with a real, hand-resolved conflict (not an automatic superset this time): `NAV_LINKS`/`FOOTER_COLUMNS` now come from Phase 3.6's shared `siteNav.ts` module (more correct than this branch's own local nav array, since the new FAQ/About/Changelog/Roadmap pages all need the same nav), while this phase's `GradedPaper` import and `ALSO_VERIFIED` naming were kept. Full re-verification after merge, from a clean `npm install` (not just the pre-merge state): `tsc` clean, **65/65 tests passing**, `npm run build` producing all 6 real routes, and real Playwright screenshots (incremental-scroll, not `fullPage`) of the merged home page and all four new content pages, reviewed directly — no overlapping text, no broken spacing, real navigation confirmed working end to end.

## Phase 3.8 — Subtraction + rewrite pass (three converging critique audits)
Executed as a literal work order distilled from three independent critique passes on
the live Phase 3.7 page — a quantified visual-density audit, a copywriting-voice audit
quoting exact text, and a skeptical-first-time-visitor test — that converged on the same
findings: the page was too long, too repetitive, and leaned on
"real/actual/genuine/honest/verified" as a crutch word instead of letting the demo and
the graded-paper visual carry the claims. This was disciplined subtraction and rewrite,
not new design work; the product owner had already rejected four rounds of open-ended
"make it better" passes.
- [x] **Cut list executed** (`apps/website/src/app/page.tsx`,
      `page.module.css`): deleted the "For Students" section entirely (~6 cards,
      duplicated the feature grid almost verbatim); collapsed the 13-card, 5-subgroup
      feature grid into a 6-item, single-line-per-item capability list (`CAPABILITIES`);
      cut the "also verified" card strip and the closing footnote paragraph from the
      "Verified, not vibes" section, replacing both with one line ("The same standard
      applies to chemistry, your code, and citations."); shortened the Notepad section
      from 2 paragraphs (~140 words) to 1 sentence; shortened Pro (7 feature
      descriptions cut to titles only, free-tier list cut from 5 items to 3, the
      "Everything free, plus the expensive tools" heading sentence cut, replaced by an
      `aria-label` on the section); deduped the footer's "Product" column against the
      main nav (dropped Features/Pro, since both are already in the header) and removed
      the "Account" column entirely (Sign In/Sign Up already live in the header) —
      `src/lib/siteNav.ts`'s `NAV_LINKS`/`FOOTER_COLUMNS` updated accordingly, also
      dropping the now-dead "For Students" nav entry; cut the separate closing CTA
      section (redundant with the hero's own CTA — "Free to start" already lives in the
      hero's existing note line, so nothing was lost).
- [x] **Copy voice rewrite**: applied the audit's exact specified rewrites verbatim —
      the hero subhead, the "Other AI tutors guess. Newton grades." line (replacing
      "Most AI tutors tell you an answer sounds right..."), the Focus Mode line
      ("Focus Mode holds back the answer until you ask. Enforced server-side, not
      politely requested of the model."), the Notepad's one-sentence description, "This
      is the app." (was "This is the actual app."), and "What it does." (was "Real
      capability, organized honestly."). Also trimmed crutch-word instances in
      `src/components/GradedPaper.tsx`'s figcaption and `src/components/
      DemoTranscript.tsx`'s idle/disclaimer/tooltip copy (structure/positioning of both
      components left untouched, per the task's explicit scope). "Verified, not vibes"
      (the eyebrow/tagline) and the Verified badge/stamp itself were deliberately kept
      — the one place the word is doing real work.
- [x] **Mobile nav bug fixed**: below 720px the header previously hid the primary nav
      and the Sign In link with no replacement, leaving Features/Pro/FAQ/Sign In
      completely unreachable on mobile — confirmed by the skeptical-visitor audit. Added
      a real hamburger toggle (`.menuToggle`) + dropdown panel (`#mobile-nav`,
      `aria-expanded`/`aria-controls`) in `page.tsx`, rendering `NAV_LINKS` plus Sign
      In/Sign Up; closes on link click. Verified working via a real Playwright click (not
      just a screenshot): the toggle opens the panel, all 5 links are present and
      reachable, and clicking FAQ navigates to the real `/faq` route
      (`page.waitForURL`).
- [x] **Verification, all real**: `npx tsc --noEmit` clean; `npm run build` clean, all 6
      routes (`/`, `/about`, `/changelog`, `/faq`, `/roadmap`, `/_not-found`) statically
      prerendered; the website's test suite (`src/app/page.test.tsx`,
      `src/components/SiteChrome.test.tsx`) rewritten to match the cut/renamed content
      instead of leaving dead assertions — **70/70 tests passing** across all 8 test
      files (the previously-tracked 3 pre-existing `demoTranscript`-scenario-count
      failures are no longer reproducing). Real word/section counts, measured by
      rendering both the pre-Phase-3.8 page and the new page with React Testing Library
      and reading `document.querySelector("main").textContent` (not estimated): **body
      copy 1,483 words → 425 words** (a 71% cut, under the ~500-word target); **content
      sections 7 → 6** by the same measurement convention (Hero, Demo, Verified,
      Capabilities, Notepad, Pro — down from Hero, Demo, Verified, Feature Grid,
      Notepad, For Students, Pro; the separate closing CTA, which added an 8th, is
      gone). Crutch-word count (`real|actual|genuine|honest|verified`, case-insensitive)
      measured two ways: in the page's **rendered/visible text**, 88 → 11 occurrences
      (the 11 remaining are the "Verified, not vibes" eyebrow/tagline, the Verified
      badge/stamp, and the hero's "real tools"/"real computation" phrasing specified
      verbatim by the audit's own exact-rewrite instructions); in the raw
      `page.tsx` source text (including code comments), grepping the literal file per
      the task's own instruction, 108 → 27. Real, incremental-scroll Playwright
      screenshots (temp-installed with `npm install --no-save playwright`, fully
      removed afterward with `npm uninstall --no-save playwright`) at 1440x900 and
      390x844 confirmed no overlapping text or broken spacing anywhere on the shortened
      page, and specifically confirmed the mobile hamburger menu opening, showing real
      links, and navigating on click.
- **Note**: the desktop page height dropped from the pre-pass 8,229px (the number the
  original density audit measured) to **4,874px** measured the same way (`document.body.
  scrollHeight` at 1440x900) — a 41% reduction, consistent with the word/section cuts
  above.

## Phase 3.9 — Pivot the hero demo from chat replay to a Supademo-style product walkthrough
Product owner, verbatim: "instead of showing off CHAT, can we show off Artifact
generation for educational purposes... make the LIVE DEMO ACTUALLY LOOK LIKE OUR APP...
I'D RATHER HAVE IT BE LIKE A VIDEO (SUPADEMO STYLE) OF THE APP IN USE... show off THE
ACTUAL USEFUL FEATURES OF THE APP (NEWTON NOTEPAD, ARTIFACT GENERATION, STUDY MODE
(HAVE IT SHOW THE USER ANSWERING THE QUESTION WRONG, AND NEWTON GUIDING THE USER TO THE
RIGHT ANSWER))... WE ARE THE FIRST EVER AGENTIC LEARNING ENVIRONMENT." This phase
replaces the chat-transcript hero demo (`DemoTranscript.tsx`, deleted this pass, along
with its supporting `lib/demoTranscript.ts`, `lib/renderReplyMarkdown.tsx`, and
`data/demo-transcripts.json` — nothing else referenced them once it was gone) AND folds
the separate "Verified, not vibes"/`GradedPaper` section and the separate Notepad
section into one section: `src/components/AppWalkthrough.tsx`, a stepped, auto-advancing
3-scene walkthrough (progress segments, pause-on-hover, manual prev/next and
click-to-jump step controls) instead of a token-by-token chat replay.
- [x] **Scene 1 — Study Mode.** Reuses `GradedPaper.tsx` exactly as it already existed
      (not rebuilt) for the visual — the real `math-catches-mistake` scenario, unchanged.
      Paired with the real guiding follow-up question pulled verbatim from that same
      captured transcript's `chunk` frames: *"Try this: can you find a different pair of
      numbers that multiply to 6 but add up to 5 instead of 7?"* — Newton's actual
      captured reply, not paraphrased. `GradedPaper.tsx`'s own figcaption had it link to
      `#demo` with "Watch the full exchange below" — that pointed at the now-deleted
      chat-replay demo, so the dead link was removed as part of reusing the component
      (the visual/marks themselves are untouched).
- [x] **Scene 2 — Newton Notepad.** The same real "Lecture 14 — Electromagnetism"
      highlight-to-explain card content the old standalone Notepad section used,
      unchanged, now inside the walkthrough instead of its own section.
- [x] **Scene 3 — real artifact generation, ending on a live, interactive artifact.**
      The real interactive artifact built earlier this session by the real
      `create_artifact` tool (`services/api/app/tools/create_artifact.py`, Muse Spark /
      `artifact_generation_model`, a real Pro-gated backend call) — a draggable point on
      a unit circle with live cos/sin/tan readouts — is moved from `src/data/` into
      `public/demo/unit-circle-artifact.html` so Next.js serves it as a real static
      asset; confirmed serving with a real HTTP request against a real `next start`
      server (`GET /demo/unit-circle-artifact.html` → 200, 16,270 bytes, real HTML).
      The scene shows the real prompt that generated it ("Build me an interactive
      artifact that teaches the unit circle"), the real progress label
      `create_artifact.py`'s own `on_progress` callback uses for `kind="interactive"`
      ("Building your interactive demo" — reused verbatim from `_ARTIFACT_BUILDING_LABELS`,
      not invented), then embeds the artifact live via
      `<iframe sandbox="allow-scripts">` — no `allow-same-origin`, matching that tool's
      own documented rendering posture (no storage access, no network) since the
      artifact needs neither. This scene never auto-advances away — it's the walkthrough's
      terminal/resting state.
- [x] **Positioning.** One line, stated once, not argued for: the walkthrough's eyebrow
      reads "The first Agentic Learning Environment", its subtitle "Built to teach you,
      not do it for you." — Scene 1 (Newton declining to just hand over the answer) is
      the actual proof; the copy doesn't re-explain it elsewhere on the page.
- [x] **Section count actually went down, not up.** Hero → Demo/Verified/Notepad (3
      sections) collapsed into Hero → Walkthrough (1 section) → Capabilities → Pro.
      `document.querySelectorAll("main > section, main > div > section")` against the
      rendered page: **6 → 4**. The header's "Features" nav link and the walkthrough's
      own hero CTA both needed real anchor targets that still exist after the cut —
      `#verified` (deleted) became `#features` (a real `id` added to the Capabilities
      section, `src/lib/siteNav.ts` updated) and the hero's "See how it works" now
      points at `#demo` (the walkthrough's own id) instead of the deleted section.
- [x] **Real bug found and fixed in the process**: the site header is
      `position: sticky`, and neither `#demo`, `#features`, nor `#pro` had a
      `scroll-margin-top` — jumping to any of them (the hero CTA, a nav link, or a
      Playwright `scrollIntoViewIfNeeded()` during this pass's own verification) landed
      the section's heading partly underneath the sticky header. Fixed by adding
      `scroll-margin-top: 96px` to the shared `.section` class in `page.module.css`
      (covers all three anchors, since all three now share that class). Caught by
      actually looking at a real screenshot, not just running `tsc`/tests.
- [x] **Verification, all real.** `npx tsc --noEmit` clean; `npm run build` clean, all 6
      routes prerendered; the artifact file's static-serving confirmed with a real
      `curl` against a real running `next start` server (not assumed from the file copy
      succeeding). Test suite rewritten rather than left with dead assertions for the
      removed components/sections (`DemoTranscript.test.tsx` and
      `lib/demoTranscript.test.ts` deleted along with the components/modules they
      tested; `src/app/page.test.tsx` and `src/components/SiteChrome.test.tsx` updated
      for the new structure/anchors; a new `src/components/AppWalkthrough.test.tsx`
      added) — **57/57 tests passing across 7 files** (was 70/70 across 8 at the end of
      Phase 3.8; the reduction is fewer components to test, not fewer assertions per
      component). `AppWalkthrough.test.tsx` covers manual step/prev/next navigation,
      and — using a mocked `IntersectionObserver` plus `vi.useFakeTimers()` — real
      timer-driven auto-advance (scene 0 → 1 → 2 on its own real schedule), pause-on-hover
      (advancing the fake clock 15s past a scene's real duration while "hovered" and
      confirming it did NOT advance), resume-on-unhover, and that scene 2 does not loop
      back to scene 0 even after 30 real seconds more. Real Playwright screenshots
      (temp-installed with `npm install --no-save playwright`, fully removed afterward)
      at 1440x900 and 390x844, of all 3 scenes, plus a `prefers-color-scheme: dark` pass.
      Scene 3 specifically: the real embedded artifact was actually dragged two
      different ways through Playwright's frame-locator APIs against the real running
      iframe — the slider (`#slider` → `.fill("135")`) and the SVG point itself (real
      `mouse.down()`/`mouse.move()`/`mouse.up()` pointer events on `#svg`) — with the
      live `#roTheta`/`#roCos`/`#roSin`/`#roTan` readouts confirmed to actually change
      both times (e.g. 30° → 135° via the slider: cos 0.866→-0.707, sin 0.500→0.707, tan
      0.577→-1.000; then a further SVG drag to 315°: cos 0.707, sin -0.707, tan -1.000),
      proving it's genuinely interactive rather than a static screenshot. The
      auto-advance/pause/no-loop behavior above was also confirmed a second time against
      a real browser with real (non-fake) timers, not just the fake-timer unit test.
      Real word/section counts, same `document.querySelector("main").textContent`
      convention as Phase 3.8's own measurement: **body copy 425 words → 283 words**
      (this pass replaces three sections' copy with one tighter section, not adding a
      fourth thing on top); crutch-word count (`real|actual|genuine|honest|verified`,
      case-insensitive) in rendered/visible text, **11 → 3** (the 3 remaining: the hero's
      "real tools" and the graded-paper stamp's "Verified"/"real symbolic computation" —
      all pre-existing, not new instances added by this pass); desktop page height at
      1440x900 (`document.body.scrollHeight`), **4,874px → 3,569px**.
- **A real stale-server false alarm during this pass's own verification, worth recording
  honestly**: an earlier `next start` process was still bound to port 4173 from before a
  CSS fix (`pkill -f "next start"` didn't match it, and a later start attempt silently
  no-op'd behind a failed log redirect), so several verification screenshots were
  actually taken against a stale build with an incomplete CSS chunk — surfacing as a
  real-looking but fake bug (giant unstyled SVG marks on the graded-paper visual at
  mobile width). Found by fetching the served CSS chunk directly and diffing its
  contents/hash against a fresh build, not by trusting the first screenshot. Re-verified
  end to end (`tsc`, tests, build, a freshly-bound server, then Playwright) once the
  actual current build was confirmed being served (`GET`'d CSS chunk contained
  `GradedPaper`/`AppWalkthrough` rules; hash changed between builds as expected).
- **Honest assessment on the screen-recording question**: this pass does not include a
  literal Tauri screen recording. An earlier session this same night hit a real WebView2
  rendering failure trying to launch the desktop app on this machine, and re-fighting
  that wasn't attempted again here — out of scope, by design, for tonight. What's here
  instead is real backend-generated data (an actually-captured transcript for Scene 1,
  the actually-generated artifact for Scene 3) presented through a much higher-fidelity,
  stepped, video-like UI than the old chat replay. It reads much closer to "the actual
  app" now, especially Scene 3 where a visitor is dragging a real thing Newton actually
  built rather than watching text stream into a recreated chat pane. A real Tauri
  screen-recording (once WebView2 launches reliably on a real capture machine) would
  still be worth a later pass, particularly for Scene 2 (Notepad) and Scene 1 (Focus
  Mode's actual in-app chat surface, which this pass does not attempt to recreate at
  all) — Scene 3 is the one place a literal recording would arguably add the least,
  since the artifact embedded here already is the real, live, interactive thing itself,
  not a recording of it.

## Phase 3.10 — Replace recreated visuals with real app screenshots; sitewide page transitions
Product owner, verbatim: "it needs that SUPADEMO feel! My problem is that this 'demo'
LOOKS NOTHING LIKE OUR APP. IT DOES NOT SHOW HOW USERS WILL USE OUR APP." Phase 3.9's
Scene 1/2 visuals (`GradedPaper.tsx`, a hand-rebuilt `notepadCard`) were **recreations**
of the app's look, not the app itself — the actual gap the product owner was pointing at.
This phase replaces them with real screenshots of the real, unmodified app components.
- [x] **A real marketing-screenshot harness, `apps/desktop/src/marketing-harness.tsx` +
      `marketing-harness.html`.** A dev-only Vite entry (not referenced by `index.html`/
      `main.tsx` — zero effect on the shipped Tauri bundle) that mounts the actual,
      unmodified `TitleBar`, `Sidebar`, `ChatPane`, `MessageBubble`, `MessageContent`,
      `Composer`, and `ArtifactBlock` components — the exact same code that ships in the
      desktop app — fed real captured backend content directly as props/a `messages`
      array instead of a live WS connection. `window.fetch` is stubbed only for the
      handful of REST calls those components make on mount (billing status, the
      artifact's raw HTML bytes); no chat content, tool-activity label, or artifact is
      invented — see the file's own header comment for exactly what's real vs.
      necessarily-stubbed account plumbing. Kept in the repo (not deleted like a one-off
      verification script) since it's a genuinely reusable tool for any future marketing
      screenshot need, and it ships nothing to the real app.
- [x] **Scene 1 (Study Mode) — real screenshot**, `public/demo/screens/study-mode.png`,
      of the real `Sidebar` + `TitleBar` + `ChatPane` + `MessageBubble` rendering the real
      "math-catches-mistake" transcript recovered verbatim from git history (commit
      `0f73477`'s `demo-transcripts.json`, chunk-by-chunk reconstructed) — including the
      real tool-activity chips (`symbolic_math` ×2, `check_student_work`, all
      `verified: true`), which `GradedPaper.tsx` never showed at all.
- [x] **Scene 2 (Notepad) — real screenshot**, `public/demo/screens/notepad.png`. The one
      piece of this phase that is NOT the literal stateful `NotepadWindow` component (it
      gets its auth via a `notepad-auth` Tauri event this harness has no bridge for) —
      reproduced markup using that component's own real CSS classnames
      (`notepad-window__*`) so the pixels match, with the real hysteresis note content
      and the real Explain/Define/Summarize selection toolbar. Documented as the one
      "real classnames, reproduced markup" exception in the harness's own header comment
      rather than left unstated.
- [x] **Scene 3 (Artifact) — real screenshot of the real `ArtifactBlock` component**,
      `public/demo/screens/artifact.png`, PLUS the live embedded artifact is unchanged
      from Phase 3.9 (still the actual interactive iframe, not a picture of it) — this
      phase adds the real chat surface it actually renders inside (the "Interactive /
      Draggable Unit Circle Explorer" header, Expand/Download buttons, sandboxing
      footnote) around it, captured mid-render with the real artifact already live inside
      the real `<iframe sandbox="allow-scripts">`.
- [x] **Layout rebuilt as an actual Supademo-style player**: a left step rail (numbered,
      title + one-line caption, active step's caption/progress bar the only one shown —
      product owner: "LESS TEXT, LESS THINGS TO CLICK") next to a fixed-height "device
      frame" holding the current scene (`AppWalkthrough.module.css`'s `.stage`/`.rail`/
      `.deviceFrame`), replacing the old top-only progress-segment bar. A silent pulsing
      callout ring (no label) points at the one real UI element each step's caption
      references — the tool-activity chips, the selection toolbar, the draggable point —
      instead of more copy. Auto-advance/pause-on-hover/manual nav/reduced-motion
      handling carried over unchanged from Phase 3.9 (same hooks, new durations
      6500/6000ms).
- [x] **`GradedPaper.tsx`/`.module.css` deleted** (fully dead once Scene 1 became a real
      screenshot) along with the `@fontsource/caveat` dependency and the `--font-hand`
      token, which existed solely for `GradedPaper`'s handwritten annotation styling and
      had no other caller.
- [x] **Sitewide page transitions**, `src/app/template.tsx` + `template.module.css`.
      Product owner: "the different pages are not transitioning into eachother cleanly."
      Uses Next's own `template.js` file convention (remounts on every top-level
      navigation, unlike `layout.tsx` which persists) to replay a small CSS fade/
      slide-up on every route change — `/`, `/faq`, `/about`, `/changelog`, `/roadmap` —
      with zero motion library and zero client-side router event plumbing, respecting
      `prefers-reduced-motion`.
- [x] **Verification, all real.** `npx tsc --noEmit` clean; `npm run build` clean, all 6
      routes prerendered; **57/57 tests passing** (`AppWalkthrough.test.tsx` and
      `page.test.tsx` rewritten for the real-screenshot scenes — asserting on real `<img
      src>`/`alt` attributes, not recreated-visual text content — rather than left with
      dead assertions). Real Playwright verification against a real `next start` server:
      zero console/page errors; a real incremental-scroll full-page screenshot
      (`scrollHeight` 3,569px → 3,551px); each of the 3 scenes individually screenshotted
      in its default state; the real embedded artifact actually dragged via
      `frame.locator("input[type=range]").fill("135")` with the live `#roCos`/`#roSin`
      readouts confirmed at the mathematically exact `-0.707`/`0.707` — proving Scene 3
      is still genuinely interactive, not a screenshot, after this pass; a mobile
      (390×844) pass confirming the rail collapses to a horizontal tab row; all 4 content
      pages confirmed still serving 200; the real rendered HTML inspected directly to
      confirm `template.tsx`'s wrapper class is actually present (`template-module__*`),
      not just assumed from the file existing.
- **A real CI break, caused by this phase and fixed the same day**: the new
  `apps/desktop/src/marketing-harness.tsx` shipped with an unused `init` parameter,
  which `tsc`'s `noUnusedParameters` treats as a hard error — broke both the desktop
  app's `frontend-tests` typecheck job and its `tauri-build` job (that build script is
  `tsc && vite build`, so the typecheck failure took the whole build down with it) on
  GitHub Actions, undetected locally because verification for this phase only ran
  `apps/website`'s own `tsc`/tests/build, never `apps/desktop`'s. Fixed by dropping the
  unused parameter; re-verified `apps/desktop` directly this time (`tsc` clean, `vite
  build` clean, 699/699 tests) before pushing, and confirmed green on GitHub Actions
  (not just assumed from the local fix).
- **Phase 3.10.1 — the device frame was still too small.** Product owner, verbatim:
  "THE LIVE DEMO IS SO SMALL YOU CAN BARELY SEE THE ACTUAL APPLICATION." Two compounding
  causes, both fixed: (1) the side-by-side rail-plus-frame layout only gave the frame
  roughly half the section's width; the rail moved to a horizontal strip above the frame
  instead, and the section's own max-width grew from the standard 1160px to 1360px for
  this section specifically (an inline `style` override on the `<section>`, so it can't
  silently get re-clobbered by a later shared `.section` class edit). (2) The Study Mode
  and Artifact screenshots themselves were recaptured at a shorter harness viewport
  (1440×820, down from 1440×900) specifically to crop out the large dead vertical gap
  between a short conversation and the composer bar, so more of the frame's height is
  spent on actual content. The device frame itself grew from a fixed 480px to
  `min(78vh, 760px)`. Re-verified: `tsc`/tests/build all clean again; a real Playwright
  screenshot at 1440×1400 confirms the frame now renders the real app at a size where
  the sidebar, tool-activity chips, and reply text are all legible, not shrunk into a
  corner; a 390×844 mobile pass confirms the horizontal rail and frame still scale down
  without overflow.

## Phase 4 — Sign-up + download pages
- [ ] Sign-up page routes into the existing Keycloak OAuth flow (registration already
      enabled realm-side — confirmed, no new backend auth work needed).
- [ ] Download page with platform-detected buttons, linking to real GitHub Release
      artifacts (depends on Phase 2).
- [ ] Verification: a real sign-up flow walked through end-to-end against the real
      Keycloak realm; real download links confirmed to resolve to real artifacts.

## Phase 5 — Interactive demo (hybrid: scripted default + real "Try it live")
> **Superseded, this scripted-walkthrough item specifically**: Phase 3.9 deleted
> `DemoTranscript.tsx`, `lib/demoTranscript.ts`, and `data/demo-transcripts.json`
> entirely, replacing the chat-transcript replay described below with
> `AppWalkthrough.tsx`'s 3-scene stepped tour (see Phase 3.9's own entry). Left
> unedited below as an honest record of what that component actually did while it
> existed, rather than rewritten as if it never happened.
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
