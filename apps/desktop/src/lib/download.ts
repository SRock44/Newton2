import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

/** The one way anything a student made in Newton actually leaves the app and lands on
 * their own disk: ask for a destination with the OS's real native save dialog
 * (@tauri-apps/plugin-dialog), then write the real bytes there
 * (@tauri-apps/plugin-fs). Shared by the Documents panel's Download / Download
 * bibliography actions and the Flashcards panel's Anki export, so all three behave
 * identically and there's exactly one place that knows how a save is performed.
 *
 * Deliberately byte-oriented (Uint8Array), never string-oriented: a PDF — including the
 * LaTeX-compiled research papers, the whole reason this exists — must be written as the
 * exact bytes the server stored. Text callers encode once with TextEncoder rather than
 * this having a second, string-shaped path that could silently re-encode a binary file.
 */

export interface DownloadResult {
  /** The path the file was written to, or null if the student cancelled the dialog.
   * A cancel is a completely normal outcome, not an error — callers show nothing. */
  path: string | null;
}

export interface SaveFilter {
  name: string;
  /** Extensions WITHOUT a leading dot, as the dialog plugin expects. */
  extensions: string[];
}

export async function saveBytesToDisk(
  defaultFilename: string,
  bytes: Uint8Array,
  filters?: SaveFilter[],
): Promise<DownloadResult> {
  const path = await save({ defaultPath: defaultFilename, filters });
  if (!path) return { path: null };
  await writeFile(path, bytes);
  return { path };
}

/** Fetches an auth-gated backend URL and hands back its raw bytes — the same
 * fetch + Authorization header pattern the PDF preview already uses for
 * `documentRawUrl` (a plain <embed src> can't carry the bearer token), just returning
 * bytes instead of an object URL. */
export async function fetchBytes(url: string, token: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** "lecture-3.pdf" -> "pdf"; "" for a name with no extension. Lowercased, since the
 * save dialog's filter extensions are matched case-insensitively anyway and a
 * student's "REPORT.PDF" should still offer a PDF filter. */
export function extensionOf(filename: string): string {
  const index = filename.lastIndexOf(".");
  if (index <= 0 || index === filename.length - 1) return "";
  return filename.slice(index + 1).toLowerCase();
}

/** A save-dialog filter derived from a document's own filename, so the dialog opens
 * already pointed at the right file type. Falls back to "All files" for a name with no
 * usable extension rather than inventing one. */
export function filtersForFilename(filename: string): SaveFilter[] {
  const extension = extensionOf(filename);
  if (!extension) return [{ name: "All files", extensions: ["*"] }];
  return [{ name: `${extension.toUpperCase()} file`, extensions: [extension] }];
}

/** "Attention Is All You Need.pdf" -> "Attention Is All You Need.bib". Mirrors the
 * backend's own Content-Disposition filename for the same download, so the name the
 * dialog suggests matches what the server calls it. */
export function withExtension(filename: string, extension: string): string {
  const index = filename.lastIndexOf(".");
  const stem = index > 0 ? filename.slice(0, index) : filename;
  return `${stem || "download"}.${extension}`;
}
