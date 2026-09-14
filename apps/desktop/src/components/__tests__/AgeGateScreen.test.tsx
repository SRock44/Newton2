import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "../../api";
import AgeGateScreen from "../AgeGateScreen";

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    submitAgeConsent: vi.fn(),
  };
});

import { submitAgeConsent } from "../../api";

describe("AgeGateScreen", () => {
  beforeEach(() => {
    vi.mocked(submitAgeConsent).mockClear();
  });

  it("asks the age question with three options", () => {
    render(<AgeGateScreen token="tok" onResolved={vi.fn()} />);
    expect(screen.getByText(/how old are you/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Under 13" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "13 to 17" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "18 or older" })).toBeInTheDocument();
  });

  it("calls onResolved with the real backend status once a 13-17 answer succeeds", async () => {
    const status = { age_band: "13_17" as const, consented_at: "2026-09-14T00:00:00Z", needs_consent: false };
    vi.mocked(submitAgeConsent).mockResolvedValueOnce(status);
    const onResolved = vi.fn();
    const user = userEvent.setup();
    render(<AgeGateScreen token="tok" onResolved={onResolved} />);

    await user.click(screen.getByRole("button", { name: "13 to 17" }));

    expect(submitAgeConsent).toHaveBeenCalledWith("tok", "13_17");
    expect(onResolved).toHaveBeenCalledWith(status);
  });

  it("shows the parent/guardian message and never calls onResolved for under 13", async () => {
    vi.mocked(submitAgeConsent).mockResolvedValueOnce({
      age_band: "under_13",
      consented_at: null,
      needs_consent: true,
    });
    const onResolved = vi.fn();
    const user = userEvent.setup();
    render(<AgeGateScreen token="tok" onResolved={onResolved} />);

    await user.click(screen.getByRole("button", { name: "Under 13" }));

    expect(await screen.findByText(/needs to create and manage this account/i)).toBeInTheDocument();
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("lets a student who misclicked 'Under 13' go back and pick again", async () => {
    vi.mocked(submitAgeConsent).mockResolvedValueOnce({
      age_band: "under_13",
      consented_at: null,
      needs_consent: true,
    });
    const user = userEvent.setup();
    render(<AgeGateScreen token="tok" onResolved={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Under 13" }));
    await screen.findByText(/needs to create and manage this account/i);

    await user.click(screen.getByRole("button", { name: /pick again/i }));

    expect(screen.getByText(/how old are you/i)).toBeInTheDocument();
  });

  it("shows an error banner and does not call onResolved when the request fails", async () => {
    vi.mocked(submitAgeConsent).mockRejectedValueOnce(new ApiError("Couldn't save that."));
    const onResolved = vi.fn();
    const user = userEvent.setup();
    render(<AgeGateScreen token="tok" onResolved={onResolved} />);

    await user.click(screen.getByRole("button", { name: "18 or older" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save that.");
    expect(onResolved).not.toHaveBeenCalled();
  });
});
