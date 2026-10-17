// SPDX-License-Identifier: GPL-3.0-only
import { useState } from "react";
import { AlertIcon, CheckIcon, CopyIcon, CpuIcon, LinkExternalIcon, TrashIcon, XIcon } from "@primer/octicons-react";
import { listEngines, pickFile } from "../lib/desktop";
import { type Engine, addEngine, forgetEngine, loadEngines } from "../lib/engines";
import { useAsync } from "../lib/util";
import { DocsLink } from "./BlankSlate";

/**
 * Desktop: the analysis engines Analyze can use: the built-in one, and command-line tools found on this computer.
 * Installing one is done outside Difflicit (its `brew install` line is shown); other engines can be added by
 * command name or path.
 */
export function EnginesDialog({ onClose }: { onClose: () => void }) {
  const [reads, setReads] = useState(0);
  const [engines, loadError] = useAsync(() => loadEngines(), [reads]);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reread = () => setReads((n) => n + 1);

  // Added only once it answers as an engine: found, and speaking the protocol.
  const add = async (cmd: string) => {
    const wanted = cmd.trim();
    if (!wanted) return;
    setBusy(true);
    setError(null);
    try {
      const [found] = await listEngines([wanted]);
      if (!found.installed) throw new Error(`Couldn't find ${wanted}. Install it, or give its full path.`);
      if (found.problem) throw new Error(found.problem);
      addEngine(wanted);
      setCommand("");
      reread();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal engines-dialog">
        <header>
          <span className="grow">Analysis engines</span>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            <XIcon size={16} />
          </button>
        </header>
        <div className="content">
          <p className="muted">
            An engine is a command-line tool that analyzes the change between two artifacts and writes it up as a
            note. Install more to go deeper. <DocsLink page="engines" />
          </p>
          <div className="engines-list">
            {(engines ?? []).map((e) => (
              <EngineRow
                key={e.command || "built-in"}
                engine={e}
                onForget={
                  e.added
                    ? () => {
                        forgetEngine(e.command);
                        reread();
                      }
                    : undefined
                }
              />
            ))}
            {!engines && !loadError && <div className="list-item muted">Looking for engines…</div>}
          </div>
          <form
            className="engine-add"
            onSubmit={(e) => {
              e.preventDefault();
              void add(command);
            }}
          >
            <input
              className="input mono grow"
              placeholder="Another engine: a command (acme-engine) or a path"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              aria-label="Engine command"
            />
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const path = await pickFile("The engine's program");
                if (path) await add(path);
              }}
            >
              Browse…
            </button>
            <button className="btn primary" disabled={busy || !command.trim()}>
              {busy ? "Checking…" : "Add"}
            </button>
          </form>
          {(error ?? loadError) && <div className="notice error">{error ?? loadError}</div>}
        </div>
      </div>
    </div>
  );
}

function EngineRow({ engine: e, onForget }: { engine: Engine; onForget?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className={`list-item two-line engine-row ${e.installed ? "" : "dim"}`}>
      {e.problem ? <AlertIcon size={16} /> : <CpuIcon size={16} />}
      <div className="main">
        <div className="title">
          <b>{e.name}</b>
          {e.version && <span className="muted"> {e.version}</span>}
          {e.builtIn && <span className="pill">built in</span>}
          {e.license && <span className="pill">{e.license}</span>}
          {!e.builtIn && e.name !== e.command && <code className="engine-command">{e.command}</code>}
        </div>
        <div className={`sub ${e.problem ? "error-text" : "muted"}`}>
          {e.problem ??
            (e.installed ? (
              e.description
            ) : e.install ? (
              <>
                Not installed: <code>{e.install}</code>
              </>
            ) : (
              "Not installed."
            ))}
        </div>
      </div>
      {!e.installed && e.install && (
        <button className="icon-link" onClick={() => copy(e.install!)} title="Copy the install command">
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
        </button>
      )}
      {e.homepage && /^https:\/\//.test(e.homepage) && (
        <a href={e.homepage} target="_blank" rel="noreferrer" title={e.homepage}>
          <LinkExternalIcon size={14} />
        </a>
      )}
      {onForget && (
        <button className="icon-link" onClick={onForget} title={`Remove ${e.name} from this list (it stays installed)`} aria-label={`Remove ${e.name}`}>
          <TrashIcon size={14} />
        </button>
      )}
    </div>
  );
}
