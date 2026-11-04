import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginScreen from "../LoginScreen";
import { ApiError } from "../../api";

const signInWithBrowser = vi.fn();
const beginWebSignIn = vi.fn();
vi.mock("../../auth", () => ({
  signInWithBrowser: (...args: unknown[]) => signInWithBrowser(...args),
  beginWebSignIn: (...args: unknown[]) => beginWebSignIn(...args),
}));

describe("LoginScreen", () => {
  beforeEach(() => {
    signInWithBrowser.mockReset();
    beginWebSignIn.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, writable: true, configurable: true });
  });

  it("under Tauri, signs in via the loopback-listener flow (mode='login') and hands the tokens to onSuccess", async () => {
    const tokens = { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 1000 };
    signInWithBrowser.mockResolvedValue(tokens);
    const onSuccess = vi.fn();

    const user = userEvent.setup();
    render(<LoginScreen onSuccess={onSuccess} />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(signInWithBrowser).toHaveBeenCalledWith("login");
    expect(beginWebSignIn).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith(tokens);
  });

  it("on the web, redirects via beginWebSignIn (mode='login') instead — never calls onSuccess directly (App.tsx picks the tokens up after the redirect)", async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    beginWebSignIn.mockImplementation(() => new Promise(() => {})); // never resolves, like a real redirect
    const onSuccess = vi.fn();

    const user = userEvent.setup();
    render(<LoginScreen onSuccess={onSuccess} />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(beginWebSignIn).toHaveBeenCalledWith("login");
    expect(signInWithBrowser).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("'Create an account' signs in with mode='register' — Tauri", async () => {
    signInWithBrowser.mockImplementation(() => new Promise(() => {}));

    const user = userEvent.setup();
    render(<LoginScreen onSuccess={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /create an account/i }));

    expect(signInWithBrowser).toHaveBeenCalledWith("register");
  });

  it("'Create an account' signs in with mode='register' — web", async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    beginWebSignIn.mockImplementation(() => new Promise(() => {}));

    const user = userEvent.setup();
    render(<LoginScreen onSuccess={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /create an account/i }));

    expect(beginWebSignIn).toHaveBeenCalledWith("register");
  });

  it("shows an error message if the Tauri sign-in flow throws", async () => {
    signInWithBrowser.mockRejectedValue(new ApiError("Sign-in failed: access_denied"));

    const user = userEvent.setup();
    render(<LoginScreen onSuccess={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in failed: access_denied");
  });
});

// The marketing site (apps/website) links to apps/web with ?auth=register / ?auth=login
// so clicking "Sign Up"/"Sign In" there lands straight on the right real Keycloak form —
// no second click once you're already on this page.
describe("LoginScreen (web — auto-triggering from a ?auth= link)", () => {
  const realLocation = window.location;

  function stubLocationSearch(search: string) {
    Object.defineProperty(window, "location", {
      value: { ...realLocation, search },
      writable: true,
      configurable: true,
    });
  }

  beforeEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    signInWithBrowser.mockReset();
    beginWebSignIn.mockReset();
    beginWebSignIn.mockImplementation(() => new Promise(() => {}));
  });

  afterEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, writable: true, configurable: true });
    Object.defineProperty(window, "location", { value: realLocation, writable: true, configurable: true });
  });

  it("?auth=register auto-triggers registration with no click needed", async () => {
    stubLocationSearch("?auth=register");
    render(<LoginScreen onSuccess={vi.fn()} />);
    await vi.waitFor(() => expect(beginWebSignIn).toHaveBeenCalledWith("register"));
  });

  it("?auth=login auto-triggers sign-in with no click needed", async () => {
    stubLocationSearch("?auth=login");
    render(<LoginScreen onSuccess={vi.fn()} />);
    await vi.waitFor(() => expect(beginWebSignIn).toHaveBeenCalledWith("login"));
  });

  it("with no ?auth= param, does nothing automatically — the student has to click", async () => {
    stubLocationSearch("");
    render(<LoginScreen onSuccess={vi.fn()} />);
    await screen.findByRole("button", { name: "Sign in" });
    expect(beginWebSignIn).not.toHaveBeenCalled();
  });

  it("ignores an unrecognized ?auth= value rather than guessing", async () => {
    stubLocationSearch("?auth=something-else");
    render(<LoginScreen onSuccess={vi.fn()} />);
    await screen.findByRole("button", { name: "Sign in" });
    expect(beginWebSignIn).not.toHaveBeenCalled();
  });

  it("never auto-triggers under Tauri, even if ?auth= is somehow present", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, writable: true, configurable: true });
    stubLocationSearch("?auth=register");
    render(<LoginScreen onSuccess={vi.fn()} />);
    await screen.findByRole("button", { name: "Sign in" });
    expect(beginWebSignIn).not.toHaveBeenCalled();
    expect(signInWithBrowser).not.toHaveBeenCalled();
  });
});
