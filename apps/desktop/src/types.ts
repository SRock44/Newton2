export type Role = "user" | "assistant" | string;

export interface ChatMessage {
  role: Role;
  content: string;
  created_at?: string;
  /** Client-side only: true while an assistant reply is still streaming in. */
  streaming?: boolean;
  /** Client-side only: true if this message represents a stream error. */
  error?: boolean;
}

export interface ChatSession {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
}

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface UploadedDocument {
  id: string;
  filename: string;
  mime_type: string | null;
  created_at: string;
}

export interface ToolInfo {
  name: string;
  description: string;
}
