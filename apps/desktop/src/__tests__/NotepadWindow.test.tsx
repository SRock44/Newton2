import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import NotepadWindow from "../NotepadWindow";

const listeners: Record<string, Array<(event: { payload: unknown }) => void>> = {};

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, callback: (event: { payload: unknown }) => void) => {
    (listeners[event] ??= []).push(callback);
    return Promise.resolve(() => {
      listeners[event] = (listeners[event] ?? []).filter((cb) => cb !== callback);
    });
  }),
}));

function fireSync(json: string | null) {
  (listeners["notepad-sync"] ?? []).forEach((cb) => cb({ payload: { json } }));
}

describe("NotepadWindow", () => {
  it("shows a waiting message before any content has synced", () => {
    render(<NotepadWindow />);
    expect(screen.getByText(/Waiting for a step-by-step derivation/)).toBeInTheDocument();
  });

  it("renders the synced math-steps content once a notepad-sync event arrives", async () => {
    render(<NotepadWindow />);
    // Let the effect's dynamic import()/listen() promise chain register the callback
    // before firing it.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => fireSync('{"steps": ["First step", "Second step"]}'));
    expect(screen.getByText("First step")).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for a step-by-step derivation/)).not.toBeInTheDocument();
  });

  it("falls back to the waiting message again if synced json is cleared", async () => {
    render(<NotepadWindow />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => fireSync('{"steps": ["First step"]}'));
    act(() => fireSync(null));
    expect(screen.getByText(/Waiting for a step-by-step derivation/)).toBeInTheDocument();
  });
});
