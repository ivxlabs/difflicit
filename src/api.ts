// SPDX-License-Identifier: GPL-3.0-only
// The project catalog: a remote one (CATALOG, e.g. xnu.ivx.run's Apple CVEs), or else the user's own projects.
import { CATALOG } from "./config";
import { IS_DESKTOP, localProjects } from "./lib/desktop";
import { useSyncExternalStore } from "react";
import { cached, signal } from "./lib/util";
import type { Index, Location, Project, ProjectSummary } from "./types";

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = new URL(`${CATALOG}/${path}`, location.href);
  // A network error, or the server not allowing this page's origin (CORS): browsers only say "Load failed".
  const res = await fetch(url, init).catch(() => {
    throw new Error(`Couldn't reach ${url.host}. Check your connection, or that it allows requests from ${location.origin}.`);
  });
  if (res.status === 404) throw new Error("Not found");
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

const foldersByProject = new Map<string, Location[]>();

/** Desktop: the folders on this computer with an analysis of project `id` (once the catalog has loaded). */
export const localFolders = (id: string) => foldersByProject.get(id.toLowerCase()) ?? [];

/**
 * The user's own projects: in the desktop app, the analyses in ~/Difflicit; on a website without a catalog, none
 * (projects still open by their links).
 */
async function ownCatalog(): Promise<Index> {
  const byId = new Map<string, ProjectSummary>();
  foldersByProject.clear();
  for (const local of (IS_DESKTOP ? await localProjects() : []).sort((a, b) => b.modified - a.modified)) {
    const where = local.folder;
    const key = local.project.toLowerCase();
    foldersByProject.set(key, [...(foldersByProject.get(key) ?? []), { kind: "local", path: local.path, folder: local.folder }]);
    const known = byId.get(key);
    if (known) known.summary += `, ${where}`;
    else {
      byId.set(local.project.toLowerCase(), {
        id: local.project,
        summary: where,
        date: new Date(local.modified).toISOString(),
        badge: null,
        tags: [],
        facets: {},
        analyzed: false,
      });
    }
  }
  const projects = [...byId.values()];
  return {
    generated: new Date().toISOString(),
    title: "Your projects",
    about: IS_DESKTOP ? "Analyses in ~/Difflicit." : "No project catalog configured.",
    stats: [{ label: "projects", value: projects.length }],
    facets: [],
    scopes: [],
    projects,
  };
}

/**
 * The manifest: totals, facets and shards. A remote one is always revalidated (a cheap 304 when unchanged), so a
 * new scrape is picked up at once and never mixed with stale shards.
 */
export const loadIndex = cached(async () => {
  if (!CATALOG) return ownCatalog();
  const index = await getJson<Index>("index.json", { cache: "no-cache" });
  if (!Array.isArray(index.facets)) {
    throw new Error("The catalog is being updated to a newer format. Try again in a few minutes.");
  }
  return index;
});

// The user's own catalog changes as they open folders and clone analyses; views that list it follow along.
let version = 0;
const changes = signal();

/** Load the catalog again, e.g. after a folder was added. */
export function reloadCatalog() {
  loadIndex.reset();
  version++;
  changes.notify();
}

/** Changes whenever the catalog is reloaded: a dependency for views that load it. */
export const useCatalogVersion = () => useSyncExternalStore(changes.subscribe, () => version);

const shards = new Map<string, () => Promise<ProjectSummary[]>>();

/** One shard's project summaries, fetched once per page load. */
export function loadShard(file: string) {
  if (!shards.has(file)) shards.set(file, cached(() => getJson<ProjectSummary[]>(file)));
  return shards.get(file)!();
}

/** A project's details. The user's own projects have none beyond where they are; any id opens. */
export async function loadProject(id: string): Promise<Project> {
  if (CATALOG) return getJson<Project>(`projects/${encodeURIComponent(id)}.json`);
  const own = (await loadIndex()).projects?.find((p) => p.id.toLowerCase() === id.toLowerCase());
  return { id, summary: own?.summary ?? null, badge: null, tags: [], sections: [], menu: null };
}
