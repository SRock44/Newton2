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

  it("under Tauri, signs in via the loopback-listener flow and hands the tokens to onSuccess", async () => {
    const tokens = { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 1000 };
    signInWithBrowser.mockResolvedValue(tokens);
    const onSuccess = vi.fn();

    const user = userEvent.setup();
    render(<LoginScreen onSuccess={onSuccess} />);
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(signInWithBrowser).toHaveBeenCalled();
    expect(beginWebSignIn).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith(tokens);
  });

  it("on the web, redirects via beginWebSignIn instead — never calls onSuccess directly (App.tsx picks the tokens up after the redirect)", async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    beginWebSignIn.mockImplementation(() => new Promise(() => {})); // never resolves, like a real redirect
    const onSuccess = vi.fn();

    const user = userEvent.setup();
    render(<LoginScreen onSuccess={onSuccess} />);
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(beginWebSignIn).toHaveBeenCalled();
    expect(signInWithBrowser).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("shows an error message if the Tauri sign-in flow throws", async () => {
    signInWithBrowser.mockRejectedValue(new ApiError("Sign-in failed: access_denied"));

    const user = userEvent.setup();
    render(<LoginScreen onSuccess={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in failed: access_denied");
  });
});
