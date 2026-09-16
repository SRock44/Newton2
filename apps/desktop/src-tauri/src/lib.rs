use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

use base64::Engine;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};

/// Frontend event carrying a `newton://...` URL the OS handed us. Nothing consumes it
/// yet -- it exists so the Stripe checkout-complete page (see services/api's
/// billing.py `/billing/checkout-complete`, which currently dead-ends in a static
/// "you're all set" browser page) and other out-of-app round trips can eventually
/// redirect straight back into the app instead of asking the user to switch windows.
const DEEP_LINK_EVENT: &str = "deep-link-received";

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(serde::Serialize)]
struct OAuthCallbackResult {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// Minimal percent-decoding for a query-string value — avoids pulling in a whole URL
/// crate just to read `code`/`state`/`error` off a redirect.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(byte);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let mut parts = pair.splitn(2, '=');
        let k = parts.next()?;
        if k == key {
            Some(percent_decode(parts.next().unwrap_or("")))
        } else {
            None
        }
    })
}

/// Waits (up to 15 minutes) for exactly one OAuth redirect on `http://127.0.0.1:{port}/...`,
/// the way `gcloud auth login`/`gh auth login` do it for desktop apps -- the system
/// browser handles the actual login UI (including "Sign in with Google", or now
/// registering a new email/password account, which can interrupt the flow with an
/// email-verification step -- hence a longer allowance than a plain login normally
/// needs, since a user has to go read an actual email in between). No OS-level custom-
/// URL-scheme registration needed, which is the part that's genuinely fiddly to get
/// right in a Windows dev build.
#[tauri::command]
async fn wait_for_oauth_callback(port: u16) -> Result<OAuthCallbackResult, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<OAuthCallbackResult, String> {
        let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;

        let deadline = Instant::now() + Duration::from_secs(900);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _addr)) => break stream,
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if Instant::now() > deadline {
                        return Err("Timed out waiting for sign-in.".to_string());
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
                Err(e) => return Err(e.to_string()),
            }
        };
        stream.set_nonblocking(false).ok();
        stream.set_read_timeout(Some(Duration::from_secs(10))).ok();

        let mut reader = BufReader::new(&stream);
        let mut request_line = String::new();
        reader
            .read_line(&mut request_line)
            .map_err(|e| e.to_string())?;
        // e.g. "GET /callback?code=XXXX&state=YYYY HTTP/1.1"
        let path = request_line.split_whitespace().nth(1).unwrap_or("");
        let query = path.split_once('?').map(|(_, q)| q).unwrap_or("").to_string();

        let code = query_param(&query, "code");
        let state = query_param(&query, "state");
        let error = query_param(&query, "error");

        let body = if error.is_some() {
            "Sign-in failed. You can close this window and return to Newton."
        } else {
            "Signed in. You can close this window and return to Newton."
        };
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();

        Ok(OAuthCallbackResult { code, state, error })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Captures the primary monitor (falling back to whichever monitor is first if none is
/// flagged primary), encodes it as a PNG data URL, and emits it to the main window for
/// the "Newton Snip" crop UI to pick up — the actual drag-select region-of-interest is a
/// frontend concern (ScreenSnipModal.tsx); this only does the OS-level full-screen grab,
/// since a true native drag-select overlay is a much larger undertaking than a v1 needs.
fn capture_and_emit_snip(app: &tauri::AppHandle) {
    let monitors = match xcap::Monitor::all() {
        Ok(m) if !m.is_empty() => m,
        _ => return,
    };
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .unwrap_or(&monitors[0]);

    let Ok(image) = monitor.capture_image() else {
        return;
    };

    let mut png_bytes: Vec<u8> = Vec::new();
    if image::DynamicImage::ImageRgba8(image)
        .write_to(&mut std::io::Cursor::new(&mut png_bytes), image::ImageFormat::Png)
        .is_err()
    {
        return;
    }

    let encoded = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    let data_url = format!("data:image/png;base64,{}", encoded);

    focus_main_window(app.clone());
    let _ = app.emit("newton-snip-captured", serde_json::json!({ "dataUrl": data_url }));
}

/// Brings the main window to front — the same show+focus pair the tray's "Open Newton"
/// menu item and `capture_and_emit_snip` already use inline, exposed as an invokable
/// command so the frontend can trigger it too. Backs the Notepad window's "Sign in"
/// fallback button (see NotepadWindow.tsx): if the Notepad genuinely can't get a token
/// from the main window within a short timeout, this is how the student gets to an
/// actual sign-in screen instead of being stuck on a dead-end "waiting" message.
#[tauri::command]
fn focus_main_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Shows (creating if needed) the always-on-top companion Notepad window — a second,
/// separate webview loading the same frontend bundle, distinguished purely by its window
/// label ("notepad" vs "main"), which main.tsx uses to decide whether to render the full
/// `<App />` or the lightweight `<NotepadWindow />` that just mirrors whatever step-by-step
/// derivation is currently showing in the main window (via a `notepad-sync` event emitted
/// from the frontend, not from here — this function only owns the window's lifecycle).
fn show_notepad_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("notepad") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let window = match WebviewWindowBuilder::new(app, "notepad", WebviewUrl::App("index.html".into()))
        .title("Newton Notepad")
        .inner_size(420.0, 580.0)
        .min_inner_size(320.0, 360.0)
        .decorations(false)
        .build()
    {
        Ok(w) => w,
        Err(e) => {
            eprintln!("Failed to create Notepad window: {e}");
            return;
        }
    };
    // Applied after creation rather than as a builder flag -- see the reload comment
    // below for why building with always_on_top(true) set inline is suspected to
    // contribute to the exact bug that comment describes.
    let _ = window.set_always_on_top(true);

    // A real, reproduced WebView2 bug (confirmed via Chrome DevTools Protocol against
    // a live repro, not a hunch): this second webview occasionally never completes its
    // initial navigation and is left showing a solid blank window, its own devtools
    // target stuck on about:blank indefinitely -- even an explicit CDP Page.navigate
    // call to it afterward never completed either, so the underlying WebView2
    // controller itself gets wedged during creation of a second webview in the same
    // environment, not a JS-level or wrong-URL problem. A single forced reload shortly
    // after creation reliably recovers it: harmless if the page already loaded fine
    // (the note picker just re-renders in a blink), a real fix if it didn't.
    let retry_window = window.clone();
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(Duration::from_millis(1200));
        let _ = retry_window.eval("location.reload();");
    });
}

