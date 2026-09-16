import type {
  AccountConsentStatus,
  AgeBand,
  BillingStatus,
  ChatMessage,
  ChatSession,
  ClassroomStatus,
  DocumentContent,
  Flashcard,
  GamificationStats,
  Note,
  NoteAnnotateAction,
  NoteSummary,
  PracticeExamDetail,
  PracticeExamSummary,
  ProModel,
  StudyPlanItem,
  ToolInfo,
  UploadedDocument,
  WeakArea,
} from "./types";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:58001";
export const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL ?? "http://127.0.0.1:58180";
export const WS_URL = API_URL.replace(/^http/, "ws");

export class ApiError extends Error {}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

/** Minor-consent / age-gate scaffolding (ROADMAP.md Phase 7 -- see
 * docs/data-retention-and-privacy.md). Fetched once per sign-in (see App.tsx) to decide
 * whether to show AgeGateScreen before the rest of the app. */
export async function getAccountStatus(token: string): Promise<AccountConsentStatus> {
  const res = await fetch(`${API_URL}/account`, { headers: authHeaders(token) });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't load your account."));
  return (await res.json()) as AccountConsentStatus;
}

/** Records the age band chosen on AgeGateScreen. See app/routers/account.py's
 * submit_age_consent -- "under_13" is accepted and recorded but the returned status
 * still reports needs_consent: true, since self-attestation alone isn't COPPA's
 * required verifiable parental consent. */
export async function submitAgeConsent(token: string, ageBand: AgeBand): Promise<AccountConsentStatus> {
  const res = await fetch(`${API_URL}/account/age-consent`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ age_band: ageBand }),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't save that."));
  return (await res.json()) as AccountConsentStatus;
}

/** Permanently deletes the CALLING user's own account and everything they own -- chat
 * history, documents, notes, flashcards, study plan, uploaded files, the Google
 * Classroom connection -- see app/routers/account.py's delete_account and
 * app/services/account.py's delete_own_account. Always "delete my own account", never an
 * admin action on someone else's: the account deleted is whoever `token` belongs to.
 *
 * Irreversible with no undo and no grace period, which is why SettingsPanel.tsx gates it
 * behind a typed-confirmation dialog rather than the window.confirm() used for
 * single-document deletes. The caller must sign out afterwards -- the token is still
 * syntactically valid but now refers to nothing. */
