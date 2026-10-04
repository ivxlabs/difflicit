# Difflicit

Patch diffing and analysis for CVEs. **ivx/xnu** (Apple CVEs, at xnu.ivx.run) is the instance this repository runs. Pick a CVE, see what Apple and NVD say about it, and read the patch
that fixed it in a GitHub Desktop-style diff viewer. Bring your own analyses: any GitHub repository named after a
CVE shows up next to it, private ones included.

It is a static site: no server, no database, no accounts.

## How it works

```
GitHub Actions (weekly)                        Browser (this Vite app, on GitHub Pages)
  scripts/main.py                                │
  Apple advisories + NVD ──► JSON ──► CDN ──────►│  CVE list + details   (cdn.ivx.run/applesec/api)
                                                 │
  GitHub repos named CVE-YYYY-NNNN ─────────────►│  write-ups + diffs    (api.github.com, directly)
```

- **CVE data**: the scrape workflow writes a static JSON API and syncs it to an S3-compatible bucket behind a CDN.
  It is sharded so a browser only downloads the slice it is looking at:
  - `index.json`: totals and the list of shards (a few KB).
  - `years/2026.json`: summaries of the CVEs whose id is `CVE-2026-*` (severity, components, impact, platforms,
    analyzed). Typing a CVE id loads its year.
  - `components/kernel.json`: the same, for every CVE Apple lists under one component, all years.
  - `cves/CVE-YYYY-NNNN.json`: the NVD data and every Apple advisory entry for one CVE.
- **Analyses** are GitHub repositories named `CVE-YYYY-NNNN`. The app renders `README.md` as the write-up and every
  `*.diff` / `*.patch` file in the diff viewer. It looks in:
  - `<org>/CVE-…`, the published analysis (org = owner of the repo this site is built from, e.g. `ivxlabs`)
  - that repo's forks
  - with a token connected: every repo the token can see with that name, private ones included
- **Contributing**: connect GitHub, fork an analysis, push your changes, and open a pull request. Merged changes
  show up immediately.
- **GitHub access**, two ways, chosen at build time:
  - *Bring your own token* (default): a GitHub personal access token, kept in the browser's local storage and only
    ever sent to `api.github.com`.
  - *Sign In*: builds that set the three `SUPABASE_URL`, `SUPABASE_CLIENT_ID` and `IAM_URL` repository
    variables sign users in with their ivx account ([iam.ivx.run](https://iam.ivx.run), OAuth 2.1 + PKCE) and use
    GitHub through iam's `/api/github` proxy, which holds the GitHub token; the browser never sees it. Without those
    variables none of this code is in the build.

  Without either, GitHub allows 60 anonymous API requests an hour.

## Configuring an instance

An instance is set up in `difflicit.config.json`:

| Key | What |
| --- | --- |
| `name` | Shown under the Difflicit logo, in page titles and in shared posts, e.g. `ivx/xnu` |
| `icon` | Shown next to the name, e.g. `💀` |
| `apiBase` | Where the JSON API lives; the `API_BASE` repository variable overrides it |
| `projectRepo` | The repository the Star button points at; CI uses the repository being built instead |

## Local development

```sh
npm install
(cd scripts && uv run main.py --out ../public/api)   # or add --limit 20 for a quick sample
VITE_API_BASE=/api npm run dev
```

To try "Sign In" locally, also set `VITE_SUPABASE_URL`, `VITE_SUPABASE_CLIENT_ID` and `VITE_IAM_URL`
(e.g. in `.env.local`), and add `http://localhost:5173` to iam's `GITHUB_ORIGINS` in its `.dev.vars`.

Set `ANALYSIS_ORG=<account>` for the scrape to mark CVEs as analyzed from another account's `CVE-*` repos.

## Deploying

**GitHub Pages:** *Settings → Pages → Source: GitHub Actions*, and optionally a custom domain (e.g. `xnu.ivx.run`).
`.github/workflows/pages.yml` builds and deploys on every push to `main`.

**JSON API on Cloudflare R2** (any S3-compatible storage works):

1. Create a bucket and connect a custom domain to it (e.g. `cdn.ivx.run`).
2. Add a CORS rule allowing `GET` from the site's origin (e.g. `https://xnu.ivx.run`).
3. Create an R2 API token with *Object Read & Write* on that bucket.
4. In the GitHub repo, set:
   - **variables**:
     - `S3_ENDPOINT`: `https://<account-id>.r2.cloudflarestorage.com`
     - `S3_BUCKET`: the bucket name
     - `S3_PREFIX`: optional, defaults to `applesec/api`
     - `API_BASE`: optional, defaults to `https://cdn.ivx.run/applesec/api`
   - **secrets**: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
5. Run the `scrape` workflow once by hand. It then runs weekly; run it again after publishing a new analysis repo to
   refresh the "analyzed" flags (the CVE page itself always checks GitHub live).

**Sign In** (optional, for the hosted xnu.ivx.run):

1. In Supabase, *Authentication → OAuth Server → Clients*: add a **public** client (no secret) for the site, with
   redirect URI `https://xnu.ivx.run/` (and `http://localhost:5173/` for development).
2. In iam.ivx.run's `wrangler.jsonc`, add the client id to `GITHUB_CLIENTS` and the site to `GITHUB_ORIGINS`.
3. In this repo, set the variables `SUPABASE_URL` (`https://<project>.supabase.co`), `SUPABASE_CLIENT_ID` and
   `IAM_URL` (`https://iam.ivx.run`).

Users then allow GitHub access once, on their ivx account page.

## License

[GPL-3.0-only](LICENSE)
