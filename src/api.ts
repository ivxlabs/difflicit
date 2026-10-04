import { API_BASE } from "./config";
import { cached } from "./lib/util";
import type { CveDetail, Index } from "./types";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}/${path}`);
  if (res.status === 404) throw new Error("Not found");
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** The whole CVE list (~4k entries), fetched once and filtered in the browser. */
export const loadIndex = cached(() => getJson<Index>("index.json"));

export const loadCve = (id: string) => getJson<CveDetail>(`cves/${encodeURIComponent(id)}.json`);
