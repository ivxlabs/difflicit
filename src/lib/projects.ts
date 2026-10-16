// SPDX-License-Identifier: GPL-3.0-only
// Projects and their analyses. A project is whatever the instance analyzes (on ivx/xnu, a CVE); an analysis is a
// GitHub repository (or a folder, in the desktop app) with an analysis.json naming the project. The instance's
// naming convention (difflicit.config.json) says which repositories to look at: `repo` is a template like
// "{id}" or "analysis-{id}", and `id` is the pattern project ids follow.

import { PROJECTS } from "../config";
import type { AnalysisFile } from "../types";

export const ANALYSIS_FILE = "analysis.json";
export const ANALYSIS_SCHEMA = "https://raw.githubusercontent.com/ivxlabs/difflicit/main/analysis.schema.json";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ID_RE = new RegExp(`^(?:${PROJECTS.id})$`, "i");
const [before, after] = PROJECTS.repo.split("{id}").map(escape);
const REPO_RE = new RegExp(`^${before}(${PROJECTS.id})${after}$`, "i");

export const isProjectId = (id: string) => ID_RE.test(id);

/** The repository name an analysis of `id` gets, e.g. CVE-2024-54494. */
export const repoName = (id: string) => PROJECTS.repo.replace("{id}", id);

/** The project a repository's name says it analyzes, if it follows the convention. */
export const projectOfRepo = (name: string): string | null => REPO_RE.exec(name)?.[1] ?? null;

export const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The analysis.json for a new analysis of `id`. */
export const analysisFile = (id: string) =>
  JSON.stringify({ $schema: ANALYSIS_SCHEMA, project: id } satisfies AnalysisFile, null, 2) + "\n";

/** The project an analysis.json names; null when it isn't one. */
export function parseAnalysisFile(text: string): string | null {
  try {
    const project = (JSON.parse(text) as Partial<AnalysisFile>).project;
    return typeof project === "string" && project ? project : null;
  } catch {
    return null;
  }
}
