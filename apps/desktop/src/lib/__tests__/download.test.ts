import { describe, it, expect, vi, beforeEach } from "vitest";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import {
  extensionOf,
  fetchBytes,
  filtersForFilename,
  saveBytesToDisk,
  withExtension,
} from "../download";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: vi.fn() }));

const saveMock = save as unknown as ReturnType<typeof vi.fn>;
const writeFileMock = writeFile as unknown as ReturnType<typeof vi.fn>;

describe("download helpers", () => {
  beforeEach(() => {
    saveMock.mockReset();
    writeFileMock.mockReset();
    writeFileMock.mockResolvedValue(undefined);
  });

  it("extensionOf reads the extension, lowercased", () => {
    expect(extensionOf("lecture-3.pdf")).toBe("pdf");
    expect(extensionOf("REPORT.PDF")).toBe("pdf");
    expect(extensionOf("slides.pptx")).toBe("pptx");
  });

  it("extensionOf returns empty string when there's nothing usable", () => {
    expect(extensionOf("README")).toBe("");
    expect(extensionOf(".gitignore")).toBe(""); // a leading dot is not an extension
    expect(extensionOf("trailing.")).toBe("");
  });

  it("filtersForFilename offers the document's own type, or all files when unknown", () => {
    expect(filtersForFilename("paper.pdf")).toEqual([{ name: "PDF file", extensions: ["pdf"] }]);
    expect(filtersForFilename("README")).toEqual([{ name: "All files", extensions: ["*"] }]);
  });

  it("withExtension swaps the extension and keeps the rest of the name", () => {
    expect(withExtension("Attention Is All You Need.pdf", "bib")).toBe("Attention Is All You Need.bib");
    expect(withExtension("paper.tex", "bib")).toBe("paper.bib");
    expect(withExtension("noextension", "bib")).toBe("noextension.bib");
  });

  it("saveBytesToDisk asks for a destination and writes the exact bytes there", async () => {
    saveMock.mockResolvedValue("C:\\Users\\student\\Downloads\\paper.pdf");
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

    const result = await saveBytesToDisk("paper.pdf", bytes, [{ name: "PDF file", extensions: ["pdf"] }]);

    expect(saveMock).toHaveBeenCalledWith({
      defaultPath: "paper.pdf",
      filters: [{ name: "PDF file", extensions: ["pdf"] }],
    });
    expect(writeFileMock).toHaveBeenCalledWith("C:\\Users\\student\\Downloads\\paper.pdf", bytes);
    expect(result.path).toBe("C:\\Users\\student\\Downloads\\paper.pdf");
  });

  it("writes nothing at all when the student cancels the save dialog", async () => {
    saveMock.mockResolvedValue(null);

    const result = await saveBytesToDisk("paper.pdf", new Uint8Array([1, 2, 3]));

    expect(writeFileMock).not.toHaveBeenCalled();
    expect(result.path).toBeNull();
  });

  it("fetchBytes sends the bearer token and returns raw bytes, not decoded text", async () => {
    const payload = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(payload, { status: 200 }));

    const bytes = await fetchBytes("http://api.test/documents/1/raw", "tok");

    expect(fetchSpy).toHaveBeenCalledWith("http://api.test/documents/1/raw", {
      headers: { Authorization: "Bearer tok" },
    });
    expect(Array.from(bytes)).toEqual([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    fetchSpy.mockRestore();
  });

  it("fetchBytes throws on a non-OK response rather than saving an error page to disk", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("not found", { status: 404 }));

    await expect(fetchBytes("http://api.test/documents/1/bibliography.bib", "tok")).rejects.toThrow(
      /404/,
    );
    fetchSpy.mockRestore();
  });
});
