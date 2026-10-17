#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Versions and releases. The version lives in package.json (semver); the desktop app reads it from there
// (src-tauri/tauri.conf.json), and a pushed vX.Y.Z tag builds and drafts the release (.github/workflows/desktop.yml).
//
//   npm run bump -- <patch|minor|major|prerelease|X.Y.Z[-pre]>   set the version, e.g. to build it locally
//   npm run release [-- <same as bump>] [--prompt "<text>"]      (bump,) commit, tag vX.Y.Z and push it
//   npm run release:notes [-- --prompt "<text>"]                 just draft the release notes, to see them
//
// Pre-release versions (1.2.0-beta.1, or `prerelease --preid beta`) become pre-releases on GitHub.
//
// Release notes: if Ollama is running, a local model (RELEASE_NOTES_MODEL, default gemma4) drafts them from the
// commits since the last release, to accept, edit or skip. `--prompt` tells it what you want, e.g.
// `npm run release -- --prompt "Our first release: write an introduction"` (npm needs the `--` before it). They go in the tag's message, and the release workflow
// puts them in the draft release; without them it lists the commits.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const VERSION_FILES = ["package.json", "package-lock.json"];
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", ...opts }).trimEnd(); // not trim(): `git status --porcelain` lines start with a space
const git = (...args) => run("git", args);
const version = () => JSON.parse(readFileSync("package.json", "utf8")).version;

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** Set the version in package.json and package-lock.json; no commit, no tag. */
function bump(args) {
  if (!args.length) fail("Which version? e.g. `npm run bump -- patch`, `minor`, `major`, `prerelease --preid beta` or `1.4.0`.");
  const before = version();
  try {
    run("npm", ["version", ...args, "--no-git-tag-version", "--allow-same-version"], { stdio: "pipe" });
  } catch (e) {
    fail(String(e.stderr).match(/npm error (.*)/)?.[1] ?? `Couldn't set the version to ${args.join(" ")}.`);
  }
  if (!SEMVER.test(version())) fail(`${version()} isn't a semantic version.`);
  console.log(`Version ${before} → ${version()}`);
}

const OLLAMA = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const MODEL = process.env.RELEASE_NOTES_MODEL ?? "gemma4";

/** Pull `--prompt <text>` (or `--prompt=<text>`) out of the arguments; the rest are left for bump. */
function takePrompt(args) {
  const i = args.findIndex((a) => a === "--prompt" || a.startsWith("--prompt="));
  if (i < 0) return "";
  const [flag] = args.splice(i, 1);
  if (flag.includes("=")) return flag.slice("--prompt=".length).trim();
  if (i >= args.length) fail('--prompt needs the text to give the model: --prompt "…"');
  return args.splice(i, 1)[0].trim();
}

/**
 * Release notes for `tag` drafted by a local model from the commits since the last release, following `wish` (from
 * --prompt) over the usual guidelines; null without Ollama.
 */
