#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Versions and releases. The version lives in package.json (semver); the desktop app reads it from there
// (src-tauri/tauri.conf.json), and a pushed vX.Y.Z tag builds and drafts the release (.github/workflows/desktop.yml).
//
//   npm run bump -- <patch|minor|major|prerelease|X.Y.Z[-pre]>   set the version, e.g. to build it locally
//   npm run release [-- <same as bump>]                          (bump,) commit, tag vX.Y.Z and push it
//
// Pre-release versions (1.2.0-beta.1, or `prerelease --preid beta`) become pre-releases on GitHub.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

async function release(args) {
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

  const pre = version().includes("-");
  console.log(`\nRelease ${tag}${pre ? " (pre-release)" : ""} from ${branch}:`);
  console.log(`  commit the version, tag ${tag}, push ${branch} and ${tag} to origin;`);
  console.log("  GitHub Actions then builds macOS, Windows and Linux and drafts the release.");
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
  git("tag", "-a", tag, "-m", `Difflicit ${tag}`);
  // Both or neither: a tag pushed without its commit would build the wrong thing.
  git("push", "--atomic", "origin", branch, `refs/tags/${tag}`);

  const remote = git("remote", "get-url", "origin").replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
  console.log(`\n✓ Pushed ${tag}. Builds: ${remote}/actions — then review and publish the draft: ${remote}/releases`);
}

const [command, ...args] = process.argv.slice(2);
if (command === "bump") bump(args);
else if (command === "release") await release(args);
else fail("Usage: release.mjs bump <version> | release [<version>]");
