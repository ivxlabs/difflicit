# AGENTS.md

Instructions for AI coding agents working on Difflicit. Humans: see [README.md](README.md).

Difflicit shows the patch behind a project: a React web app (and a Tauri desktop app) over a static JSON catalog
of projects, where each analysis is a GitHub repository with an `analysis.json` naming its project. The app is
generic; an instance (`difflicit.config.json`) says what a project is and how analyses are named. On ivx/xnu,
projects are Apple CVEs. Read the README's *How it works* first.

## Principles: always DRY and KISS

- **Keep it simple (KISS).** Write the smallest change that solves the problem. No speculative options,
  abstractions, layers or configuration for needs nobody has yet. The app is a static site with no server or
  database by design; keep it that way.
- **Don't repeat yourself (DRY).** Before writing something, look for it: `src/lib/` (GitHub calls, routing,
  project naming, `useAsync`, `cached`, `uniqueBy`), `src/config.ts` (every build setting), the existing dialogs and CSS
  classes (`.modal`, `.choice`, `.notice`, `.btn`). Reuse or extend them rather than adding a second version.
  One source of truth for each fact, e.g. the version lives only in `package.json`.
- **Don't add dependencies** when a few lines will do. Every package ends up in users' browsers or installers.
- **Match the surrounding code**: its naming, idiom, formatting and comment density. Comments explain *why*,
  in plain words; don't narrate what the code says.

## Layout

| Path | What |
| --- | --- |
| `src/` | The web app (React 19, TypeScript, Vite). `App.tsx` is the shell, `components/` the UI. |
| `src/lib/` | GitHub API (`github.ts`), the diff an analysis shows (`analysis.ts`), project naming (`projects.ts`), auth (`access.ts`), routing (`route.ts`), diff parsing (`diff.ts`), desktop bridge (`desktop.ts`). |
| `src/types.ts` | The catalog format every instance's API follows. |
| `src/iam/` | Optional "Sign In" with iam.ivx.run. Only built when `__IAM__` is true; must not run at import time. |
| `src-tauri/` | The desktop app (Tauri 2, Rust). Local capabilities are Tauri commands in `src/lib.rs`; artifacts and diffing (git, radare2, ipsw) in `src/diff.rs`; the project tree's file views and notes in `src/info.rs`; the VNC bridge in `src/vnc.rs`. |
| `scripts/main.py` | ivx/xnu's scraper: Apple advisories + NVD into the catalog (Python, run with `uv`). |
| `scripts/release.mjs` | Version bumps and releases. |
| `difflicit.config.json` | Instance settings: name, icon, API base, and `projects` (label, owner, naming convention). |
| `analysis.schema.json` | The schema of the project file (`difflicit.json` / `analysis.json`). Notes are diffmd: https://ivx.run/docs/difflicit/diffmd/ |
| `.github/workflows/` | `pages` (site), `scrape` (data, weekly), `desktop` (release builds on `v*` tags). |

## Build and check

```sh
npm install
(cd scripts && uv run main.py --limit 20 --out ../public/api)   # sample data for local development
VITE_CATALOG=/api npm run dev                                   # web app on http://localhost:5173
npm run tauri dev                                               # desktop app (needs Rust)
```

Before you open a pull request, everything you touched must pass:

```sh
npm run build                                          # typecheck + production build
(cd src-tauri && cargo clippy && cargo test)           # if you touched src-tauri/
(cd scripts && uv run main.py --limit 5 --out /tmp/api)  # if you touched the scraper
```

Then run the app and try the change yourself. Say in the pull request what you tested and how.

Never commit build output or data: `dist/`, `public/api/`, `scripts/out/`, `src-tauri/target/`.
Don't bump versions, create tags or run `npm run release`; maintainers release.

## Rules that matter here

- **License headers.** Every source file starts with `SPDX-License-Identifier: GPL-3.0-only` in a comment.
- **Security.** The app holds GitHub credentials and renders README HTML from arbitrary repositories:
  - Sanitize any HTML from GitHub (DOMPurify) before rendering it.
  - Keep the Content Security Policy in `vite.config.ts` tight; widen it only for a specific, stated reason.
  - A personal access token is only ever sent to `api.github.com`; don't send it anywhere else.
  - Treat `difflicit://` links and anything from the network as untrusted. Validate the input, and ask the user
    before acting on it.
- **The website stays static.** No server code, no database, no tracking.
- **The app stays generic.** Nothing in `src/` may know what a CVE is: instance-specific wording comes from
  `difflicit.config.json`, and instance-specific data from the catalog. CVE logic belongs in `scripts/main.py`.
- **Builds without Sign In must keep working.** Code using `src/iam/` goes behind `__IAM__`.
- **Desktop code stays out of the website.** Import Tauri modules on demand, behind `IS_DESKTOP`.

## Pull requests from AI agents

We welcome pull requests written by AI models working on open source. Each one must say, in its description
(the pull request template has the fields):

1. **Model**: which AI model wrote it, with its version (e.g. `claude-opus-5-5`, `gpt-…`).
2. **Operator**: the human controlling the agent and responsible for the pull request (name and GitHub handle).
3. **Project**: the project you're using Difflicit in or for (name and link), or "contributing to Difflicit".

Pull requests that leave any of these out are closed without review. Keep each pull request to one change,
explain why it's needed, and don't send changes you haven't built and tested.

## License: GPL-3.0-only

Difflicit is free software under the [GNU GPL, version 3 only](LICENSE). Anything that includes Difflicit's
code, or is based on it, must also be released under GPL-3.0 with its source code when you distribute it.
**Difflicit's code can't go into a closed-source project.** By contributing, you agree your contribution is
licensed under GPL-3.0-only.
