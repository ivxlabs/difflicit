// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef, useState } from "react";
import { DesktopDownloadIcon, XIcon } from "@primer/octicons-react";
import { reloadCatalog } from "../api";
import { PRODUCT } from "../config";
import { DOWNLOAD_URL, analyzeLocally, localPath, openInDesktop } from "../lib/desktop";
import { DocsLink } from "./BlankSlate";
import type { Repo } from "../types";

/**
 * Website: analyses run on the user's computer, so hand the repository over to the desktop app, and offer the
 * download when it doesn't open.
 */
export function OpenInDesktop({ project, repo, onClose }: { project: string; repo: Repo; onClose: () => void }) {
  const [state, setState] = useState<"idle" | "opening" | "opened" | "missing">("idle");

  const open = async () => {
    setState("opening");
    setState((await openInDesktop(project, repo.full_name)) ? "opened" : "missing");
  };

  // Straight from the Analyze click, open right away; browsers only open apps in response to one.
  useEffect(() => {
    if (navigator.userActivation?.isActive) void open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <header>
          <span className="grow">Analyze {project}</span>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            <XIcon size={16} />
          </button>
        </header>
        <div className="content">
          <p>
            Opens <code>{repo.full_name}</code> in {PRODUCT} for desktop. <DocsLink page="desktop" />
          </p>
          {state === "opened" && <p className="muted">Continue in the {PRODUCT} app.</p>}
          {state === "missing" && (
            <div className="notice">
              {PRODUCT} didn't open. Download it, then press <b>Open in {PRODUCT}</b> again.
            </div>
          )}
        </div>
        <footer>
          <a className="muted" href={repo.html_url} target="_blank" rel="noreferrer">
            Open on GitHub instead
          </a>
          <span className="grow" />
          <a className="btn" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
            <DesktopDownloadIcon size={16} /> Download
          </a>
          <button className="btn primary" disabled={state === "opening"} onClick={open}>
            {state === "opening" ? "Opening…" : `Open in ${PRODUCT}`}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Desktop: clone the repository and open it. Analyze starts right away; a difflicit:// link, which any website
 * can open, asks first (`confirm`).
 */
export function AnalyzeLocally({
  repo,
  confirm,
  onCloned,
  onClose,
}: {
  repo: string;
  confirm: boolean;
  /** With the folder it's in, to show that copy. */
  onCloned: (path: string) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<"ask" | "cloning" | "done">(confirm ? "ask" : "cloning");
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const run = async () => {
    setState("cloning");
    setError(null);
    try {
      const cloned = await analyzeLocally(repo);
      setPath(cloned);
      reloadCatalog(); // it's one of the user's projects now
      onCloned(cloned);
      setState("done");
    } catch (e) {
      setError(String(e));
      setState("ask");
    }
  };

  useEffect(() => {
    if (!confirm && !started.current) {
      started.current = true; // StrictMode mounts twice; clone once
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && state !== "cloning" && onClose()}>
      <div className="modal">
        <header>
          <span className="grow">Analyze {repo} locally</span>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            <XIcon size={16} />
          </button>
        </header>
        <div className="content">
          {state === "done" ? (
            <p>
              Opened <code>{path}</code>. <DocsLink page="analyses" />
            </p>
          ) : (
            <p>
              {state === "cloning" ? "Cloning" : "Clone"} <code>{repo}</code> from GitHub into{" "}
              <code>{localPath(repo)}</code>
              {state === "cloning" ? "…" : " and open it?"}
            </p>
          )}
          {state === "ask" && !error && confirm && (
            <p className="muted">Only continue if you opened this link.</p>
          )}
          {error && <div className="notice error">{error}</div>}
        </div>
        <footer>
          <span className="grow" />
          {state === "done" ? (
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" disabled={state === "cloning"} onClick={run}>
                {state === "cloning" ? "Cloning…" : error ? "Try again" : "Clone and open"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

