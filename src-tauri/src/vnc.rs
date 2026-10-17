// SPDX-License-Identifier: GPL-3.0-only
//! A localhost WebSocket↔TCP bridge so the embedded noVNC client (which can only open WebSockets) can reach a
//! VNC server that speaks raw RFB over TCP — the user's sandbox VM or box.
//!
//! `vnc_connect` opens a one-shot bridge for one connection and returns a `ws://127.0.0.1:<port>/<token>` URL
//! for noVNC. The bridge binds to loopback only, accepts a single WebSocket whose path must carry the token it
//! handed out, dials the sandbox, and pipes bytes both ways until either side closes. It is torn down when the
//! session ends (or after 30s if noVNC never connects), so nothing lingers listening.

use std::net::Ipv4Addr;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http;

/// A random, unguessable path so another local process can't drive the bridge during its brief window.
fn token() -> String {
    let mut bytes = [0u8; 16];
    let _ = getrandom::getrandom(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A host is a name or address we pass to the OS resolver — never a URL or anything with whitespace.
fn valid_host(host: &str) -> Result<(), String> {
    let bad = host.is_empty()
        || host.len() > 255
        || host.chars().any(|c| c.is_whitespace() || c.is_control() || matches!(c, '/' | '\\' | '?' | '#' | '@'));
    if bad {
        return Err(format!("{host:?} isn't a valid host."));
    }
    Ok(())
}

/// Open a one-shot bridge to a VNC server and return the ws:// URL for noVNC to connect to.
#[tauri::command]
pub async fn vnc_connect(host: String, port: u16) -> Result<Value, String> {
    valid_host(&host)?;
    if port == 0 {
        return Err("That isn't a valid port.".into());
    }
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.map_err(|e| e.to_string())?;
    let local_port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let path = format!("/{}", token());
    let want = path.clone();

    tauri::async_runtime::spawn(async move {
        // One connection, and only if noVNC shows up promptly.
        let Ok(Ok((stream, _))) = tokio::time::timeout(Duration::from_secs(30), listener.accept()).await else {
            return;
        };
        if let Err(e) = bridge(stream, &want, &host, port).await {
            eprintln!("vnc bridge: {e}");
        }
    });

    Ok(json!({ "url": format!("ws://127.0.0.1:{local_port}{path}") }))
}

/// Accept the WebSocket (checking the path token), connect to the sandbox, and pipe bytes both ways.
async fn bridge(stream: TcpStream, want_path: &str, host: &str, port: u16) -> Result<(), String> {
    let want = want_path.to_string();
    let ws = tokio_tungstenite::accept_hdr_async(stream, move |req: &Request, resp: Response| {
        if req.uri().path() == want {
            Ok(resp)
        } else {
            let deny = http::Response::builder().status(http::StatusCode::FORBIDDEN).body(Some("forbidden".into())).unwrap();
            Err(ErrorResponse::from(deny))
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    let tcp = TcpStream::connect((host, port)).await.map_err(|e| format!("Couldn't reach the sandbox at {host}:{port}: {e}"))?;
    let (mut tcp_read, mut tcp_write) = tcp.into_split();
    let (mut ws_write, mut ws_read) = ws.split();

    // noVNC → sandbox
    let to_sandbox = async {
        while let Some(msg) = ws_read.next().await {
            match msg.map_err(|e| e.to_string())? {
                Message::Binary(data) => tcp_write.write_all(&data).await.map_err(|e| e.to_string())?,
                Message::Close(_) => break,
                _ => {} // RFB rides on binary frames; ignore text/ping/pong
            }
        }
        Ok::<(), String>(())
    };

    // sandbox → noVNC
    let to_client = async {
        let mut buf = vec![0u8; 16 * 1024];
        loop {
            let n = tcp_read.read(&mut buf).await.map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            ws_write.send(Message::Binary(buf[..n].to_vec())).await.map_err(|e| e.to_string())?;
        }
        Ok::<(), String>(())
    };

    tokio::select! {
        r = to_sandbox => r,
        r = to_client => r,
    }
}
