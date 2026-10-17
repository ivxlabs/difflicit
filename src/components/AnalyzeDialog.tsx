// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useState } from "react";
import { ArrowSwitchIcon, XIcon } from "@primer/octicons-react";
import type { Artifact } from "../types";
import { type Pair, type Side, defaultPair, versionOptions } from "../lib/analysis";
import { BUILT_IN, type Engine, lastEngine, loadEngines, usable } from "../lib/engines";
import { gitVersions } from "../lib/desktop";
import { useAsync } from "../lib/util";
import { DocsLink } from "./BlankSlate";

/** One side of the comparison: an artifact and one of its versions. */
function SidePicker({ label, project, artifacts, side, fallback, onChange }: {
  label: string;
  project: string;
  artifacts: Artifact[];
  side: Side;
  /** Which version to pick when the artifact changes: the newest (after) or the one before it (before). */
  fallback: "base" | "head";
  onChange: (side: Side) => void;
}) {
  const artifact = artifacts.find((a) => a.name === side.artifact) ?? artifacts[0];
  const [refs] = useAsync(() => (artifact.kind === "git" ? gitVersions(project, artifact.repo) : null), [artifact.name]);
  const options = versionOptions(artifact, refs);
  const shown = side.version || (defaultPair(options)[fallback] ?? "");
  // Commit the default the dropdown shows (a git artifact's refs arrive after it's picked).
  useEffect(() => {
    if (!side.version && shown) onChange({ ...side, version: shown });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  return (
    <div className="analyze-side">
      <div className="analyze-side-label">{label}</div>
      <label className="field">
        <span>Artifact</span>
        <select
          className="select"
          value={artifact.name}
          onChange={(e) => {
            const next = artifacts.find((a) => a.name === e.target.value)!;
            // A file artifact's versions are known now; a git artifact's load, so its first is picked after.
            onChange({ artifact: next.name, version: next.kind === "file" ? (defaultPair(versionOptions(next))[fallback] ?? "") : "" });
          }}
        >
          {artifacts.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name} ({a.kind})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Version</span>
        <select
          className="select"
          value={shown}
          onChange={(e) => onChange({ ...side, version: e.target.value })}
          disabled={!options.length}
        >
          {!options.length && <option value="">{artifact.kind === "git" ? "Loading…" : "No versions"}</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * Desktop: pick the two things to compare — two versions of one artifact, or versions of two artifacts — and the
 * engine that analyzes what changed between them, into a diffmd note in the project.
 */
export function AnalyzeDialog({ project, artifacts, initial, enginesChanged, onAnalyze, onManageEngines, onClose }: {
  project: string;
  artifacts: Artifact[];
  initial: Pair;
  /** Analyze the pair with the engine and write it up in the project; a rejection is shown here. */
  onAnalyze: (pair: Pair, engine: Engine) => Promise<void>;
  onManageEngines: () => void;
  /** Changes when engines were installed or removed, to list them again. */
  enginesChanged: number;
  onClose: () => void;
}) {
  const [before, setBefore] = useState(initial.before);
  const [after, setAfter] = useState(initial.after);
  // The engines installed on this computer (the built-in one first).
  const [known] = useAsync(() => loadEngines(), [], [enginesChanged]);
  const engines: Engine[] = known ? usable(known) : [BUILT_IN];
  const [command, setCommand] = useState(lastEngine);
  const engine = engines.find((e) => e.command === command) ?? BUILT_IN;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = (name: string) => artifacts.find((a) => a.name === name)?.kind;
  const problem =
    before.artifact !== after.artifact && (kind(before.artifact) === "git" || kind(after.artifact) === "git")
      ? "A git repository can only be compared with its own versions: pick two versions of the same repository."
      : !before.version || !after.version
        ? "Pick a version on both sides."
        : before.artifact === after.artifact && before.version === after.version
          ? "That's the same version twice: pick two different ones."
          : null;

  const analyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      await onAnalyze({ before, after }, engine);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal analyze-dialog" onSubmit={analyze}>
        <header>
          <span className="grow">Analyze a change</span>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            <XIcon size={16} />
          </button>
        </header>
        <div className="content">
          <p className="muted">
            Pick what to compare and an engine to analyze it. The analysis is written up as a note in the project, for
            you to check and edit. <DocsLink page="analyses" />
          </p>
          {!artifacts.length ? (
            <div className="notice">Add an artifact first: there's nothing to compare yet.</div>
          ) : (
            <div className="analyze-sides">
              <SidePicker label="Before" project={project} artifacts={artifacts} side={before} fallback="base" onChange={setBefore} />
              <button
                type="button"
                className="btn ghost analyze-swap"
                onClick={() => {
                  setBefore(after);
                  setAfter(before);
                }}
                title="Swap before and after"
                aria-label="Swap before and after"
              >
                <ArrowSwitchIcon size={16} />
              </button>
              <SidePicker label="After" project={project} artifacts={artifacts} side={after} fallback="head" onChange={setAfter} />
            </div>
          )}
          <div className="analyze-engine">
            <label className="field">
              <span>Engine</span>
              <select className="select" value={engine.command} onChange={(e) => setCommand(e.target.value)}>
                {engines.map((e) => (
                  <option key={e.command} value={e.command}>
                    {e.name}
                    {e.version ? ` ${e.version}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn ghost" onClick={onManageEngines}>
              Manage engines…
            </button>
          </div>
          {engine.description && <div className="muted small-note">{engine.description}</div>}
          {problem && artifacts.length > 0 && <div className="muted small-note">{problem}</div>}
          {error && <div className="notice error">{error}</div>}
        </div>
        <footer>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={Boolean(problem) || !artifacts.length || busy}>
            {busy ? "Analyzing…" : "Analyze"}
          </button>
        </footer>
      </form>
    </div>
  );
}
