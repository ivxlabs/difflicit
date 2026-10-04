import { useState } from "react";
import { XIcon } from "@primer/octicons-react";
import { INSTANCE, PRODUCT } from "../config";
import { pat } from "../lib/access";
import { viewer } from "../lib/github";
import type { Viewer } from "../types";

const NEW_TOKEN_URL = `https://github.com/settings/tokens/new?scopes=repo&description=${encodeURIComponent(`${PRODUCT} (${INSTANCE.name})`)}`;

export function TokenDialog({ current, onClose }: { current: Viewer | null; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const previous = pat.get();
    pat.set(value.trim());
    try {
      if (!(await viewer())) throw new Error();
      onClose();
    } catch {
      pat.set(previous);
      setError("GitHub didn't accept that token.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    pat.set(null);
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={connect}>
        <header>
          <span className="grow">{current ? `Connected as ${current.login}` : "Connect GitHub"}</span>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            <XIcon size={16} />
          </button>
        </header>
        <div className="content">
          <p>
            Paste a GitHub personal access token to see your own <code>CVE-YYYY-NNNN</code> repositories (private ones
            included), fork analyses, and lift GitHub's anonymous limit of 60 requests an hour.
          </p>
          <p className="muted">
            A <a href={NEW_TOKEN_URL} target="_blank" rel="noreferrer">classic token with the <code>repo</code> scope</a>{" "}
            covers everything; <code>public_repo</code> is enough if you only need public repos. The token stays in
            this browser's local storage and is only ever sent to <code>api.github.com</code>.
          </p>
          <input
            className="input"
            type="password"
            autoFocus
            placeholder="ghp_…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          {error && <div className="notice error">{error}</div>}
        </div>
        <footer>
          {current && (
            <button type="button" className="btn danger" onClick={disconnect}>
              Disconnect
            </button>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!value.trim() || busy}>
            {current ? "Replace token" : "Connect"}
          </button>
        </footer>
      </form>
    </div>
  );
}
