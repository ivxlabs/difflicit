// SPDX-License-Identifier: GPL-3.0-only
// A project holds artifacts (a git repo, or a file/folder with versions). You diff two versions of one artifact.
// This resolves a location + a chosen (artifact, base, head) into the diff to show. Stored *.diff / *.patch
// files (a project with no artifacts) still work, on the web too; the artifact engines run on the desktop.

import { repoContent } from "./github";
import { artifactDiff, localAnalysis } from "./desktop";
import { parseUnifiedDiff } from "./diff";
import type { AnalysisContent, Artifact, Location, Repo } from "../types";

/** How a location is named in the URL (`repo=`): a repository's full name, or local:<path> for a folder. */
export const locationId = (loc: Location) => (loc.kind === "github" ? loc.repo.full_name : `local:${loc.path}`);

export interface VersionOption {
  id: string;
  label: string;
}

/** The versions you can diff: a file artifact's own versions (newest first), or a git artifact's refs. */
export function versionOptions(
  artifact: Artifact,
  gitRefs?: { tags: string[]; commits: { hash: string; short: string; subject: string }[] } | null,
): VersionOption[] {
  if (artifact.kind === "file") return [...artifact.versions].reverse().map((v) => ({ id: v.id, label: v.id }));
  if (!gitRefs) return [];
  return [
    ...gitRefs.tags.map((t) => ({ id: t, label: t })),
    ...gitRefs.commits.map((c) => ({ id: c.hash, label: `${c.short} · ${c.subject}` })),
  ];
}

/** Where in the project an artifact lives: a git artifact's clone, a file artifact's folder or one version's copy. */
export interface ArtifactPlace {
  artifact: string;
  /** The version, when the path is a file artifact's copy of one. */
  version?: string;
}

/** The artifact a project path (relative to the project) is in, or null. */
export function artifactAt(artifacts: Artifact[], path: string): ArtifactPlace | null {
  const within = (dir: string) => path === dir || path.startsWith(`${dir}/`);
  for (const a of artifacts) {
    if (a.kind === "git") {
      if (within(a.repo)) return { artifact: a.name };
      continue;
    }
    const version = a.versions.find((v) => within(v.path));
    if (version) return { artifact: a.name, version: version.id };
    if (within(`artifacts/${a.name}`)) return { artifact: a.name };
  }
  return null;
}

/** One side of a comparison: an artifact and one of its versions. */
export interface Side {
  artifact: string;
  version: string;
}

export interface Pair {
  before: Side;
  after: Side;
}

/**
 * Analyze starting from an artifact (or one version of it): that as the after, the version before it as the before.
 * An empty version is filled in by the dialog (a git artifact's refs load there).
 */
export function pairFrom(artifacts: Artifact[], place: ArtifactPlace): Pair {
  const artifact = artifacts.find((a) => a.name === place.artifact);
  const options = artifact ? versionOptions(artifact) : [];
  const after = place.version ?? options[0]?.id ?? "";
  const at = options.findIndex((o) => o.id === after);
  const before = options[at + 1]?.id ?? options.find((o) => o.id !== after)?.id ?? "";
  return { before: { artifact: place.artifact, version: before }, after: { artifact: place.artifact, version: after } };
}

/** A version as people write it: a commit by its short hash. */
export const shortVersion = (v = "") => (/^[0-9a-f]{40}$/.test(v) ? v.slice(0, 12) : v);

/** The note an analysis of `pair` is written to, e.g. `analysis-libfoo-1.2-to-1.3`. */
export function noteName({ before, after }: Pair): string {
  const short = shortVersion;
  const from = before.artifact === after.artifact ? short(before.version) : `${before.artifact}-${short(before.version)}`;
  const to = before.artifact === after.artifact ? short(after.version) : `${after.artifact}-${short(after.version)}`;
  return `analysis-${after.artifact}-${from}-to-${to}`.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 100).replace(/[-.]+$/, "");
}

/** The default pair: newest as head, the next one as base (options are newest-first). */
export function defaultPair(options: VersionOption[]): { base?: string; head?: string } {
  if (!options.length) return {};
  return { head: options[0].id, base: (options[1] ?? options[0]).id };
}

export async function loadAnalysis(
  loc: Location,
  artifactName?: string | null,
  base?: string | null,
  head?: string | null,
  baseArtifactName?: string | null,
): Promise<AnalysisContent> {
  return loc.kind === "local" ? loadLocal(loc.path, artifactName, base, head, baseArtifactName) : loadGithub(loc.repo);
}

async function loadLocal(
  project: string,
  artifactName?: string | null,
  base?: string | null,
  head?: string | null,
  baseArtifactName?: string | null,
): Promise<AnalysisContent> {
  const a = await localAnalysis(project);
  const artifacts = a.artifacts ?? [];
  if (!artifacts.length) {
    return { notes_html: a.notes_html, notes_path: a.notes_path, notes_files: a.notes_files, files: a.patches.flatMap((p) => parseUnifiedDiff(p.text)), artifacts: [] };
  }
  const artifact = artifacts.find((x) => x.name === artifactName) ?? artifacts[0];
  // Comparing two artifacts: the base version is the other artifact's.
  const baseArtifact = artifacts.find((x) => x.name === baseArtifactName && x.name !== artifact.name);
  const common = { notes_html: a.notes_html, notes_path: a.notes_path, notes_files: a.notes_files, artifacts, artifact, baseArtifact, base: base ?? undefined, head: head ?? undefined, project };
  // A version diffed with itself is empty: don't run an engine for it (an artifact with one version starts here).
  if (!base || !head || (base === head && !baseArtifact)) return { ...common, files: [] };
  const diff = await artifactDiff(project, artifact, base, head, baseArtifact);
  return diff.kind === "binary" ? { ...common, files: [], binary: diff.functions } : { ...common, files: parseUnifiedDiff(diff.text) };
}

// Web: stored-patches projects show their files; artifact projects need the desktop app.
async function loadGithub(repo: Repo): Promise<AnalysisContent> {
  const content = await repoContent(repo);
  const notes = { notes_html: content.notes_html, notes_path: content.notes_path, notes_files: content.notes_files };
  if (content.artifacts.length) return { ...notes, files: [], artifacts: content.artifacts, needsDesktop: true };
  return { ...notes, files: content.files, artifacts: [] };
}
