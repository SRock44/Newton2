import { describe, it, expect, beforeEach } from "vitest";
import { hasSeenOnboarding, markOnboardingSeen } from "../onboarding";

describe("onboarding first-run tracking", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reports not-seen for an account that's never dismissed it", () => {
    expect(hasSeenOnboarding("user-1")).toBe(false);
  });

  it("reports seen after marking it, and only for that exact user id", () => {
    markOnboardingSeen("user-1");
    expect(hasSeenOnboarding("user-1")).toBe(true);
    expect(hasSeenOnboarding("user-2")).toBe(false);
  });
});
