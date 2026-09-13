/** A small, deterministic (non-cryptographic) string hash — djb2 — used to derive a
 * short, stable localStorage-key suffix from a block's own content, so two different
 * math-steps blocks in the same message don't collide. Not for anything security-
 * sensitive, just cheap key disambiguation. */
export function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}
