import { describe, it, expect } from "vitest";
import { extractStudyItems } from "../studyLinks";

describe("extractStudyItems", () => {
  it("strips the markers from the text and returns each item, in order", () => {
    const content = [
      "You're set for Feb 26.",
      "",
      "[Study item: plan|doc-1|Midterm 2 packet.docx|7 items]",
      "[Study item: flashcards|doc-1|Midterm 2 packet.docx|15 cards]",
      "[Study item: exam|exam-9|Midterm 2 packet.docx|15 questions]",
    ].join("\n");
    const { text, items } = extractStudyItems(content);
    expect(text).toBe("You're set for Feb 26.");
    expect(items).toEqual([
      { kind: "plan", id: "doc-1", title: "Midterm 2 packet.docx", detail: "7 items" },
      { kind: "flashcards", id: "doc-1", title: "Midterm 2 packet.docx", detail: "15 cards" },
      { kind: "exam", id: "exam-9", title: "Midterm 2 packet.docx", detail: "15 questions" },
    ]);
  });

  it("reads the marker's '-' id (a bare-topic deck with no source document) as null", () => {
    const { items } = extractStudyItems("[Study item: flashcards|-|linear algebra|8 cards]");
    expect(items).toEqual([{ kind: "flashcards", id: null, title: "linear algebra", detail: "8 cards" }]);
  });

  it("leaves ordinary text, and unknown kinds, alone", () => {
    expect(extractStudyItems("just a reply")).toEqual({ text: "just a reply", items: [] });
    expect(extractStudyItems("[Study item: deck|x|y|z]").items).toEqual([]);
  });
});
