// SPDX-License-Identifier: GPL-3.0-only
import { GITHUB_API } from "../config";
import type { Artifact, Repo, RepoContent, Viewer } from "../types";
import { CONNECT_LABEL, access } from "./access";
import { parseUnifiedDiff } from "./diff";
import { ANALYSIS_FILE, analysisFile, parseAnalysisFile, projectOfRepo, repoName, sameId } from "./projects";
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

/** The artifacts a GitHub analysis declares in its analysis.json, or [] for stored patches. */
export async function githubArtifacts(repo: Repo): Promise<Artifact[]> {
  const res = await gh(`/repos/${repo.full_name}/contents/analysis.json`, { accept: "application/vnd.github.raw" });
  if (!res.ok) return [];
  try {
    return (JSON.parse(await res.text()).artifacts as Artifact[]) ?? [];
  } catch {
    return [];
  }
}

/** The GitHub user the app acts as; null when not connected. */
export const viewer = async () =>
  (await access.authorization()) ? ghJson<Viewer>("/user") : null;

export async function fork(fullName: string): Promise<Repo> {
  const res = await gh(`/repos/${fullName}/forks`, { method: "POST" });
  if (!res.ok) throw new Error(`GitHub refused the fork (${res.status}).`);
  return res.json();
}

/**
 * A new analysis of project `id`, in the user's account or an org (`owner`): a repository named by the instance's
 * convention, with a README to start from and the analysis.json that makes it an analysis.
 */
export async function createAnalysis(owner: string | null, id: string, description: string, isPrivate: boolean): Promise<Repo> {
  const name = repoName(id);
  const res = await gh(owner ? `/orgs/${owner}/repos` : "/user/repos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, description, private: isPrivate, auto_init: true }),
  });
  const where = owner ?? "your account";
  if (res.status === 422) throw new Error(`There is already a repository named ${name} in ${where}.`);
  if (res.status === 403 || res.status === 404) {
    throw new Error(`GitHub won't let you create repositories in ${where}. You need to be a member allowed to create them.`);
  }
  if (!res.ok) throw new Error(`GitHub refused to create the repository (${res.status}).`);
  const repo: Repo = await res.json();
  const file = await gh(`/repos/${repo.full_name}/contents/${ANALYSIS_FILE}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: `Analysis of ${id}`, content: base64(analysisFile(id)) }),
  });
  if (!file.ok) throw new Error(`Created ${repo.full_name}, but couldn't add ${ANALYSIS_FILE} to it (${file.status}).`);
  return repo;
}

/**
 * Every repo the user can see (private ones included) whose name follows the convention, as candidates: whether
 * each really is an analysis (has an analysis.json) is only checked when its project is opened.
 */
export const myAnalysisRepos = cached(async () =>
  (await access.authorization())
    ? (await ghAll<Repo>("/user/repos?affiliation=owner,collaborator,organization_member")).filter((r) => projectOfRepo(r.name))
    : [],
);
access.subscribe(myAnalysisRepos.reset);

const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

/** A file's text on the default branch; null when it's missing. */
async function fileText(repo: Repo, path: string): Promise<string | null> {
  const branch = encodeURIComponent(repo.default_branch);
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  // raw.githubusercontent.com doesn't count against the API rate limit, but only serves public repos.
  const res = repo.private
    ? await gh(`/repos/${repo.full_name}/contents/${encoded}?ref=${branch}`, { accept: "application/vnd.github.raw" })
    : await fetch(`https://raw.githubusercontent.com/${repo.full_name}/${branch}/${encoded}`);
  return res.ok ? res.text() : null;
}

/** Whether the repository is an analysis of project `id`: its analysis.json says so. */
const analyzes = async (repo: Repo, id: string) => {
  const project = parseAnalysisFile((await fileText(repo, ANALYSIS_FILE)) ?? "");
  return project !== null && sameId(project, id);
};

/**
 * The analyses of a project: the owner's (the published one), its forks, and the user's own. Forks keep the
 * published analysis.json, so only the others are checked.
 */
export async function analysisRepos(owner: string, id: string): Promise<Repo[]> {
  const [published, mine] = await Promise.all([getRepo(`${owner}/${repoName(id)}`), myAnalysisRepos()]);
  const candidates = [published, ...mine.filter((r) => sameId(projectOfRepo(r.name) ?? "", id))].filter((r): r is Repo => !!r);
  const checked = await Promise.all(candidates.map(async (r) => ((await analyzes(r, id)) ? r : null)));
  const upstream = checked[0] === published ? published : null;
  const forks = upstream?.forks_count ? await ghAll<Repo>(`/repos/${upstream.full_name}/forks?sort=newest`) : [];
  return uniqueBy([...checked, ...forks].filter((r): r is Repo => !!r), (r) => r.full_name);
}

const contents = new Map<string, () => Promise<RepoContent>>();

/**
 * README (rendered by GitHub) and every *.diff / *.patch file on the default branch. Fetched once per push, so
 * the analysis and its search (⌘K) share it.
 */
export function repoContent(repo: Repo): Promise<RepoContent> {
  const key = `${repo.full_name}@${repo.pushed_at}`;
  if (!contents.has(key)) contents.set(key, cached(() => fetchContent(repo)));
  return contents.get(key)!();
}

async function fetchContent(repo: Repo, maxPatches = 30): Promise<RepoContent> {
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
      const text = await fileText(repo, path);
      // Parsed right away so only the per-file text is kept, not a second copy of each patch.
      return text ? parseUnifiedDiff(text) : [];
    }),
  );

  return { readme_html: readme.ok ? await readme.text() : null, files: patches.flat() };
}
