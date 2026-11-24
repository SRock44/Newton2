// Explicit web-entry opt-in: desktop Vite development also runs without Tauri.
let enabled = false;

export function enableWebComposer(): void {
  enabled = true;
}

export function webComposerEnabled(): boolean {
  return enabled;
}