export async function deleteAccount(token: string): Promise<void> {
  const res = await fetch(`${API_URL}/account`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't delete your account."));
}

export async function createSession(token: string): Promise<string> {
  const res = await fetch(`${API_URL}/chat/sessions`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new ApiError("Couldn't start a new chat.");
  const data = await res.json();
  return data.session_id as string;
}

export async function listSessions(token: string): Promise<ChatSession[]> {
  const res = await fetch(`${API_URL}/chat/sessions`, { headers: authHeaders(token) });
  if (!res.ok) throw new ApiError("Couldn't load your chats.");
  return (await res.json()) as ChatSession[];
}

export async function getMessages(token: string, sessionId: string): Promise<ChatMessage[]> {
  const res = await fetch(`${API_URL}/chat/sessions/${sessionId}/messages`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new ApiError("Couldn't load this conversation.");
  return (await res.json()) as ChatMessage[];
}

export async function endSession(token: string, sessionId: string): Promise<void> {
  const res = await fetch(`${API_URL}/chat/sessions/${sessionId}/end`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new ApiError("Couldn't end this session.");
}

export async function deleteSession(token: string, sessionId: string): Promise<void> {
  const res = await fetch(`${API_URL}/chat/sessions/${sessionId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't delete this chat."));
}

/** Message editing (ROADMAP.md): deletes `messageId` and every message after it (by
 * creation order) in `sessionId` — the student's own previous message being edited,
 * plus its original reply and everything since, permanently discarded with no
 * undo/branch history. App.tsx's handleSend calls this FIRST, awaited, before touching
 * its local message list or sending the edited text as a new message. */
export async function deleteMessageAndAfter(token: string, sessionId: string, messageId: string): Promise<void> {
  const res = await fetch(`${API_URL}/chat/sessions/${sessionId}/messages/${messageId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't save that edit."));
}

/** Opens the streaming chat socket for a session. Caller owns the returned socket. */
export function openChatSocket(token: string, sessionId: string): WebSocket {
  return new WebSocket(`${WS_URL}/chat/ws/${sessionId}?token=${encodeURIComponent(token)}`);
}

/** Uploads a photo/screenshot attached to this chat, scoped to the session — see the
 * read_image tool. Returns an image_id to reference in the outgoing message text. */
export async function uploadChatImage(token: string, sessionId: string, file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_URL}/chat/sessions/${sessionId}/images`, {
    method: "POST",
    headers: authHeaders(token),
    body: formData,
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't attach that image."));
  const data = await res.json();
  return data.image_id as string;
}

async function detailOrFallback(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
  } catch {
    // not JSON, or no body — fall through to the generic message
  }
  return fallback;
}

export async function listDocuments(token: string): Promise<UploadedDocument[]> {
  const res = await fetch(`${API_URL}/documents`, { headers: authHeaders(token) });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't load your documents."));
  return (await res.json()) as UploadedDocument[];
}

export async function uploadDocument(token: string, file: File): Promise<UploadedDocument> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_URL}/documents/upload`, {
    method: "POST",
    headers: authHeaders(token),
    body: formData,
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, `Couldn't upload ${file.name}.`));
  return (await res.json()) as UploadedDocument;
}

export async function deleteDocument(token: string, documentId: string): Promise<void> {
  const res = await fetch(`${API_URL}/documents/${documentId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't delete this document."));
}

/** Extracted text for the viewer/editor pane. `editable` is false for PDFs — see the
 * backend's is_editable — the frontend uses it to decide whether to offer an Edit
 * toggle at all rather than letting a save attempt fail. */
export async function getDocumentContent(token: string, documentId: string): Promise<DocumentContent> {
  const res = await fetch(`${API_URL}/documents/${documentId}/content`, { headers: authHeaders(token) });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't load this document."));
  return (await res.json()) as DocumentContent;
}

/** The URL for a document's raw, original bytes (correct Content-Type, no text
 * extraction) — for a PDF viewer's blob source or a download affordance. Auth-gated
 * like every other document endpoint, so fetch it the way AttachedImage.tsx does
 * (fetch + Authorization header + blob()), not a plain <embed src>. */
export function documentRawUrl(documentId: string): string {
  return `${API_URL}/documents/${documentId}/raw`;
}

export async function updateDocumentContent(
  token: string,
  documentId: string,
  content: string,
): Promise<UploadedDocument> {
  const res = await fetch(`${API_URL}/documents/${documentId}/content`, {
    method: "PUT",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't save this document."));
  return (await res.json()) as UploadedDocument;
}

export async function renameDocument(
  token: string,
  documentId: string,
  filename: string,
): Promise<UploadedDocument> {
  const res = await fetch(`${API_URL}/documents/${documentId}`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't rename this document."));
  return (await res.json()) as UploadedDocument;
}

// ---------------------------------------------------------------------------
// Newton Notepad's notes — separate from the uploaded-files Documents endpoints
// above even though both are backed by the same `documents` table server-side (see
// app/routers/notes.py): a note is a first-class, listable thing in its own right,
// not folded into the Documents panel's UI or listing.
// ---------------------------------------------------------------------------

export async function listNotes(token: string): Promise<NoteSummary[]> {
  const res = await fetch(`${API_URL}/notes`, { headers: authHeaders(token) });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't load your notes."));
  return (await res.json()) as NoteSummary[];
}

export async function createNote(token: string, title?: string): Promise<NoteSummary> {
  const res = await fetch(`${API_URL}/notes`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ title: title ?? null }),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't create a new note."));
  return (await res.json()) as NoteSummary;
}

export async function getNote(token: string, noteId: string): Promise<Note> {
  const res = await fetch(`${API_URL}/notes/${noteId}`, { headers: authHeaders(token) });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't load this note."));
  return (await res.json()) as Note;
}

/** Full replace of a note's content+title — called on a client-side debounce (see
 * NotepadWindow.tsx), not per keystroke. */
export async function updateNote(
  token: string,
  noteId: string,
  title: string,
  content: string,
): Promise<NoteSummary> {
  const res = await fetch(`${API_URL}/notes/${noteId}`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ title, content }),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't save this note."));
  return (await res.json()) as NoteSummary;
}

export async function deleteNote(token: string, noteId: string): Promise<void> {
  const res = await fetch(`${API_URL}/notes/${noteId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't delete this note."));
}

/** Sets a note's user-created, optional course tags — a dedicated endpoint separate
 * from updateNote's content-autosave PATCH above, so a click to add/remove a tag is
 * reflected immediately rather than waiting on that multi-second debounce. */
export async function updateNoteTags(token: string, noteId: string, tags: string[]): Promise<NoteSummary> {
  const res = await fetch(`${API_URL}/notes/${noteId}/tags`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ tags }),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't save these tags."));
  return (await res.json()) as NoteSummary;
}

/** Highlight-to-act: explain/define/summarize a selection from within a note. Returns
 * the generated text for the caller to insert inline into the note's raw markdown —
 * never routed to the main chat window (see app/routers/notes.py's own docstring). */
export async function annotateNoteSelection(
  token: string,
  noteId: string,
  selectedText: string,
  context: string,
  action: NoteAnnotateAction,
): Promise<string> {
  const res = await fetch(`${API_URL}/notes/${noteId}/annotate`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ selected_text: selectedText, context, action }),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't get a response for that selection."));
  const data = await res.json();
  return data.text as string;
}

/** The live tool belt, straight from the backend registry — never hand-duplicated
 * client-side, so this can't drift from what the Tutor can actually call. */
export async function listTools(token: string): Promise<ToolInfo[]> {
  const res = await fetch(`${API_URL}/tools`, { headers: authHeaders(token) });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't load Newton's tools."));
  return (await res.json()) as ToolInfo[];
}

export async function generateStudyPlan(token: string, documentId: string): Promise<StudyPlanItem[]> {
  const res = await fetch(`${API_URL}/study-plan/generate/${documentId}`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't generate a study plan for this document."));
  return (await res.json()) as StudyPlanItem[];
}

export async function listStudyPlan(token: string): Promise<StudyPlanItem[]> {
  const res = await fetch(`${API_URL}/study-plan`, { headers: authHeaders(token) });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't load your study plan."));
  return (await res.json()) as StudyPlanItem[];
}

export async function deleteStudyPlanItem(token: string, itemId: string): Promise<void> {
  const res = await fetch(`${API_URL}/study-plan/${itemId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't remove this item."));
}

export async function getClassroomStatus(token: string): Promise<ClassroomStatus> {
  const res = await fetch(`${API_URL}/integrations/classroom/status`, { headers: authHeaders(token) });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't check Google Classroom's connection."));
  return (await res.json()) as ClassroomStatus;
}

/** Returns the Google consent URL to open in the system browser — a separate,
 * Classroom-scoped OAuth grant handled entirely by the backend, distinct from the
 * Keycloak-brokered Google *login*. The backend's own /callback finishes the exchange;
 * the desktop app just polls getClassroomStatus() afterward to notice it landed. */
export async function connectClassroom(token: string): Promise<string> {
  const res = await fetch(`${API_URL}/integrations/classroom/connect`, { headers: authHeaders(token) });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't start connecting Google Classroom."));
  const data = await res.json();
  return data.authorization_url as string;
}

export async function syncClassroom(token: string): Promise<StudyPlanItem[]> {
  const res = await fetch(`${API_URL}/integrations/classroom/sync`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't sync Google Classroom."));
  return (await res.json()) as StudyPlanItem[];
}

export async function disconnectClassroom(token: string): Promise<void> {
  const res = await fetch(`${API_URL}/integrations/classroom`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't disconnect Google Classroom."));
}

export async function generateFlashcards(token: string, documentId: string): Promise<Flashcard[]> {
  const res = await fetch(`${API_URL}/flashcards/generate/${documentId}`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't generate flashcards for this document."));
  return (await res.json()) as Flashcard[];
}

export async function listFlashcards(token: string, dueOnly = false): Promise<Flashcard[]> {
  const url = new URL(`${API_URL}/flashcards`);
  if (dueOnly) url.searchParams.set("due_only", "true");
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't load your flashcards."));
  return (await res.json()) as Flashcard[];
}

/** `rating`: 1=Again, 2=Hard, 3=Good, 4=Easy (matches the FSRS scheduler backing this). */
export async function reviewFlashcard(token: string, cardId: string, rating: 1 | 2 | 3 | 4): Promise<Flashcard> {
  const res = await fetch(`${API_URL}/flashcards/${cardId}/review`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ rating }),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't record that review."));
  return (await res.json()) as Flashcard;
}

export async function deleteFlashcard(token: string, cardId: string): Promise<void> {
  const res = await fetch(`${API_URL}/flashcards/${cardId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't remove this flashcard."));
}

export async function getGamificationStats(token: string): Promise<GamificationStats> {
  const res = await fetch(`${API_URL}/gamification/stats`, { headers: authHeaders(token) });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't load your progress."));
  return (await res.json()) as GamificationStats;
}

export async function generatePracticeExam(
  token: string,
  documentId: string,
  numQuestions = 8,
): Promise<PracticeExamDetail> {
  const url = new URL(`${API_URL}/practice-exams/generate/${documentId}`);
  url.searchParams.set("num_questions", String(numQuestions));
  const res = await fetch(url, { method: "POST", headers: authHeaders(token) });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't generate a practice exam for this document."));
  return (await res.json()) as PracticeExamDetail;
}

export async function listPracticeExams(token: string): Promise<PracticeExamSummary[]> {
  const res = await fetch(`${API_URL}/practice-exams`, { headers: authHeaders(token) });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't load your practice exams."));
  return (await res.json()) as PracticeExamSummary[];
}

export async function getPracticeExam(token: string, examId: string): Promise<PracticeExamDetail> {
  const res = await fetch(`${API_URL}/practice-exams/${examId}`, { headers: authHeaders(token) });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't load this practice exam."));
  return (await res.json()) as PracticeExamDetail;
}

/** `answers` maps question id -> chosen choice index. Any question left out is graded
 * as incorrect (see the backend) — not excluded from scoring. */
export async function submitPracticeExam(
  token: string,
  examId: string,
  answers: Record<string, number>,
): Promise<PracticeExamDetail> {
  const res = await fetch(`${API_URL}/practice-exams/${examId}/submit`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't submit this exam."));
  return (await res.json()) as PracticeExamDetail;
}

export async function deletePracticeExam(token: string, examId: string): Promise<void> {
  const res = await fetch(`${API_URL}/practice-exams/${examId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't remove this practice exam."));
}

export async function getBillingStatus(token: string): Promise<BillingStatus> {
  const res = await fetch(`${API_URL}/billing/status`, { headers: authHeaders(token) });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't load your plan."));
  return (await res.json()) as BillingStatus;
}

/** A curated list of frontier models. Shown to every signed-in user (see
 * SettingsPanel) — only a Pro plan can actually persist a choice via
 * setPreferredProModel below, but free users still get to see and explore the list. */
export async function getProModels(token: string): Promise<ProModel[]> {
  const res = await fetch(`${API_URL}/billing/pro-models`, { headers: authHeaders(token) });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't load the available models."));
  return (await res.json()) as ProModel[];
}

/** Persists a Pro user's chosen frontier model and returns the refreshed billing status
 * (including the now-saved preferred_pro_model). The backend only ever actually persists
 * this for a Pro user — see SettingsPanel, which never calls this for a free user in the
 * first place since it already knows the request would be rejected (402). */
export async function setPreferredProModel(token: string, modelId: string): Promise<BillingStatus> {
  const res = await fetch(`${API_URL}/billing/preferred-model`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: modelId }),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't save your model preference."));
  return (await res.json()) as BillingStatus;
}

/** Persists a student's own Focus Mode preference and returns the refreshed billing
 * status (including the now-saved focus_mode_enabled). Unlike setPreferredProModel,
 * this is never plan-gated -- the backend accepts it for free and Pro users alike (see
 * app/routers/billing.py's set_focus_mode). */
export async function setFocusMode(token: string, enabled: boolean): Promise<BillingStatus> {
  const res = await fetch(`${API_URL}/billing/focus-mode`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't save your Focus Mode setting."));
  return (await res.json()) as BillingStatus;
}

/** Persists a student's own Learn Mode preference and returns the refreshed billing
 * status (including the now-saved learn_mode_enabled). Same never-plan-gated shape as
 * setFocusMode above, and deliberately independent of it -- see
 * app/routers/billing.py's set_learn_mode. */
export async function setLearnMode(token: string, enabled: boolean): Promise<BillingStatus> {
  const res = await fetch(`${API_URL}/billing/learn-mode`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't save your Learn Mode setting."));
  return (await res.json()) as BillingStatus;
}

/** Returns a Stripe Checkout URL to open in the system browser — there's no clean
 * redirect-back to a desktop app, so the caller polls getBillingStatus() afterward
 * (see SettingsPanel) until the plan flips to "pro". 503s when billing isn't configured
 * server-side yet, which reads here as a plain "not available" message rather than a
 * raw error. */
export async function createCheckoutSession(token: string): Promise<string> {
  const res = await fetch(`${API_URL}/billing/checkout-session`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const fallback = res.status === 503 ? "Pro isn't available on this server yet." : "Couldn't start checkout.";
    throw new ApiError(await detailOrFallback(res, fallback));
  }
  const data = await res.json();
  return data.checkout_url as string;
}

/** Returns a Stripe Checkout URL (one-time payment, not a subscription) for a top-up
 * credit purchase, to open in the system browser — same "open a URL, then poll
 * getBillingStatus()" pattern as createCheckoutSession above (see SettingsPanel's "Add
 * credits" section). `amountCents` must be one of the tiers in BillingStatus.
 * topup_tiers_cents; the backend itself validates this too. 503s when billing isn't
 * configured server-side yet, same graceful-degradation message as createCheckoutSession. */
export async function createTopupCheckoutSession(token: string, amountCents: number): Promise<string> {
  const res = await fetch(`${API_URL}/billing/topup-checkout-session`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ amount_cents: amountCents }),
  });
  if (!res.ok) {
    const fallback = res.status === 503 ? "Adding credits isn't available on this server yet." : "Couldn't start checkout.";
    throw new ApiError(await detailOrFallback(res, fallback));
  }
  const data = await res.json();
  return data.checkout_url as string;
}

/** Transcribes a recorded audio chunk via the existing POST /voice/transcribe (see
 * app/routers/voice.py) — Pro-gated server-side (402 if the caller isn't on Newton
 * Pro), exactly as it already is for every other caller of this endpoint; the Notepad's
 * lecture-recording feature does not change or bypass that gate, it just calls the
 * endpoint as it exists today. Newton Notepad's recorder calls this once per chunk
 * (see NotepadWindow.tsx) rather than uploading one long recording at the end. */
export async function transcribeAudio(token: string, blob: Blob): Promise<string> {
  const formData = new FormData();
  formData.append("file", blob, "notepad-recording.webm");
  const res = await fetch(`${API_URL}/voice/transcribe`, {
    method: "POST",
    headers: authHeaders(token),
    body: formData,
  });
  if (!res.ok) {
    const fallback = res.status === 402 ? "Voice recording is a Pro feature." : "Couldn't transcribe that recording.";
    throw new ApiError(await detailOrFallback(res, fallback));
  }
  const data = await res.json();
  return data.text as string;
}

/** Synthesizes an assistant message to speech via POST /voice/synthesize (see
 * app/routers/voice.py), which returns raw WAV bytes — NOT a URL and NOT JSON — so this
 * hands back the Blob directly for the caller to wrap in an object URL and play through
 * the browser's Audio API (see MessageBubble's "Listen" action). Pro-gated server-side
 * with a 402 exactly like transcribeAudio above; the same non-punitive "this is a Pro
 * feature" detail comes back from the server, so it's surfaced as-is rather than
 * replaced with a generic failure message. */
export async function synthesizeSpeech(token: string, text: string): Promise<Blob> {
  const res = await fetch(`${API_URL}/voice/synthesize`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const fallback = res.status === 402 ? "Listening is a Pro feature." : "Couldn't read that message aloud.";
    throw new ApiError(await detailOrFallback(res, fallback));
  }
  return await res.blob();
}

/** The student's real per-topic weak areas, computed server-side from actual flashcard
 * review ratings and missed practice-exam questions (see app/services/weak_areas.py) —
 * the same data the chat tutor's `get_weak_areas` tool reads, now reachable directly
 * for the Home dashboard's "What to study next" widget. An empty array is the normal
 * answer for a student with no review/exam history yet, not an error. */
export async function getWeakAreas(token: string): Promise<WeakArea[]> {
  const res = await fetch(`${API_URL}/weak-areas`, { headers: authHeaders(token) });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't work out what to study next."));
  return (await res.json()) as WeakArea[];
}

/** Returns a Stripe-hosted billing portal URL (manage payment method, cancel) to open
 * in the system browser — self-service, nothing to poll for afterward. */
export async function createPortalSession(token: string): Promise<string> {
  const res = await fetch(`${API_URL}/billing/portal-session`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!res.ok) throw new ApiError(await detailOrFallback(res, "Couldn't open the billing portal."));
  const data = await res.json();
  return data.portal_url as string;
}