async function draftNotes(tag, wish = "") {
  let previous = "";
  try {
    previous = git("describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD");
  } catch {
    // the first release: every commit
  }
  const log = git("log", "--no-merges", "--format=- %s%n%w(0,2,2)%b", previous ? `${previous}..HEAD` : "HEAD")
    .split("\n")
    .filter((line) => !/^- Release v\d/.test(line))
    .join("\n")
    .trim();
  if (!log) return null;
  const { description } = JSON.parse(readFileSync("package.json", "utf8"));
  const prompt = `You write release notes for Difflicit ${tag}. Difflicit: ${description}
${wish ? `\nWhat the person making the release wants, which comes first, before any of the defaults below:\n${wish}\n` : ""}
Here are the commits since ${previous || "the start"}, with their messages:

${log}

Write the release notes in GitHub Markdown, for people who use Difflicit, not its developers. By default:
- start with one or two sentences on what this release is about;
- then "### New", "### Improved" and "### Fixed" sections, one short bullet per change, saying what users can do
  now or what works better, in plain words. Leave out a section with nothing in it entirely, heading and all:
  never write a placeholder such as "no fixes";
- leave out purely internal changes (refactoring, tests, CI, typos) unless users would notice them;
- don't invent anything the commits don't say, don't name commits or hashes, and add no other headings, no title
  and no download instructions;
- keep a plain, factual tone: don't call the release major, exciting or powerful;
- at most 250 words.
${wish ? `\nRemember what was asked first: ${wish}\n` : ""}
Reply with the notes only.`;
  console.log(`\nDrafting release notes with ${MODEL} (Ollama)…`);
  try {
    const res = await fetch(`${OLLAMA}/api/generate`, {
      method: "POST",
      body: JSON.stringify({ model: MODEL, prompt, stream: false }),
      signal: AbortSignal.timeout(5 * 60_000),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    const { response } = await res.json();
    // Models sometimes think aloud first, or fence their answer.
    const notes = response.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^\s*```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/, "$1").trim();
    return dropEmptySections(notes) || null;
  } catch (e) {
    console.log(`  Skipped: couldn't reach ${MODEL} at ${OLLAMA} (${e.message}). The release lists the commits instead.`);
    return null;
  }
}

/** Without the placeholders a model writes instead of leaving a section out ("No fixes."), or the sections they leave empty. */
function dropEmptySections(notes) {
  // A line saying there's nothing here ("No user-facing fixes.", "None."), not one about something ("None of …").
  const placeholder = /^[-*\s_(]*((no|none)\b[^.]*\b(fix(es)?|changes?|improvements?|updates?|features?|notes?)\b[^.]*|none|n\/a)[.)_*\s]*$/i;
  return notes
    .split("\n")
    .filter((line) => !placeholder.test(line.trim()))
    .join("\n")
    .split(/^(?=#{2,3} )/m)
    .filter((section) => !/^#{2,3} /.test(section) || section.split("\n").slice(1).some((l) => l.trim()))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Show the drafted notes and ask what to do with them: use them as they are, edit them first, or leave them out. */
async function reviewNotes(notes) {
  if (!notes) return null;
  if (!process.stdin.isTTY) return notes;
  for (;;) {
    console.log(`\n${"─".repeat(60)}\n${notes}\n${"─".repeat(60)}`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("Use these release notes? [Y]es / [e]dit / [n]o, list the commits: ")).trim().toLowerCase();
    rl.close();
    if (answer === "" || answer.startsWith("y")) return notes;
    if (answer.startsWith("n")) return null;
    if (answer.startsWith("e")) {
      const file = join(mkdtempSync(join(tmpdir(), "difflicit-notes-")), "notes.md");
      writeFileSync(file, notes + "\n");
      const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vi";
      spawnSync(editor, [file], { stdio: "inherit", shell: true });
      notes = readFileSync(file, "utf8").trim();
      if (!notes) return null;
    }
  }
}

async function release(args) {
  const wish = takePrompt(args);
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch === "HEAD") fail("Check out a branch first; you're on a detached HEAD.");
  const dirty = git("status", "--porcelain")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3))
    .filter((file) => !VERSION_FILES.includes(file));
  if (dirty.length) fail(`Commit or stash your changes first:\n  ${dirty.join("\n  ")}`);

  git("fetch", "--quiet", "--tags", "origin");
  let behind = 0;
  try {
    behind = Number(git("rev-list", "--count", "HEAD..@{upstream}"));
  } catch {
    // not on origin yet; the push creates it
  }
  if (behind) fail(`${branch} is ${behind} commit(s) behind origin; pull first.`);

  if (args.length) bump(args);
  const tag = `v${version()}`;
  if (!SEMVER.test(version())) fail(`${version()} isn't a semantic version.`);
  if (git("tag", "--list", tag)) fail(`${tag} already exists. Bump the version: \`npm run release -- patch\`.`);

  const notes = await reviewNotes(await draftNotes(tag, wish));

  const pre = version().includes("-");
  console.log(`\nRelease ${tag}${pre ? " (pre-release)" : ""} from ${branch}:`);
  console.log(`  commit the version, tag ${tag}, push ${branch} and ${tag} to origin;`);
  console.log(`  GitHub Actions then builds macOS, Windows and Linux and drafts the release${notes ? " with these notes" : ""}.`);
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Go ahead? [y/N] ");
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) fail("Stopped; nothing was committed or pushed.");
  }

  if (git("status", "--porcelain", "--", ...VERSION_FILES)) {
    git("add", "--", ...VERSION_FILES);
    git("commit", "--quiet", "-m", `Release ${tag}`);
  }
  // The notes ride in the tag's message (kept verbatim: their "### " headings aren't comments).
  git("tag", "-a", tag, "--cleanup=verbatim", "-m", `Difflicit ${tag}${notes ? `\n\n${notes}` : ""}`);
  // Both or neither: a tag pushed without its commit would build the wrong thing.
  git("push", "--atomic", "origin", branch, `refs/tags/${tag}`);

  const remote = git("remote", "get-url", "origin").replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
  console.log(`\n✓ Pushed ${tag}. Builds: ${remote}/actions — then review and publish the draft: ${remote}/releases`);
}

const [command, ...args] = process.argv.slice(2);
if (command === "bump") bump(args);
else if (command === "release") await release(args);
else if (command === "notes") {
  const wish = takePrompt(args);
  console.log((await draftNotes(`v${version()}`, wish)) ?? "No notes: nothing new since the last release, or no model.");
}
else fail("Usage: release.mjs bump <version> | release [<version>] | notes");
