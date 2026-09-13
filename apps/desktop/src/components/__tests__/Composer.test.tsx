import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Composer from "../Composer";

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    uploadChatImage: vi.fn(async () => "image-123"),
    uploadDocument: vi.fn(async () => ({
      id: "doc-999",
      filename: "notes.txt",
      mime_type: "text/plain",
      created_at: "2026-01-01T00:00:00Z",
    })),
    listDocuments: vi.fn(async () => [
      { id: "doc-1", filename: "syllabus.pdf", mime_type: "application/pdf", created_at: "2026-01-01T00:00:00Z" },
      { id: "doc-2", filename: "notes.txt", mime_type: "text/plain", created_at: "2026-01-02T00:00:00Z" },
    ]),
  };
});

import { listDocuments, uploadChatImage, uploadDocument } from "../../api";

describe("Composer", () => {
  beforeEach(() => {
    vi.mocked(uploadChatImage).mockClear();
    vi.mocked(uploadDocument).mockClear();
    vi.mocked(listDocuments).mockClear();
  });

  it("sends the trimmed draft on Enter and clears the input", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Composer onSend={onSend} disabled={false} token="test-token" sessionId="test-session" />);

    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "  hello there  ");
    await user.keyboard("{Enter}");

    expect(onSend).toHaveBeenCalledWith("hello there");
    expect(textarea).toHaveValue("");
  });

  it("inserts a newline on Shift+Enter instead of sending", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Composer onSend={onSend} disabled={false} token="test-token" sessionId="test-session" />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(textarea, "line one");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(textarea, "line two");

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.value).toBe("line one\nline two");
  });

  it("does not send an empty or whitespace-only draft", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Composer onSend={onSend} disabled={false} token="test-token" sessionId="test-session" />);

    await user.type(screen.getByRole("textbox"), "   ");
    await user.keyboard("{Enter}");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables the textarea and send button while disabled (e.g. streaming)", () => {
    render(<Composer onSend={vi.fn()} disabled={true} token="test-token" sessionId="test-session" />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("shows an enabled Stop button instead of Send while streaming, and calls onStop", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(
      <Composer
        onSend={onSend}
        onStop={onStop}
        disabled={true}
        streaming={true}
        token="test-token"
        sessionId="test-session"
      />,
    );

    expect(screen.queryByRole("button", { name: /send message/i })).not.toBeInTheDocument();
    const stopButton = screen.getByRole("button", { name: /stop/i });
    expect(stopButton).not.toBeDisabled();

    await user.click(stopButton);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows Send (disabled, per the disabled prop) when disabled but not streaming", () => {
    render(<Composer onSend={vi.fn()} disabled={true} streaming={false} token="test-token" sessionId={null} />);
    expect(screen.queryByRole("button", { name: /stop/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("the + attach button is disabled with no active session", () => {
    render(<Composer onSend={vi.fn()} disabled={false} token="test-token" sessionId={null} />);
    expect(screen.getByRole("button", { name: /add attachment/i })).toBeDisabled();
  });

  describe("the + menu", () => {
    it("opens a menu with the two attach paths", async () => {
      const user = userEvent.setup();
      render(<Composer onSend={vi.fn()} disabled={false} token="test-token" sessionId="test-session" />);

      await user.click(screen.getByRole("button", { name: /add attachment/i }));
      expect(screen.getByRole("menuitem", { name: /upload from your computer/i })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: /attach an existing document/i })).toBeInTheDocument();
    });

    it("uploading a selected image file still uses the ephemeral image-attach flow and includes its id when sending", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(<Composer onSend={onSend} disabled={false} token="test-token" sessionId="test-session" />);

      await user.click(screen.getByRole("button", { name: /add attachment/i }));
      await user.click(screen.getByRole("menuitem", { name: /upload from your computer/i }));

      const file = new File(["fake-bytes"], "problem.png", { type: "image/png" });
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(fileInput, file);

      await waitFor(() => expect(uploadChatImage).toHaveBeenCalledWith("test-token", "test-session", file));
      expect(uploadDocument).not.toHaveBeenCalled();
      expect(await screen.findByText(/problem\.png/)).toBeInTheDocument();

      await user.type(screen.getByRole("textbox"), "what's this?");
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledWith("what's this?\n\n[Attached image: image-123]");
      expect(screen.queryByText(/problem\.png/)).not.toBeInTheDocument();
    });

    it("uploading a selected .txt file routes through the real document-upload endpoint and includes the document marker", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(<Composer onSend={onSend} disabled={false} token="test-token" sessionId="test-session" />);

      await user.click(screen.getByRole("button", { name: /add attachment/i }));
      await user.click(screen.getByRole("menuitem", { name: /upload from your computer/i }));

      const file = new File(["hello"], "notes.txt", { type: "text/plain" });
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(fileInput, file);

      await waitFor(() => expect(uploadDocument).toHaveBeenCalledWith("test-token", file));
      expect(uploadChatImage).not.toHaveBeenCalled();
      expect(await screen.findByText(/notes\.txt/)).toBeInTheDocument();

      await user.type(screen.getByRole("textbox"), "summarize this");
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledWith("summarize this\n\n[Attached document: doc-999|notes.txt]");
    });

    it("picking an existing document fetches listDocuments and inserts its marker without re-uploading", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(<Composer onSend={onSend} disabled={false} token="test-token" sessionId="test-session" />);

      await user.click(screen.getByRole("button", { name: /add attachment/i }));
      await user.click(screen.getByRole("menuitem", { name: /attach an existing document/i }));

      await waitFor(() => expect(listDocuments).toHaveBeenCalledWith("test-token"));
      const item = await screen.findByRole("menuitem", { name: /syllabus\.pdf/i });
      await user.click(item);

      expect(uploadDocument).not.toHaveBeenCalled();
      expect(await screen.findByText(/syllabus\.pdf/)).toBeInTheDocument();

      await user.type(screen.getByRole("textbox"), "let's review this");
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledWith("let's review this\n\n[Attached document: doc-1|syllabus.pdf]");
    });

    it("removing an attached document before sending leaves no trace in the outgoing text", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(<Composer onSend={onSend} disabled={false} token="test-token" sessionId="test-session" />);

      await user.click(screen.getByRole("button", { name: /add attachment/i }));
      await user.click(screen.getByRole("menuitem", { name: /attach an existing document/i }));
      await user.click(await screen.findByRole("menuitem", { name: /notes\.txt/i }));
      await screen.findByText(/notes\.txt/);

      await user.click(screen.getByRole("button", { name: /remove attached document/i }));
      expect(screen.queryByText(/notes\.txt/)).not.toBeInTheDocument();

      await user.type(screen.getByRole("textbox"), "never mind");
      await user.keyboard("{Enter}");
      expect(onSend).toHaveBeenCalledWith("never mind");
    });
  });
});
