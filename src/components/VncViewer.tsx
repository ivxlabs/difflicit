// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef, useState } from "react";
import { SyncIcon, XIcon } from "@primer/octicons-react";
import { vncConnect } from "../lib/desktop";
import type { Sandbox } from "../lib/sandbox";

type Status = "connecting" | "connected" | "disconnected";
type Rfb = InstanceType<typeof import("@novnc/novnc").default>;

/**
 * Desktop: a noVNC viewer for a sandbox, over the Rust WebSocket↔TCP bridge (vnc_connect). The password, if the
 * server wants one, is asked here and sent straight to the server through noVNC — it is never stored.
 */
export function VncViewer({ sandbox, onClose }: { sandbox: Sandbox; onClose: () => void }) {
  const screen = useRef<HTMLDivElement>(null);
  const rfb = useRef<Rfb | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let instance: Rfb | null = null;
    setStatus("connecting");
    setError(null);
    setNeedsPassword(false);

    (async () => {
      try {
        const { url } = await vncConnect(sandbox.host, sandbox.port);
        if (cancelled || !screen.current) return;
        const { default: RFB } = await import("@novnc/novnc");
        instance = new RFB(screen.current, url, { credentials: { password: "" } });
        instance.scaleViewport = true;
        instance.background = "#0b0e14";
        instance.addEventListener("connect", () => setStatus("connected"));
        instance.addEventListener("disconnect", (e) => {
          setStatus("disconnected");
          if (!(e.detail as { clean?: boolean })?.clean) setError("The sandbox connection dropped.");
        });
        instance.addEventListener("credentialsrequired", () => setNeedsPassword(true));
        instance.addEventListener("securityfailure", (e) => {
          const reason = (e.detail as { reason?: string })?.reason;
          setError(reason ? `Authentication failed: ${reason}` : "Authentication failed.");
        });
        rfb.current = instance;
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setStatus("disconnected");
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        instance?.disconnect();
      } catch {
        // already gone
      }
    };
  }, [sandbox.id, sandbox.host, sandbox.port, attempt]);

  const sendPassword = (e: React.FormEvent) => {
    e.preventDefault();
    rfb.current?.sendCredentials({ password });
    setNeedsPassword(false);
  };

  return (
    <div className="modal-backdrop vnc-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="vnc">
        <header className="vnc-bar">
          <span className="vnc-title">{sandbox.label || `${sandbox.host}:${sandbox.port}`}</span>
          <span className={`vnc-status ${status}`}>{status}</span>
          {needsPassword && (
            <form className="vnc-pass" onSubmit={sendPassword}>
              <input
                className="input"
                type="password"
                placeholder="VNC password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              <button className="btn" type="submit">
                Send
              </button>
            </form>
          )}
          <span className="grow" />
          {status === "disconnected" && (
            <button className="btn" onClick={() => setAttempt((a) => a + 1)}>
              <SyncIcon size={14} /> Reconnect
            </button>
          )}
          <button className="btn" onClick={onClose}>
            <XIcon size={14} /> Close
          </button>
        </header>
        {error && <div className="notice error vnc-error">{error}</div>}
        <div className="vnc-screen" ref={screen} />
      </div>
    </div>
  );
}
