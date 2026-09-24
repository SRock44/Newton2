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
- **Phase 3.10.2 — it still read as a flat picture, and Notepad had a real letterboxing
  bug.** Product owner, verbatim: "THIS 'LIVE DEMO' IS JUST A FUCKING PICTURE... THE
  NOTEPAD LOOKS SO BAD, IT HAS SO MUCH BLANK SPACE AROUND IT. IT DOESN'T LOOK LIKE A
  DESKTOP." Three concrete causes, all fixed:
  - **No "desktop" context.** Every scene's screenshot/iframe filled the frame edge to
    edge, so it read as a cropped image rather than a machine someone is using. Added a
    `Desktop` wrapper (`AppWalkthrough.tsx`) — a dark cobalt wallpaper-toned backdrop
    (`.desktopSurface`) with a thin taskbar sliver at the bottom — that every scene now
    renders inside; the screenshot/iframe is now "a window" with its own shadow and
    rounded corners floating on that backdrop, not the whole frame.
  - **Notepad's letterboxing**, root cause: `notepad.png` is a small companion-window
    crop (640×230, a very different aspect ratio than the two full-app-window
    screenshots) shown alone inside the same tall frame — mostly empty space by
    construction. Fixed by compositing it as a real floating window over a dimmed/
    blurred reuse of the Study Mode screenshot as backdrop — matching how the real app
    actually behaves (Notepad is an always-on-top companion window over the main
    window, never alone on a blank desktop). Fixes the blank-space complaint and the
    "doesn't look like a desktop, a user using the app" complaint in the same change.
  - **"Just a picture."** No literal screen recording exists (the WebView2 launch issue
    from earlier this session), so a CSS-only `Cursor` component now travels to the one
    real UI element each step's caption references and "clicks" it (a fake cursor
    animating in via `@keyframes`, ending in a click-ring pulse), replacing the earlier
    static pulsing-dot callout — a captured interaction, not a photo, without needing an
    actual recording. Respects `prefers-reduced-motion` (cursor renders already at rest,
    no travel).
  - Re-verified: `tsc`/57 tests/build all clean; the real artifact re-dragged via
    Playwright (still `-0.707`/`0.707` at 135°, confirming the CSS changes didn't affect
    its own real interactivity); real screenshots taken of all 3 scenes at 1440px and of
    the Notepad/first scene at 390×844 mobile, confirming the desktop backdrop, taskbar,
    and floating-window composite all render correctly and without overflow at both
    sizes.

## Phase 3.10.3 — Actual screen-recorded video, not a screenshot with a fake cursor
Product owner, verbatim: "THIS 'LIVE DEMO' IS JUST A FUCKING PICTURE... IT SHOULD BE
LIKE A REMOTION VIDEO OF THE PROMPT RUNNING, LIKE A PROMOTIONAL ADVERTISEMENT... SHOW
OFF TYPING IN... NEWTON NOTEPAD, THEN HIGHLIGHTING AND CLICK EXPLAIN." The CSS-animated
traveling-cursor-over-a-static-screenshot from 3.10.2 was still fundamentally a picture.
This phase replaces it with real screen-recorded video of the real app being used.
- [x] **The marketing harness gained a second mode**: `?scene=study|notepad|artifact`
  renders one scripted, autoplaying-once scene full-bleed instead of the static prop-fed
  scenes from 3.10/3.10.1. Every string typed or revealed is the same real, previously-
  captured content this whole initiative has used throughout (the "math-catches-mistake"
  transcript, the hysteresis note) — this phase only adds the TIMING of a typewriter
  effect, real tool-activity chips revealed one at a time, and a real progressive reply
  reveal; see the harness file's own header comment for the one deliberately-generic
  moment (an "Explaining…" shimmer instead of a fabricated AI answer, since no real
  captured example of that specific annotation response exists to reuse).
- [x] **The Notepad scene's selection is a real browser `Selection`/`Range`**, grown
  incrementally over the real DOM text node (not a CSS-only highlight class) so a
  recording shows an actual native selection sweep, then the real Explain/Define/
  Summarize toolbar positioned from that Range's own real `getBoundingClientRect()`
  (more accurate than 3.10's hand-eyeballed pixel guess).
- [x] **Recorded with Playwright's own video capture** (`context.recordVideo`) against
  the real running harness — a real screen recording of real rendered React/CSS, not a
  hand-animated substitute. Converted `.webm` → `.mp4` (H.264, `libx264`/`faststart`) via
  a real `ffmpeg` install (`winget install Gyan.FFmpeg`) for broad browser/Safari
  compatibility; poster JPGs extracted from a representative in-progress frame of each
  clip. Final sizes: study.mp4 450KB, notepad.mp4 77KB, artifact.mp4 282KB.
- [x] **`AppWalkthrough.tsx` rebuilt around real `<video>` elements**: autoplay/pause now
  call the video's own real `play()`/`pause()` (gated on real scroll-into-view via
  `useInView`, and on real mouse hover), the step rail's progress bar is driven by the
  video's own real `timeupdate` event (`currentTime/duration`), and advancing to the
  next scene fires on the video's own real `ended` event — no more `SCENE_DURATIONS_MS`/
  `setInterval` simulating a duration that had to be kept in sync by hand.
