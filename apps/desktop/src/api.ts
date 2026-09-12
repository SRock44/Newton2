import type { ChatMessage, ChatSession, ClassroomStatus, StudyPlanItem, ToolInfo, UploadedDocument } from "./types";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:58001";
export const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL ?? "http://127.0.0.1:58180";
export const WS_URL = API_URL.replace(/^http/, "ws");

export class ApiError extends Error {}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
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

/** Opens the streaming chat socket for a session. Caller owns the returned socket. */
export function openChatSocket(token: string, sessionId: string): WebSocket {
  return new WebSocket(`${WS_URL}/chat/ws/${sessionId}?token=${encodeURIComponent(token)}`);
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
