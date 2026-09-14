# Newton Privacy Policy (DRAFT)

**Status: DRAFT. This document has NOT been reviewed or approved by a lawyer, and
nothing in it should be treated as legal advice or a final compliance determination.**
It was written by an engineer (with AI assistance) directly from Newton's actual code
and database schema, as a well-reasoned starting point for real legal review — not as
a finished, authoritative privacy policy. Do not publish, link, or rely on this
document as Newton's real privacy policy until a qualified lawyer has reviewed it
against applicable law (including COPPA, FERPA, and any state student-privacy statutes
that may apply) and it has been formally adopted. See
`docs/data-retention-and-privacy.md` for the specific list of gaps a real review needs
to close.

*Last drafted: 2026-09-14.*

---

## 1. Who we are and what this covers

Newton ("we," "us") is an AI tutoring application: a desktop app (built with Tauri)
that talks to a backend service we operate. This policy describes what personal
information Newton's backend collects, why, how long it's kept, and who else — if
anyone — it's shared with. It covers the Newton desktop app and its backend only.

Newton is used by students, who may be under 18, including — per our own age-gate
step described in Section 6 — possibly under 13. **This draft does not yet fully
satisfy the law's requirements for serving users under 13; read Section 6 and the gaps
document before treating Newton as ready for that audience.**

## 2. The real, specific categories of data Newton collects

This section is grounded directly in Newton's actual database schema
(`services/api/app/db/models.py`) — every category below is something Newton's backend
genuinely stores today, not a generic list. For every category: what it is, why we
collect it, how long we keep it, and who (if anyone) it's shared with.

