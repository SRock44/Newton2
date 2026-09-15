const DRAFT_KEY_PREFIX = "newton:notepad:draft:";

export interface NoteDraft {
  title: string;
  content: string;
}

/** A per-note-id localStorage fallback for the Notepad window's autosave (see
 * NotepadWindow.tsx) — this app already treats "never silently lose a student's real
 * work" as load-bearing (e.g. a stopped chat generation still persists partial text),
 * so a crash or network blip right before the debounced PATCH /notes/{id} save lands
 * shouldn't lose real, unsaved typing either. Written on every content/title change,
 * cleared only once a real save has actually succeeded — deliberately local-only, same
 * reasoning as onboarding.ts's per-user localStorage use: this is a crash fallback for
 * THIS browser profile, not a synced draft. */
export function loadNoteDraft(noteId: string): NoteDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY_PREFIX + noteId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.title === "string" && typeof parsed?.content === "string") {
      return parsed as NoteDraft;
    }
  } catch {
    // Corrupt or unavailable storage — treat it the same as no pending draft.
  }
  return null;
}

export function saveNoteDraft(noteId: string, draft: NoteDraft): void {
  try {
    window.localStorage.setItem(DRAFT_KEY_PREFIX + noteId, JSON.stringify(draft));
  } catch {
    // Best-effort only — worst case a crash right now loses unsaved typing anyway.
  }
}

export function clearNoteDraft(noteId: string): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY_PREFIX + noteId);
  } catch {
    // Best-effort only.
  }
}
