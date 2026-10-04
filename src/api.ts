import { API_BASE } from "./config";
import { cached } from "./lib/util";
import type { CveDetail, CveSummary, Index } from "./types";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}/${path}`);
  if (res.status === 404) throw new Error("Not found");
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** The manifest: totals and the list of year / component shards. */
export const loadIndex = cached(() => getJson<Index>("index.json"));

const shards = new Map<string, () => Promise<CveSummary[]>>();

/** One shard's CVE summaries, fetched once per page load. */
export function loadShard(file: string) {
  if (!shards.has(file)) shards.set(file, cached(() => getJson<CveSummary[]>(file)));
  return shards.get(file)!();
}

export const loadCve = (id: string) => getJson<CveDetail>(`cves/${encodeURIComponent(id)}.json`);
