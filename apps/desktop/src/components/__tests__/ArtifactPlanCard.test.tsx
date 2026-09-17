import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageContent from "../MessageContent";
import ArtifactPlanCard, {
  BUILDING_NOTE,
  BUILD_MESSAGE,
  COST_NOTE,
  parseArtifactPlan,
} from "../ArtifactPlanCard";

const PLAN_JSON = JSON.stringify({
  kind: "interactive",
  title: "Projectile range explorer",
  summary: "A launch-angle slider that redraws the trajectory live, so you can find where range peaks.",
});

describe("ArtifactPlanCard", () => {
  it("renders the kind badge, title, and summary", () => {
    render(<ArtifactPlanCard json={PLAN_JSON} onApprove={vi.fn()} onRequestChanges={vi.fn()} />);
    expect(screen.getByText("Interactive")).toBeInTheDocument();
    expect(screen.getByText("Projectile range explorer")).toBeInTheDocument();
    expect(screen.getByText(/launch-angle slider/i)).toBeInTheDocument();
  });

  it("falls back to the raw kind string for an unknown kind rather than hiding it", () => {
    const json = JSON.stringify({ kind: "sculpture", title: "T", summary: "S." });
    render(<ArtifactPlanCard json={json} onApprove={vi.fn()} onRequestChanges={vi.fn()} />);
    expect(screen.getByText("sculpture")).toBeInTheDocument();
  });

  // ─── The cost-transparency requirement: the student is told BEFORE they spend. ───
  describe("cost note", () => {
    it("shows the honest cost note before anything is built", () => {
      render(<ArtifactPlanCard json={PLAN_JSON} onApprove={vi.fn()} onRequestChanges={vi.fn()} />);
      expect(screen.getByText(COST_NOTE)).toBeInTheDocument();
    });

    it("names what actually makes it expensive, how long it takes, and that it's Pro", () => {
      render(<ArtifactPlanCard json={PLAN_JSON} onApprove={vi.fn()} onRequestChanges={vi.fn()} />);
      const note = screen.getByText(COST_NOTE).textContent ?? "";
      expect(note).toMatch(/coding agent/i);
      expect(note).toMatch(/minute/i);
      expect(note).toMatch(/costs a lot more/i);
      expect(note).toMatch(/\bPro\b/);
      expect(note).toMatch(/credit/i);
    });

    it("is shown on the confirm card, not only after the build", () => {
      // The note and the Build button are in the same card — a student cannot approve
      // the spend without the note being on screen.
      render(<ArtifactPlanCard json={PLAN_JSON} onApprove={vi.fn()} onRequestChanges={vi.fn()} />);
      expect(screen.getByText(COST_NOTE)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /build it/i })).toBeInTheDocument();
    });
  });

  describe("actions", () => {
    it("Build it sends the fixed confirmation sentence", async () => {
      const user = userEvent.setup();
      const onApprove = vi.fn();
      render(<ArtifactPlanCard json={PLAN_JSON} onApprove={onApprove} onRequestChanges={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: /build it/i }));
      expect(onApprove).toHaveBeenCalledWith(BUILD_MESSAGE);
      expect(onApprove).toHaveBeenCalledTimes(1);
    });

    // ─── A second click is a second multi-minute, real-money build. ───
    it("locks after the first click so a second click cannot start another build", async () => {
      const user = userEvent.setup();
      const onApprove = vi.fn();
      render(<ArtifactPlanCard json={PLAN_JSON} onApprove={onApprove} onRequestChanges={vi.fn()} />);

      const build = screen.getByRole("button", { name: /build it/i });
      await user.click(build);
      expect(onApprove).toHaveBeenCalledTimes(1);

      // The button is gone entirely, replaced by an honest in-progress note.
      expect(screen.queryByRole("button", { name: /build it/i })).not.toBeInTheDocument();
      expect(screen.getByText(BUILDING_NOTE)).toBeInTheDocument();
      expect(onApprove).toHaveBeenCalledTimes(1);
    });

    it("also hides Change it once a build has started", async () => {
      const user = userEvent.setup();
      render(<ArtifactPlanCard json={PLAN_JSON} onApprove={vi.fn()} onRequestChanges={vi.fn()} />);
      await user.click(screen.getByRole("button", { name: /build it/i }));
      expect(screen.queryByRole("button", { name: /change it/i })).not.toBeInTheDocument();
    });

    it("renders locked from the start when the conversation already moved past it", () => {
      // Reopening the conversation later: local state is gone, but the following message
      // still proves this card was acted on.
      render(
        <ArtifactPlanCard
          json={PLAN_JSON}
          onApprove={vi.fn()}
          onRequestChanges={vi.fn()}
          answeredWith={BUILD_MESSAGE}
        />,
      );
      expect(screen.queryByRole("button", { name: /build it/i })).not.toBeInTheDocument();
      expect(screen.getByText(BUILDING_NOTE)).toBeInTheDocument();
      // The plan itself and the cost note still render — only the actions are gone.
      expect(screen.getByText("Projectile range explorer")).toBeInTheDocument();
      expect(screen.getByText(COST_NOTE)).toBeInTheDocument();
    });

    it("stays interactive while it is still the last thing in the conversation", () => {
      render(<ArtifactPlanCard json={PLAN_JSON} onApprove={vi.fn()} onRequestChanges={vi.fn()} />);
      expect(screen.getByRole("button", { name: /build it/i })).toBeInTheDocument();
      expect(screen.queryByText(BUILDING_NOTE)).not.toBeInTheDocument();
    });

    it("Change it focuses the composer and sends nothing", async () => {
      const user = userEvent.setup();
      const onApprove = vi.fn();
      const onRequestChanges = vi.fn();
      render(
        <ArtifactPlanCard json={PLAN_JSON} onApprove={onApprove} onRequestChanges={onRequestChanges} />,
      );

      await user.click(screen.getByRole("button", { name: /change it/i }));
      expect(onRequestChanges).toHaveBeenCalledTimes(1);
      expect(onApprove).not.toHaveBeenCalled();
    });
  });

  describe("malformed JSON", () => {
    it("shows an error state instead of throwing", () => {
      render(<ArtifactPlanCard json="{{{" onApprove={vi.fn()} onRequestChanges={vi.fn()} />);
      expect(screen.getByText(/couldn't render this plan/i)).toBeInTheDocument();
    });

    it("rejects a plan with no summary", () => {
      expect(parseArtifactPlan(JSON.stringify({ kind: "chart", title: "T" }))).toBeNull();
    });

    it("rejects a plan with a blank title", () => {
      expect(parseArtifactPlan(JSON.stringify({ kind: "chart", title: " ", summary: "S." }))).toBeNull();
    });
  });

  describe("dispatch from a chat message", () => {
    it("renders a fenced ```artifact-plan block as a confirm card with the cost note", () => {
      render(
        <MessageContent
          content={"Want one?\n\n```artifact-plan\n" + PLAN_JSON + "\n```"}
          onSend={vi.fn()}
          onFocusComposer={vi.fn()}
        />,
      );
      expect(screen.getByText("Projectile range explorer")).toBeInTheDocument();
      expect(screen.getByText(COST_NOTE)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /build it/i })).toBeInTheDocument();
    });
  });
});
