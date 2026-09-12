import { useState } from "react";
import { ApiError } from "../api";
import { signInWithBrowser } from "../auth";
import type { TokenSet } from "../auth";

interface LoginScreenProps {
  onSuccess: (tokens: TokenSet) => void;
}

function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  async function handleSignIn() {
    if (signingIn) return;
    setError(null);
    setSigningIn(true);
    try {
      const tokens = await signInWithBrowser();
      onSuccess(tokens);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-brand-mark" aria-hidden="true">
            N
          </span>
          <span className="login-brand-name">Newton</span>
        </div>
        <p className="login-tagline">Your agentic learning environment.</p>

        <button type="button" className="login-submit" onClick={handleSignIn} disabled={signingIn}>
          {signingIn ? "Opening browser…" : "Sign in"}
        </button>
        <p className="login-hint">
          Opens your browser to sign in with Google, or with email and password —
          whichever you've set up.
        </p>

        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

export default LoginScreen;
