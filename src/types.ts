import type { DiffFile } from "./lib/diff";

// Shapes of the static JSON API written by scripts/main.py.

export type Severity = "Critical" | "High" | "Medium" | "Low";

export interface CveSummary {
  id: string;
  severity: Severity | null;
  cvss_score: number | null;
  components: string[];
  impact: string | null;
  released: string | null;
  platforms: string[];
  /** A public <org>/CVE-YYYY-NNNN repo existed at the last scrape. */
  analyzed: boolean;
}

/** A slice of the CVE list in its own file: one year (by CVE id) or one component. */
export interface Shard {
  name: string;
  file: string;
  count: number;
}

/** index.json: totals and the shards, so the browser only downloads the slice it is looking at. */
export interface Index {
  generated: string;
  org: string;
  advisories: number;
  cves: number;
  analyzed: number;
  /** Newest first. */
  years: Shard[];
  /** Largest first. */
  components: Shard[];
}

export interface CveEntry {
  advisory_id: string;
  component: string;
  impact: string | null;
  description: string | null;
  credit: string | null;
  title: string;
  url: string;
  released: string | null;
  platforms: string[];
}

export interface CveDetail {
  id: string;
  severity: Severity | null;
  cvss_score: number | null;
  cvss_version: string | null;
  cvss_vector: string | null;
  nvd_description: string | null;
  cwes: string[];
  refs: { url: string; tags: string[] }[];
  entries: CveEntry[];
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
}

export interface RepoContent {
  readme_html: string | null;
  /** Every file changed by the repo's *.diff / *.patch files, in order. */
  files: DiffFile[];
}

// Components treated as "kernel & friends" by the default scope.
export const KERNEL_COMPONENTS = [
  "Kernel",
  "IOKit",
  "AMD Kernel",
  "Kext Management",
  "Sandbox",
  "APFS",
  "HFS",
  "SMB",
  "NFS",
  "Networking",
  "ASP TCP",
  "IOMobileFrameBuffer",
  "IOSurface",
  "IOSurfaceAccelerator",
  "IOGPUFamily",
  "IOHIDFamily",
  "IOUSBHostFamily",
  "AppleAVD",
  "Apple Neural Engine",
  "dyld",
  "libxpc",
  "Libsystem",
];

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