**A note on retention, up front:** for nearly every category below, the honest answer
to "how long is this kept" is **"until you delete it, or until you delete your account
— whichever comes first."** Newton has a real, working account-deletion feature
(`DELETE /account` in the app's Settings) that immediately and irreversibly deletes
your account row and, via a database cascade, every row in every table listed below
that belongs to you, plus your uploaded files. This is not a "we'll get to it"
process — it happens in one transaction, synchronously, when you ask. Where a
category has a *different* retention story than "until deletion," it's called out
explicitly.

### 2.1 Account / identity information
**What:** your email address, a display name, and an internal account identifier
linked to your sign-in identity (Newton's login is handled by a Keycloak identity
service we operate — your password itself is never stored in Newton's own database).
**Why:** to know who you are, so your chats, documents, and progress are yours and
nobody else's.
**Retention:** until account deletion.
**Shared with:** nobody outside Newton, except as described for Google/Stripe below if
you use those specific features.

### 2.2 Chat messages and conversation history
**What:** every message you send to Newton's tutor, and every reply it sends back,
grouped into chat sessions.
**Why:** this is the core of the product — Newton can't tutor you without seeing what
you're asking, and you can't review a past conversation if we don't keep it.
**Retention:** until you delete that specific chat, or until account deletion.
**Shared with:** whichever AI model provider is actually generating the reply — see
Section 3, "AI model providers." This is real and important: **the content of your
tutoring conversations is sent to a third-party AI provider so it can generate a
response.**

### 2.3 Session summaries and durable "profile facts" (Newton's memory)
**What:** after a chat session ends, a background job asks an AI model to summarize it
(topics covered, problems solved, mistakes made) and to extract durable facts about you
as a student (e.g. "struggles with fractions," "taking MATH201") into a separate,
deduplicated table.
**Why:** so Newton doesn't start every new conversation from zero — it can remember
real context about you across sessions, the same way a human tutor who'd worked with
you for a semester would.
**Retention:** a session summary lives as long as the session it summarizes (until
deletion). A "profile fact" can optionally carry its own expiration date and is
superseded (not just appended to) when a newer fact replaces it — but there is
currently no default expiration; in practice these persist until account deletion
unless a specific fact was given its own expiry. See the gaps document — this is one
of the areas a real retention policy should probably tighten.
**Shared with:** the same AI model provider used to generate the summary (Section 3).

### 2.4 Uploaded documents
**What:** files you upload (syllabi, notes, problem sets), stored as both the original
file and machine-searchable text chunks used to ground Newton's answers in your actual
course material.
**Why:** so Newton can answer questions about *your* syllabus, *your* notes — not just
generic material.
**Retention:** until you delete the document, or until account deletion (which also
deletes the underlying stored file, not just the database record referencing it).
**Shared with:** the AI model provider, when a chat references or is grounded in a
document you've uploaded.

### 2.5 Study plan items
**What:** assignments and deadlines, either extracted from an uploaded syllabus or
synced from Google Classroom (see 2.6).
**Why:** the study-plan feature.
**Retention:** until deletion or account deletion.
**Shared with:** nobody beyond what's already described for documents/Classroom.

### 2.6 Google Classroom connection (fully optional)
**What:** if — and only if — you choose to connect Google Classroom (a separate,
explicit opt-in from signing in with a Google account), Newton stores an encrypted
OAuth access token and refresh token, your connected Google account's email, and the
specific read-only permissions granted. These tokens are encrypted before they're ever
written to our database.
**Why:** to read your real courses and assignments from Classroom and turn them into
study plan items, so you don't have to re-enter them by hand.
**Retention:** until you disconnect Classroom or delete your account.
**Shared with:** Google, necessarily — we use your token to make read-only calls to
the Google Classroom API for your own course/assignment list. Newton requests only
`classroom.courses.readonly` and `classroom.coursework.me.readonly` — it cannot see
grades, other students, or make any changes to your Classroom account. This is a
separate permission grant from signing in with Google, which only ever requests your
basic `openid email profile` identity.

### 2.7 Flashcards and review history
**What:** flashcards Newton generates from your documents, plus a permanent log of
every time you review one (which rating you gave it — Again/Hard/Good/Easy) so the
spaced-repetition scheduler knows when to show it again.
**Why:** the flashcard feature and its scheduling.
**Retention:** until deletion or account deletion.
**Shared with:** the AI model provider, when generating flashcards from your content.

### 2.8 Practice exams and your answers
**What:** generated practice exam questions, your submitted answers, whether each was
correct, and your overall score.
**Why:** the practice-exam feature, including picking a harder or easier exam next
time based on your real recent performance.
**Retention:** until deletion or account deletion.
**Shared with:** the AI model provider, when generating exam questions.

### 2.9 Billing and subscription metadata
**What:** if you subscribe to Newton Pro or purchase a credit top-up, we store your
plan, a Stripe-issued customer/subscription identifier, subscription status, and how
much of your usage allowance you've consumed. **We do not store your card number or
other raw payment details ourselves** — that's handled entirely by Stripe.
**Why:** to know what you've paid for and enforce/track usage against it.
**Retention:** until account deletion.
**Shared with:** Stripe, our payment processor — only if/when billing is actually
configured for a given deployment of Newton (it's an optional, dormant integration
until then). See Stripe's own privacy policy for how they handle payment data.

### 2.10 Crisis-detection safety net (a special case — read carefully)
Newton runs a small, local, deterministic pattern-matcher over every message you send,
looking only for clear, direct, first-person statements of suicidal ideation or
self-harm intent (e.g., not a homework question about a novel's themes). This is
**not** an AI model call — it's a fixed set of phrase patterns checked on our own
server, and it never sends your message anywhere new to do this check.

**What actually gets recorded when it triggers:** your original message is already
being stored as normal chat history (Section 2.2) — that doesn't change. Separately, a
one-line internal operational log entry is written containing only your session ID,
your account ID, and a category label (e.g. "kill_myself") — **never the content of
your message itself.** This log entry exists so we can monitor that the safety net is
actually firing when it should, not to build any kind of profile of you.
**Why:** because Newton may be talking to students in real distress, and giving a
canned "please reach out to a real crisis line" response — instead of trying to have
an AI model reply to something this serious — is a deliberate, considered safety
choice.
**Retention:** the underlying chat message follows ordinary chat-history retention
(2.2); the operational log line follows Newton's ordinary technical log retention
(currently not a fixed policy — see the gaps document).
**Shared with:** nobody outside Newton. This is deliberately **not** sent to our error
tracking tool (Section 3) — it's a working safety feature, not a bug report.

### 2.11 Age band / consent record
**What:** a self-reported age range (under 13 / 13–17 / 18 or older) and the timestamp
you provided it, collected the first time you sign in — see Section 6.
**Why:** a first attempt at meeting legal requirements around younger users; see
Section 6 for exactly what this does and does not accomplish.
**Retention:** until account deletion.
**Shared with:** nobody.

### 2.12 Technical / operational data
**What:** request correlation IDs and application logs generated as part of running
the service (e.g., "chat turn started for session X"). If — and only if — we've
configured an optional error-tracking service (Sentry), unhandled application errors
(crash reports, stack traces) are sent there too.
**Why:** operating and debugging the service.
**Retention:** not currently governed by a fixed policy — see the gaps document.
**Shared with:** our error-tracking provider, only if configured, and only for genuine
application errors — not chat content, not by design.

## 3. Who Newton shares data with — the complete, real list

- **AI model providers (OpenRouter and/or Groq).** This is the most important entry on
  this list: **the actual text of your tutoring conversations, generated flashcards,
  practice exam questions, and document-grounded answers is sent to whichever AI
  provider is configured to process it and generate Newton's replies.** This is how
  Newton works — an AI tutor needs an AI model to talk to.

  **One specific, real disclosure:** Newton's Pro tier offers a model called "Muse
  Spark Contributor" from Meta, priced far below Meta's standard offering of the same
  underlying model. That lower price exists *because* selecting this specific tier
  grants Meta permission to use submitted prompts and responses for training —
  unlike Meta's standard tier, which explicitly excludes user data from training. If
  you (or a Pro subscriber on your account) select this specific model, your
  conversation content may be used by Meta to train future models. Newton's own
  in-product model picker does not currently show a separate warning when you select
  it; this policy is where that fact is disclosed. If this matters to you, don't
  select "Muse Spark Contributor (Meta)" in Settings.

- **Google**, only if you connect Google Classroom (read-only access to your own
  courses/assignments — Section 2.6) or sign in using a Google account (minimal
  identity-only access).

- **Stripe**, only if billing is configured and only for users who subscribe to Pro or
  purchase a credit top-up — for payment processing.

- **An error-tracking service (Sentry)**, only if configured for a given deployment,
  and only for technical crash/error data — not chat content.

- **Self-hosted tools that are part of Newton's own infrastructure, not outside
  companies:** a self-hosted search tool, grammar checker, speech-to-text and
  text-to-speech service, and a sandboxed code-execution service all run on
  infrastructure we operate, not a third party's. They're listed here for
  transparency because they still process real request content (a search query, an
  audio clip) as part of answering you — they just don't leave systems we control.

We do not sell your data. We do not share it with advertisers. We do not have any
integration with any party not listed above.

## 4. Your controls

- **Delete your account:** Settings → Delete Account, or `DELETE /account`. This is
  immediate and complete — it removes your account and everything listed in Section 2
  that belongs to you (chat history, documents, flashcards, practice exams, study plan
  items, your Classroom connection, your profile facts), plus your uploaded files.
  This action cannot be undone.
- **Delete individual chats or documents** without deleting your whole account, from
  the app itself.
- **Disconnect Google Classroom** independently of deleting your account.

## 5. Children's privacy and COPPA

Newton has taken a first, incomplete step toward addressing this — see Section 6 and,
more importantly, `docs/data-retention-and-privacy.md`'s gap list, which explains
plainly what is and is not actually in place yet. **In short: Newton's current age-gate
mechanism is not, by itself, sufficient to comply with COPPA's requirement of
verifiable parental consent before collecting personal information from a child under
13.** Do not treat Newton as COPPA-compliant for under-13 users based on this policy or
the current implementation.

## 6. The age-gate step

The first time you sign in, Newton asks whether you're under 13, 13–17, or 18 or
older — an age range, not your exact birthdate (which is itself more sensitive than we
need to ask for). If you say you're under 13, Newton records that answer but does
**not** let you proceed into the app; you're told a parent or guardian needs to be
involved. If you say 13–17 or 18 or older, you're let in and that answer (plus a
timestamp) is recorded on your account.

**Why this isn't a finished solution:** a student clicking a button is
self-attestation, not the verifiable parental consent COPPA actually requires. This
gate stops Newton from silently treating an under-13 signup like any other, but it
does not, by itself, give Newton a lawful basis to serve under-13 users at all yet.
See the gaps document for what a real solution needs.

## 7. Changes to this policy

Since this document is a first draft awaiting real legal review, expect it to change —
likely substantially — before Newton treats it as authoritative. We'll update the date
at the top when that happens.

## 8. Contact

*A real contact channel for privacy questions/requests needs to be established before
this policy is used for real — see the gaps document. Placeholder until then: reach the
Newton team through the app's support channel.*

---

**Reminder: this entire document is a DRAFT, written to give a real lawyer a concrete,
specific, honest starting point — not a substitute for their review. Nothing here has
been legally reviewed or approved.**
