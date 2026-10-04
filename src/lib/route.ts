import { useCallback, useEffect, useState } from "react";

export interface Route {
  cve: string | null;
  /** Which analysis repo to show; null means the default (the org's). */
  repo: string | null;
  /** Path of the diff file to show; null means the write-up. */
  file: string | null;
}

// Hash routes (#/cve/CVE-2024-54494?repo=owner/name&file=path) work on static hosting without server rewrites,
// and the URL always describes exactly what is on screen, so it can be shared as-is.
function parse(): Route {
  const [path, query] = location.hash.replace(/^#/, "").split("?");
  const m = /^\/cve\/(CVE-\d{4}-\d+)/i.exec(path);
  const params = new URLSearchParams(query);
  return { cve: m ? m[1].toUpperCase() : null, repo: params.get("repo"), file: params.get("file") };
}

function format(r: Route): string {
  if (!r.cve) return "#/";
  const params = new URLSearchParams();
  if (r.repo) params.set("repo", r.repo);
  if (r.file) params.set("file", r.file);
  const q = params.toString().replace(/%2F/g, "/");
  return `#/cve/${r.cve}${q ? `?${q}` : ""}`;
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((next: Partial<Route>) => {
    location.hash = format({ ...parse(), ...next }).slice(1);
  }, []);
  return [route, navigate] as const;
}
