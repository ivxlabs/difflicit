// SPDX-License-Identifier: GPL-3.0-only
//! Desktop sign-in's way back from the browser: a loopback redirect (RFC 8252 §7.3), as other desktop apps do it.
//! While a sign-in is under way, the app listens on 127.0.0.1 for the one request iam redirects the browser to,
//! answers it with a page saying how it went, and hands the URL (with its code and state) to the web app, which
//! finishes the sign-in. No URL scheme has to be registered, so it works in `tauri dev` too, and browsers don't
//! need a click to follow an http redirect.

use std::net::Ipv4Addr;
use std::sync::Mutex;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// The sign-in waiting for its redirect, so starting another one replaces it instead of failing on the port.
static WAITING: Mutex<Option<tokio::task::AbortHandle>> = Mutex::new(None);

/// What the browser shows once it's back: the outcome, and that the tab can go.
fn page(denied: bool) -> String {
    let (mark, color, title, text) = if denied {
        ("✕", "#8b949e", "Sign-in cancelled", "Difflicit didn't get access to your account.")
    } else {
        ("✓", "#3fb950", "You're signed in", "Difflicit can now use your ivx account. You can close this tab and go back to the app.")
    };
    format!(
        "<!doctype html><meta charset=utf-8><title>{title} · Difflicit</title>\
         <body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1117;color:#e6edf3;\
         font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:center\">\
         <div><div style=\"font-size:44px;color:{color}\">{mark}</div><h1 style=\"font-size:22px;margin:8px 0\">{title}</h1>\
         <p style=\"color:#8b949e;max-width:420px\">{text}</p></div></body>"
    )
}

async fn wait_for_callback(listener: TcpListener, port: u16) -> Result<String, String> {
    loop {
        let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).await.unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        // "GET /callback?code=…&state=… HTTP/1.1"
        let target = request.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("").to_string();
        if !target.starts_with("/callback?") {
            // The browser asking for a favicon, or anything else: not the redirect.
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
            continue;
        }
        let body = page(target.contains("error="));
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(response.as_bytes()).await;
        return Ok(format!("http://127.0.0.1:{port}{target}"));
    }
}

/// Wait (up to 10 minutes) for the browser to come back from signing in, on `port`; returns the URL it came back
/// to. Start it before opening the browser.
#[tauri::command]
pub async fn oauth_callback(port: u16) -> Result<String, String> {
    if let Some(previous) = WAITING.lock().unwrap().take() {
        previous.abort();
    }
    // The aborted listener lets go of the port as soon as the runtime drops it.
    let mut bound = None;
    for _ in 0..20 {
        match TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await {
            Ok(l) => {
                bound = Some(l);
                break;
            }
            Err(_) => tokio::time::sleep(Duration::from_millis(50)).await,
        }
    }
    let listener = bound.ok_or_else(|| format!("Couldn't listen for the sign-in on port {port}: something else is using it."))?;
    let task = tauri::async_runtime::spawn(async move {
        tokio::time::timeout(Duration::from_secs(600), wait_for_callback(listener, port))
            .await
            .map_err(|_| "The sign-in timed out. Try again.".to_string())?
    });
    *WAITING.lock().unwrap() = Some(task.inner().abort_handle());
    match task.await {
        Ok(result) => result,
        Err(_) => Err("Replaced by a newer sign-in.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hands_back_the_redirect() {
        tauri::async_runtime::block_on(async {
            let port = 48399;
            let waiting = tauri::async_runtime::spawn(oauth_callback(port));
            tokio::time::sleep(Duration::from_millis(200)).await;
            let get = |path: &'static str| async move {
                let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
                s.write_all(format!("GET {path} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes()).await.unwrap();
                let mut out = String::new();
                s.read_to_string(&mut out).await.unwrap();
                out
            };
            assert!(get("/favicon.ico").await.starts_with("HTTP/1.1 404"));
            let page = get("/callback?code=abc&state=xyz").await;
            assert!(page.contains("You're signed in"));
            assert_eq!(waiting.await.unwrap().unwrap(), format!("http://127.0.0.1:{port}/callback?code=abc&state=xyz"));
        });
    }
}
