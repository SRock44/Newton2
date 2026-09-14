import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPanel from "../SettingsPanel";
import type { BillingStatus, ProModel } from "../../types";

const freeStatus: BillingStatus = {
  plan: "free",
  subscription_status: null,
  current_period_end: null,
  credits_used_cents: 0,
  credits_limit_cents: 500,
  credits_reset_at: null,
  preferred_pro_model: "model-a",
  free_generation_target: 5,
  pro_generation_target: 15,
  focus_mode_enabled: false,
  topup_credits_cents: 0,
  topup_tiers_cents: [500, 1000, 2500],
};

const proStatus: BillingStatus = {
  plan: "pro",
  subscription_status: "active",
  current_period_end: "2026-10-13T12:00:00Z",
  credits_used_cents: 750,
  credits_limit_cents: 1500,
  credits_reset_at: "2026-10-13T12:00:00Z",
  preferred_pro_model: "model-a",
  free_generation_target: 5,
  pro_generation_target: 15,
  focus_mode_enabled: false,
  topup_credits_cents: 460,
  topup_tiers_cents: [500, 1000, 2500],
};

const proModels: ProModel[] = [
  { id: "model-a", label: "Model A (default)" },
  { id: "model-b", label: "Model B" },
];

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    getBillingStatus: vi.fn(async () => freeStatus),
    getProModels: vi.fn(async () => proModels),
    createCheckoutSession: vi.fn(async () => "https://checkout.stripe.com/session123"),
    createPortalSession: vi.fn(async () => "https://billing.stripe.com/portal123"),
    createTopupCheckoutSession: vi.fn(async () => "https://checkout.stripe.com/topup123"),
    setPreferredProModel: vi.fn(async () => ({ ...proStatus, preferred_pro_model: "model-b" })),
    setFocusMode: vi.fn(async (_token: string, enabled: boolean) => ({ ...freeStatus, focus_mode_enabled: enabled })),
  };
});

const openUrl = vi.fn(async (_url: string) => undefined);
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => openUrl(url),
}));

import {
  ApiError,
  createCheckoutSession,
  createPortalSession,
  createTopupCheckoutSession,
  getBillingStatus,
  getProModels,
  setFocusMode,
  setPreferredProModel,
} from "../../api";

