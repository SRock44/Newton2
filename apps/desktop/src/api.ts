import type { ChatMessage, ChatSession, UploadedDocument } from "./types";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:58001";
export const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL ?? "http://127.0.0.1:58180";
export const WS_URL = API_URL.replace(/^http/, "ws");

export class ApiError extends Error {}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

/** Exchanges a username/password for an access token via Keycloak's direct grant flow. */
export async function login(username: string, password: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${KEYCLOAK_URL}/realms/newton/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "newton-api",
        username,
        password,
      }),
    });
  } catch {
    throw new ApiError("Can't reach the sign-in server. Check your connection and try again.");
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 400) {
      throw new ApiError("Incorrect username or password.");
    }
    throw new ApiError(`Sign-in failed (${res.status}). Please try again.`);
  }
  const data = await res.json();
  return data.access_token as string;
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
