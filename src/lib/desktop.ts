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

/** Desktop: a project folder's project id (null without a project file), notes as HTML (and their path), and patch texts. */
export const localAnalysis = (path: string) =>
  invoke<{
    project: string | null;
    artifacts: import("../types").Artifact[] | null;
    notes_path: string | null;
    notes_html: string | null;
    notes_files: string[];
    patches: { path: string; text: string }[];
  }>("local_analysis", { path });

/** Desktop: what to show for a file or folder in a project (path relative to the project). */
export const fileInfo = (project: string, path: string) => invoke<import("../types").FileInfo>("file_info", { project, path });

/**
 * Desktop: start a note, `<name>.diffmd` (README.diffmd without a name), from a template or with `text` (then
 * under a free name, never replacing one); a project's first becomes its notes. Returns its path.
 */
export const createNote = (project: string, name?: string, text?: string) => invoke<string>("create_note", { project, name, text });

/** Desktop: save a note (a .diffmd or .md file in the project). */
export const writeNote = (project: string, path: string, text: string) => invoke<void>("write_note", { project, path, text });

/** Desktop: rename a note in its folder (the extension stays unless given); returns its new path. */
export const renameNote = (project: string, path: string, name: string) => invoke<string>("rename_note", { project, path, name });

/** Desktop: Markdown to HTML, exactly as saved notes are rendered (a note's blocks, one at a time). */
export const renderMarkdown = (text: string) => invoke<string>("render_markdown", { text });

/** Files the OS may open from here (capabilities/default.json allows only these): never a binary, which it'd run. */
export const canOpenFile = (path: string) => /\.(diffmd|md|markdown|txt|json|diff|patch)$/i.test(path);

/** What the file manager is called here, for "Reveal in …". */
export const FILE_MANAGER = /Mac/.test(navigator.platform) ? "Finder" : /Win/.test(navigator.platform) ? "Explorer" : "file manager";

/** Desktop: open a file in its default app (an editor, for notes). */
export const openFile = (path: string) => void import("@tauri-apps/plugin-opener").then(({ openPath }) => openPath(path));

/** Desktop: mark a folder as a Difflicit project (writes difflicit.json) if it isn't one. */
export const initProject = (path: string) => invoke<void>("init_project", { path });

/** Desktop: add a git repo (path or URL) as an artifact (cloned into the project). Returns its name. */
export const addGitArtifact = (project: string, source: string, token?: string) =>
  invoke<string>("add_git_artifact", { project, source, token });

/**
 * Desktop: add a file or folder as an artifact, or as another version of the file artifact already named like it.
 * Returns { name, version }.
 */
export const addFileArtifact = (project: string, path: string) => invoke<{ name: string; version: string }>("add_file_artifact", { project, path });

/** An analysis engine as Difflicit finds it: a command, and what its `--about` says (protocol:
 * https://ivx.run/docs/difflicit/engines/). */
export interface EngineInfo {
  command: string;
  name: string;
  installed: boolean;
  version?: string;
  description?: string;
  license?: string;
  homepage?: string;
  /** Installed, but it can't be used (why). */
  problem?: string;
}

/** Desktop: each command as an analysis engine (installed or not, and what it is). */
export const listEngines = (commands: string[]) => invoke<EngineInfo[]>("list_engines", { commands });
/** Desktop: analyze `base` (of `baseArtifact`, else `artifact`) → `head` with an engine; its diffmd. */
export const runEngine = (command: string, project: string, artifact: Artifact, base: string, head: string, baseArtifact?: Artifact) =>
  invoke<string>("run_engine", { command, project, artifact, base, head, baseArtifact });

/** Desktop: remove an artifact from the project, with its copies in `artifacts/<name>`. */
export const removeArtifact = (project: string, name: string) => invoke<void>("remove_artifact", { project, name });

/** Desktop: a git artifact's versions — its tags and recent commits. */
export const gitVersions = (project: string, repo: string) =>
  invoke<{ tags: string[]; commits: { hash: string; short: string; subject: string; date: string }[] }>("git_versions", { project, repo });

/**
 * Desktop: the diff between two versions of an artifact — or `base` of another artifact (`baseArtifact`) — as
 * unified-diff text, or a binary function table.
 */
export const artifactDiff = (project: string, artifact: Artifact, base: string, head: string, baseArtifact?: Artifact) =>
  invoke<{ kind: "unified"; text: string } | { kind: "binary"; functions: import("../types").BinaryFunction[] }>(
    "artifact_diff",
    { project, artifact, base, head, baseArtifact },
  );

