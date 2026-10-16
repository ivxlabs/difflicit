// SPDX-License-Identifier: GPL-3.0-only
import { useState } from "react";
import { RepoForkedIcon, RepoIcon, XIcon } from "@primer/octicons-react";
import { githubStatus, iamAccountUrl } from "../iam/session";
import { PROJECTS } from "../config";
import { useCommand } from "../lib/commands";
import { createAnalysis, fork } from "../lib/github";
import { repoName } from "../lib/projects";
import { DocsLink } from "./BlankSlate";
import { useAsync } from "../lib/util";
import type { Project, Repo, Viewer } from "../types";

interface Props {
  project: Project;
  /** The project's analyses (null while loading); `upstream` is the owner's published one, if any. */
  repos: Repo[] | null;
  upstream: Repo | null;
  viewer: Viewer | null;
  /** Sign In / Connect GitHub. */
  onConnect: () => void;
  /** Show the user's repo here and analyze it locally (in the desktop app; the website hands it over). */
  onOpen: (repo: Repo) => void;
}

/**
 * The main action: get the user into their own analysis of this project. Signs in first if needed, opens their
 * repo if they have one, and otherwise offers to fork the published analysis or create a new repository. The
 * analysis itself happens locally, in the desktop app.
 */
export function AnalyzeButton({ project, repos, upstream, viewer, onConnect, onOpen }: Props) {
  const [asking, setAsking] = useState(false);
  // "Yours": in your account, or the published analysis itself if you can push to it (e.g. you're in the owner org).
  const own =
    viewer &&
    (repos?.find((r) => r.owner.login.toLowerCase() === viewer.login.toLowerCase()) ??
      (upstream?.permissions?.push ? upstream : undefined));

  const analyze = () => {
    if (!viewer) return onConnect();
    if (own) return onOpen(own);
    setAsking(true);
  };
  useCommand("analyze", analyze, !(viewer && !repos));

  return (
    <>
      <button
        className="btn primary analyze"
        disabled={Boolean(viewer) && !repos}
        onClick={(e) => {
          e.stopPropagation(); // it sits in the project header, which toggles on click
          analyze();
        }}
        title={own ? `Open ${own.full_name}` : `Analyze ${project.id} in your own GitHub repository`}
      >
        Analyze
      </button>
      {asking && viewer && (
        <StartDialog project={project} upstream={upstream} viewer={viewer} onClose={() => setAsking(false)} onOpen={onOpen} />
      )}
    </>
  );
}

function StartDialog({ project, upstream, viewer, onClose, onOpen }: Pick<Props, "project" | "upstream" | "onOpen"> & { viewer: Viewer; onClose: () => void }) {
  const org = PROJECTS.owner;
  const name = repoName(project.id);
  const [how, setHow] = useState<"fork" | "create">(upstream ? "fork" : "create");
  // Where a new repository goes: your account, or the instance's org, where it becomes the published analysis.
  // (Once the org has one, it's offered as a fork instead.)
  const owners = upstream || org.toLowerCase() === viewer.login.toLowerCase() ? [viewer.login] : [viewer.login, org];
  const [owner, setOwner] = useState(viewer.login);
  const [wantPrivate, setPrivate] = useState(true);
  // Sign In builds know what the user allowed on iam; a private repo needs private-repository access there.
  const [status] = useAsync(() => (__IAM__ ? githubStatus() : null), []);
  const canPrivate = !__IAM__ || Boolean(status?.scopes?.includes("repo"));
  // The published analysis must be public for everyone (and the site) to see it.
  const isPrivate = wantPrivate && canPrivate && owner !== org;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const repo =
        how === "fork" && upstream
          ? await fork(upstream.full_name)
          : await createAnalysis(
              owner === viewer.login ? null : owner,
              project.id,
              `Analysis of ${project.id}${project.summary ? `: ${project.summary}` : ""}`.slice(0, 350),
              isPrivate,
            );
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
          <span className="grow">Analyze {project.id}</span>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            <XIcon size={16} />
          </button>
        </header>
        <div className="content">
          <p className="muted">
            No repository for {project.id} yet. <DocsLink page="analyses" />
          </p>
          {upstream && (
            <label className="choice">
              <input type="radio" checked={how === "fork"} onChange={() => setHow("fork")} />
              <RepoForkedIcon size={16} />
              <span>
                <b>Fork {upstream.full_name}</b>
                <span className="muted"> and send a pull request when you're done.</span>
              </span>
            </label>
          )}
          <label className="choice">
            <input type="radio" checked={how === "create"} onChange={() => setHow("create")} />
            <RepoIcon size={16} />
            <span>
              <b>
                Create {owner}/{name}
              </b>
              <span className="muted">
                {owner === org ? " as the published analysis everyone sees." : " and start from scratch."}
              </span>
              {how === "create" && owners.length > 1 && (
                <span className="options">
                  {owners.map((o) => (
                    <label key={o}>
                      <input type="radio" checked={owner === o} onChange={() => setOwner(o)} /> {o}
                    </label>
                  ))}
                </span>
              )}
              {how === "create" && owner !== org && (
                <span className="options">
                  <label title={canPrivate ? undefined : "Needs private-repository access on your ivx account"}>
                    <input type="radio" checked={isPrivate} disabled={!canPrivate} onChange={() => setPrivate(true)} /> Private
                  </label>
                  <label>
                    <input type="radio" checked={!isPrivate} onChange={() => setPrivate(false)} /> Public
                  </label>
                </span>
              )}
              {how === "create" && owner !== org && !canPrivate && (
                <span className="muted small-note">
                  You allowed ivx public repositories only.{" "}
                  <a href={iamAccountUrl()} target="_blank" rel="noreferrer">
                    Include private ones
                  </a>{" "}
                  to create a private repository.
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
