import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import MessageBubble from "../MessageBubble";
import type { ChatMessage } from "../../types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MessageBubble", () => {
  it("renders plain messages without an attached-image marker unaffected", () => {
    const message: ChatMessage = { role: "assistant", content: "Just some text." };
    render(<MessageBubble message={message} token="tok" sessionId="s1" />);
    expect(screen.getByText("Just some text.")).toBeInTheDocument();
  });

  it("strips the [Attached image: <id>] marker from the visible text and renders a thumbnail instead", async () => {
    const blob = new Blob(["fake-bytes"], { type: "image/png" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, blob: async () => blob })),
    );
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:fake-url"),
      revokeObjectURL: vi.fn(),
    });

    const message: ChatMessage = {
      role: "user",
      content: "What's going on here?\n\n[Attached image: cb01da7d-0f16-4b08-9945-5aca60855cf5]",
    };
    render(<MessageBubble message={message} token="tok" sessionId="s1" />);

    // The raw bracket/UUID text must never be visible...
    expect(screen.queryByText(/Attached image: cb01da7d/)).not.toBeInTheDocument();
    // ...the rest of the message still is...
    expect(screen.getByText("What's going on here?")).toBeInTheDocument();
    // ...and a real thumbnail renders in its place.
    const img = await screen.findByAltText("Attached to this message");
    expect(img).toHaveAttribute("src", "blob:fake-url");
  });

  it("shows a clean fallback chip, not a broken image, when the attachment has expired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );

    const message: ChatMessage = {
      role: "user",
      content: "[Attached image: some-old-id]",
    };
    render(<MessageBubble message={message} token="tok" sessionId="s1" />);

    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
