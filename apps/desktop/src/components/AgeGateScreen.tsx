import { useState } from "react";
import { ApiError, submitAgeConsent } from "../api";
import type { AccountConsentStatus, AgeBand } from "../types";
import NewtonMark from "./NewtonMark";

interface AgeGateScreenProps {
  token: string;
  onResolved: (status: AccountConsentStatus) => void;
}

/** First-pass minor-consent gate (ROADMAP.md Phase 7 -- see
 * docs/data-retention-and-privacy.md for the real design decision and its honest,
 * explicit gaps). Shown once per account, right after sign-in, before the rest of the
 * app renders (see App.tsx) -- and, unlike the local-only first-run onboarding card
 * (lib/onboarding.ts), gated on a real server-side field (users.consented_at) that's
 * checked on every sign-in, not just remembered in this browser profile.
 *
 * Deliberately NOT a finished COPPA compliance flow: choosing "Under 13" records that
 * answer (POST /account/age-consent) but does NOT unlock the app below. A student's own
 * click is self-attestation, not COPPA's required VERIFIABLE PARENTAL consent -- this
 * screen is honest about that instead of quietly pretending a checkbox is enough. See
 * the docs file for what a real implementation would still need. */
function AgeGateScreen({ token, onResolved }: AgeGateScreenProps) {
  const [submitting, setSubmitting] = useState<AgeBand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockedUnder13, setBlockedUnder13] = useState(false);

  async function choose(ageBand: AgeBand) {
    if (submitting) return;
    setError(null);
    setSubmitting(ageBand);
    try {
      const status = await submitAgeConsent(token, ageBand);
      if (status.needs_consent) {
        // True for "under_13" (see the module docstring above) -- also the safe
        // fallback if the backend ever disagrees with what was just clicked.
        setBlockedUnder13(true);
      } else {
        onResolved(status);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(null);
    }
  }

  if (blockedUnder13) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-brand">
            <span className="login-brand-mark">
              <NewtonMark size={22} />
            </span>
            <span className="login-brand-name">Newton</span>
          </div>
          <p className="login-tagline font-voice">Let's get a parent or guardian involved.</p>
          <p className="login-hint">
            Because you told us you're under 13, a parent or guardian needs to create and manage
            this account for you before you can start using Newton. Please have them get in touch
            with us so we can help set that up.
          </p>
          <button
            type="button"
            className="login-submit"
            onClick={() => setBlockedUnder13(false)}
          >
            That's not right — pick again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-brand-mark">
            <NewtonMark size={22} />
          </span>
          <span className="login-brand-name">Newton</span>
        </div>
        <p className="login-tagline font-voice">One quick question before you start.</p>
        <p className="login-hint">How old are you?</p>

        <button
          type="button"
          className="btn-primary login-submit"
          disabled={submitting !== null}
          onClick={() => choose("under_13")}
        >
          {submitting === "under_13" ? "Saving…" : "Under 13"}
        </button>
        <button
          type="button"
          className="btn-primary login-submit"
          disabled={submitting !== null}
          onClick={() => choose("13_17")}
        >
          {submitting === "13_17" ? "Saving…" : "13 to 17"}
        </button>
        <button
          type="button"
          className="btn-primary login-submit"
          disabled={submitting !== null}
          onClick={() => choose("18_plus")}
        >
          {submitting === "18_plus" ? "Saving…" : "18 or older"}
        </button>

        <p className="login-hint">
          We ask for an age range, not your exact birthdate, so we can meet legal requirements for
          younger students. See our privacy policy for details.
        </p>

        {error && (
          <div className="banner banner--error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

export default AgeGateScreen;
