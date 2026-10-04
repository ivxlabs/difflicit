import { GITHUB_API } from "../config";
import type { Repo, RepoContent, Viewer } from "../types";
import { CONNECT_LABEL, access } from "./access";
import { parseUnifiedDiff } from "./diff";
import { cached, uniqueBy } from "./util";

/** A GitHub REST call: as the user when they're connected (directly or through iam), anonymously otherwise. */
async function gh(path: string, init: RequestInit & { accept?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("accept", init.accept ?? "application/vnd.github+json");
  const auth = await access.authorization();
  if (auth) headers.set("authorization", auth);
  const res = await fetch(`${auth ? access.base : GITHUB_API}${path}`, { ...init, headers });
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    throw new Error(
      auth
        ? "GitHub API rate limit reached. Try again in a few minutes."
        : `GitHub's anonymous rate limit (60 requests/hour) is used up. ${CONNECT_LABEL} to raise it.`,
    );
  }
  if (res.status === 401 || res.status === 409) throw new Error(`GitHub access expired. ${CONNECT_LABEL} again.`);
  return res;
}

/** GET JSON; null when GitHub says 404 (missing, or private without access). */
async function ghJson<T>(path: string): Promise<T | null> {
  const res = await gh(path);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function ghAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const batch = (await ghJson<T[]>(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`)) ?? [];
    out.push(...batch);
    if (batch.length < 100) return out;
  }
}

export const getRepo = (fullName: string) => ghJson<Repo>(`/repos/${fullName}`);

/** The GitHub user the app acts as; null when not connected. */
export const viewer = async () =>
  (await access.authorization()) ? ghJson<Viewer>("/user") : null;

export async function fork(fullName: string): Promise<Repo> {
  const res = await gh(`/repos/${fullName}/forks`, { method: "POST" });
  if (!res.ok) throw new Error(`GitHub refused the fork (${res.status}).`);
  return res.json();
}

/** A new repository in the user's account for analysing a CVE, with a README to start from. */
export async function createRepo(name: string, description: string, isPrivate: boolean): Promise<Repo> {
  const res = await gh("/user/repos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, description, private: isPrivate, auto_init: true }),
  });
  if (res.status === 422) throw new Error(`You already have a repository named ${name}.`);
  if (!res.ok) throw new Error(`GitHub refused to create the repository (${res.status}).`);
  return res.json();
}

const ANALYSIS_REPO_RE = /^CVE-\d{4}-\d{4,}$/i;

/** Every repo the user can see (private ones included) that is named after a CVE. */
export const myCveRepos = cached(async () =>
  (await access.authorization())
    ? (await ghAll<Repo>("/user/repos?affiliation=owner,collaborator,organization_member")).filter((r) =>
        ANALYSIS_REPO_RE.test(r.name),
      )
    : [],
);
access.subscribe(myCveRepos.reset);

/** The org's analysis repo for a CVE, its forks, and the user's own repos named after the CVE. */
export async function cveRepos(org: string, cve: string): Promise<Repo[]> {
  const [upstream, mine] = await Promise.all([getRepo(`${org}/${cve}`), myCveRepos()]);
  const forks = upstream?.forks_count ? await ghAll<Repo>(`/repos/${upstream.full_name}/forks?sort=newest`) : [];
  const all = [upstream, ...mine.filter((r) => r.name.toUpperCase() === cve), ...forks].filter((r): r is Repo => !!r);
  return uniqueBy(all, (r) => r.full_name);
}

/** README (rendered by GitHub) and every *.diff / *.patch file on the default branch. */
export async function repoContent(repo: Repo, maxPatches = 30): Promise<RepoContent> {
  const branch = encodeURIComponent(repo.default_branch);
  const [tree, readme] = await Promise.all([
    ghJson<{ tree: { path: string; type: string; size?: number }[] }>(
      `/repos/${repo.full_name}/git/trees/${branch}?recursive=1`,
    ),
    gh(`/repos/${repo.full_name}/readme`, { accept: "application/vnd.github.html" }),
  ]);

  const paths = (tree?.tree ?? [])
    .filter((i) => i.type === "blob" && /\.(diff|patch)$/i.test(i.path) && (i.size ?? 0) < 2_000_000)
    .map((i) => i.path)
    .slice(0, maxPatches);

  const patches = await Promise.all(
    paths.map(async (path) => {
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      // raw.githubusercontent.com doesn't count against the API rate limit, but only serves public repos.
      const res = repo.private
        ? await gh(`/repos/${repo.full_name}/contents/${encoded}?ref=${branch}`, { accept: "application/vnd.github.raw" })
        : await fetch(`https://raw.githubusercontent.com/${repo.full_name}/${branch}/${encoded}`);
      // Parsed right away so only the per-file text is kept, not a second copy of each patch.
      return res.ok ? parseUnifiedDiff(await res.text()) : [];
    }),
  );

  return { readme_html: readme.ok ? await readme.text() : null, files: patches.flat() };
}
