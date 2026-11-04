import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api";
import { beginWebSignIn, signInWithBrowser } from "../auth";
import type { SignInMode, TokenSet } from "../auth";
import { isTauri } from "../lib/platform";
import NewtonMark from "./NewtonMark";

interface LoginScreenProps {
  onSuccess: (tokens: TokenSet) => void;
}

function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  async function handleSignIn(mode: SignInMode) {
    if (signingIn) return;
    setError(null);
    setSigningIn(true);
    try {
      if (isTauri()) {
        const tokens = await signInWithBrowser(mode);
        onSuccess(tokens);
      } else {
        // Navigates the whole page away to Keycloak's hosted login/register form —
        // never resolves in the normal case. App.tsx's bootstrap effect picks the
        // tokens back up via completeWebSignIn() once Keycloak redirects back;
        // onSuccess is called from there instead, not here.
        await beginWebSignIn(mode);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSigningIn(false);
    }
  }

  // apps/web only: the marketing site's "Sign Up"/"Sign In" buttons link here with
  // ?auth=register / ?auth=login (NEXT_PUBLIC_APP_URL in apps/website) so clicking one
  // there lands straight on the right real Keycloak form, no extra click needed once
  // you're already here. autoTriggerRanRef guards against React.StrictMode's deliberate
  // double-invocation of effects in development re-running this (see App.tsx's
  // bootstrapRanRef for the fuller story of why a plain useEffect isn't safe here).
  const autoTriggerRanRef = useRef(false);
  useEffect(() => {
    if (autoTriggerRanRef.current) return;
    autoTriggerRanRef.current = true;
    if (isTauri()) return;
    const requested = new URLSearchParams(window.location.search).get("auth");
    if (requested === "register" || requested === "login") {
      void handleSignIn(requested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-brand-mark">
            <NewtonMark size={22} />
          </span>
          <span className="login-brand-name">Newton</span>
        </div>
        <p className="login-tagline font-voice">Your agentic learning environment.</p>

        <button
          type="button"
          className="btn-primary login-submit"
          onClick={() => handleSignIn("login")}
          disabled={signingIn}
        >
          {signingIn ? "Opening browser…" : "Sign in"}
        </button>
        <p className="login-hint">
          Opens your browser to sign in with Google, or with email and password —
          whichever you've set up.
        </p>

        <button
          type="button"
          className="login-create-account"
          onClick={() => handleSignIn("register")}
          disabled={signingIn}
        >
          New here? Create an account
        </button>

        {error && (
          <div className="banner banner--error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

export default LoginScreen;