/** Desktop: one function's disassembly diff between two binary versions of an artifact. */
export const artifactFunctionDiff = (
  project: string,
  artifact: Artifact,
  base: string,
  head: string,
  name: string,
  baseAddr: string | null,
  headAddr: string | null,
  baseArtifact?: Artifact,
) => invoke<string>("artifact_function_diff", { project, artifact, base, head, name, baseAddr, headAddr, baseArtifact });

/** Desktop: which diff engines/tools are usable here — git, radiff2/r2 for binaries, ipsw for firmware. */
export const diffTools = () => invoke<{ git: boolean; binary: boolean; ipsw: boolean }>("diff_tools");

// ── dyld shared cache / firmware (blacktop/ipsw) ─────────────────────────────

export interface Cache {
  name: string;
  path: string;
}
export interface Image {
  name: string;
  version: string | null;
}

/** Desktop: dyld_shared_caches on disk — this Mac's, plus any Difflicit downloaded or extracted. */
export const dscCaches = () => invoke<Cache[]>("dsc_caches");

/** Desktop: the images (dylibs) inside a cache, with versions. */
export const dscImages = (cache: string) => invoke<Image[]>("dsc_images", { cache });

/** Desktop: extract an image from a cache as a file artifact (or another version of the one named like it). */
export const addDscArtifact = (project: string, cache: string, image: string, label?: string) =>
  invoke<{ name: string; version: string }>("add_dsc_artifact", { project, cache, image, label });


/** Desktop: pull the dyld_shared_cache(s) out of an IPSW/OTA file. Returns the caches on disk. */
export const extractCacheFromIpsw = (path: string) => invoke<Cache[]>("extract_cache_from_ipsw", { path });

/** Desktop: download firmware by device and build/version and extract its cache. Can take a long time. */
export const downloadIpsw = (device: string, build?: string, version?: string) =>
  invoke<Cache[]>("download_ipsw", { device, build, version });

/** Desktop: ipsw's own cache-level diff — images added, removed and changed between two caches. */
export const dscDiff = (base: string, head: string) =>
  invoke<{ added: string[]; removed: string[]; changed: { name?: string; previous?: string; version?: string }[] }>("dsc_diff", { base, head });


/** Desktop: installed binaries to pick as a file artifact — native apps, and libraries on disk. */
export const installedBinaries = () =>
  invoke<{ apps: { name: string; path: string }[]; libraries: { name: string; path: string }[] }>("installed_binaries");

/** Desktop: whether a clone URL is a github.com repo (so connecting GitHub could unblock a failed clone). */
export const isGithubUrl = (url: string) => invoke<boolean>("is_github", { url });

/** Desktop: open a one-shot WebSocket↔TCP bridge to a VNC sandbox; returns the ws:// URL for noVNC. */
export const vncConnect = (host: string, port: number) => invoke<{ url: string }>("vnc_connect", { host, port });

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

/** Desktop: wait for the browser to come back from signing in, on a loopback port; resolves to the URL it hit. */
export const oauthCallback = (port: number) => invoke<string>("oauth_callback", { port });

/** Desktop: bring the app's window to the front (after signing in in the browser). */
export const focusWindow = () =>
  void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
    const w = getCurrentWindow();
    await w.unminimize();
    await w.setFocus();
  });

/** Desktop: set the app window's title (the app is Difflicit itself, not any one instance). */
export const setWindowTitle = (title: string) =>
  void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title));

/**
 * Desktop: call `each` for every difflicit:// link the app is handed, at launch and while running (a URL that
 * won't parse is ignored). Returns an unsubscribe. The specific links are matched by the callers below.
 */
function onDeepLink(each: (url: URL) => void): () => void {
  let unlisten: (() => void) | null = null;
  let live = true;
  const take = (urls: string[] | null) => {
    for (const raw of urls ?? []) {
      try {
        each(new URL(raw));
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
 * Desktop: the website's analyze links (difflicit://analyze?project=…&repo=…). They come from any website, so
 * they're validated here and the user confirms before anything is cloned.
 */
export const onAnalyzeLink = (handle: (project: string, repo: string) => void) =>
  onDeepLink((url) => {
    const project = url.searchParams.get("project") ?? "";
    const repo = url.searchParams.get("repo") ?? "";
    if (url.protocol === "difflicit:" && isProjectId(project) && REPO_RE.test(repo)) handle(project, repo);
  });

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
