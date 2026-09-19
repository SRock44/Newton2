import { useEffect, useState } from "react";
import {
  ApiError,
  createShareLink,
  deleteFlashcard,
  flashcardsApkgUrl,
  flashcardsPptxUrl,
  listFlashcards,
  reviewFlashcard,
  reviewFlashcardWithAnswer,
  revokeShareLink,
} from "../api";
import { fetchBytes, saveBytesToDisk } from "../lib/download";
import type { Flashcard, ProductionGrading } from "../types";

interface FlashcardsPanelProps {
  /** Resolves to an access token guaranteed not to be expired (see App.tsx's
   * `tokenManager.getValidAccessToken()`), not a plain cached string — this panel opens
   * after a chat-driven generation that can take a while, and always fetching a
   * verified-fresh token here (the same rule the chat WebSocket already follows before
   * connecting) closes the exact "token quietly expired while a background refresh
   * hadn't caught up yet" race that once caused chats to fail with a stale token too. */
  getAccessToken: () => Promise<string>;
  onClose: () => void;
}

const RATINGS: { value: 1 | 2 | 3 | 4; label: string; className: string }[] = [
  { value: 1, label: "Again", className: "flashcard-rate--again" },
  { value: 2, label: "Hard", className: "flashcard-rate--hard" },
  { value: 3, label: "Good", className: "flashcard-rate--good" },
  { value: 4, label: "Easy", className: "flashcard-rate--easy" },
];

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

/** What the student is told the instant they commit to a typed answer — right or wrong,
 * said plainly, with the real answer shown next to theirs when it wasn't right. "close"
 * exists for exactly one case: they spelled the word but dropped an accent, which the
 * server credits as a Hard review rather than a failure. */
const GRADING_MESSAGES: Record<ProductionGrading["result"], string> = {
  correct: "Correct.",
  close: "Almost — that's right apart from the accent marks. Counted as Hard.",
  wrong: "Not quite.",
};

/** Two modes: review the cards due right now (FSRS-scheduled, one at a time), or
 * browse/delete everything regardless of due date. Generation happens from the Documents
 * panel or from chat, not here — this is purely study + management.
 *
 * A due card is reviewed one of two ways, depending on its `direction`. A recognition
 * card is the original flip-and-self-rate: see the prompt, reveal the answer, rate 1-4.
 * A production card (language vocabulary, drilled in the harder direction) is shown the
 * meaning and the student must TYPE the term — they commit before seeing anything, and
 * the server grades what they typed and derives the FSRS rating from it, so there's no
 * self-rating step to quietly let yourself off with. */
