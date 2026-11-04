import { isTauri } from "./platform";

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
 *
 * Dynamically imports the two Tauri plugins only on the Tauri path (rather than a static
 * top-level import) so `apps/web` — which loads this exact file — never ships them in its
 * bundle at all; there's no real Tauri bridge for them to talk to there anyway.
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
  if (!isTauri()) return saveBytesToDiskInBrowser(defaultFilename, bytes);

  const { save } = await import("@tauri-apps/plugin-dialog");
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  const path = await save({ defaultPath: defaultFilename, filters });
  if (!path) return { path: null };
  await writeFile(path, bytes);
  return { path };
}

/** The browser's own download mechanism: a `Blob` URL behind a synthetic, immediately-
 * clicked `<a download>` — the standard way a web page hands the user real bytes with no
 * native save dialog available. Browsers don't expose where the file actually landed (the
 * downloads folder, or a save-as prompt, depending on the user's own browser settings) —
 * `path: null` is the same shape `saveBytesToDisk` already returns for a cancelled Tauri
 * dialog, so callers need no new branch to handle it. `filters` has no web equivalent
 * (there's no dialog to filter) and is intentionally unused here. */
function saveBytesToDiskInBrowser(filename: string, bytes: Uint8Array): DownloadResult {
  const blob = new Blob([new Uint8Array(bytes)]);
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return { path: null };
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
