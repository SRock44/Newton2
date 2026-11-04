import { useEffect, useState } from "react";

interface TourStep {
  /** Matches a `data-tour="…"` attribute added to the real element being pointed at
   * (Sidebar.tsx's brand button, Composer.tsx's root div, ContextPanel.tsx's aside) —
   * never a synthetic/invented element, so this can never point at something that isn't
   * really there. */
  target: string;
  /** Which side of the target the popover opens toward — chosen per step to stay on
   * screen (the sidebar is on the left edge, so its popover opens right; the context
   * panel is on the right edge, so its popover opens left; the composer is at the
   * bottom, so its popover opens up). */
  placement: "right" | "left" | "top";
  title: string;
  body: string;
}

// Three stops, each tied to something a visitor can see change on screen, not prose
// about a feature — see App.tsx's own comment for why this exists at all (web-only,
// gated behind isTauri()) and lib/onboarding.ts's hasSeenTour for the "once per
// account, never nagged again" guarantee. Copy deliberately backs up the "Agentic
// Learning Environment" claim the marketing site makes with something concrete this
// screen can actually point at, rather than repeating the slogan.
const TOUR_STEPS: TourStep[] = [
  {
    target: "sidebar-brand",
    placement: "right",
    title: "This is Newton",
    body: "Not just a chat window — your courses, documents, and every past chat live here, and Newton actually acts on them.",
  },
  {
    target: "composer",
    placement: "top",
    title: "Ask anything — for real",
    body: "Newton solves with real tools — symbolic math, your own code, real citations — and checks its own work. That's what makes it agentic, not autocomplete.",
  },
  {
    target: "context-panel",
    placement: "left",
    title: "It remembers your semester",
    body: "Weak areas, due flashcards, what to review next — tracked here automatically as you study, not something you have to ask for.",
  },
];

const POPOVER_WIDTH = 300;
const GAP = 14;
// `top`-placement cards must sit ABOVE their target, which means their position depends
// on their own rendered height — not known until after layout. Rather than a two-pass
// measure-then-reposition render, this is a deliberate fixed estimate (comfortably
// covers this component's actual content: a 2-line body, title, and one button row)
// used to anchor the card's position directly rather than relying on a CSS transform
// for the offset — a transform here would collide with the entrance animation, which
// also animates `transform` (see the `tour-card-in` keyframes in App.css).
const POPOVER_ESTIMATED_HEIGHT = 170;

interface Placement {
  top: number;
  left: number;
  ringTop: number;
  ringLeft: number;
  ringWidth: number;
  ringHeight: number;
}

function computePlacement(step: TourStep): Placement | null {
  const el = document.querySelector(`[data-tour="${step.target}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top: number;
  let left: number;
  if (step.placement === "right") {
    left = rect.right + GAP;
    top = rect.top;
  } else if (step.placement === "left") {
    left = rect.left - POPOVER_WIDTH - GAP;
    top = rect.top;
  } else {
    left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
    top = rect.top - GAP - POPOVER_ESTIMATED_HEIGHT;
  }

  // Clamp to stay fully on screen regardless of window size or how close the target
  // sits to an edge — a popover that renders partly off-screen is worse than one that's
  // merely not perfectly adjacent to its target.
  left = Math.max(12, Math.min(left, vw - POPOVER_WIDTH - 12));
  top = Math.max(12, Math.min(top, vh - 12));

  return {
    top,
    left,
    ringTop: rect.top - 4,
    ringLeft: rect.left - 4,
    ringWidth: rect.width + 8,
    ringHeight: rect.height + 8,
  };
}

interface ProductTourProps {
  /** Called once, either after the last step's "Got it" or an explicit Skip — both mark
   * the tour permanently seen (App.tsx handles persisting that; this component never
   * touches localStorage itself). */
  onFinish: () => void;
}

/** A short, three-stop guided tour pointing at real UI chrome — web only (App.tsx only
 * ever mounts this behind `!isTauri()`), shown once per account, never a full-screen
 * blocking modal: the rest of the app stays fully usable and visible the whole time,
 * and Escape/Skip dismisses it for good at any point. Product owner, verbatim: "add
 * pop-ups for web... friendly-ai guide users... STYLED NICELY, NOT SOME ANNOYING ASS
 * SHIT" — "not annoying" here specifically means: never blocks input, never comes back
 * once dismissed, and quietly skips (or ends) rather than ever rendering a popover
 * pointing at nothing, if a target element isn't actually on screen for any reason
 * (e.g. the context panel is hidden behind an open document viewer). */
function ProductTour({ onFinish }: ProductTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [placement, setPlacement] = useState<Placement | null>(null);

  useEffect(() => {
    function recompute() {
      // Walk forward past any step whose target genuinely isn't on screen right now,
      // rather than ever showing a popover anchored to nothing. If none of the
      // remaining steps have a real target, there's nothing left to show.
      for (let i = stepIndex; i < TOUR_STEPS.length; i++) {
        const next = computePlacement(TOUR_STEPS[i]!);
        if (next) {
          if (i !== stepIndex) setStepIndex(i);
          setPlacement(next);
          return;
        }
      }
      onFinish();
    }
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onFinish();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onFinish]);

  if (!placement) return null;
  const step = TOUR_STEPS[stepIndex]!;
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  return (
    <div className="product-tour">
      <div
        className="product-tour-ring"
        style={{
          top: placement.ringTop,
          left: placement.ringLeft,
          width: placement.ringWidth,
          height: placement.ringHeight,
        }}
        aria-hidden="true"
      />
      <div
        className={`product-tour-card product-tour-card--${step.placement}`}
        style={{ top: placement.top, left: placement.left, width: POPOVER_WIDTH }}
        role="dialog"
        aria-label={step.title}
      >
        <p className="product-tour-step">
          {stepIndex + 1} of {TOUR_STEPS.length}
        </p>
        <h3 className="product-tour-title">{step.title}</h3>
        <p className="product-tour-body">{step.body}</p>
        <div className="product-tour-actions">
          <button type="button" className="product-tour-skip" onClick={onFinish}>
            Skip
          </button>
          <button
            type="button"
            className="product-tour-next"
            onClick={() => (isLast ? onFinish() : setStepIndex((i) => i + 1))}
          >
            {isLast ? "Got it" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProductTour;
