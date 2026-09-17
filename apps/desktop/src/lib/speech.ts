/**
 * Splits a reply into the chunks "Listen" synthesizes and plays one after another.
 *
 * WHY THIS EXISTS — two real, measured problems with sending a whole reply as one
 * request to POST /voice/synthesize (services/piper-tts):
 *
 *   1. It is slow to START. Piper synthesizes at roughly 0.12x realtime on the dev box
 *      (measured: 29 chars -> 0.25s, 174 chars -> 1.53s), and cost scales with the
 *      length of the text. A long Newton reply therefore meant fifteen-plus seconds of
 *      silence before the first word — the student clicks "Listen" and nothing happens.
 *      Almost all of that wait is spent rendering audio they haven't reached yet.
 *   2. It could KILL the voice service. A single 580-character request took down the
 *      piper-tts worker mid-response ("Server disconnected without sending a response",
 *      container RestartCount 1). Long replies are exactly the case a student most wants
 *      read aloud.
 *
 * Chunking fixes both at once, with no backend change: the first chunk is small, so
 * audio starts in well under a second, and every request stays comfortably inside the
 * size that service handles reliably. The rest is synthesized in the background while
 * the student is already listening.
 *
 * The first chunk is deliberately SMALLER than the rest: it is the only one whose
 * synthesis time the student actually waits through. Later chunks are larger, because
 * each is prefetched during playback of the one before it — bigger is better there
 * (fewer round trips, more natural prosody across a full sentence), as long as it still
 * renders faster than realtime, which at ~0.12x it comfortably does.
 */

/**
 * Deliberately tiny: this is the ONLY synthesis the student actually waits through, and
 * the wait is not just compute. /voice/synthesize returns uncompressed 22kHz 16-bit WAV
 * (~44KB per second of speech), so the bytes on the wire matter as much as Piper's
 * ~0.7s render — measured on the dev box, a 140-character chunk is 345KB, and over a
 * slow link that transfer, not the synthesis, dominates time-to-first-word. Halving the
 * first chunk halves both. Later chunks don't have this constraint because they download
 * while the student is already listening.
 */
export const FIRST_CHUNK_CHARS = 80;
/** Big enough for natural prosody, far below the size that broke the service. */
export const CHUNK_CHARS = 320;

// Sentence-ish boundaries: ., !, ? or a newline, plus any closing quote/bracket, followed
// by whitespace. Kept simple on purpose — this decides where audio is allowed to seam,
// not where a sentence truly ends, and a slightly early seam is inaudible.
const SENTENCE_BOUNDARY = /(?<=[.!?][)"'\]]?)\s+|\n+/;

function hardWrap(piece: string, limit: number): string[] {
  // A single "sentence" longer than the limit (a run-on, a long list line, a code-ish
  // blob) still has to be split, or it would recreate exactly the oversized request this
  // module exists to avoid. Break on a word boundary where possible.
  const out: string[] = [];
  let rest = piece;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = window.lastIndexOf(" ");
    const at = cut > limit * 0.5 ? cut : limit;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Returns the ordered chunks to synthesize. Always returns at least one chunk for
 * non-blank input, and never returns a blank chunk (the service rejects empty text).
 */
export function splitForSpeech(
  text: string,
  firstChunkChars: number = FIRST_CHUNK_CHARS,
  chunkChars: number = CHUNK_CHARS,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const sentences = trimmed
    .split(SENTENCE_BOUNDARY)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  const limitFor = () => (chunks.length === 0 ? firstChunkChars : chunkChars);

  for (const sentence of sentences) {
    for (const piece of hardWrap(sentence, chunkChars)) {
      if (!current) {
        current = piece;
      } else if (current.length + 1 + piece.length <= limitFor()) {
        current = `${current} ${piece}`;
      } else {
        chunks.push(current);
        current = piece;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
