import NewtonMark from "./NewtonMark";

interface ExamplePrompt {
  /** Short label shown on the button. */
  label: string;
  /** The exact text sent as a real chat message when clicked — must be something
   * Newton's actual tools can genuinely act on today, not an aspirational feature. */
  prompt: string;
}

// Each of these maps directly to a documented behavior in the Tutor's own system
// prompt (see services/api/app/agents/tutor.py's SYSTEM_PROMPT) and a real tool in the
// registry (services/api/app/tools/registry.py) — chosen specifically so a brand-new
// student's first click triggers an actual tool call (visible via the ToolActivity
// chips on the reply), not just a description of one. Deliberately avoids anything
// that needs an uploaded document or existing practice history to succeed (e.g.
// flashcard/practice-exam generation) since a first-run account has neither yet.
const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    label: "Solve an equation step by step",
    prompt: "Solve this step by step: 2x + 5 = 15",
  },
  {
    label: "Check my work",
    prompt: "Check my work: I said x = 4 solves 2x + 5 = 15. Is that right?",
  },
  {
    label: "Get a hint, not the answer",
    prompt: "I'm stuck on 3(x + 2) = 21 — can you give me a hint instead of the answer?",
  },
  {
    label: "What should I study first?",
    prompt: "What should I study first?",
  },
];

interface OnboardingWelcomeProps {
  /** Sends a real chat message through the exact same path as typing it into the
   * composer and hitting Enter — see App.tsx's handleSend. */
  onSend: (text: string) => void;
  /** Marks the welcome card seen (persisted locally, see lib/onboarding.ts) and hides
   * it. Called both by the dismiss button and by clicking any example prompt, so
   * acting on one is itself an acknowledgment — it never comes back after that. */
  onDismiss: () => void;
}

/** A brand-new student's very first empty chat, in place of the generic "Ask Newton
 * anything" placeholder (see ChatPane.tsx) — shown once per account (App.tsx tracks
 * this via lib/onboarding.ts) and never again after it's dismissed or acted on. Not a
 * modal: no backdrop, nothing blocks the composer below it, and a student who'd rather
 * just start typing can ignore it entirely. The whole point is to show a real tool call
 * happening on the very first click rather than describe Newton's capabilities in
 * prose — see the EXAMPLE_PROMPTS comment above for why each of these four was picked. */
function OnboardingWelcome({ onSend, onDismiss }: OnboardingWelcomeProps) {
  function handlePromptClick(prompt: string) {
    onSend(prompt);
    onDismiss();
  }

  return (
    <div className="onboarding-welcome fade-up">
      <button
        type="button"
        className="modal-close onboarding-welcome-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss welcome"
        title="Dismiss — I'll explore on my own"
      >
        ×
      </button>

      <div className="chat-empty-state-mark">
        <NewtonMark size={26} />
      </div>
      <h2>Welcome to Newton</h2>
      <p className="modal-subtitle onboarding-welcome-subtitle">
        Newton isn't just a chatbot — it verifies math with a real computer algebra
        system, checks your own work step by step, and knows what you're actually
        struggling with from your real study history. Try one below and watch it work,
        or just start typing.
      </p>

      <div className="onboarding-welcome-prompts">
        {EXAMPLE_PROMPTS.map((example) => (
          <button
            key={example.label}
            type="button"
            className="onboarding-prompt"
            onClick={() => handlePromptClick(example.prompt)}
          >
            <span className="onboarding-prompt-label">{example.label}</span>
            <span className="onboarding-prompt-text">{example.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default OnboardingWelcome;
