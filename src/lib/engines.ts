// SPDX-License-Identifier: GPL-3.0-only
// Analysis engines: what Analyze runs on two artifacts to write up their change as diffmd. One is built in (the
// pattern prediction in predict.ts); the others are command-line tools the user installs (`brew install …`),
// open source or proprietary, which Difflicit finds on the PATH and runs (src-tauri/src/engines.rs).
// Protocol: https://ivx.run/docs/difflicit/engines/
import { ENGINES } from "../config";
import type { Artifact, Location } from "../types";
import { type Pair, loadAnalysis } from "./analysis";
import { type EngineInfo, listEngines, runEngine } from "./desktop";
import { analyzeChange, reportNote } from "./report";

export type Engine = EngineInfo & {
  builtIn?: boolean;
  /** How to install it, when it isn't (from the instance's settings). */
  install?: string;
  /** Added by the user (and so removable from the list), rather than one the instance offers. */
  added?: boolean;
};

/** The engine every install has: free, and needs nothing else. */
export const BUILT_IN: Engine = {
  command: "",
  name: "Difflicit patterns",
  description: "Predicts what a change was about from the patterns fixes leave in a diff, without AI.",
  license: "GPL-3.0-only",
  installed: true,
  builtIn: true,
};

const ADDED = "difflicit-engines";
const CHOICE = "difflicit-engine";

/** Engines the user added (commands or paths), beyond the instance's. */
const added = (): string[] => JSON.parse(localStorage.getItem(ADDED) ?? "[]");
export const addEngine = (command: string) => localStorage.setItem(ADDED, JSON.stringify([...new Set([...added(), command])]));
export const forgetEngine = (command: string) => localStorage.setItem(ADDED, JSON.stringify(added().filter((c) => c !== command)));

/** Every engine Difflicit knows of: built in, the instance's, and the user's, each found (or not) on this computer. */
export async function loadEngines(): Promise<Engine[]> {
  const extra = added().filter((c) => !ENGINES.some((e) => e.command === c));
  const found = await listEngines([...ENGINES.map((e) => e.command), ...extra]);
  const engines = found.map((e) => ({ ...e, install: ENGINES.find((x) => x.command === e.command)?.install, added: extra.includes(e.command) }));
  // One that isn't installed is only worth listing with a way to install it (or if the user added it).
  return [BUILT_IN, ...engines.filter((e) => e.installed || e.install || e.added)];
}

/** Engines Analyze can run now. */
export const usable = (engines: Engine[]) => engines.filter((e) => e.installed && !e.problem);

/** The engine Analyze last ran (its command; "" for the built-in one), offered first next time. */
export const lastEngine = () => localStorage.getItem(CHOICE) ?? BUILT_IN.command;

/** Analyze `pair` in a project folder with `engine`; returns the analysis as diffmd. */
export async function analyzeWith(engine: Engine, location: Extract<Location, { kind: "local" }>, artifacts: Artifact[], { before, after }: Pair) {
  localStorage.setItem(CHOICE, engine.command);
  const baseArtifact = before.artifact === after.artifact ? undefined : before.artifact;
  if (engine.builtIn) {
    const content = await loadAnalysis(location, after.artifact, before.version, after.version, baseArtifact);
    return reportNote(content, await analyzeChange(content));
  }
  const find = (name: string) => {
    const a = artifacts.find((x) => x.name === name);
    if (!a) throw new Error(`No artifact ${name}.`);
    return a;
  };
  return runEngine(engine.command, location.path, find(after.artifact), before.version, after.version, baseArtifact ? find(baseArtifact) : undefined);
}