- [x] **Scene 3 still hands off to the real live artifact**: the clip plays (typing the
  real prompt, the real `ArtifactBlock` component's own real "Loading artifact…" state
  — reused via a short real delay in the fetch mock, not a fabricated chip — then the
  artifact appearing), and on `ended` swaps to the SAME real, unmodified, sandboxed
  `<iframe>` a visitor can actually drag. Re-confirmed after this whole rewrite: dragging
  the real embedded artifact to 135° post-video still reads the mathematically exact
  `-0.707`/`0.707`.
- [x] **`prefers-reduced-motion` never autoplays video**: scenes 1/2 render their real
  poster JPG as a plain `<img>` instead of a `<video>` element at all (not just a paused
  video), and scene 3 skips straight to the real live iframe (no motion concern with a
  static diagram sitting still until dragged).
- [x] **The old CSS traveling-cursor/click-ring, the Notepad floating-window-over-
  blurred-backdrop composite, and the static PNG screenshots it all depended on are
  deleted** — fully superseded, not left as dead code alongside the video path.
- [x] **Verification, all real.** `apps/desktop`: `tsc` clean, real `vite build` clean,
  **699/699 tests passing** (this phase's harness edit also fixed a real bug found via
  this same verification pass — see below). `apps/website`: `tsc` clean, real `next
  build` clean, **59/59 tests passing** (`AppWalkthrough.test.tsx` rewritten around real
  `fireEvent.ended`/spied `play`/`pause` calls instead of fake timers; a global
  `HTMLMediaElement.prototype.play/pause/load` stub added to `src/test/setup.ts`, since
  jsdom implements no real media playback at all). Real Playwright verification against
  a real `next start` server: confirmed the video's own `currentTime` genuinely advances
  over real wall-clock time (not just that the element exists); zero console/page
  errors; the post-video live-artifact handoff re-verified with a real drag; a
  `reducedMotion: "reduce"` browser context confirmed zero `<video>` elements render;
  mobile (390×844) confirmed the video plays and scales correctly.
- **A real bug found and fixed during this phase's own verification, worth recording
  honestly**: the Study Mode scene's progressive reply reveal was silently dropping
  paragraph 0 and duplicating paragraph 1 on every run. Root-caused (not worked around)
  to a classic React pitfall: the `setState(prev => ...)` functional updater closed over
  a mutable outer `p` variable by reference rather than by value, and `p += 1` ran
  synchronously immediately after the `setState` call — by the time React actually
  invoked the updater, `p` had already advanced, so every update silently used the
  NEXT paragraph's text instead of the current one. Confirmed via `console.log`
  instrumentation showing the call sequence was correct while the rendered DOM
  (inspected directly, not just screenshotted) showed the wrong content, isolating the
  bug to the updater's stale-by-reference closure specifically. Fixed by snapshotting
  the paragraph text into a local `const` before incrementing `p`. A second, unrelated
  React 18 `StrictMode` issue was found the same way: `StrictMode`'s deliberate dev-only
  double-invocation of effects raced two independent copies of this same sequential-
  state-accumulation logic against each other, which is a real hazard specific to
  scripted-playback code (most components don't accumulate state across a chain of
  timeouts) — fixed by rendering this dev-only recording harness without `StrictMode`,
  documented inline as a deliberate, scoped exception rather than a silent removal.

## Phase 3.11 — One Remotion film of Newton in use (replaces the multi-step walkthrough)
> **Superseded by Phase 3.13**: this film is no longer on the site and its source was removed (it remains in git history). The rendering techniques below carry over to `ShowFilm`.
Product owner, verbatim: "make it a REMOTION video (ONE VIDEO, NOT MULTIPLE SLIDES, of a
user using Newton in all of its capacity)... the notepad in the class, types the word
'PHOTOSYNTHESIS', highlights and clicks DEFINE — instant definition... show generating an
artifact in the chat box from clicking yes build it, to watching it generate, to interacting
with the artifact in the Newton application ON THE DESKTOP... the live demo has a box on the
bottom of it, remove that." Then: "at 36.2s to 46.21s the artifact is flickering... this will
kill an epileptic person." And: "add AUDIO to the video — not on the website."
- [x] **`apps/promo-video/` (new Remotion project)** renders one 49.5 s, 1920x1080, 30 fps
  film. It imports the REAL, unmodified desktop components (TitleBar, Sidebar, ChatPane,
  MessageBubble/MessageContent, ArtifactPlanCard, ArtifactBlock, NewtonNoteBlock, Toggle)
  through a webpack override (single shared React, `import.meta.env` stubbed). Story, one
  continuous take on one desktop: intro -> Study Mode (real typed prompt, real verified
  tool chips, real streamed reply) -> the Notepad companion window slides over the dimmed
  main window, the student types "Photosynthesis", clicks Preview, drags a selection, clicks
  Define, and Newton's real definition appears instantly in the note (the real
  `NEWTON DEFINED` card) -> a new chat: prompt, Newton's real plan reply with the real
  "Build it / Change it" plan card, click Build it, the card locks, a sped-up build, the
  real artifact appears, the student clicks the app's real Expand button and drags the point
  around the circle while the readouts update live -> outro.