function FlashcardsPanel({ getAccessToken, onClose }: FlashcardsPanelProps) {
  const [mode, setMode] = useState<"review" | "browse">("review");

  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  // Distinct from `error` (which drives the banner): gates the reassuring "all caught
  // up" copy specifically, so a failed fetch never gets misread as "you genuinely have
  // no due cards" -- those are very different things to tell a student.
  const [queueFailed, setQueueFailed] = useState(false);
  const [showingBack, setShowingBack] = useState(false);
  const [rating, setRating] = useState(false);

  // Production-direction review only. `grading` being non-null is also what says "this
  // card has been answered and its review is already recorded" — the card then stays on
  // screen showing the verdict until the student presses Next, which is the immediate,
  // specific feedback that makes a typed drill worth doing at all.
  const [typedAnswer, setTypedAnswer] = useState("");
  const [grading, setGrading] = useState<ProductionGrading | null>(null);

  const [allCards, setAllCards] = useState<Flashcard[]>([]);
  const [allLoading, setAllLoading] = useState(true);
  const [allFailed, setAllFailed] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // File exports — a real .apkg (Anki) or .pptx (PowerPoint) written to the student's
  // disk (see lib/download.ts). Held separately from `error` so "saved to …" and a
  // failure can use the same line without either being mistaken for the panel-level
  // error banner. `exporting` names WHICH export is running rather than being a plain
  // boolean, so only the button that was actually pressed shows a busy label while the
  // other is merely disabled.
  const [exporting, setExporting] = useState<"anki" | "pptx" | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  // Public share link. `shareLinkId` is remembered so "Stop sharing" can revoke the exact
  // link this session minted without a second round trip to look it up.
  const [sharing, setSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [shareLinkId, setShareLinkId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setQueueLoading(true);
    setQueueFailed(false);
    (async () => {
      try {
        const accessToken = await getAccessToken();
        const cards = await listFlashcards(accessToken, true);
        if (cancelled) return;
        setQueue(cards);
      } catch (err) {
        if (cancelled) return;
        setQueueFailed(true);
        setError(err instanceof ApiError ? err.message : "Couldn't load due flashcards.");
      } finally {
        if (!cancelled) setQueueLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode !== "browse") return;
    let cancelled = false;
    setAllLoading(true);
    setAllFailed(false);
    (async () => {
      try {
        const accessToken = await getAccessToken();
        const cards = await listFlashcards(accessToken, false);
        if (cancelled) return;
        setAllCards(cards);
      } catch (err) {
        if (cancelled) return;
        setAllFailed(true);
        setError(err instanceof ApiError ? err.message : "Couldn't load your flashcards.");
      } finally {
        if (!cancelled) setAllLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const current = queue[0] ?? null;
  const isProduction = current?.direction === "production";

  async function handleRate(value: 1 | 2 | 3 | 4) {
    if (!current || rating) return;
    setRating(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      await reviewFlashcard(accessToken, current.id, value);
      advance();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record that review.");
    } finally {
      setRating(false);
    }
  }

  /** Submits a typed production answer. The review is RECORDED by this call — the server
   * grades the answer and applies the resulting FSRS rating — so the card is already
   * done; we hold it on screen only to show the verdict. */
  async function handleSubmitTypedAnswer(event: React.FormEvent) {
    event.preventDefault();
    if (!current || rating || grading) return;
    setRating(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      const result = await reviewFlashcardWithAnswer(accessToken, current.id, typedAnswer);
      setGrading(result.grading);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't check that answer.");
    } finally {
      setRating(false);
    }
  }

  function advance() {
    setQueue((prev) => prev.slice(1));
    setShowingBack(false);
    setTypedAnswer("");
    setGrading(null);
  }

  /** Exports every one of this student's cards as a real Anki `.apkg` (decks grouped by
   * the document each card came from, built server-side with genanki) and writes it
   * wherever they choose. The point is that Newton's FSRS-scheduled cards can be
   * reviewed on a phone — so this is a first-class toolbar action here, not something
   * buried in a submenu. */
  function handleExportToAnki() {
    runExport("anki", "Building your Anki deck…", async (accessToken) => {
      const bytes = await fetchBytes(flashcardsApkgUrl(), accessToken);
      return saveBytesToDisk("newton-flashcards.apkg", bytes, [
        { name: "Anki deck", extensions: ["apkg"] },
      ]);
    });
  }

  /** Exports the same cards as a real PowerPoint deck: two slides per card (the question,
   * then the answer), with a title slide per source document — i.e. something a student
   * can actually present or click through full-screen, which an .apkg isn't. Built
   * server-side with python-pptx from the same grouping the Anki export uses; no model
   * and no sandbox is involved, so it's available on every plan. */
  function handleExportToPowerPoint() {
    runExport("pptx", "Building your slide deck…", async (accessToken) => {
      const bytes = await fetchBytes(flashcardsPptxUrl(), accessToken);
      return saveBytesToDisk("newton-flashcards.pptx", bytes, [
        { name: "PowerPoint presentation", extensions: ["pptx"] },
      ]);
    });
  }

  /** Shared body of both export buttons — fetch real bytes from an auth-gated endpoint,
   * hand them to the native save dialog, then report where the file landed. */
  async function runExport(
    kind: "anki" | "pptx",
    busyMessage: string,
    work: (accessToken: string) => Promise<{ path: string | null }>,
  ) {
    if (exporting) return;
    setExporting(kind);
    setExportStatus(busyMessage);
    setError(null);
    try {
      const result = await work(await getAccessToken());
      // A cancelled save dialog is a normal outcome, not a failure.
      setExportStatus(result.path ? `Saved to ${result.path}` : null);
    } catch (err) {
      setExportStatus(err instanceof ApiError ? err.message : "Couldn't export your flashcards.");
    } finally {
      setExporting(null);
    }
  }

  /** Mints a public, read-only web page for this deck and copies its URL.
   *
   * The URL points straight at the Newton API, not at this app: whoever receives it has no
   * Newton account and no desktop app installed, which is the entire point of the feature.
   * It's authorized by an unguessable random token in the path rather than any login (see
   * services/api/app/services/share_tokens.py) — so treat it like a password: anyone with
   * the link can read the deck.
   *
   * Idempotent server-side, so pressing this twice hands back the same URL instead of
   * quietly orphaning one already sent to a classmate. */
  async function handleShare() {
    if (sharing) return;
    setSharing(true);
    setShareStatus(null);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      const link = await createShareLink(accessToken, { kind: "flashcards" });
      await navigator.clipboard.writeText(link.url);
      setShareLinkId(link.id);
      setShareStatus(`Link copied — anyone with it can view these cards. ${link.url}`);
    } catch (err) {
      setShareStatus(err instanceof ApiError ? err.message : "Couldn't create a share link.");
    } finally {
      setSharing(false);
    }
  }

  /** Revocation, for the case every URL-embedded secret needs: the link got forwarded
   * somewhere it shouldn't have. A real DELETE server-side — the page 404s immediately. */
  async function handleStopSharing() {
    if (sharing || !shareLinkId) return;
    setSharing(true);
    try {
      const accessToken = await getAccessToken();
      await revokeShareLink(accessToken, shareLinkId);
      setShareLinkId(null);
      setShareStatus("Sharing stopped — that link no longer works.");
    } catch (err) {
      setShareStatus(err instanceof ApiError ? err.message : "Couldn't revoke this share link.");
    } finally {
      setSharing(false);
    }
  }

  async function handleDeleteFromBrowse(id: string) {
    try {
      const accessToken = await getAccessToken();
      await deleteFlashcard(accessToken, id);
      setAllCards((prev) => prev.filter((c) => c.id !== id));
      setQueue((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove this flashcard.");
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Flashcards</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="flashcards-tabs">
          <button
            type="button"
            className={`flashcards-tab${mode === "review" ? " flashcards-tab--active" : ""}`}
            onClick={() => setMode("review")}
          >
            Review{queue.length > 0 ? ` (${queue.length})` : ""}
          </button>
          <button
            type="button"
            className={`flashcards-tab${mode === "browse" ? " flashcards-tab--active" : ""}`}
            onClick={() => setMode("browse")}
          >
            All cards
          </button>
          <button
            type="button"
            className="btn-secondary-sm flashcards-toolbar-btn flashcards-toolbar-btn--first"
            onClick={handleExportToAnki}
            disabled={exporting !== null}
            title="Save these cards as a real Anki deck you can review on your phone"
          >
            {exporting === "anki" ? "Exporting…" : "Export to Anki"}
          </button>
          {/* Same .flashcards-toolbar-btn as its neighbours (WITHOUT --first, which only
              the leftmost action carries) — that class is what baseline-aligns a button
              against the taller tab buttons on this row. See App.css. */}
          <button
            type="button"
            className="btn-secondary-sm flashcards-toolbar-btn"
            onClick={handleExportToPowerPoint}
            disabled={exporting !== null}
            title="Save these cards as a PowerPoint deck — one slide per question, the next slide reveals the answer"
          >
            {exporting === "pptx" ? "Exporting…" : "Export to PowerPoint"}
          </button>
          {shareLinkId ? (
            <button
              type="button"
              className="btn-secondary-sm btn-secondary-sm--danger flashcards-toolbar-btn"
              onClick={handleStopSharing}
              disabled={sharing}
              title="Revoke the public link — it stops working immediately"
            >
              {sharing ? "Working…" : "Stop sharing"}
            </button>
          ) : (
            <button
              type="button"
              className="btn-secondary-sm flashcards-toolbar-btn"
              onClick={handleShare}
              disabled={sharing}
              title="Copy a public, read-only web link anyone can open — no Newton account needed"
            >
              {sharing ? "Sharing…" : "Share"}
            </button>
          )}
        </div>

        {error && <div className="banner banner--error">{error}</div>}
        {exportStatus && <div className="item-status">{exportStatus}</div>}
        {shareStatus && <div className="item-status">{shareStatus}</div>}

        {mode === "review" ? (
          queueLoading ? (
            <p className="empty-state-text">Loading…</p>
          ) : queueFailed ? (
            <p className="empty-state-text">Couldn't check for due flashcards — try reopening this panel.</p>
          ) : !current ? (
            <p className="empty-state-text">
              All caught up — nothing due right now. Generate more from a document in Documents, or ask
              Newton in chat.
            </p>
          ) : (
            <div className="flashcard-review">
              {isProduction ? (
                <>
                  <div className="flashcard-box flashcard-box--production">
                    <div className="flashcard-box-label">Write it</div>
                    <div className="flashcard-box-text">{current.front}</div>
                    {!grading && (
                      <div className="flashcard-box-hint">Type the term this means</div>
                    )}
                  </div>

                  <form className="flashcard-production-form" onSubmit={handleSubmitTypedAnswer}>
                    <input
                      type="text"
                      className="flashcard-production-input"
                      aria-label="Your answer"
                      value={grading ? grading.answer : typedAnswer}
                      onChange={(e) => setTypedAnswer(e.target.value)}
                      // Spelling is exactly what this drills — a browser correcting it
                      // would grade the browser, not the student.
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      autoFocus
                      disabled={grading !== null || rating}
                    />
                    {!grading && (
                      <button type="submit" className="btn-primary" disabled={rating}>
                        {rating ? "Checking…" : "Check"}
                      </button>
                    )}
                  </form>

                  {grading && (
                    <div className={`flashcard-grading flashcard-grading--${grading.result}`}>
                      <div className="flashcard-grading-verdict">
                        {GRADING_MESSAGES[grading.result]}
                      </div>
                      {/* Always shown, even when they were right: seeing the correct
                          form next to your own is the feedback, and hiding it on a
                          correct answer removes the one chance to notice a near-miss. */}
                      <div className="flashcard-grading-expected">
                        Answer: <strong>{grading.expected}</strong>
                      </div>
                      <button type="button" className="btn-primary" onClick={advance}>
                        Next card
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flashcard-box" onClick={() => setShowingBack((s) => !s)}>
                    <div className="flashcard-box-label">{showingBack ? "Answer" : "Question"}</div>
                    <div className="flashcard-box-text">{showingBack ? current.back : current.front}</div>
                    {!showingBack && <div className="flashcard-box-hint">Click to reveal the answer</div>}
                  </div>

                  {showingBack && (
                    <div className="flashcard-ratings">
                      {RATINGS.map((r) => (
                        <button
                          key={r.value}
                          type="button"
                          className={`flashcard-rate ${r.className}`}
                          onClick={() => handleRate(r.value)}
                          disabled={rating}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        ) : allLoading ? (
          <p className="empty-state-text">Loading…</p>
        ) : allFailed ? (
          <p className="empty-state-text">Couldn't load your flashcards — try reopening this panel.</p>
        ) : allCards.length === 0 ? (
          <p className="empty-state-text">
            No flashcards yet — generate some from a document in Documents, or ask Newton in chat.
          </p>
        ) : (
          <ul className="item-list">
            {allCards.map((card) => (
              <li key={card.id} className="item-row item-row--stacked">
                <div className="item-row-main">
                  <div>
                    <div className="item-title">{card.front}</div>
                    <div className="item-meta">
                      {card.state} · due {formatDate(card.due)}
                      {/* A term drilled in both directions is two rows whose fronts are
                          each other's backs, which looks like a duplicate in this list
                          until you say which is which. */}
                      {card.direction === "production" ? " · type-in" : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary-sm btn-secondary-sm--danger"
                    onClick={() => handleDeleteFromBrowse(card.id)}
                    aria-label={`Delete flashcard: ${card.front}`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default FlashcardsPanel;