describe("SettingsPanel", () => {
  beforeEach(() => {
    vi.mocked(getBillingStatus).mockReset().mockResolvedValue(freeStatus);
    vi.mocked(getProModels).mockReset().mockResolvedValue(proModels);
    vi.mocked(createCheckoutSession).mockReset().mockResolvedValue("https://checkout.stripe.com/session123");
    vi.mocked(createPortalSession).mockReset().mockResolvedValue("https://billing.stripe.com/portal123");
    vi.mocked(createTopupCheckoutSession).mockReset().mockResolvedValue("https://checkout.stripe.com/topup123");
    vi.mocked(setPreferredProModel)
      .mockReset()
      .mockResolvedValue({ ...proStatus, preferred_pro_model: "model-b" });
    vi.mocked(setFocusMode)
      .mockReset()
      .mockImplementation(async (_token, enabled) => ({ ...freeStatus, focus_mode_enabled: enabled }));
    openUrl.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes via the close button", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SettingsPanel token="tok" username="sean" onClose={onClose} />);

    await screen.findByText("You're on the Free plan.");
    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it("shows the signed-in account name", async () => {
    render(<SettingsPanel token="tok" username="sean@rockwitz.com" onClose={vi.fn()} />);
    expect(await screen.findByText("sean@rockwitz.com")).toBeInTheDocument();
  });

  it("free plan: shows the upgrade button, which starts checkout and opens the URL", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);

    const upgradeBtn = await screen.findByRole("button", { name: /upgrade to pro/i });
    await user.click(upgradeBtn);

    await waitFor(() => expect(vi.mocked(createCheckoutSession)).toHaveBeenCalledWith("tok"));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://checkout.stripe.com/session123"));
    expect(await screen.findByText(/waiting for payment to complete/i)).toBeInTheDocument();
  });

  it("free plan: checkout polling picks up a plan flip to pro and stops waiting", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);

    const upgradeBtn = await screen.findByRole("button", { name: /upgrade to pro/i });
    await user.click(upgradeBtn);
    await screen.findByText(/waiting for payment to complete/i);

    vi.mocked(getBillingStatus).mockResolvedValue(proStatus);

    await vi.advanceTimersByTimeAsync(3000);

    expect(await screen.findByText(/pro plan/i)).toBeInTheDocument();
    expect(screen.queryByText(/waiting for payment to complete/i)).not.toBeInTheDocument();
  });

  it("shows a graceful message when checkout isn't configured (503) instead of crashing", async () => {
    vi.mocked(createCheckoutSession).mockRejectedValue(new ApiError("Pro isn't available on this server yet."));
    const user = userEvent.setup();
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);

    const upgradeBtn = await screen.findByRole("button", { name: /upgrade to pro/i });
    await user.click(upgradeBtn);

    expect(await screen.findByText("Pro isn't available on this server yet.")).toBeInTheDocument();
    expect(openUrl).not.toHaveBeenCalled();
    // Still usable — the upgrade button is back, not stuck in a broken state.
    expect(screen.getByRole("button", { name: /upgrade to pro/i })).toBeEnabled();
  });

  it("pro plan: shows status, formatted renewal date, and credits used", async () => {
    vi.mocked(getBillingStatus).mockResolvedValue(proStatus);
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);

    expect(await screen.findByText(/pro plan · active/i)).toBeInTheDocument();
    expect(screen.getByText(/renews october 13, 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/\$7\.50 of \$15\.00 used this period/i)).toBeInTheDocument();
  });

  it("pro plan: manage billing opens the portal URL", async () => {
    vi.mocked(getBillingStatus).mockResolvedValue(proStatus);
    const user = userEvent.setup();
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);

    const manageBtn = await screen.findByRole("button", { name: /manage billing/i });
    await user.click(manageBtn);

    await waitFor(() => expect(vi.mocked(createPortalSession)).toHaveBeenCalledWith("tok"));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://billing.stripe.com/portal123"));
  });

  it("free plan: the model picker is visible and its options are enabled", async () => {
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);

    await screen.findByText("You're on the Free plan.");
    expect(await screen.findByText("Model A (default)")).toBeInTheDocument();
    expect(screen.getByText("Model B")).toBeInTheDocument();
    for (const radio of screen.getAllByRole("radio", { name: /model/i })) {
      expect(radio).toBeEnabled();
    }
  });

  it("free plan: clicking a model option shows the Pro upsell message and saves nothing", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);

    await screen.findByText("You're on the Free plan.");
    await user.click(screen.getByRole("radio", { name: "Model B" }));

    expect(await screen.findByText(/pro feature/i)).toBeInTheDocument();
    expect(screen.getByText(/automatically using model a/i)).toBeInTheDocument();
    expect(setPreferredProModel).not.toHaveBeenCalled();
    // The click never actually changes the selection — a free plan always reflects the
    // resolved default, never an unpersisted pick.
    expect(screen.getByRole("radio", { name: "Model A (default)" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Model B" })).not.toBeChecked();
  });

  it("pro plan: lists pro models with the current selection checked", async () => {
    vi.mocked(getBillingStatus).mockResolvedValue(proStatus);
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);

    await screen.findByText(/pro plan/i);
    expect(await screen.findByText("Model A (default)")).toBeInTheDocument();
    expect(screen.getByText("Model B")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Model A (default)" })).toBeChecked();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });

  it("pro plan: selecting a model saves it and reflects the new selection", async () => {
    vi.mocked(getBillingStatus).mockResolvedValue(proStatus);
    const user = userEvent.setup();
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);

    await screen.findByText(/pro plan/i);
    await user.click(screen.getByRole("radio", { name: "Model B" }));

    await waitFor(() => expect(vi.mocked(setPreferredProModel)).toHaveBeenCalledWith("tok", "model-b"));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Model B" })).toBeChecked());
    expect(screen.getByRole("radio", { name: "Model A (default)" })).not.toBeChecked();
    expect(screen.queryByText(/pro feature/i)).not.toBeInTheDocument();
  });

  it("pro plan: shows an error if saving the model preference fails", async () => {
    vi.mocked(getBillingStatus).mockResolvedValue(proStatus);
    vi.mocked(setPreferredProModel).mockRejectedValue(new ApiError("Couldn't save your model preference."));
    const user = userEvent.setup();
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);

    await screen.findByText(/pro plan/i);
    await user.click(screen.getByRole("radio", { name: "Model B" }));

    expect(await screen.findByText("Couldn't save your model preference.")).toBeInTheDocument();
    // Selection reverts to whatever billing status last confirmed, since the save failed.
    expect(screen.getByRole("radio", { name: "Model A (default)" })).toBeChecked();
  });

  it("toggles the study reminders preference", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);
    await screen.findByText("You're on the Free plan.");

    const toggle = screen.getByRole("checkbox", { name: /study reminders/i });
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(toggle).not.toBeChecked();
  });

  it("focus mode: unchecked by default and persists turning it on via the backend", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);
    await screen.findByText("You're on the Free plan.");

    const toggle = screen.getByRole("checkbox", { name: /focus mode/i });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    await waitFor(() => expect(vi.mocked(setFocusMode)).toHaveBeenCalledWith("tok", true));
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("focus mode: persists turning it off via the backend", async () => {
    vi.mocked(getBillingStatus).mockResolvedValue({ ...freeStatus, focus_mode_enabled: true });
    const user = userEvent.setup();
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);
    await screen.findByText("You're on the Free plan.");

    const toggle = screen.getByRole("checkbox", { name: /focus mode/i });
    expect(toggle).toBeChecked();

    await user.click(toggle);

    await waitFor(() => expect(vi.mocked(setFocusMode)).toHaveBeenCalledWith("tok", false));
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it("focus mode: available (not gated) on the free plan, same as Pro", async () => {
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);
    await screen.findByText("You're on the Free plan.");

    expect(screen.getByRole("checkbox", { name: /focus mode/i })).toBeEnabled();
  });

  it("focus mode: reverts the toggle and shows an error when saving fails", async () => {
    vi.mocked(setFocusMode).mockRejectedValue(new ApiError("Couldn't save your Focus Mode setting."));
    const user = userEvent.setup();
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);
    await screen.findByText("You're on the Free plan.");

    const toggle = screen.getByRole("checkbox", { name: /focus mode/i });
    await user.click(toggle);

    expect(await screen.findByText("Couldn't save your Focus Mode setting.")).toBeInTheDocument();
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it("top-up: shows the current balance and a button per tier", async () => {
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);
    await screen.findByText("You're on the Free plan.");

    expect(await screen.findByText(/top-up balance: \$0\.00/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ $5.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ $10.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ $25.00" })).toBeInTheDocument();
  });

  it("top-up: available on the free plan (no Pro subscription required)", async () => {
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);
    await screen.findByText("You're on the Free plan.");

    const button = screen.getByRole("button", { name: "+ $10.00" });
    expect(button).toBeEnabled();
  });

  it("top-up: clicking a tier starts checkout for that amount and opens the URL", async () => {
    const user = userEvent.setup();
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);
    await screen.findByText("You're on the Free plan.");

    await user.click(screen.getByRole("button", { name: "+ $10.00" }));

    await waitFor(() => expect(vi.mocked(createTopupCheckoutSession)).toHaveBeenCalledWith("tok", 1000));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://checkout.stripe.com/topup123"));
    expect(await screen.findByText(/waiting for payment to complete/i)).toBeInTheDocument();
  });

  it("top-up: polling picks up a balance increase and stops waiting", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);
    await screen.findByText("You're on the Free plan.");

    await user.click(screen.getByRole("button", { name: "+ $5.00" }));
    await screen.findByText(/waiting for payment to complete/i);

    vi.mocked(getBillingStatus).mockResolvedValue({ ...freeStatus, topup_credits_cents: 460 });

    await vi.advanceTimersByTimeAsync(3000);

    expect(await screen.findByText(/top-up balance: \$4\.60/i)).toBeInTheDocument();
    expect(screen.queryByText(/waiting for payment to complete/i)).not.toBeInTheDocument();
  });

  it("top-up: shows a graceful message when checkout isn't configured (503) instead of crashing", async () => {
    vi.mocked(createTopupCheckoutSession).mockRejectedValue(
      new ApiError("Adding credits isn't available on this server yet."),
    );
    const user = userEvent.setup();
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);
    await screen.findByText("You're on the Free plan.");

    await user.click(screen.getByRole("button", { name: "+ $5.00" }));

    expect(await screen.findByText("Adding credits isn't available on this server yet.")).toBeInTheDocument();
    expect(openUrl).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "+ $5.00" })).toBeEnabled();
  });

  it("top-up: pro plan also shows the balance and tier buttons", async () => {
    vi.mocked(getBillingStatus).mockResolvedValue(proStatus);
    render(<SettingsPanel token="tok" username="sean" onClose={vi.fn()} />);

    expect(await screen.findByText(/top-up balance: \$4\.60/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ $25.00" })).toBeInTheDocument();
  });
});
