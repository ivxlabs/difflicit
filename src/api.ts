// SPDX-License-Identifier: GPL-3.0-only
import { API_BASE } from "./config";
import { cached } from "./lib/util";
import type { CveDetail, CveSummary, Index } from "./types";

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/${path}`, init);
  if (res.status === 404) throw new Error("Not found");
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/**
 * The manifest: totals and the list of year / component shards. Always revalidated (a cheap 304 when
 * unchanged), so a new scrape is picked up at once and never mixed with stale shards.
 */
export const loadIndex = cached(async () => {
  const index = await getJson<Index>("index.json", { cache: "no-cache" });
  if (!Array.isArray(index.years) || !Array.isArray(index.components)) {
    throw new Error("The CVE database is being updated to a newer format. Try again in a few minutes.");
  }
  return index;
});

const shards = new Map<string, () => Promise<CveSummary[]>>();

/** One shard's CVE summaries, fetched once per page load. */
export function loadShard(file: string) {
  if (!shards.has(file)) shards.set(file, cached(() => getJson<CveSummary[]>(file)));
  return shards.get(file)!();
}

export const loadCve = (id: string) => getJson<CveDetail>(`cves/${encodeURIComponent(id)}.json`);