/// The Home dashboard's "New note" quick action and its "Recent documents & notes"
/// widget's note cards (see HomeView.tsx) both need a way to open the Notepad window
/// from the MAIN window, not just the tray menu — this is that, a thin invokable
/// wrapper around show_notepad_window's existing show-or-create logic (unchanged).
#[tauri::command]
fn open_notepad_window(app: tauri::AppHandle) {
    show_notepad_window(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the FIRST plugin registered (tauri-plugin-single-instance's own
        // requirement). On Windows a `newton://...` link makes the OS spawn a *second*
        // desktop.exe with the URL as a CLI argument rather than notifying the running
        // one; single-instance (built with its `deep-link` feature) forwards that
        // argument into the already-running process and exits the new one, which is what
        // makes deep links reach the live window instead of opening a duplicate app.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main_window(app.clone());
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed
                        && shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyN)
                    {
                        capture_and_emit_snip(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            greet,
            wait_for_oauth_callback,
            focus_main_window,
            open_notepad_window
        ])
        .setup(|app| {
            // Windows/Linux only associate the `newton://` scheme with the app at
            // *install* time, from the bundle config -- an unbundled `tauri dev` binary
            // has never been installed, so nothing would route the scheme to it. Doing
            // the registration at runtime in debug builds points the scheme at whatever
            // target/debug/desktop.exe is currently running, which is what makes
            // `start newton://...` testable without cutting a release. Release builds
            // deliberately leave this to the installer.
            #[cfg(debug_assertions)]
            {
                if let Err(err) = app.deep_link().register_all() {
                    eprintln!("[deep-link] dev-mode scheme registration failed: {err}");
                }
            }

            // Hand the URL to the frontend rather than acting on it here: which panel a
            // `newton://...` link should land on is a UI decision, and the app may have
            // been cold-started by the link (so focus it first, or the event arrives at
            // a window that's still hidden behind the browser the link came from).
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls: Vec<String> = event.urls().iter().map(|u| u.to_string()).collect();
                focus_main_window(handle.clone());
                let _ = handle.emit(DEEP_LINK_EVENT, urls);
            });

            // "Newton Snip": Ctrl+Alt+N from anywhere captures the screen and hands it to
            // the frontend's crop UI. Deliberately not Win+Shift+S / Ctrl+Shift+N, which
            // collide with the OS snipping tool and browser incognito shortcuts.
            #[cfg(desktop)]
            app.global_shortcut().register("CmdOrCtrl+Alt+N")?;

            // Quick actions reachable without opening the full window -- "Review
            // flashcards" shows the window and asks the frontend (via an emitted event
            // it listens for) to jump straight to that panel, rather than just Show/Quit.
            let show_i = MenuItem::with_id(app, "show", "Open Newton", true, None::<&str>)?;
            let flashcards_i =
                MenuItem::with_id(app, "flashcards", "Review flashcards", true, None::<&str>)?;
            let snip_i =
                MenuItem::with_id(app, "snip", "Take a Newton Snip", true, None::<&str>)?;
            let notepad_i =
                MenuItem::with_id(app, "notepad", "Open Notepad", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&show_i, &flashcards_i, &snip_i, &notepad_i, &quit_i],
            )?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .tooltip("Newton")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => focus_main_window(app.clone()),
                    "flashcards" => {
                        focus_main_window(app.clone());
                        let _ = app.emit("tray-open-flashcards", ());
                    }
                    "snip" => capture_and_emit_snip(app),
                    "notepad" => show_notepad_window(app),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        // The window closing hides it rather than quitting the whole app -- the tray
        // icon (and whatever's in progress, e.g. a chat) stays alive, matching the point
        // of having tray quick actions at all. "Quit" in the tray menu (or the OS's own
        // quit-the-process shortcuts) is the actual way out.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
