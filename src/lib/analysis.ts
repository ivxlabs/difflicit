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
    return { notes_html: a.notes_html, notes_path: a.notes_path, files: a.patches.flatMap((p) => parseUnifiedDiff(p.text)), artifacts: [] };
  }
  const artifact = artifacts.find((x) => x.name === artifactName) ?? artifacts[0];
  // Comparing two artifacts: the base version is the other artifact's.
  const baseArtifact = artifacts.find((x) => x.name === baseArtifactName && x.name !== artifact.name);
  const common = { notes_html: a.notes_html, notes_path: a.notes_path, artifacts, artifact, baseArtifact, base: base ?? undefined, head: head ?? undefined, project };
  // A version diffed with itself is empty: don't run an engine for it (an artifact with one version starts here).
  if (!base || !head || (base === head && !baseArtifact)) return { ...common, files: [] };
  const diff = await artifactDiff(project, artifact, base, head, baseArtifact);
  return diff.kind === "binary" ? { ...common, files: [], binary: diff.functions } : { ...common, files: parseUnifiedDiff(diff.text) };
}

// Web: stored-patches projects show their files; artifact projects need the desktop app.
async function loadGithub(repo: Repo): Promise<AnalysisContent> {
  const content = await repoContent(repo);
  if (content.artifacts.length) return { notes_html: content.notes_html, files: [], artifacts: content.artifacts, needsDesktop: true };
  return { notes_html: content.notes_html, files: content.files, artifacts: [] };
}
