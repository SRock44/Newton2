const SEEN_KEY_PREFIX = "newton:onboarding-seen:";

/** Whether this browser profile has already dismissed (or acted on) the first-run
 * welcome card for the given user — see OnboardingWelcome.tsx / App.tsx. Keyed by user
 * id so a shared machine with multiple Newton accounts doesn't silently mark a second
 * student's first sign-in as "already seen." Deliberately local-only (not synced to the
 * backend): this is a one-time UI nicety, not something that needs to survive a
 * reinstall or follow the student to a different device. */
export function hasSeenOnboarding(userId: string): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY_PREFIX + userId) === "1";
  } catch {
    // Storage unavailable — fail toward not nagging a student with a broken browser
    // profile rather than showing the welcome card on every single sign-in.
    return true;
  }
}

export function markOnboardingSeen(userId: string): void {
  try {
    window.localStorage.setItem(SEEN_KEY_PREFIX + userId, "1");
  } catch {
    // Best-effort only — worst case they see the welcome card again next time.
  }
}

const TOUR_SEEN_KEY_PREFIX = "newton:tour-seen:";

/** Same pattern as hasSeenOnboarding/markOnboardingSeen above, for the separate
 * guided-tour coachmarks (ProductTour.tsx, web only) that point at the sidebar/
 * composer/context panel rather than the empty-chat welcome card. Kept as its own key
 * rather than reusing SEEN_KEY_PREFIX: the two are dismissed independently (a student
 * can act on a suggested prompt — dismissing onboarding — well before clicking through
 * the tour, or vice versa on a rare race), and a future reset of one shouldn't silently
 * reset the other. */
export function hasSeenTour(userId: string): boolean {
  try {
    return window.localStorage.getItem(TOUR_SEEN_KEY_PREFIX + userId) === "1";
  } catch {
    return true;
  }
}

export function markTourSeen(userId: string): void {
  try {
    window.localStorage.setItem(TOUR_SEEN_KEY_PREFIX + userId, "1");
  } catch {
    // Best-effort only — worst case they see the tour again next time.
  }
}
