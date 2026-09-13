import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ApiError, createCheckoutSession, createPortalSession, getBillingStatus, getProModels } from "../api";
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

  const [remindersEnabled, setRemindersEnabled] = useState(getStudyRemindersEnabled);

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
        // Non-fatal — this list is informational only; Pro users just won't see it.
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

  function handleToggleReminders(enabled: boolean) {
    setRemindersEnabled(enabled);
    setStudyRemindersEnabled(enabled);
  }

  const isPro = billing?.plan === "pro";
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

              {proModels.length > 0 && (
                <div className="settings-models">
                  <div className="settings-models-title">Preferred frontier model</div>
                  <div className="settings-model-list">
                    {proModels.map((model) => (
                      <label key={model.id} className="settings-model-option">
                        <input type="radio" name="pro-model" value={model.id} disabled />
                        {model.label}
                      </label>
                    ))}
                  </div>
                  <p className="settings-note">Model selection is coming soon — this doesn't save yet.</p>
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
        </section>
      </div>
    </div>
  );
}

export default SettingsPanel;
