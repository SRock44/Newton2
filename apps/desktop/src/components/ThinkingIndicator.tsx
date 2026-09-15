import { useEffect, useState } from "react";

/** Purely cosmetic, client-side-only phrases cycled while genuinely nothing has arrived
 * yet (see MessageBubble.tsx's showStreamingDots) — never dependent on any real backend
 * event, so the sense of ongoing activity is guaranteed continuous regardless of how
 * long the real wait turns out to be, instead of a single static sentence sitting still
 * for however many seconds pass before the first real signal (a plan chunk, tool
 * activity, or the answer itself) lands. Deliberately short and generic — this is
 * filler for the silent gap, not a claim about what's actually happening. */
const THINKING_PHRASES = [
  "Newton is thinking",
  "Reading your message",
  "Working through it",
  "Putting a plan together",
];

const PHRASE_INTERVAL_MS = 2600;

/** The one-and-only "genuinely nothing has arrived yet" signal (see MessageBubble.tsx's
 * showStreamingDots) — replaces the old static-text/slow-fade treatment with a
 * continuously animated shimmer sweep (a moving highlight across the text, the same
 * technique loading skeletons use elsewhere) plus a cycling phrase, so it reads as
 * actively alive for the entire wait rather than looking the same for 8+ seconds. */
function ThinkingIndicator() {
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setPhraseIndex((i) => (i + 1) % THINKING_PHRASES.length);
    }, PHRASE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="thinking-indicator" aria-label="Newton is thinking" aria-live="polite">
      <span className="thinking-indicator-text">{THINKING_PHRASES[phraseIndex]}…</span>
      <span className="thinking-indicator-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

export default ThinkingIndicator;
