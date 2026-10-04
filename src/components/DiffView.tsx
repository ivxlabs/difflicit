import { useMemo, useState } from "react";
import { ColumnsIcon, RowsIcon } from "@primer/octicons-react";
import { toSplitRows, type DiffFile } from "../lib/diff";
import { BlankSlate } from "./BlankSlate";

type Mode = "unified" | "split";
const MODE_KEY = "difflicit-diff-mode";

export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="stat">
      <span className="a">+{additions}</span> <span className="d">−{deletions}</span>
    </span>
  );
}

export function DiffView({ file }: { file: DiffFile }) {
  const [mode, setModeState] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) as Mode) ?? "unified");
  const setMode = (m: Mode) => {
    localStorage.setItem(MODE_KEY, m);
    setModeState(m);
  };

  return (
    <div className="diff">
      <div className="diff-header">
        <span className="path" title={file.path}>
          {file.status === "renamed" ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        <DiffStat additions={file.additions} deletions={file.deletions} />
        <div className="segmented" role="group" aria-label="Diff layout">
          <button className={mode === "unified" ? "active" : ""} onClick={() => setMode("unified")} title="Unified">
            <RowsIcon size={14} />
          </button>
          <button className={mode === "split" ? "active" : ""} onClick={() => setMode("split")} title="Split">
            <ColumnsIcon size={14} />
          </button>
        </div>
      </div>
      <div className="diff-scroll">
        {file.lines.length === 0 ? (
          <BlankSlate>
            <p>No textual changes (binary file, mode change or pure rename).</p>
          </BlankSlate>
        ) : mode === "unified" ? (
          <UnifiedTable file={file} />
        ) : (
          <SplitTable file={file} />
        )}
      </div>
    </div>
  );
}

function UnifiedTable({ file }: { file: DiffFile }) {
  return (
    <table className="diff-table">
      <tbody>
        {file.lines.map((l, i) =>
          l.type === "hunk" ? (
            <tr key={i} className="hunk">
              <td className="ln" />
              <td className="ln" />
              <td className="code">{l.text}</td>
            </tr>
          ) : (
            <tr key={i} className={l.type}>
              <td className="ln">{l.oldNo}</td>
              <td className="ln">{l.newNo}</td>
              <td className="code">{l.text}</td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

function SplitTable({ file }: { file: DiffFile }) {
  const rows = useMemo(() => toSplitRows(file.lines), [file]);
  return (
    <table className="diff-table split-mode">
      <colgroup>
        <col style={{ width: 50 }} />
        <col />
        <col style={{ width: 50 }} />
        <col />
      </colgroup>
      <tbody>
        {rows.map((r, i) =>
          r.type === "hunk" ? (
            <tr key={i} className="hunk">
              <td className="ln" />
              <td className="code" colSpan={3}>
                {r.hunk}
              </td>
            </tr>
          ) : (
            <tr key={i}>
              {r.left ? (
                <>
                  <td className={`ln ${r.left.type}`}>{r.left.oldNo}</td>
                  <td className={`code ${r.left.type}`} title={r.left.text}>
                    {r.left.text}
                  </td>
                </>
              ) : (
                <td className="empty" colSpan={2} />
              )}
              {r.right ? (
                <>
                  <td className={`ln split-gap ${r.right.type}`}>{r.right.newNo}</td>
                  <td className={`code ${r.right.type}`} title={r.right.text}>
                    {r.right.text}
                  </td>
                </>
              ) : (
                <td className="empty split-gap" colSpan={2} />
              )}
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}
