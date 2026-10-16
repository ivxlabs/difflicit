// SPDX-License-Identifier: GPL-3.0-only
// The desktop app (src-tauri) and the hand-over to it from the website. Analyses run locally on the desktop:
// the website gets the user a repository, then opens it in the app with a difflicit:// link.
//
// The Tauri modules are imported on demand, so the website never loads them.

import { PROJECT_REPO } from "../config";
import type { Artifact } from "../types";
import { isProjectId } from "./projects";

/** Running inside the desktop app. */
export const IS_DESKTOP = "__TAURI_INTERNALS__" in window;

export const DOWNLOAD_URL = `https://github.com/${PROJECT_REPO}/releases/latest`;

/** Where analyze_locally (src-tauri/src/lib.rs) puts a repository. */
export const localPath = (repo: string) => `~/Difflicit/${repo}`;

const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/;

const analyzeLink = (project: string, repo: string) =>
  `difflicit://analyze?${new URLSearchParams({ project, repo }).toString().replace(/%2F/g, "/")}`;

/**
 * Desktop: the webview doesn't open new windows, so send links meant for one (target="_blank": docs, GitHub, …)
 * to the default browser instead.
 */
export function openLinksInBrowser() {
  document.addEventListener("click", (e) => {
    const a = (e.target as Element).closest?.("a[target=_blank]") as HTMLAnchorElement | null;
    if (!a || !/^https?:/.test(a.href)) return;
    e.preventDefault();
    openExternal(a.href);
  });
}

/** Open a web page outside Difflicit: a new tab, or in the desktop app, the default browser. */
export function openExternal(url: string) {
  if (IS_DESKTOP) void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url));
  else window.open(url, "_blank", "noreferrer");
}

/** Desktop: clone the repository (or update it) and open its folder. Resolves to the local path. */
export const analyzeLocally = (repo: string) => invoke<string>("analyze_locally", { repo });

// Folders the user opened outside ~/Difflicit, so they stay among their projects.
const OPENED_KEY = "difflicit-opened-folders";
const opened = (): string[] => JSON.parse(localStorage.getItem(OPENED_KEY) ?? "[]");
export const rememberFolder = (path: string) =>
  localStorage.setItem(OPENED_KEY, JSON.stringify([...new Set([...opened(), path])]));

const invoke = async <T>(command: string, args?: Record<string, unknown>) =>
  (await import("@tauri-apps/api/core")).invoke<T>(command, args);

/** Desktop: the analyses on this computer (local_projects in src-tauri/src/lib.rs). */
export const localProjects = () =>
  invoke<{ project: string; path: string; folder: string; modified: number }[]>("local_projects", { opened: opened() });

/** Desktop: an analysis folder's project (null without an analysis.json), README as HTML and patch texts. */
export const localAnalysis = (path: string) =>
  invoke<{
    project: string | null;
    artifacts: import("../types").Artifact[] | null;
    readme_html: string | null;
    patches: { path: string; text: string }[];
  }>("local_analysis", { path });

/** Desktop: mark a folder as a Difflicit project (writes difflicit.json) if it isn't one. */
export const initProject = (path: string) => invoke<void>("init_project", { path });

/** Desktop: add a git repo (path or URL) as an artifact (cloned into the project). Returns its name. */
export const addGitArtifact = (project: string, source: string, token?: string) =>
  invoke<string>("add_git_artifact", { project, source, token });

/** Desktop: add a file or folder as a new artifact (its first version). Returns { name, version }. */
export const addFileArtifact = (project: string, path: string) => invoke<{ name: string; version: string }>("add_file_artifact", { project, path });

/** Desktop: add another version (file or folder) to an existing file artifact. Returns the version id. */
export const addFileVersion = (project: string, artifact: string, path: string) =>
  invoke<string>("add_file_version", { project, artifact, path });

/** Desktop: a git artifact's versions — its tags and recent commits. */
export const gitVersions = (project: string, repo: string) =>
  invoke<{ tags: string[]; commits: { hash: string; short: string; subject: string; date: string }[] }>("git_versions", { project, repo });

/** Desktop: the diff between two versions of an artifact — unified-diff text, or a binary function table. */
export const artifactDiff = (project: string, artifact: Artifact, base: string, head: string) =>
  invoke<{ kind: "unified"; text: string } | { kind: "binary"; functions: import("../types").BinaryFunction[] }>(
    "artifact_diff",
    { project, artifact, base, head },
  );

/** Desktop: one function's disassembly diff between two binary versions of an artifact. */
export const artifactFunctionDiff = (project: string, artifact: Artifact, base: string, head: string, name: string, baseAddr: string | null, headAddr: string | null) =>
  invoke<string>("artifact_function_diff", { project, artifact, base, head, name, baseAddr, headAddr });

/** Desktop: which diff engines are usable here — git, and radiff2/r2 for binaries. */
export const diffTools = () => invoke<{ git: boolean; binary: boolean }>("diff_tools");

/** Desktop: whether a clone URL is a github.com repo (so connecting GitHub could unblock a failed clone). */
export const isGithubUrl = (url: string) => invoke<boolean>("is_github", { url });

/** Desktop: the native file picker for one file; null when cancelled. */
export async function pickFile(title: string): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: false, multiple: false, title });
  return typeof picked === "string" ? picked : null;
}

/** Desktop: the native folder picker; null when cancelled. */
export async function pickFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, title: "Open a local repository" });
  return typeof picked === "string" ? picked : null;
}

/** Desktop: show a folder in the file manager. */
export const revealFolder = (path: string) => void import("@tauri-apps/plugin-opener").then(({ revealItemInDir }) => revealItemInDir(path));

/**
 * Desktop: call `handle` for each analyze link the app is opened with, at launch or while running. Links come
 * from any website, so they're checked here and the user confirms before anything is cloned.
 */
export function onAnalyzeLink(handle: (project: string, repo: string) => void): () => void {
  let unlisten: (() => void) | null = null;
  let live = true;
  const take = (urls: string[] | null) => {
    for (const raw of urls ?? []) {
      try {
        const url = new URL(raw);
        const project = url.searchParams.get("project") ?? "";
        const repo = url.searchParams.get("repo") ?? "";
        if (url.protocol === "difflicit:" && isProjectId(project) && REPO_RE.test(repo)) handle(project, repo);
      } catch {
        // not a URL; ignore it
      }
    }
  };
  import("@tauri-apps/plugin-deep-link").then(async ({ getCurrent, onOpenUrl }) => {
    const stop = await onOpenUrl(take);
    if (live) {
      unlisten = stop;
      take(await getCurrent());
    } else stop();
  });
  return () => {
    live = false;
    unlisten?.();
  };
}

/**
 * Website: open the analysis in the desktop app. Browsers don't say whether anything handles difflicit://, so
 * this watches whether the page loses focus (to the app, or to the browser's "Open Difflicit?" prompt) and
 * resolves to false when nothing happened, most likely because the app isn't installed.
 */
export function openInDesktop(project: string, repo: string): Promise<boolean> {
  return new Promise((resolve) => {
    let left = false;
    const onBlur = () => (left = true);
    const onHide = () => document.hidden && (left = true);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onHide);
    location.assign(analyzeLink(project, repo));
    setTimeout(() => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onHide);
      resolve(left);
    }, 1500);
  });
}
