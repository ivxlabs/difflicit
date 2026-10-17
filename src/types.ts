// SPDX-License-Identifier: GPL-3.0-only
import type { DiffFile } from "./lib/diff";

// The static JSON API: a catalog of projects to analyze, written by an instance's scraper (scripts/main.py for
// ivx/xnu, where the projects are CVEs). Nothing in the app knows what a project is beyond what's here.

/** How a badge is coloured. */
export type Tone = "critical" | "high" | "medium" | "low";

/** A short label shown next to a project's id, e.g. a CVE's severity. */
export interface Badge {
  label: string;
  tone: Tone | null;
}

export interface ProjectSummary {
  id: string;
  /** One line, e.g. a CVE's impact. */
  summary: string | null;
  /** ISO date; the list is grouped by month. */
  date: string | null;
  badge: Badge | null;
  /** Shown after the id, e.g. a CVE's components. The first is also shown in the project header. */
  tags: string[];
  /** Values to filter by, keyed by Facet.key. */
  facets: Record<string, string | string[]>;
  /** The owner's published analysis existed at the last scrape. */
  analyzed: boolean;
}

/** A slice of the catalog in its own file, e.g. one year or one component. */
export interface Shard {
  name: string;
  file: string;
  count: number;
}

/** Something to filter projects by, e.g. severity, year or component. */
export interface Facet {
  key: string;
  /** The "no filter" option, e.g. "Any severity". */
  any: string;
  /** The values to offer, when the facet has no shards. */
  values?: string[];
  /**
   * The catalog split by this facet's values, so the browser only downloads one slice. The first faceted with
   * shards picks the default slice (its first shard); a narrower chosen shard of another facet wins.
   */
  shards?: Shard[];
  /** A regular expression whose first group, when a search matches it, picks a shard, e.g. a typed id's year. */
  match?: string;
}

/** A named subset offered as a quick scope, e.g. "Kernel & friends". The first is the default; "All" is always there. */
export interface Scope {
  label: string;
  facet: string;
  values: string[];
}

/** index.json: totals and how the catalog is sliced, so the browser only downloads what it's looking at. */
export interface Index {
  generated: string;
  /** The welcome page's title and first sentence, e.g. "Find the patch behind every Apple CVE". */
  title: string;
  about: string;
  /** Headline numbers for the welcome page, e.g. 4,068 CVEs. */
  stats: { label: string; value: number }[];
  facets: Facet[];
  scopes: Scope[];
  /** Every project, for catalogs small enough not to need shards (e.g. the user's own). */
  projects?: ProjectSummary[];
}

export interface Link {
  label: string;
  url?: string;
  /** Shown after the link, muted. */
  note?: string;
}

/** A piece of a project's details. */
export type Block =
  | { type: "text"; text: string; muted?: boolean }
  /** A titled item, e.g. one advisory's write-up. */
  | { type: "entry"; title: string; detail?: string | null; notes?: string[] }
  | { type: "code"; label: string; code: string }
  | { type: "tags"; items: Link[] }
  | { type: "links"; items: Link[] };

export interface Section {
  title: string;
  /** Spans the whole width instead of one column. */
  wide?: boolean;
  blocks: Block[];
}

/** projects/<id>.json: everything known about one project. */
export interface Project {
  id: string;
  summary: string | null;
  badge: Badge | null;
  tags: string[];
  /** The project header's details. */
  sections: Section[];
  /** A toolbar menu of related pages, e.g. the advisories a CVE was fixed in. */
  menu: { label: string; items: { title: string; detail: string | null; url: string }[] } | null;
}

/** analysis.json at the root of a repository or folder: what makes it an analysis, and of which project. */
export interface AnalysisFile {
  $schema?: string;
  project: string;
}

/** The subset of a GitHub repository object the app uses. */
export interface Repo {
  name: string;
  full_name: string;
  owner: { login: string };
  fork: boolean;
  private: boolean;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  pushed_at: string | null;
  html_url: string;
  /** What the signed-in user may do with it (only present on authenticated requests). */
  permissions?: { push: boolean };
}

/** Where an analysis lives: a GitHub repository, or (in the desktop app) a folder on this computer. */
export type Location = { kind: "github"; repo: Repo } | { kind: "local"; path: string; folder: string };

/**
 * A thing a project compares, added with just a path or git URL. A git repo's versions are its commits/tags; a
 * file/folder's versions are the copies you add.
 */
export type Artifact =
  | { name: string; kind: "git"; repo: string }
  | { name: string; kind: "file"; versions: { id: string; path: string }[]; /** the dyld_shared_cache image, when extracted from one */ image?: string };

/** One function in a binary diff (radiff2): its name, how it changed, and a 0–1 similarity. */
export interface BinaryFunction {
  name: string;
  status: "same" | "changed" | "added" | "removed";
  similarity: number;
  base_addr: string | null;
  head_addr: string | null;
}

export interface RepoContent {
  notes_html: string | null;
  /** The file analysis.json names as the notes, if any, and every note (*.diffmd) in the repository. */
  notes_path: string | null;
  notes_files: string[];
  /** The artifacts its analysis.json declares ([] for stored patches). */
  artifacts: Artifact[];
  /** Every file changed by the repo's *.diff / *.patch files, in order. */
  files: DiffFile[];
}

/** A project's content on screen: the notes, and the diff of the chosen artifact's two versions. */
export interface AnalysisContent {
  /** The notes (Markdown or diffmd) rendered to HTML, and the file they came from (desktop). */
  notes_html: string | null;
  notes_path?: string | null;
  /** Every note (*.diffmd) in the project, for the sidebar's Notes. */
  notes_files: string[];
  files: DiffFile[];
  /** Present when the two versions are binaries; `files` is then empty and a function's diff loads on demand. */
  binary?: BinaryFunction[];
  /** The project's artifacts, the one on screen, and the two version ids being diffed. */
  artifacts: Artifact[];
  artifact?: Artifact;
  /** The base version's artifact, when comparing two different artifacts. */
  baseArtifact?: Artifact;
  base?: string;
  head?: string;
  /** The project folder, to resolve versions for the binary drill-in. */
  project?: string;
  /** The project uses artifacts, which only the desktop app can diff. */
  needsDesktop?: boolean;
}

/** Desktop: what a file or folder picked in a project's sidebar tree is, and what to show for it (info.rs). */
export type FileInfo = { path: string; name: string; size: number; modified: number | null } & (
  | { kind: "dir"; entries: { name: string; path: string; dir: boolean }[] }
  | { kind: "project"; json: Record<string, unknown> | null; notes: string | null }
  | { kind: "notes"; html: string; text: string; truncated: boolean }
  | { kind: "patch" | "text"; text: string; truncated: boolean }
  | {
      kind: "binary";
      format: string;
      /** rabin2's view of it; null when radare2 isn't installed. */
      binary: {
        info: Record<string, unknown> | null;
        libs: string[];
        sections: { name: string; size: number; vsize: number; perm: string; vaddr: number; paddr: number }[];
        headers: { offset: string; name: string; format: string }[];
      } | null;
    }
);

/** The GitHub user the app acts as. */
export interface Viewer {
  login: string;
  avatar_url: string;
}

/** Whether iam.ivx.run may use GitHub for the signed-in user (Sign In builds). */
export interface GitHubStatus {
  connected: boolean;
  login?: string;
  scopes?: string[];
}
