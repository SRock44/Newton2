import { describe, it, expect } from "vitest";
import { splitForSpeech, FIRST_CHUNK_CHARS, CHUNK_CHARS } from "../speech";

describe("splitForSpeech", () => {
  it("returns nothing for blank text (the service rejects empty text)", () => {
    expect(splitForSpeech("")).toEqual([]);
    expect(splitForSpeech("   \n  ")).toEqual([]);
  });

  it("keeps a short reply as a single chunk", () => {
    expect(splitForSpeech("The Krebs cycle produces ATP.")).toEqual(["The Krebs cycle produces ATP."]);
  });

  it("makes the FIRST chunk small — it is the only wait the student sits through", () => {
    const sentence = "This is a sentence of a reasonable length that a tutor might say. ";
    const chunks = splitForSpeech(sentence.repeat(10));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThanOrEqual(FIRST_CHUNK_CHARS);
  });

  it("makes later chunks larger than the first (they're prefetched during playback)", () => {
    const sentence = "This is a sentence of a reasonable length that a tutor might say. ";
    const chunks = splitForSpeech(sentence.repeat(20));
    const longest = Math.max(...chunks.slice(1).map((c) => c.length));
    expect(longest).toBeGreaterThan(FIRST_CHUNK_CHARS);
    expect(longest).toBeLessThanOrEqual(CHUNK_CHARS);
  });

  it("never emits a chunk over the cap — the size that actually killed the voice service", () => {
    const long = "Photosynthesis converts sunlight into chemical energy in plants. ".repeat(40);
    for (const chunk of splitForSpeech(long)) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_CHARS);
    }
  });

  it("splits a single run-on sentence that exceeds the cap on its own", () => {
    const runOn = "word ".repeat(200).trim(); // ~1000 chars, no sentence punctuation at all
    const chunks = splitForSpeech(runOn);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(CHUNK_CHARS);
  });

  it("loses no words — the whole reply is still spoken", () => {
    const text =
      "First sentence here. Second one follows! Third one asks something? " +
      "And a fourth that runs on for a while to push past the first chunk boundary comfortably.";
    const rejoined = splitForSpeech(text).join(" ").replace(/\s+/g, " ");
    expect(rejoined).toBe(text.replace(/\s+/g, " ").trim());
  });

  it("never emits a blank chunk", () => {
    const text = "One.\n\n\nTwo.   \n\nThree.";
    for (const chunk of splitForSpeech(text)) expect(chunk.trim()).not.toBe("");
  });

  it("seams at sentence boundaries rather than mid-word", () => {
    const text = "Alpha beta gamma delta. Epsilon zeta eta theta. Iota kappa lambda mu.";
    for (const chunk of splitForSpeech(text, 30, 30)) {
      expect(chunk).not.toMatch(/^\s|\s$/);
    }
  });

  it("handles a closing quote or bracket after the terminator", () => {
    const chunks = splitForSpeech('He said "it works." Then she agreed.', 20, 20);
    expect(chunks[0]).toBe('He said "it works."');
  });
});
