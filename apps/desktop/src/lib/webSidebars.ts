// Opted into by apps/web before the shared bootstrap mounts React. Desktop Vite
// development also runs in a browser, so a missing Tauri bridge is not a web flag.
let enabled = false;

export function enableWebSidebars(): void {
  enabled = true;
}

export function webSidebarsEnabled(): boolean {
  return enabled;
}
