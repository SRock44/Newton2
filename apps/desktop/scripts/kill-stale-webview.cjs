// Runs automatically before every `tauri dev` (see beforeDevCommand in tauri.conf.json).
//
// Tauri's window-close handler hides windows instead of destroying them (see lib.rs),
// and stopping desktop.exe directly (task kill, Ctrl+C on a hung dev process, etc.)
// does not tear down its msedgewebview2.exe helper tree -- WebView2's browser/renderer
// processes aren't true OS-level children of desktop.exe for job-object purposes. A
// leftover browser process stays bound to this app's profile dir
// (%LOCALAPPDATA%\com.newton.desktop\EBWebView) and the next `desktop.exe` launch can
// reattach to that same stale, already-degraded process instead of starting clean --
// which is exactly what caused a real bug: the Notepad window (created after the main
// window, as a second webview under that same broken browser process) rendered a blank
// white page. Killing the on-disk profile directory doesn't help, because the
// corruption lives in the orphaned process's memory, not on disk.
//
// This only targets processes whose command line references THIS app's identifier, so
// it never touches unrelated WebView2 usage elsewhere on the machine (Windows Search,
// Widgets, other apps, etc.).
const { execSync } = require("node:child_process");

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", windowsHide: true });
  } catch {
    return "";
  }
}

if (process.platform !== "win32") {
  process.exit(0);
}

run('taskkill /IM desktop.exe /F /T 2>NUL');

const psOut = run(
  'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'msedgewebview2.exe\'\\" | ForEach-Object { $_.ProcessId.ToString() + \'|\' + $_.CommandLine }"',
);
const staleIds = psOut
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.includes("com.newton.desktop"))
  .map((line) => line.split("|")[0])
  .filter((pid) => pid && /^\d+$/.test(pid));

for (const pid of staleIds) {
  run(`taskkill /PID ${pid} /F`);
}

if (staleIds.length > 0) {
  console.log(`[kill-stale-webview] cleared ${staleIds.length} leftover msedgewebview2.exe process(es)`);
}