- [x] **All AI text is real captured output, none invented.** Captured tonight against the
  live backend: the real `annotate_selection("define")` output for "Photosynthesis" (the
  exact function `POST /notes/{id}/annotate` runs), and Newton's real plan-stage reply to the
  artifact prompt over the real WS protocol (plan never approved, so no build ran; student1's
  plan/Focus Mode flipped for the capture and restored afterward — confirmed `free True`).
- [x] **Deterministic frame-by-frame rendering.** Remotion screenshots each frame, so
  everything animated is a pure function of the frame: CSS animations/transitions disabled
  globally, "now" frozen (the sidebar's live clock), cursor/ripples/selection/toolbar positioned
  by measuring the real DOM per frame, the chat pane pinned with instant (not smooth) scroll.
  The real artifact iframe is driven per frame through an in-memory postMessage bridge that
  each frame's render waits on (`delayRender`), so every frame shows exactly what the
  artifact's own code drew for that angle; the shipped artifact file is untouched.
- [x] **The flicker (36.2-46.2 s), root-caused and fixed.** Expand was driven by clicking the
  real button whenever the DOM said it was collapsed; the artifact-polling loop calls the
  positioning routine several times per frame and React applies the click asynchronously, so
  the button was clicked again in the same frame and the block toggled between expanded and
  collapsed. Fixed by recording the requested state on the element and clicking once per
  desired state. Verified numerically, not by eye (`apps/promo-video/analyze_flicker.py`):
  zero single-frame outlier frames across the whole film; over the artifact interaction
  (38.5-45.5 s) the largest frame-to-frame luminance swing is 0.26 / 255. The only large
  changes anywhere are smooth fades/zooms spread over ~10 frames. Two latent bugs of the same
  family were fixed on the way (the app's CSS `scroll-behavior: smooth` racing the screenshot,
  and the artifact iframe's `loading="lazy"` never loading in a headless frame).
- [x] **Audio (standalone file only — the website stays silent).** `make_audio.py`
  synthesizes the whole soundtrack from a cue sheet exported from the same timeline
  (`scripts/export-cues.ts`): a soft pad + quiet kalimba arpeggio, key clicks for all 165
  typed characters, mouse clicks, message pops, tool-chip ticks/dings, window whooshes, a
  selection sweep, an "instant definition" chime, a build hum, a "ready" arpeggio, and a drag
  tone whose pitch follows the point's angle. No samples or licensed music. Measured
  -17.1 LUFS, -3.9 dBTP. `npm run render:audio` -> AAC stereo mp4; `npm run render:site`
  renders the silent (`--muted`) copy the site uses.
- [x] **Website:** `AppWalkthrough` is now one `<video>` (`/demo/newton-promo.mp4`, 7.9 MB,
  poster JPG) in a plain rounded frame — no rail, tabs, arrows, live-iframe hand-off, desktop
  backdrop or taskbar (the "box on the bottom" is gone). Muted looping autoplay only while
  scrolled into view, click to pause, thin progress line, explicit Play button when paused;
  `prefers-reduced-motion` never autoplays. The old three clips, their posters, the website
  copy of the artifact HTML, and the desktop `marketing-harness` (superseded by Remotion)
  are deleted.
- [x] **Verification.** `apps/website`: `tsc` clean, `next build` clean, 57/57 tests (the
  walkthrough suite rewritten: exactly one video, no tabs, autoplay only in view, click
  toggles, Play button, reduced motion never autoplays). Real Playwright against `next start`:
  the video's `currentTime` advances in real time (2.5 s -> 5.5 s), 1920x1080 source rendered
  at 1294x727, 0 tabs / 1 video / 0 iframes, zero console errors, reduced motion holds paused
  on the poster with a Play button.

## Phase 3.12 — Second film: the engineering student (Documents -> attach -> artifact -> pushback)
> **Superseded by Phase 3.13**: this film is no longer on the site and its source was removed (it remains in git history). The rendering techniques below carry over to `ShowFilm`.
Product owner, verbatim: "make another promotional / product demo, where the user is a much more
sophisticated student, and uploads his MECHANICAL engineering work to Newton DOCUMENTS, then adds
the slides/pdf to the chat, and has an entire conversation about it. He builds an artifact, pushes
back on Newton, and gains further understanding." Then: "I want you to ACTUALLY USE THE DOCUMENTS
PAGE, AND ADD THERE. THEN IN THE CHAT, CLICK THE + AND ADD FROM DOCUMENTS (NOT THIS PC)... Make
sure you use the Artifact generation, and really show off how Newton is a real LEARNING tool, not
a cheating tool or another ChatGPT/Claude."
- [x] **`EngineerFilm` (second composition in `apps/promo-video`)**, 73.8 s, 1920x1080, 30 fps,
  same real unmodified desktop components. One take: the student opens the REAL Documents page,
  uploads a real lecture deck (the page's own "Uploading..." state, then the card and preview),
  opens a new chat, turns on Learn Mode, clicks "+" -> "Attach an existing document" (not
  "Upload from your computer") -> "Your documents" -> the deck, and asks why the same beam
  deflects 16x with only 4x the moment. Newton checks the slide numbers with real computation and
  hands the next step back as a Step Check; the student types the integration constants into the
  real MathLive field; he asks for a visual, approves the real plan card ("Build it"), the real
  artifact appears, is expanded, and is explored (support toggle, L and P sliders, readouts).
  He then disputes the 16x ("I think the 16x is wrong"), Newton shows the ratio with real
  computation and holds its ground, the student states the symmetry argument himself and Newton
  confirms it, and when he asks for the homework answer ("just give me the max P") Newton makes him
  derive it step by step.
- [x] **Everything Newton says is real backend output.** `apps/promo-video/engineer/capture.py`
  runs inside the API container: it uploads a real .pptx (built by `build_deck.py`) through
  `/documents/upload` as the dev student, then sends the student's scripted messages over the
  real chat WebSocket and records the replies, tool events and the artifact Newton actually
  built (`captured.json`). Account flags (Pro, Focus Mode off, Learn Mode on) are snapshotted
  and restored. No AI text is written by hand.
- [x] **A real bug found by doing this: Pro artifact builds from chat always collided with the
  parent turn's billing lock.** The frontier-turn lock (`try_acquire_frontier_turn_lock`) is held
  by the chat turn, and `create_artifact` tried to take it again, so every build from chat was
  refused as "already spending". Fixed with a `turn_holds_frontier_lock` context flag threaded
  from the tutor through `run_tool` (create_artifact only acquires/releases a lock it took
  itself); regression tests cover the in-turn build, the standalone path, and the flag being
  passed only on frontier turns.
- [x] **Deterministic rendering, hardened.** New shared `src/engine.ts` (cursor/camera/clock),
  used by both films (film 1 re-verified pixel-equal). Added: a per-frame "settle" wait opened
  DURING render (a handle opened only in an effect lost the race with the screenshot and let
  single frames through with a stale chat scroll — caught by `analyze_flicker.py`, 7 outlier
  frames -> 0), waits for the lazily-loaded MathLive field, and scroll-invariant cursor targets
  so the pointer follows controls inside the artifact while the chat pane and the artifact
  scroll. Flicker check on the final render: 0 single-frame outliers over 2214 frames.
- [x] **Audio (standalone only; the site stays silent).** `scripts/export-cues-eng.ts` ->
  `make_audio.py out/cues-eng.json out/engineer-audio.wav` (same synth, generalized: optional
  cues, several drag tones for the two sliders, keystrokes for typed messages and math entry).
  Measured -17.2 LUFS, -1.8 dBFS peak. The audio mp4 is a mux of the same video render.
- [x] **Website:** `FilmPlayer` extracted from `AppWalkthrough` (muted looping autoplay in view,
  click to pause, progress line, Play button, reduced motion never autoplays); new
  `EngineerWalkthrough` section ("Push back. Newton holds its ground.") directly under the first
  film with `/demo/newton-engineering.mp4` (8.4 MB, no audio track) and its poster.
  Verified: `tsc` and `next build` clean, 63/63 tests, real Playwright against the dev server
  (1920x1080 source plays, `currentTime` advances, muted, no error; reduced motion holds paused).

## Phase 3.13 — ONE product film that shows everything (replaces the two separate films)
Product owner, verbatim: "make an ALTOGETHER product demo that showcases the Newton notepad (do THE HIGHLIGHTING, DEFINING, ETC IN WRITING MODE, NOT PREVIEW MODE, JUST SHOW HOW IT LOOKS IN PREVIEW MODE AFTER THE NOTE IS FILLED OUT) THEN UPLOAD A DOCUMENT, HAVE A CONVERSATION, BUT A SHORTER ONE. THIS ONE SHOULD BE ABOUT INTEGRATION BY PARTS... Show off the document upload, attaching to chat with document, using the Newton Notepad to define, the newton learn mode (where you input answers, get pushback) - show off the Newton RESEARCH as well... around 2 minutes, with unique sound effects. The end goal is to have ONE product video that showcases everything, instead of a bunch of separate ones."
- [x] **`ShowFilm` (third composition in `apps/promo-video`)**, 114.1 s, 1920x1080, 30 fps, real unmodified desktop components. Story: a student writes notes in the Notepad, clicks away so the note renders, highlights "LIATE" -> Define, highlights the formula -> Explain — each answer lands as a card right in the note, and the finished note is scrolled top to bottom. (The film uses the real WYSIWYG `NoteEditor`; the note looks the same while it is typed and after — there is no Write/Preview.) -> the Documents page: a real .docx handout uploads ("Uploading..." state, then the card and preview) -> a new chat, **Learn Mode** on, "+" -> "Attach an existing document" -> the handout -> a Learn Mode conversation about why integration by parts works: he types answers into the real math field, gets a **sign error** and Newton pushes back, corrects it, is asked a Checkpoint ("where does the minus sign come from?") and answers in his own words -> **Newton Research** (real web search, real fetched university lecture notes, cited) that ties back to the rule.
- [x] **All Newton text is real captured output** (`apps/promo-video/showcase/capture.py`, run inside the API container as the dev student): the real `POST /notes/{id}/annotate` Define/Explain responses, the real Learn Mode chat over the WS protocol (Step Checks, pushback, Checkpoint), and a real `deep_research` run against the live SearXNG. Account flags are snapshotted/restored; created notes/documents are deleted afterward. Research needed a phrasing that lands on allow-listed university sources; one attempt hit the tool-round limit and was discarded rather than shown.
- [x] **The Notepad scene now starts where a student would:** the real notes list (other classes, each with class and topic tags — the Notepad's tags feature), "+ New Note", naming the note, adding two tags in the real tag popover, then writing the lecture note and doing Define / Explain as before. Also fixed the pointer drifting to the top of the window while the note was typed (its anchors for highlighting only exist after typing; it now rests beside the text).
- [x] **Product changes made because of this film** (ROADMAP.md, Phase 16.1). First pass: the highlight toolbar in Write mode, and markdown in Define/Explain cards. Product owner, on seeing Write mode print a raw ` ```newton-note ` fence with JSON: "combine the WRITE and preview modes - it doesn't really need two separate modes ... I want you to do it in the actual product too, not just the demo." So the Notepad is now ONE live editor (`NoteEditor`): rendered until clicked, raw only while editing, Newton's answers always cards. The film was re-recorded on the real component. Then: "the formatting completely changes when you go to the preview mode... IT SHOULD LOOK THE SAME, ALWAYS" — so the editor became true WYSIWYG (TipTap) and the film was re-recorded again: the note is formatted as it is typed, with no click-away step. Also fixed the "Typeyourattempt" math-field placeholder, which the film had been showing.
- [x] **Sound: a distinct effect per feature** (`scripts/export-cues-show.ts` -> `make_audio.py`, no samples): soft wooden ticks for Notepad writing vs. key clicks in chat, highlight sweeps, a bright Define chime and a warmer two-note Explain, an upload rise + landing chime, the Learn Mode switch, the attach snap, a rising chime when Newton confirms an answer and a soft falling pair for pushback, sonar pings + source blips during Research. Own key/tempo (D major, 76 BPM) and a deliberately calm, quiet bed (about 40% level, every other arpeggio note) so the effects are what you notice; the mix is re-normalized, so the effects come up. -17 LUFS, about -2.5 dBFS peak. The site copy stays silent.
- [x] **Rendering hardening:** each film's `fetch` mock is now gated by an active-film id (one bundle holds all compositions, and a later film's mock would otherwise answer an earlier film's requests). Flicker check: 0 single-frame outliers over 3423 frames.
- [x] **Website:** the site now has exactly ONE film. `AppWalkthrough` plays `/demo/newton-showcase.mp4` (8.9 MB, no audio track) with its poster; the second-film section, its test, and both older mp4s/posters are deleted (and, since the goal is one film, their Remotion compositions and capture data were removed from `apps/promo-video` too — they remain in git history). Verified: `tsc`, `next build`, 58/58 tests; real Playwright: one `<video>`, 1920x1080 source, plays, muted, 0 console errors; reduced motion holds paused.

## Phase 3.14 — A separate research-level film: messy notes + a synopsis -> an arXiv-style paper
Product owner, verbatim: "lets do a SEPARATE demo for higher level education. Writing an arxiv level paper with a bunch of random notes and a synopsis document, and outputting a quality latex paper. Can we do this? We want to show that Newton can be used at ALL levels, not just the lower levels." and "Once the video is done, place it on my desktop". This is a deliberate exception to Phase 3.13's "one film": the owner asked for a SEPARATE one, so the site shows two films, each in its own section.
- [x] **`ResearchFilm` (`apps/promo-video/src/paper/`)**, 101 s, 1920x1080, 30 fps, the real unmodified desktop components. A graduate student uploads raw lab notes (`SOR_scratch_notes.md`, deliberately messy) and a project synopsis (`.docx`), opens each to show Newton has read it, starts a new chat, attaches BOTH from Documents (the composer's "+" is used twice; each shows as its own chip), and asks for an arXiv-style paper. Newton's real plan card appears; the student pushes back with "Request Changes", Newton revises, the student approves; Newton researches sources and writes the paper (time-lapsed). Once it's written, the student attaches the finished PDF back into the SAME chat and asks Newton to walk through a results table (a real reply, with a real derivation and a real Checkpoint question) — then opens that PDF right there (`DocumentViewerPanel`, split with the chat, see Phase after this one), highlights a real sentence in it, and asks a follow-up quoting it. Both are real replies, not scripted text.
- [x] **All content is real captured output** (`apps/promo-video/paper/capture.py`, run in the API container as the dev student): the real plan, the revised plan, the real `write_research_paper` run (web search + fetch, citation grounding, pdflatex + biber) and its compiled 6-page PDF, and a second real capture stage (`stage_review`) that re-uploads that same PDF (the account's copy was deleted by `restore --delete-docs`) and holds two more real turns discussing it. Account flags are snapshotted and restored, and created documents are deleted afterwards. The inputs are `paper/experiments.py` (a real NumPy run of Jacobi, Gauss-Seidel and SOR on the 2D Poisson problem, `experiments.json`) and the notes and synopsis built from it, so the paper's numbers are the run's numbers.
- [x] **Product changes made because of this film:** the arXiv style, several source documents and the author's name (Phase 33); a plan whose headings the model numbered showed "1. 1. Introduction" (fixed in the tutor prompt, the plan card and the writer); a chat message could carry only ONE attached document (the composer now keeps a list); and, built specifically to make this film honest, the chat-side `DocumentViewerPanel` itself (see the dedicated phase right after this one) — the film was re-recorded against each fix in turn.
- [x] **Rendering notes:** the OLD take faked the finished PDF with page-image overlays, because the app's PDF preview was an `<iframe>` a headless renderer can't draw into. That's gone: the film now uses the real `DocumentViewerPanel` (real pdf.js pages, `public/research-paper.pdf`), so nothing about the paper is faked anymore. The highlighted sentence is found by concatenating every pdf.js text-layer `<span>`'s text and searching that (a single span is usually one short run, not a whole sentence) — see `ResearchFilm.tsx`'s `findSpanElements`; the highlight box and its toolbar are drawn by the film itself (directed, not the panel's own live selection state), matching the technique `ShowFilm`'s Notepad highlight already used. Every wall-clock timeout in film code counts iterations instead (`Date.now()` is frozen while rendering). Each film's `fetch` mock is gated by `src/filmId.ts`. Flicker check: 0 single-frame outliers over 3029 frames — fixing the last 2 found a real bug in the shared `safePrefix` reveal helper (used by both films): cutting a streamed reply's prefix exactly between the two characters of a `**`/`` ``` ``/`$$` token hid that token from its own balance check, which could misjudge an already-closed span as unclosed with no closer left and jump straight to revealing the ENTIRE rest of the message for one frame, then back. Fixed by never letting the cut point land inside one of those tokens.
- [x] **Sound** (`scripts/export-cues-paper.ts` -> `make_audio.py`): key clicks, an attach snap for each attached document (now three: the synopsis, the notes, and the finished PDF), upload rises and landing chimes, message pops, source blips, a soft hum while the paper is written and a chime when it is done, a soft whoosh for the document panel opening and for the highlight sweeping in, calm music (76 bpm, about -17 LUFS). The site copy is silent; the audio version was delivered to the owner's Desktop (`Newton-research-paper-film-with-audio.mp4`).
- [!] **Known limitation of the recorded take:** the dev box's search engines (Brave, DuckDuckGo, Google CSE) were rate-limited/CAPTCHA'd by repeated capture runs (SearXNG reported "Suspended: too many requests") during the plan/write stage, so the recorded paper's two references could not be fetched and Newton says so in its reply. That is real, honest behaviour, but a take with verified sources (an earlier capture had 8) is stronger; re-record `say`'s plan/revise/approve turns with `paper/run_cap.sh` once search recovers, then re-run `review` for the discussion scene.
- [x] **Website:** `ResearchFilmSection` ("From messy notes to a real paper.", `#demo-research`) under the main film, reusing `FilmPlayer` (autoplay in view, reduced-motion Play button, click to pause), playing `/demo/newton-research.mp4` (13.3 MB, no audio track) with its poster, now mentioning the finished-PDF discussion too. Tests: the section's own tests (including one for the new copy), and the page test expects exactly two films. `tsc`, 61 website tests and `next build` clean.

## Phase 3.15 — DocumentViewerPanel: open a document split with the chat, highlight it, ask Newton
Product owner, verbatim, after watching Phase 3.14's first cut: "I should be able to open the final PDF in the chat (as a clickable document modal ... it should then open split with the chatbox (just like claude, gemini, chatgpt; with buttons for usability to download, zoom, close, etc)" and "in that document preview mode, I should be able to highlight, annotate, tell newton what to change, what I dont like, etc. sort of like the notepad, but more aimed at documents." Verified as a real, working feature (screenshots of the actual component, real pdf.js rendering of the real compiled paper) before any film work started.
- [x] **`DocumentViewerPanel` (`apps/desktop/src/components/`, new)** — clicking an attached-document chip in a chat message now opens that document ALONGSIDE the chat (a resizable split pane, same drag-to-resize convention as the sidebar/context panel) instead of navigating away to the Documents page. A real PDF renders with `pdfjs-dist`: real canvas pages plus a real, positioned text layer (fit-to-width on open), so — unlike the app's other PDF preview, an OS-native `<iframe>` DocumentsPanel already had, which JS can't read a selection out of at all — a PDF can be highlighted here. Toolbar: zoom in/out (PDF only), Download (the document's real bytes, never a re-encoded copy of the extracted text), Close. Non-PDF documents reuse the same extracted-text preview DocumentsPanel already had.
- [x] **Highlighting** reuses DocumentsPanel's existing Explain/Define/Summarize toolbar (same backend call), plus a new **Ask Newton**, which quotes the excerpt into the composer next to the panel and focuses it — same "set it, don't send it" contract as every other attach flow in this app (`Composer`'s new `pendingDraftText` prop): the student still writes and sends their own instruction. Newton then answers in the ordinary chat, right next to the document.
- [x] **Home's "Recent documents" still navigates** to the full Documents page (`handleOpenDocument`, unchanged) — there's no chat open next to Home to split with. Only an attachment chip inside an active chat opens the new split panel (`handleOpenDocumentInChat`).
- [x] **Verified for real before any film work**: a throwaway Remotion composition (`src/dev/DocPreview.tsx`, deleted once reviewed) rendered the actual `DocumentViewerPanel` next to real chat bubbles, first with a plain text document, then with the actual compiled SOR paper PDF — real screenshots, not descriptions, caught and fixed a real bug (the initial 100% zoom ran wider than the panel and clipped; fixed with a fit-to-width default computed from the first page's real size) before Phase 3.14's film was rebuilt around it.
- [x] **Tests**: `DocumentViewerPanel.test.tsx` (new, pdf.js mocked), `Composer.test.tsx` (`pendingDraftText`), `App.test.tsx` (opening the panel from a chip click, highlighting text and choosing Ask Newton, closing it), `MessageBubble.test.tsx` updated for the chip's new `(id, filename)` callback. 739 desktop tests, `tsc`, `vite build` clean (the bundle grew by pdf.js's ~1.3 MB worker + main lib — not yet code-split to load only when a panel first opens, a reasonable follow-up).

## Phase 3.16 — Research film: re-recorded once more after the plan-lock fix
- [x] Once `PaperPlanCard` locked "Approve & Write" (Phase 35), the research film's plan card now honestly shows "Writing your paper..." the instant it's approved, instead of leaving the buttons visibly clickable while the reply streams in — a real product fix that happened to also make the demo more accurate. Re-rendered; flicker check unchanged (0 new outliers; the same 2 pre-existing frames from a composer textarea line-wrap reflow, judged benign — diff-in/diff-out both ~1.0, and the two neighbouring frames the wrap sits between are themselves progressively different, not a revert-and-restore). Site copy (13.4 MB) and poster refreshed; the audio version was re-delivered to the owner's Desktop.

## Phase 3.17 — Highlight overshoot fixed; a generated document is now a real clickable card; the film's re-attach flow removed
Product owner, verbatim: "The highlighting in the demo goes way off the screen/text of the research paper. Can you make the HIGHLIGHTING feature look way cleaner than this please" and, separately: "once a paper/document is GENERATED, IT SHOULD APPEAR AS A CLICKABLE BUTTON IN THE CHAT (EXACTLY HOW CLAUDE DOES IT IN THE WEB - A RECTANGULAR, ROUNDED BUTTON OF THE DOCUMENT NAME AND TYPE/THUMBNAIL) - CLICKING ON IT EXPANDS/CLOSES."
- [x] **Root-caused the highlight overshoot** (`DocumentViewerPanel`, used by both the real app and this film): the initial fix hypothesis — highlighting whole matched `<span>`s, which can be wider than the words inside them — was disproven by measurement (switching to `Range.getClientRects()`, a real text selection's own technique, made no visible difference). A second hypothesis (ending the highlight at a justified line's wrap point) was also disproven. The real cause, confirmed by direct on-screen measurement, not assumed: for a justified line, pdf.js's text-layer box for a run matches the PDF's *declared* advance width, which the substitute font actually painted onto the canvas can be narrower than — a real pdf.js/font-substitution characteristic, not a bug in the selection code. Fixed with `trimRectToInk()`: reads the page's OWN rendered canvas pixels (`ctx.getImageData`) for the highlight rect's vertical band and trims the rect to the rightmost actual ink, rather than trusting either box. Verified with 3 independent re-renders producing identical, pixel-correct results.
- [x] **A generated document is now a real, clickable card in the chat**, not just a filename in prose: `write_research_paper` (`services/api/app/tools/write_research_paper.py`) now returns its result ending with `[Attached document: id|filename]` markers for the PDF and its `.tex` source — the exact marker a student's own composer attach already produces — and the tutor prompt (`agents/tutor.py`) tells the model to relay them verbatim. `MessageBubble`'s existing marker parsing renders them identically regardless of role, so this needed zero new parsing or component-type work. `AttachedDocumentChip` was redesigned from a plain inline chip into a real card (colored type badge, filename, type line, rounded button — Claude.ai's own file-card look), and clicking it now toggles: opening it a second time while it's already open closes it (`App.tsx`'s `chatDocumentPanel` toggle, threaded down as `openDocumentId` through `ChatPane`/`MessageBubble` for the active/pressed state). Tests: new `AttachedDocumentChip.test.tsx`, an `App.test.tsx` toggle test, `test_write_research_paper_tool.py` asserting both real markers appear in the tool's own returned string against real DB rows. 72 backend tests, 750 desktop tests (51 files), `tsc`, `vite build` clean.
- [x] **The film's old re-attach flow removed**: Phase 3.14/3.15's `stage_review` re-uploaded the finished PDF as a separate document (because, at the time, only a student's own attach produced a clickable chip) and had the student attach-and-discuss it via the composer's picker before opening it. Now that `write_research_paper`'s own reply carries the real card, that re-upload and re-attach round-trip is gone entirely — the film clicks the card already sitting on Newton's "Approve & Write" reply, straight into `DocumentViewerPanel`, then highlights and asks. `paper/capture.py`'s `stage_review` and the film's `reviewAttach`/`PICKER_DOCS_LATE`/`paperReuploadDoc` are all deleted.
- [x] **Fresh, clean recapture**: the previous capture's state-file bookkeeping (`paper/capture.py`'s `/tmp/paper_state.json`, wiped by a container rebuild) had been restored from a `docker cp`'d backup and was silently reusing a stale, already-conversed-with session — verified by inspecting the dev account directly (55 leftover chat sessions and 30 leftover documents from earlier aborted attempts, none a clean take). Fixed by wiping the account back to a known-clean state (all leftover sessions/documents deleted, flags reset to the real defaults) and re-running plan → revise → write → highlight-and-ask as one careful sequence, verifying the turn count after every single step before spending further real LLM/backend cost on the next one. The new capture's Related Work turn also cites Wikipedia instead of an arXiv abstract page, which this dev box's outbound fetcher gets a consistent HTTP 406 from (Cloudflare bot-blocking `/abs/` specifically, confirmed by the same URL's `/html/` variant fetching fine) — avoiding a real, reproducible flake rather than working around it after the fact.
- [x] **Rendering notes**: `findTextRange` (was `findSpanElements`) now returns a real DOM `Range` over exactly the matched characters, spanning `<span>` boundaries via a `TreeWalker` over the container's text-layer nodes; `trimRectToInk` (above) is applied to every rect it returns, both where the highlight itself is drawn and inside the per-frame settle fingerprint (so a frame isn't captured before the page's own canvas has actually finished painting). Flicker check: 0 outliers.
- [x] **Website:** `newton-research.mp4` (16.6 MB, no audio) and its poster re-rendered/re-extracted; `ResearchFilmSection`'s comment and `aria-label` updated to describe opening the PDF from Newton's own card instead of re-attaching it. The audio version was re-delivered to the owner's Desktop (`Newton-research-paper-film-with-audio.mp4`).

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
