/** A single document/note preview — shared by DocumentsPanel.tsx's file list (as a
 * compact `variant="row"`) and HomeView.tsx's "Recent documents & notes" widget (as
 * the default `variant="card"`), so both get the same visual treatment instead of two
 * separately-built styles (see ROADMAP.md). The "card" variant renders a Google
 * Drive-style thumbnail: a fixed white "page" (deliberately not theme-colored — real
 * paper doesn't go dark in dark mode any more than a Drive thumbnail does) showing the
 * item's actual leading text at a tiny size, with the type badge as a small tab in the
 * corner — real content, not a rendered PDF-engine screenshot, but a genuine preview of
 * what's inside rather than a flat color swatch with three letters on it. */

export interface RecentItemCardProps {
  /** Short badge text, e.g. "PDF", "TXT", "MD", "DOC", "NOTE". */
  typeLabel: string;
  title: string;
  /** ISO timestamp — last-updated for a note, upload date for a document. */
  timestamp: string;
  /** A short excerpt of the item's real content — omitted (not "Loading…") until it's
   * actually known, since the row/card renders immediately off the summary list while
   * the snippet is still being fetched (see HomeView.tsx). */
  snippet?: string | null;
  /** Notes carry user-created course tags; documents never do (see types.ts's
   * NoteSummary vs UploadedDocument). */
  tags?: string[];
  active?: boolean;
  /** "row": a compact single-line list entry (DocumentsPanel's file list).
   * "card": a taller tile with room for a snippet (HomeView's recent-items grid).
   * Defaults to "card". */
  variant?: "row" | "card";
  onClick: () => void;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function RecentItemCard({
  typeLabel,
  title,
  timestamp,
  snippet,
  tags,
  active = false,
  variant = "card",
  onClick,
}: RecentItemCardProps) {
  const metaRow = (
    <span className="recent-item-card-meta">
      <span className="recent-item-card-date">{formatTimestamp(timestamp)}</span>
      {tags && tags.length > 0 && (
        <span className="recent-item-card-tags">
          {tags.map((tag) => (
            <span key={tag} className="recent-item-card-tag">
              {tag}
            </span>
          ))}
        </span>
      )}
    </span>
  );

  if (variant === "row") {
    return (
      <button
        type="button"
        className={`recent-item-card recent-item-card--row${active ? " recent-item-card--active" : ""}`}
        onClick={onClick}
      >
        <span className="recent-item-card-icon" aria-hidden="true">
          {typeLabel}
        </span>
        <span className="recent-item-card-body">
          <span className="recent-item-card-title">{title}</span>
          {metaRow}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`recent-item-card recent-item-card--card${active ? " recent-item-card--active" : ""}`}
      onClick={onClick}
    >
      <span className="recent-item-thumb">
        <span className="recent-item-thumb-badge">{typeLabel}</span>
        {snippet ? (
          <span className="recent-item-thumb-text">{snippet}</span>
        ) : (
          <span className="recent-item-thumb-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        )}
      </span>
      <span className="recent-item-card-body">
        <span className="recent-item-card-title">{title}</span>
        {metaRow}
      </span>
    </button>
  );
}

export default RecentItemCard;
