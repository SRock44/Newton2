use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

use base64::Engine;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};

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

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit("newton-snip-captured", serde_json::json!({ "dataUrl": data_url }));
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
    let _ = WebviewWindowBuilder::new(app, "notepad", WebviewUrl::App("index.html".into()))
        .title("Newton Notepad")
        .inner_size(420.0, 580.0)
        .min_inner_size(320.0, 360.0)
        .always_on_top(true)
        .decorations(false)
        .build();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .invoke_handler(tauri::generate_handler![greet, wait_for_oauth_callback])
        .setup(|app| {
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
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "flashcards" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
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
