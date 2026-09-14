import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ApiError,
  createCheckoutSession,
  createPortalSession,
  createTopupCheckoutSession,
  getBillingStatus,
  getProModels,
  setFocusMode,
  setPreferredProModel,
} from "../api";
import type { BillingStatus, ProModel } from "../types";
import { getStudyRemindersEnabled, setStudyRemindersEnabled } from "../lib/preferences";

interface SettingsPanelProps {
  token: string;
  username: string;
  onClose: () => void;
}

const CHECKOUT_POLL_INTERVAL_MS = 3000;
const CHECKOUT_POLL_TIMEOUT_MS = 2 * 60 * 1000;

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Account identity, plan/billing, and light local preferences — three sections
 * behind one settings entry point, same modal chrome as every other panel. Checkout
 * and the billing portal are both Stripe-hosted pages opened in the system browser
 * (see auth.ts's signInWithBrowser and StudyPlanPanel's Classroom connect for the same
 * "open a URL, then poll until the backend reflects it" pattern) — there's no clean
 * redirect-back to a desktop app, so upgrading polls getBillingStatus() for a while
 * afterward instead of making the student manually refresh. */
function SettingsPanel({ token, username, onClose }: SettingsPanelProps) {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [proModels, setProModels] = useState<ProModel[]>([]);

  const [startingCheckout, setStartingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [waitingForCheckout, setWaitingForCheckout] = useState(false);
  const pollRef = useRef<{ interval: number; timeout: number } | null>(null);

  const [openingPortal, setOpeningPortal] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const [savingModel, setSavingModel] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [showFreeModelNotice, setShowFreeModelNotice] = useState(false);

  const [remindersEnabled, setRemindersEnabled] = useState(getStudyRemindersEnabled);

  const [savingFocusMode, setSavingFocusMode] = useState(false);
  const [focusModeError, setFocusModeError] = useState<string | null>(null);

  // Top-up credit purchase -- same "open a Stripe Checkout URL in the system browser,
  // then poll getBillingStatus() until it reflects the purchase" pattern as the Pro
  // upgrade flow above (handleUpgrade/pollRef), just tracking a balance INCREASE rather
  // than a plan flip. `startingTopup` holds the specific tier (in cents) currently
  // starting checkout, so only that one button shows a "Starting…" state.
  const [startingTopup, setStartingTopup] = useState<number | null>(null);
  const [topupError, setTopupError] = useState<string | null>(null);
  const [waitingForTopup, setWaitingForTopup] = useState(false);
  const topupPollRef = useRef<{ interval: number; timeout: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBillingStatus(token)
      .then((status) => {
        if (!cancelled) setBilling(status);
      })
      .catch((err) => {
        if (!cancelled) setBillingError(err instanceof ApiError ? err.message : "Couldn't load your plan.");
      })
      .finally(() => {
        if (!cancelled) setBillingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    getProModels(token)
      .then((models) => {
        if (!cancelled) setProModels(models);
      })
      .catch(() => {
        // Non-fatal — if this fails, the picker section just doesn't render (guarded by
        // proModels.length > 0 below) rather than breaking the rest of Settings.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Cancel any in-flight checkout poll the moment this panel unmounts — closing the
  // panel (App.tsx conditionally renders SettingsPanel on `showSettings`) is exactly
  // how a student "cancels" waiting for payment, since there's nothing that would
  // otherwise stop it short of the timeout.
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current.interval);
        window.clearTimeout(pollRef.current.timeout);
      }
      if (topupPollRef.current) {
        window.clearInterval(topupPollRef.current.interval);
        window.clearTimeout(topupPollRef.current.timeout);
      }
    };
  }, []);

  function stopCheckoutPoll() {
    if (pollRef.current) {
      window.clearInterval(pollRef.current.interval);
      window.clearTimeout(pollRef.current.timeout);
      pollRef.current = null;
    }
    setWaitingForCheckout(false);
  }

  function stopTopupPoll() {
    if (topupPollRef.current) {
      window.clearInterval(topupPollRef.current.interval);
      window.clearTimeout(topupPollRef.current.timeout);
      topupPollRef.current = null;
    }
    setWaitingForTopup(false);
  }

  async function handleUpgrade() {
    if (startingCheckout || waitingForCheckout) return;
    setStartingCheckout(true);
    setCheckoutError(null);
    try {
      const checkoutUrl = await createCheckoutSession(token);
      await openUrl(checkoutUrl);
      setWaitingForCheckout(true);

      const interval = window.setInterval(async () => {
        try {
          const status = await getBillingStatus(token);
          setBilling(status);
          if (status.plan === "pro") stopCheckoutPoll();
        } catch {
          // A single failed check shouldn't abort the wait — keep polling.
        }
      }, CHECKOUT_POLL_INTERVAL_MS);

      const timeout = window.setTimeout(stopCheckoutPoll, CHECKOUT_POLL_TIMEOUT_MS);
      pollRef.current = { interval, timeout };
    } catch (err) {
      setCheckoutError(err instanceof ApiError ? err.message : "Couldn't start checkout.");
    } finally {
      setStartingCheckout(false);
    }
  }

  async function handleManageBilling() {
    if (openingPortal) return;
    setOpeningPortal(true);
    setPortalError(null);
    try {
      const portalUrl = await createPortalSession(token);
      await openUrl(portalUrl);
    } catch (err) {
      setPortalError(err instanceof ApiError ? err.message : "Couldn't open the billing portal.");
    } finally {
      setOpeningPortal(false);
    }
  }

  /** Starts a one-time Checkout purchase for one of billing.topup_tiers_cents. Available
   * on every plan, free or Pro -- a top-up balance is real spendable credit, not tied to
   * a Pro subscription (see app/services/billing.py's frontier_access_available). Same
   * "open in system browser, then poll until the backend reflects it" shape as
   * handleUpgrade, but watching for the balance to actually go up rather than a plan
   * flip -- the webhook that credits it can land a moment after the browser tab closes. */
  async function handleAddCredits(amountCents: number) {
    if (startingTopup !== null || waitingForTopup || !billing) return;
    const balanceBeforePurchase = billing.topup_credits_cents;
    setStartingTopup(amountCents);
    setTopupError(null);
    try {
      const checkoutUrl = await createTopupCheckoutSession(token, amountCents);
      await openUrl(checkoutUrl);
      setWaitingForTopup(true);

      const interval = window.setInterval(async () => {
        try {
          const status = await getBillingStatus(token);
          setBilling(status);
          if (status.topup_credits_cents > balanceBeforePurchase) stopTopupPoll();
        } catch {
          // A single failed check shouldn't abort the wait — keep polling.
        }
      }, CHECKOUT_POLL_INTERVAL_MS);

      const timeout = window.setTimeout(stopTopupPoll, CHECKOUT_POLL_TIMEOUT_MS);
      topupPollRef.current = { interval, timeout };
    } catch (err) {
      setTopupError(err instanceof ApiError ? err.message : "Couldn't start checkout.");
    } finally {
      setStartingTopup(null);
    }
  }

  /** Free users can see and click the model picker (product requirement — it must not
   * be hidden), but a free plan can never actually persist a choice (the backend rejects
   * it with a 402 regardless), so this deliberately never calls the save endpoint for
   * them — no point making a request known to be rejected. Instead it surfaces a local,
   * factual upsell note next to the picker. Pro users actually save their pick. */
  async function handleSelectModel(modelId: string) {
    if (!isPro) {
      setShowFreeModelNotice(true);
      return;
    }
    if (savingModel) return;
    setSavingModel(modelId);
    setModelError(null);
    try {
      const status = await setPreferredProModel(token, modelId);
      setBilling(status);
    } catch (err) {
      setModelError(err instanceof ApiError ? err.message : "Couldn't save your model preference.");
    } finally {
      setSavingModel(null);
    }
  }

  function handleToggleReminders(enabled: boolean) {
    setRemindersEnabled(enabled);
    setStudyRemindersEnabled(enabled);
  }

  /** Focus Mode (see types.ts's BillingStatus.focus_mode_enabled) is real, persisted,
   * server-side state -- not a local-only preference like study reminders -- since the
   * Tutor's own backend behavior (Socratic-only prompting, blocking write_research_paper)
   * depends on it. Optimistically flips the checkbox, then reconciles with the backend's
   * response; on failure, reverts to the last known-good server value rather than
   * leaving the UI showing a state that never actually saved. Available to every
   * signed-in user regardless of plan -- see setFocusMode's own doc comment. */
  async function handleToggleFocusMode(enabled: boolean) {
    if (savingFocusMode || !billing) return;
    const previous = billing;
    setBilling({ ...billing, focus_mode_enabled: enabled });
    setSavingFocusMode(true);
    setFocusModeError(null);
    try {
      const status = await setFocusMode(token, enabled);
      setBilling(status);
    } catch (err) {
      setBilling(previous);
      setFocusModeError(err instanceof ApiError ? err.message : "Couldn't save your Focus Mode setting.");
    } finally {
      setSavingFocusMode(false);
    }
  }

  const isPro = billing?.plan === "pro";
  const defaultModelLabel = (
    proModels.find((m) => m.id === billing?.preferred_pro_model)?.label ?? "DeepSeek V4 Flash"
  ).replace(/\s*\(default\)\s*$/i, "");
  const creditsPct =
    billing && billing.credits_limit_cents > 0
      ? Math.min(100, (billing.credits_used_cents / billing.credits_limit_cents) * 100)
      : 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <section className="settings-section">
          <h3 className="settings-section-title">Account</h3>
          <div className="settings-account-name">{username}</div>
        </section>

        <section className="settings-section">
          <h3 className="settings-section-title">Plan &amp; billing</h3>

          {billingLoading && <p className="panel-loading">Loading…</p>}
          {billingError && <div className="banner banner--error">{billingError}</div>}

          {billing && !isPro && (
            <div className="settings-plan">
              <p className="settings-plan-line">You're on the Free plan.</p>
              {checkoutError && <div className="banner banner--error">{checkoutError}</div>}
              {waitingForCheckout ? (
                <p className="settings-waiting">Waiting for payment to complete…</p>
              ) : (
                <button type="button" className="btn-primary" onClick={handleUpgrade} disabled={startingCheckout}>
                  {startingCheckout ? "Starting checkout…" : "Upgrade to Pro — $15/mo"}
                </button>
              )}
            </div>
          )}

          {billing && isPro && (
            <div className="settings-plan">
              <div className="settings-plan-status">
                <span className="classroom-connect-dot" aria-hidden="true" />
                Pro plan{billing.subscription_status ? ` · ${billing.subscription_status}` : ""}
              </div>
              {billing.current_period_end && (
                <p className="settings-plan-line">Renews {formatDate(billing.current_period_end)}</p>
              )}

              <div className="progress-bar-track">
                <div className="progress-bar-fill" style={{ width: `${creditsPct}%` }} />
              </div>
              <div className="progress-bar-caption">
                {formatCents(billing.credits_used_cents)} of {formatCents(billing.credits_limit_cents)} used this
                period
                {billing.credits_reset_at ? ` · resets ${formatDate(billing.credits_reset_at)}` : ""}
              </div>

              {portalError && <div className="banner banner--error">{portalError}</div>}
              <button type="button" className="btn-secondary" onClick={handleManageBilling} disabled={openingPortal}>
                {openingPortal ? "Opening…" : "Manage billing"}
              </button>
            </div>
          )}

          {/* Visible to every signed-in user, Pro or free — a free user can see and
              click these options (product requirement: never hide it), but only a Pro
              plan actually saves a selection. See handleSelectModel. */}
          {billing && proModels.length > 0 && (
            <div className="settings-models">
              <div className="settings-models-title">Preferred frontier model</div>
              <div className="settings-model-list">
                {proModels.map((model) => (
                  <label key={model.id} className="settings-model-option">
                    <input
                      type="radio"
                      name="pro-model"
                      value={model.id}
                      checked={billing.preferred_pro_model === model.id}
                      disabled={isPro && savingModel !== null}
                      onChange={() => handleSelectModel(model.id)}
                    />
                    {model.label}
                  </label>
                ))}
              </div>
              {isPro ? (
                <>
                  {savingModel && <p className="settings-waiting">Saving…</p>}
                  {modelError && <div className="banner banner--error">{modelError}</div>}
                </>
              ) : (
                showFreeModelNotice && (
                  <p className="settings-note">
                    Choosing a model is a Pro feature. You're automatically using {defaultModelLabel} — a great
                    free default.
                  </p>
                )
              )}
            </div>
          )}

          {/* Real, purchased, non-expiring credit balance -- separate from the Pro
              monthly allowance shown above. Visible and usable on every plan, free or
              Pro (see app/services/billing.py's frontier_access_available). */}
          {billing && (
            <div className="settings-topup">
              <div className="settings-models-title">Add credits</div>
              <p className="settings-plan-line">
                Top-up balance: {formatCents(billing.topup_credits_cents)}
              </p>
              {topupError && <div className="banner banner--error">{topupError}</div>}
              {waitingForTopup ? (
                <p className="settings-waiting">Waiting for payment to complete…</p>
              ) : (
                <div className="settings-topup-tiers">
                  {billing.topup_tiers_cents.map((amountCents) => (
                    <button
                      key={amountCents}
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleAddCredits(amountCents)}
                      disabled={startingTopup !== null}
                    >
                      {startingTopup === amountCents ? "Starting…" : `+ ${formatCents(amountCents)}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="settings-section settings-section--last">
          <h3 className="settings-section-title">Preferences</h3>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={remindersEnabled}
              onChange={(e) => handleToggleReminders(e.target.checked)}
            />
            <span>
              <span className="settings-toggle-label">Study reminders</span>
              <span className="settings-toggle-desc">
                Notify me when flashcards or study plan items are due soon.
              </span>
            </span>
          </label>

          {/* Self-service Focus Mode -- a student opting THEMSELVES into a stricter
              standard, never a teacher/guardian-administered control (this app has no
              such account concept). Unlike Study reminders above, this is real,
              persisted, server-side state (see handleToggleFocusMode) because it
              actually changes how the Tutor behaves and blocks write_research_paper --
              not just a client-side notification preference. */}
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={billing?.focus_mode_enabled ?? false}
              disabled={!billing || savingFocusMode}
              onChange={(e) => handleToggleFocusMode(e.target.checked)}
            />
            <span>
              <span className="settings-toggle-label">Focus Mode</span>
              <span className="settings-toggle-desc">
                Socratic-only tutoring, no full paper drafts — guiding questions instead of direct answers until
                you've made a real attempt.
              </span>
            </span>
          </label>
          {savingFocusMode && <p className="settings-waiting">Saving…</p>}
          {focusModeError && <div className="banner banner--error">{focusModeError}</div>}
        </section>
      </div>
    </div>
  );
}

export default SettingsPanel;
