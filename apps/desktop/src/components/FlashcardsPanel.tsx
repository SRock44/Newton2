import { useEffect, useState } from "react";
import {
  ApiError,
  createShareLink,
  deleteFlashcard,
  flashcardsApkgUrl,
  listFlashcards,
  reviewFlashcard,
  revokeShareLink,
} from "../api";
import { fetchBytes, saveBytesToDisk } from "../lib/download";
import type { Flashcard } from "../types";

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

/** Two modes: review the cards due right now (FSRS-scheduled, one at a time, front
 * first, rate after seeing the back), or browse/delete everything regardless of due
 * date. Generation happens from the Documents panel, not here — this is purely
 * study + management. */
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

  const [allCards, setAllCards] = useState<Flashcard[]>([]);
  const [allLoading, setAllLoading] = useState(true);
  const [allFailed, setAllFailed] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Anki export — a real .apkg written to the student's disk (see lib/download.ts).
  // Held separately from `error` so "saved to …" and a failure can use the same line
  // without either being mistaken for the panel-level error banner.
  const [exporting, setExporting] = useState(false);
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

  async function handleRate(value: 1 | 2 | 3 | 4) {
    if (!current || rating) return;
    setRating(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      await reviewFlashcard(accessToken, current.id, value);
      setQueue((prev) => prev.slice(1));
      setShowingBack(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record that review.");
    } finally {
      setRating(false);
    }
  }

  /** Exports every one of this student's cards as a real Anki `.apkg` (decks grouped by
   * the document each card came from, built server-side with genanki) and writes it
   * wherever they choose. The point is that Newton's FSRS-scheduled cards can be
   * reviewed on a phone — so this is a first-class toolbar action here, not something
   * buried in a submenu. */
  async function handleExportToAnki() {
    if (exporting) return;
    setExporting(true);
    setExportStatus("Building your Anki deck…");
    setError(null);
    try {
      const accessToken = await getAccessToken();
      const bytes = await fetchBytes(flashcardsApkgUrl(), accessToken);
      const result = await saveBytesToDisk("newton-flashcards.apkg", bytes, [
        { name: "Anki deck", extensions: ["apkg"] },
      ]);
      // A cancelled save dialog is a normal outcome, not a failure.
      setExportStatus(result.path ? `Saved to ${result.path}` : null);
    } catch (err) {
      setExportStatus(err instanceof ApiError ? err.message : "Couldn't export your flashcards.");
    } finally {
      setExporting(false);
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
            disabled={exporting}
            title="Save these cards as a real Anki deck you can review on your phone"
          >
            {exporting ? "Exporting…" : "Export to Anki"}
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
