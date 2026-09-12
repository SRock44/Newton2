import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Composer from "../Composer";

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    uploadChatImage: vi.fn(async () => "image-123"),
  };
});

import { uploadChatImage } from "../../api";

describe("Composer", () => {
  beforeEach(() => {
    vi.mocked(uploadChatImage).mockClear();
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

  it("uploads a selected image, shows it attached, and includes its id when sending", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Composer onSend={onSend} disabled={false} token="test-token" sessionId="test-session" />);

    const file = new File(["fake-bytes"], "problem.png", { type: "image/png" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    await waitFor(() => expect(uploadChatImage).toHaveBeenCalledWith("test-token", "test-session", file));
    expect(await screen.findByText(/problem\.png/)).toBeInTheDocument();

    await user.type(screen.getByRole("textbox"), "what's this?");
    await user.keyboard("{Enter}");

    expect(onSend).toHaveBeenCalledWith("what's this?\n\n[Attached image: image-123]");
    // sending clears the attachment chip too
    expect(screen.queryByText(/problem\.png/)).not.toBeInTheDocument();
  });

  it("removing an attached image before sending leaves no trace in the outgoing text", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Composer onSend={onSend} disabled={false} token="test-token" sessionId="test-session" />);

    const file = new File(["fake-bytes"], "notes.png", { type: "image/png" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);
    await screen.findByText(/notes\.png/);

    await user.click(screen.getByRole("button", { name: /remove attached image/i }));
    expect(screen.queryByText(/notes\.png/)).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox"), "never mind");
    await user.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith("never mind");
  });

  it("the attach button is disabled with no active session", () => {
    render(<Composer onSend={vi.fn()} disabled={false} token="test-token" sessionId={null} />);
    expect(screen.getByRole("button", { name: /attach an image/i })).toBeDisabled();
  });
});
