// SPDX-License-Identifier: GPL-3.0-only
import { useCallback, useEffect, useState } from "react";

export interface Route {
  project: string | null;
  /** Which analysis repo to show; null means the default (the org's). */
  repo: string | null;
  /** Path of the diff file to show; null means the notes. */
  file: string | null;
  /** Desktop: a file or folder picked in the project tree (relative to the project), shown instead of a diff. */
  path: string | null;
  /** The line to jump to in that file (its index among the file's diff lines). */
  line: number | null;
  /** The artifact on screen, and the two version ids to diff; null uses defaults. */
  artifact: string | null;
  /** The base version's artifact, when it isn't `artifact` (comparing two artifacts); null means the same. */
  baseArtifact: string | null;
  base: string | null;
  head: string | null;
  /** Compact, read-only layout for embedding in other pages (an <iframe>). */
  embed: boolean;
}

// Hash routes (#/project/CVE-2024-54494?repo=owner/name&file=path) work on static hosting without server
// rewrites, and the URL always describes exactly what is on screen, so it can be shared as-is. Any first part is
// accepted, so older #/cve/… links keep working.

function parse(): Route {
  const [path, query] = location.hash.replace(/^#/, "").split("?");
  const m = /^\/[^/]+\/([^/]+)/.exec(path);
  const params = new URLSearchParams(query);
  return {
    project: m ? decodeURIComponent(m[1]) : null,
    repo: params.get("repo"),
    file: params.get("file"),
    path: params.get("path"),
    line: params.has("line") ? Number(params.get("line")) || 0 : null,
    artifact: params.get("artifact"),
    baseArtifact: params.get("baseArtifact"),
    base: params.get("base"),
    head: params.get("head"),
    embed: params.has("embed"),
  };
}

function format(r: Route): string {
  if (!r.project) return "#/";
  const params = new URLSearchParams();
  if (r.repo) params.set("repo", r.repo);
  if (r.artifact) params.set("artifact", r.artifact);
  if (r.baseArtifact) params.set("baseArtifact", r.baseArtifact);
  if (r.base) params.set("base", r.base);
  if (r.head) params.set("head", r.head);
  if (r.path) params.set("path", r.path);
  if (r.file) params.set("file", r.file);
  if (r.file && r.line !== null) params.set("line", String(r.line));
  if (r.embed) params.set("embed", "1");
  const q = params.toString().replace(/%2F/g, "/");
  return `#/project/${encodeURIComponent(r.project)}${q ? `?${q}` : ""}`;
}

/** An absolute link to a view, e.g. the current one with `{ embed: true }`. */
export const urlFor = (next: Partial<Route>) => location.origin + location.pathname + format({ ...parse(), ...next });

export function useRoute() {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((next: Partial<Route>) => {
    // A line belongs to its file; changing the file, pair, repo or project starts from the notes at the top.
    // A tree entry (path) and a diff file take each other's place on screen.
    const has = (key: keyof Route) => key in next;
    const resets = ["file", "path", "base", "head", "artifact", "baseArtifact", "repo", "project"].some((k) => has(k as keyof Route));
    const line = has("line") ? next.line : resets ? null : undefined;
    const pair = has("base") || has("head") || has("artifact") || has("baseArtifact");
    const file = !has("file") && ((has("path") && next.path) || pair) ? null : undefined;
    const path = !has("path") && resets ? null : undefined;
    // Picking another artifact compares its own versions again, unless a base artifact comes with it.
    const baseArtifact = !has("baseArtifact") && (has("artifact") || has("repo") || has("project")) ? null : undefined;
    location.hash = format({
      ...parse(),
      ...next,
      ...(line !== undefined && { line }),
      ...(file !== undefined && { file }),
      ...(path !== undefined && { path }),
      ...(baseArtifact !== undefined && { baseArtifact }),
    }).slice(1);
  }, []);
  return [route, navigate] as const;
}
