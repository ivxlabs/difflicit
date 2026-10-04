// SPDX-License-Identifier: GPL-3.0-only
import { useState } from "react";
import { RepoForkedIcon, RepoIcon, XIcon } from "@primer/octicons-react";
import { createRepo, fork } from "../lib/github";
import type { CveDetail, Repo, Viewer } from "../types";

interface Props {
  cve: CveDetail;
  /** The CVE's repos (null while loading); `upstream` is the org's published analysis, if any. */
  repos: Repo[] | null;
  upstream: Repo | null;
  viewer: Viewer | null;
  /** Sign In / Connect GitHub. */
  onConnect: () => void;
  /** Show the user's repo here and open it on GitHub to work in. */
  onOpen: (repo: Repo) => void;
}

/**
 * The main action: get the user into their own repository for this CVE. Signs in first if needed, opens their
 * repo if they have one, and otherwise offers to fork the published analysis or create a new repository.
 */
export function AnalyzeButton({ cve, repos, upstream, viewer, onConnect, onOpen }: Props) {
  const [asking, setAsking] = useState(false);
  const own = viewer && repos?.find((r) => r.owner.login.toLowerCase() === viewer.login.toLowerCase());

  const analyze = () => {
    if (!viewer) return onConnect();
    if (own) return onOpen(own);
    setAsking(true);
  };

  return (
    <>
      <button
        className="btn primary analyze"
        disabled={Boolean(viewer) && !repos}
        onClick={(e) => {
          e.stopPropagation(); // it sits in the CVE header, which toggles on click
          analyze();
        }}
        title={own ? `Open ${own.full_name}` : `Analyze ${cve.id} in your own GitHub repository`}
      >
        Analyze
      </button>
      {asking && viewer && (
        <StartDialog cve={cve} upstream={upstream} viewer={viewer} onClose={() => setAsking(false)} onOpen={onOpen} />
      )}
    </>
  );
}

function StartDialog({ cve, upstream, viewer, onClose, onOpen }: Pick<Props, "cve" | "upstream" | "onOpen"> & { viewer: Viewer; onClose: () => void }) {
  const [how, setHow] = useState<"fork" | "create">(upstream ? "fork" : "create");
  const [isPrivate, setPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const impact = cve.entries.find((x) => x.impact)?.impact;
      const repo =
        how === "fork" && upstream
          ? await fork(upstream.full_name)
          : await createRepo(cve.id, `Analysis of ${cve.id}${impact ? `: ${impact}` : ""}`.slice(0, 350), isPrivate);
      onClose();
      onOpen(repo);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={start}>
        <header>
          <span className="grow">Analyze {cve.id}</span>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            <XIcon size={16} />
          </button>
        </header>
        <div className="content">
          <p>
            You don't have a repository for {cve.id} yet. Put your write-up in <code>README.md</code> and the fix in{" "}
            <code>*.diff</code> or <code>*.patch</code> files, and it shows up here.
          </p>
          {upstream && (
            <label className="choice">
              <input type="radio" checked={how === "fork"} onChange={() => setHow("fork")} />
              <RepoForkedIcon size={16} />
              <span>
                <b>Fork {upstream.full_name}</b>
                <span className="muted"> and build on the published analysis; send a pull request when you're done.</span>
              </span>
            </label>
          )}
          <label className="choice">
            <input type="radio" checked={how === "create"} onChange={() => setHow("create")} />
            <RepoIcon size={16} />
            <span>
              <b>
                Create {viewer.login}/{cve.id}
              </b>
              <span className="muted"> and start from scratch.</span>
              {how === "create" && (
                <span className="options">
                  <label>
                    <input type="radio" checked={isPrivate} onChange={() => setPrivate(true)} /> Private
                  </label>
                  <label>
                    <input type="radio" checked={!isPrivate} onChange={() => setPrivate(false)} /> Public
                  </label>
                </span>
              )}
            </span>
          </label>
          {error && <div className="notice error">{error}</div>}
        </div>
        <footer>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "Starting…" : how === "fork" ? "Fork and analyze" : "Create and analyze"}
          </button>
        </footer>
      </form>
    </div>
  );
}
