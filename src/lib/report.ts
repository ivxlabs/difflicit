// SPDX-License-Identifier: GPL-3.0-only
// Analyze's output: what a change was probably about (lib/predict.ts), written up as a diffmd note for the
// project, with the lines each finding rests on as patch excerpts the user can check and edit.
import type { AnalysisContent, BinaryFunction } from "../types";
import { shortVersion } from "./analysis";
import { artifactFunctionDiff } from "./desktop";
import { type DiffFile, type DiffLine, diffLines, parseUnifiedDiff } from "./diff";
import { type Prediction, predict } from "./predict";

/** How many of a binary's functions are disassembled for the prediction: the most changed first. */
const MAX_FUNCTIONS = 16;
/** A removed function counts as this many removed lines (it has no diff of its own to count). */
const REMOVED_FUNCTION_LINES = 20;
/** Lines of the diff shown around each piece of evidence. */
const CONTEXT = 3;

/** The disassembly diffs of a binary's most changed functions, named by function (as the sidebar opens them). */
async function functionDiffs(content: AnalysisContent, functions: BinaryFunction[]): Promise<DiffFile[]> {
  const { project, artifact, base, head, baseArtifact } = content;
  if (!project || !artifact || !base || !head) return [];
  const picked = functions
    .filter((f) => f.status === "changed" || f.status === "added")
    .sort((a, b) => (a.status === b.status ? a.similarity - b.similarity : a.status === "changed" ? -1 : 1))
    .slice(0, MAX_FUNCTIONS);
  const out: DiffFile[] = [];
  // A few at a time: each runs radare2 on both binaries.
  for (let i = 0; i < picked.length; i += 4) {
    const batch = await Promise.all(
      picked.slice(i, i + 4).map(async (fn) => {
        const text = await artifactFunctionDiff(project, artifact, base, head, fn.name, fn.base_addr, fn.head_addr, baseArtifact);
        return parseUnifiedDiff(text).map((f) => ({ ...f, path: fn.name }));
      }),
    );
    out.push(...batch.flat());
  }
  return out;
}

/** Predict what the change on screen was about; `files` are the diffs the evidence points into. */
export async function analyzeChange(content: AnalysisContent): Promise<{ prediction: Prediction; files: DiffFile[] }> {
  const binary = content.binary;
  if (!binary) return { prediction: predict(content.files), files: content.files };
  const files = await functionDiffs(content, binary);
  const removed = binary.filter((f) => f.status === "removed").length;
  return { prediction: predict(files, { asm: true, extraRemoved: removed * REMOVED_FUNCTION_LINES }), files };
}

/** A hunk of `lines[from..to]` (no hunk headers inside), with its own header so it stands alone. */
function hunk(lines: DiffLine[], from: number, to: number): string {
  const part = lines.slice(from, to + 1);
  const oldNos = part.filter((l) => l.oldNo !== undefined);
  const newNos = part.filter((l) => l.newNo !== undefined);
  const sign = { add: "+", del: "-", context: " ", hunk: "" };
  return [
    `@@ -${oldNos[0]?.oldNo ?? 0},${oldNos.length} +${newNos[0]?.newNo ?? 0},${newNos.length} @@`,
    ...part.map((l) => sign[l.type] + l.text),
  ].join("\n");
}

/** The diff around some lines of a file (indices into diffLines), as a diffmd ```diff block. */
function excerpt(file: DiffFile, at: number[]): string {
  const lines = diffLines(file);
  // Each line's window, kept inside its hunk, with overlapping windows merged.
  const ranges: [number, number][] = [];
  for (const i of [...at].sort((a, b) => a - b)) {
    let from = i;
    let to = i;
    while (from > 0 && i - from < CONTEXT && lines[from - 1].type !== "hunk") from--;
    while (to < lines.length - 1 && to - i < CONTEXT && lines[to + 1].type !== "hunk") to++;
    const last = ranges[ranges.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else ranges.push([from, to]);
  }
  const header = [
    `--- ${file.status === "added" ? "/dev/null" : `a/${file.oldPath || file.path}`}`,
    `+++ ${file.status === "deleted" ? "/dev/null" : `b/${file.path}`}`,
  ].join("\n");
  return ["```diff", header, ...ranges.map(([from, to]) => hunk(lines, from, to)), "```"].join("\n");
}

const strength = (score: number) => (score >= 8 ? "strong" : score >= 4 ? "likely" : "weak");
const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

/** The analysis as a diffmd note: the headline, what was compared, and each finding with its evidence. */
export function reportNote(content: AnalysisContent, { prediction, files }: { prediction: Prediction; files: DiffFile[] }): string {
  const { binary, artifact, baseArtifact, base, head } = content;
  const compared = `${baseArtifact?.name ?? artifact?.name} ${shortVersion(base)} → ${artifact?.name} ${shortVersion(head)}`;
  const scope = binary
    ? (["changed", "added", "removed"] as const).map((s) => count(binary.filter((f) => f.status === s).length, `${s} function`)).join(", ")
    : `${count(prediction.stats.files, "file")}, +${prediction.stats.additions} −${prediction.stats.deletions}`;
  const out = [
    `# ${prediction.headline}`,
    `**${compared}** · ${scope}${binary ? ` (disassembly of the ${Math.min(MAX_FUNCTIONS, files.length)} most changed functions)` : ""}.`,
    "> Predicted by Difflicit's Analyze from patterns in the diff, without AI. Check each finding against its lines, and make these notes your own.",
  ];
  for (const f of prediction.findings) {
    out.push(`## ${f.label} (${strength(f.score)})`, f.why);
    const byFile = new Map<string, number[]>();
    for (const e of f.evidence) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e.line]);
    for (const [path, at] of byFile) {
      const file = files.find((d) => d.path === path);
      if (file) out.push(excerpt(file, at));
    }
  }
  if (!prediction.findings.length)
    out.push("## What changed", "Nothing here matched a known pattern. Look through the diff and write down what you find.");
  return out.join("\n\n") + "\n";
}
