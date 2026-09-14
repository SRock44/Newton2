import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatPane from "../ChatPane";
import type { ChatMessage } from "../../types";

const PLAN_A = JSON.stringify({
  title: "Plan A",
  style: "ieee",
  abstract_sketch: "First draft plan.",
  sections: [{ heading: "Intro", summary: "S." }],
});

const PLAN_B = JSON.stringify({
  title: "Plan B",
  style: "ieee",
  abstract_sketch: "Revised plan.",
  sections: [{ heading: "Intro", summary: "S." }],
});

const OPTIONS_JSON = JSON.stringify({
  question: "Which style?",
  options: [{ label: "IEEE" }, { label: "APA 7" }],
});

function renderPane(messages: ChatMessage[], overrides: Partial<React.ComponentProps<typeof ChatPane>> = {}) {
  return render(
    <ChatPane
      messages={messages}
      loading={false}
      loadError={null}
      token="tok"
      sessionId="s1"
      onOpenSuggestedPanel={vi.fn()}
      onOpenDocument={vi.fn()}
      {...overrides}
    />,
  );
}

describe("ChatPane — options/paper-plan wiring across the full message list", () => {
  it("wires onSend through to an options card's click, end to end", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderPane([{ role: "assistant", content: "```options\n" + OPTIONS_JSON + "\n```" }], { onSend });

    await user.click(screen.getByRole("button", { name: /IEEE/ }));
    expect(onSend).toHaveBeenCalledWith("IEEE");
  });

  it("locks an options card read-only once a later message exists in history", () => {
    renderPane([
      { role: "assistant", content: "```options\n" + OPTIONS_JSON + "\n```" },
      { role: "user", content: "IEEE" },
    ]);
    expect(screen.queryByRole("button", { name: /IEEE/ })).not.toBeInTheDocument();
  });

  it("keeps an options card interactive when it's the last message in history", () => {
    renderPane([{ role: "assistant", content: "```options\n" + OPTIONS_JSON + "\n```" }]);
    expect(screen.getByRole("button", { name: /IEEE/ })).toBeInTheDocument();
  });

  it("only the most recent of two paper-plan blocks shows live action buttons", () => {
    renderPane([
      { role: "assistant", content: "```paper-plan\n" + PLAN_A + "\n```" },
      { role: "user", content: "Request Changes" },
      { role: "assistant", content: "```paper-plan\n" + PLAN_B + "\n```" },
    ]);

    // Both plans render...
    expect(screen.getByText("Plan A")).toBeInTheDocument();
    expect(screen.getByText("Plan B")).toBeInTheDocument();
    // ...but only one Approve & Write button exists (Plan B's).
    expect(screen.getAllByRole("button", { name: /approve.*write/i })).toHaveLength(1);
    expect(screen.getByText(/newer plan has replaced this one/i)).toBeInTheDocument();
  });

  it("wires onFocusComposer through to the latest plan's Request Changes button", async () => {
    const user = userEvent.setup();
    const onFocusComposer = vi.fn();
    renderPane([{ role: "assistant", content: "```paper-plan\n" + PLAN_A + "\n```" }], { onFocusComposer });

    await user.click(screen.getByRole("button", { name: /request changes/i }));
    expect(onFocusComposer).toHaveBeenCalledTimes(1);
  });

  it("a lone paper-plan block (nothing after it) still shows live actions", () => {
    renderPane([{ role: "assistant", content: "```paper-plan\n" + PLAN_A + "\n```" }]);
    expect(screen.getByRole("button", { name: /approve.*write/i })).toBeInTheDocument();
  });
});
