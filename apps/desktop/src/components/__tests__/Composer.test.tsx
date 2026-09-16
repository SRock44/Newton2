import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Composer from "../Composer";

const FREE_BILLING_STATUS = {
  plan: "free" as const,
  subscription_status: null,
  current_period_end: null,
  credits_used_cents: 0,
  credits_limit_cents: 0,
  credits_reset_at: null,
  preferred_pro_model: "deepseek/deepseek-v4-flash-0731",
  free_generation_target: 5,
  pro_generation_target: 15,
  focus_mode_enabled: false,
  topup_credits_cents: 0,
  topup_tiers_cents: [500, 1000, 2500],
  learn_mode_enabled: false,
};

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
    getBillingStatus: vi.fn(async () => FREE_BILLING_STATUS),
    setLearnMode: vi.fn(async (_token: string, enabled: boolean) => ({ ...FREE_BILLING_STATUS, learn_mode_enabled: enabled })),
  };
});

import { getBillingStatus, listDocuments, setLearnMode, uploadChatImage, uploadDocument } from "../../api";

describe("Composer", () => {
  beforeEach(() => {
    vi.mocked(uploadChatImage).mockClear();
    vi.mocked(uploadDocument).mockClear();
    vi.mocked(listDocuments).mockClear();
    vi.mocked(getBillingStatus).mockReset().mockResolvedValue(FREE_BILLING_STATUS);
    vi.mocked(setLearnMode)
      .mockReset()
      .mockImplementation(async (_token, enabled) => ({ ...FREE_BILLING_STATUS, learn_mode_enabled: enabled }));
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

  describe("Learn Mode toggle", () => {
    it("is visible directly in the composer, not just in Settings, and starts unchecked by default", async () => {
      render(<Composer onSend={vi.fn()} disabled={false} token="test-token" sessionId="test-session" />);

      const toggle = await screen.findByRole("switch", { name: /learn mode/i });
      await waitFor(() => expect(toggle).not.toBeDisabled());
      expect(toggle).not.toBeChecked();
    });

    it("reflects an already-enabled server value once billing status loads", async () => {
      vi.mocked(getBillingStatus).mockResolvedValue({ ...FREE_BILLING_STATUS, learn_mode_enabled: true });
      render(<Composer onSend={vi.fn()} disabled={false} token="test-token" sessionId="test-session" />);

      const toggle = await screen.findByRole("switch", { name: /learn mode/i });
      await waitFor(() => expect(toggle).toBeChecked());
    });

    it("clicking it persists the change via setLearnMode and updates optimistically", async () => {
      const user = userEvent.setup();
      render(<Composer onSend={vi.fn()} disabled={false} token="test-token" sessionId="test-session" />);

      const toggle = await screen.findByRole("switch", { name: /learn mode/i });
      await waitFor(() => expect(toggle).not.toBeDisabled());
      await user.click(toggle);

      expect(toggle).toBeChecked(); // optimistic, before the awaited call resolves
      await waitFor(() => expect(vi.mocked(setLearnMode)).toHaveBeenCalledWith("test-token", true));
      await waitFor(() => expect(toggle).toBeChecked());
    });

    it("reverts the toggle and shows an error when saving fails", async () => {
      vi.mocked(setLearnMode).mockRejectedValue(new Error("network down"));
      const user = userEvent.setup();
      render(<Composer onSend={vi.fn()} disabled={false} token="test-token" sessionId="test-session" />);

      const toggle = await screen.findByRole("switch", { name: /learn mode/i });
      await waitFor(() => expect(toggle).not.toBeDisabled());
      await user.click(toggle);

      expect(await screen.findByText(/couldn't save your learn mode setting/i)).toBeInTheDocument();
      await waitFor(() => expect(toggle).not.toBeChecked());
    });

    it("does not block sending a message while Learn Mode status is still loading or toggled", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(<Composer onSend={onSend} disabled={false} token="test-token" sessionId="test-session" />);

      await user.type(screen.getByRole("textbox"), "hello");
      await user.keyboard("{Enter}");
      expect(onSend).toHaveBeenCalledWith("hello");
    });
  });

  // Message editing (ROADMAP.md): Composer's own contract for the `editing` prop --
  // App.tsx owns the actual delete-and-resend logic (see App.test.tsx's "message
  // editing" suite for that full flow), this just covers Composer's piece of it in
  // isolation: populating/repopulating the draft, the visible indicator, Cancel, and
  // the Save-edit send still going through the same onSend.
  describe("editing", () => {
    it("repopulates the draft with the exact original text and shows an editing indicator", () => {
      render(
        <Composer
          onSend={vi.fn()}
          disabled={false}
          token="test-token"
          sessionId="test-session"
          editing={{ id: "m1", content: "my original wording" }}
        />,
      );

      expect(screen.getByRole("textbox")).toHaveValue("my original wording");
      expect(screen.getByText("Editing message")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save edit" })).toBeInTheDocument();
    });

    it("re-populates when the edit target changes to a different message", () => {
      const { rerender } = render(
        <Composer
          onSend={vi.fn()}
          disabled={false}
          token="test-token"
          sessionId="test-session"
          editing={{ id: "m1", content: "first message text" }}
        />,
      );
      expect(screen.getByRole("textbox")).toHaveValue("first message text");

      rerender(
        <Composer
          onSend={vi.fn()}
          disabled={false}
          token="test-token"
          sessionId="test-session"
          editing={{ id: "m2", content: "second message text" }}
        />,
      );
      expect(screen.getByRole("textbox")).toHaveValue("second message text");
    });

    it("does not stomp further edits to the draft on every re-render while the same message stays targeted", async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <Composer
          onSend={vi.fn()}
          disabled={false}
          token="test-token"
          sessionId="test-session"
          editing={{ id: "m1", content: "original" }}
        />,
      );
      const textarea = screen.getByRole("textbox");
      await user.type(textarea, " plus more");

      // A re-render with the SAME editing.id (e.g. a parent re-render for an unrelated
      // reason) must not wipe out the student's in-progress tweak.
      rerender(
        <Composer
          onSend={vi.fn()}
          disabled={false}
          token="test-token"
          sessionId="test-session"
          editing={{ id: "m1", content: "original" }}
        />,
      );
      expect(textarea).toHaveValue("original plus more");
    });

    it("Cancel clears the draft and calls onCancelEdit without sending anything", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      const onCancelEdit = vi.fn();
      render(
        <Composer
          onSend={onSend}
          disabled={false}
          token="test-token"
          sessionId="test-session"
          editing={{ id: "m1", content: "original wording" }}
          onCancelEdit={onCancelEdit}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onCancelEdit).toHaveBeenCalledTimes(1);
      expect(onSend).not.toHaveBeenCalled();
      expect(screen.getByRole("textbox")).toHaveValue("");
    });

    it("shows the edit error inline next to the editing indicator", () => {
      render(
        <Composer
          onSend={vi.fn()}
          disabled={false}
          token="test-token"
          sessionId="test-session"
          editing={{ id: "m1", content: "original" }}
          editError="Couldn't save that edit."
        />,
      );
      expect(screen.getByText("Couldn't save that edit.")).toBeInTheDocument();
    });

    it("Save edit sends the (possibly further-edited) text through the same onSend as a normal message", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(
        <Composer
          onSend={onSend}
          disabled={false}
          token="test-token"
          sessionId="test-session"
          editing={{ id: "m1", content: "original wording" }}
        />,
      );

      const textarea = screen.getByRole("textbox");
      await user.clear(textarea);
      await user.type(textarea, "edited wording");
      await user.click(screen.getByRole("button", { name: "Save edit" }));

      expect(onSend).toHaveBeenCalledWith("edited wording");
    });
  });
});
