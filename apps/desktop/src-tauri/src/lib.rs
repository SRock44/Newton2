use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

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

/// Waits (up to 5 minutes) for exactly one OAuth redirect on `http://127.0.0.1:{port}/...`,
/// the way `gcloud auth login`/`gh auth login` do it for desktop apps -- the system
/// browser handles the actual login UI (including "Sign in with Google"); this just
/// catches the one redirect back afterward. No OS-level custom-URL-scheme registration
/// needed, which is the part that's genuinely fiddly to get right in a Windows dev build.
#[tauri::command]
async fn wait_for_oauth_callback(port: u16) -> Result<OAuthCallbackResult, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<OAuthCallbackResult, String> {
        let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;

        let deadline = Instant::now() + Duration::from_secs(300);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, wait_for_oauth_callback])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
