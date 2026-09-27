import MessageContent from "../../desktop/src/components/MessageContent";

// Smooth "follow the newest line" for a chat pinned to the bottom while a reply streams.
//
// A streamed reply grows a whole line at a time, so a plain bottom-pin jumps up ~25 px every time
// a line wraps, which reads as stutter. The fix is to average the pin over a short trailing window
// -- but frames render independently, so the heights at earlier times have to be MEASURED, not
// remembered. So a film mounts a few hidden copies of the streaming message, each holding the text
// as it stood at an earlier moment, in the same typographic context and at the same width as the
// real one; their measured heights give the layout the chat had at those moments. Everything is a
// pure function of the current time: deterministic and stateless. (Earlier attempts that guessed
// from the visible DOM -- when each line appeared, how far across its line the caret was -- mis-fit
// short list items and made the chat lurch.)

/** How far back the pin is averaged over. Longer is smoother but leaves the newest line further
 * below the fold while it's being written; ~0.2 s hides at most about a line. */
export const FOLLOW_WINDOW = 0.2;
const FOLLOW_SAMPLES = 9;

/** The moments the probes represent: the current time first, then back through the window. */
export const followSampleTimes = (t: number): number[] =>
  Array.from({ length: FOLLOW_SAMPLES }, (_, j) => t - (FOLLOW_WINDOW * j) / (FOLLOW_SAMPLES - 1));

/** Hidden copies of the streaming message, one per sample time (`contents[0]` = now). */
export function FollowProbes({ contents }: { contents: string[] }) {
  if (!contents.length) return null;
  return (
    <div
      data-follow-probes=""
      aria-hidden="true"
      style={{ position: "absolute", left: -20000, top: 0, visibility: "hidden", pointerEvents: "none" }}
    >
      {contents.map((content, i) => (
        <div key={i} data-follow-probe="" className="transcript-entry transcript-entry--assistant">
          <div className="transcript-gutter" />
          <div className="transcript-body">
            <MessageContent content={content || " "} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** How far BELOW its settled position the chat should sit right now: the current bottom minus the
 * average of the bottoms over the trailing window (0 when no probes are mounted). Call from the
 * film's place(), after the probes have rendered. */
export function followLagPx(root: HTMLElement): number {
  const probes = root.querySelector<HTMLElement>("[data-follow-probes]");
  if (!probes) return 0;
  const entries = root.querySelectorAll<HTMLElement>(".message-list .transcript-entry");
  const real = entries[entries.length - 1];
  if (!real) return 0;
  const width = `${real.offsetWidth}px`;
  const heights: number[] = [];
  probes.querySelectorAll<HTMLElement>("[data-follow-probe]").forEach((entry) => {
    entry.style.width = width;
    heights.push(entry.offsetHeight);
  });
  if (heights.length < 2) return 0;
  const now = heights[0]!;
  // A block can render TALLER while it is half-written (an unclosed code fence, a table header
  // before its rows) than once it lands; an earlier moment taller than now must never push the
  // chat past its bottom, so each term is clamped at zero.
  return heights.reduce((sum, h) => sum + Math.max(0, now - h), 0) / heights.length;
}

/** Pins a chat pane to the bottom with a transform on its message list (never by scrolling it: a
 * programmatic scrollTop on a composited scroller inside a film's scaled/zoomed layers can be painted
 * a whole message short of where the DOM says it is), minus the streaming follow lag. The pane must
 * be `overflow-y: clip; min-height: 0` (see promo.css's `.promo-* .chat-pane`) so nothing -- not even
 * ChatPane's own `scrollTop = scrollHeight` effect -- can scroll it out from under this. `top`, when
 * given, overrides the pinned position (a film panning across a card). */
export function pinChatToBottom(root: HTMLElement, opts: { top?: (maxTop: number, paneTop: number, paneScale: number) => number; follow?: boolean } = {}) {
  root.querySelectorAll<HTMLElement>(".chat-pane").forEach((pane) => {
    const list = pane.querySelector<HTMLElement>(".message-list");
    if (!list) return;
    list.style.transform = ""; // measure the untranslated layout
    pane.scrollTop = 0;
    const paneRect = pane.getBoundingClientRect();
    const paneScale = pane.offsetWidth ? paneRect.width / pane.offsetWidth : 1;
    const contentHeight = (list.getBoundingClientRect().bottom - paneRect.top) / paneScale + parseFloat(getComputedStyle(pane).paddingBottom || "0");
    const maxTop = Math.max(0, contentHeight - pane.clientHeight);
    let top = opts.top ? opts.top(maxTop, paneRect.top, paneScale) : maxTop;
    if (!opts.top && opts.follow !== false) top = Math.max(0, top - followLagPx(root));
    list.style.transform = `translateY(${-top}px)`;
  });
}
