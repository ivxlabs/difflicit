// SPDX-License-Identifier: GPL-3.0-only
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ColumnsIcon, RowsIcon } from "@primer/octicons-react";
import { changedPart, diffLines, toSplitRows, type DiffFile, type DiffLine, type SplitRow } from "../lib/diff";
import { useCommand } from "../lib/commands";
import { BlankSlate } from "./BlankSlate";

type Mode = "unified" | "split";
const MODE_KEY = "difflicit-diff-mode";
const ROW = 20; // px: every diff row is exactly this tall (see .diff-table), which is what makes windowing simple
const OVERSCAN = 40; // rows rendered above and below the visible ones

export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="stat">
      <span className="a">+{additions}</span> <span className="d">−{deletions}</span>
    </span>
  );
}

export function DiffView({ file, line }: { file: DiffFile; line: number | null }) {
  const [mode, setModeState] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) as Mode) ?? "unified");
  const setMode = (m: Mode) => {
    localStorage.setItem(MODE_KEY, m);
    setModeState(m);
  };
  useCommand("diff-unified", () => setMode("unified"), mode !== "unified");
  useCommand("diff-split", () => setMode("split"), mode !== "split");

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
      {/* Keyed so switching file or layout starts at the top. */}
      <DiffBody key={`${file.path}\n${mode}`} file={file} mode={mode} line={line} />
    </div>
  );
}

/**
 * The diff's lines are only parsed for the file on screen, and only the rows in view (plus OVERSCAN) are
 * in the DOM, so a 50,000-line file costs about as much memory as a 50-line one.
 */
function DiffBody({ file, mode, line }: { file: DiffFile; mode: Mode; line: number | null }) {
  const lines = useMemo(() => diffLines(file), [file]);
  const rows = useMemo(() => (mode === "split" ? toSplitRows(lines) : lines), [lines, mode]);
  // The row showing `line`: the same index in unified view; in split view, the pair (or hunk) it's in.
  const target = useMemo(() => {
    const l = line === null ? undefined : lines[line];
    if (!l) return -1;
    if (mode === "unified") return line!;
    return (rows as SplitRow[]).findIndex((r) => r.left === l || r.right === l || (r.type === "hunk" && r.hunk === l.text));
  }, [line, lines, rows, mode]);
  // Unified rows can be wider than the screen; reserve the widest line's width so it doesn't jump while scrolling.
  const widest = useMemo(() => lines.reduce((w, l) => Math.max(w, l.text.length), 0), [lines]);

  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });
  const measure = () => {
    const el = scroller.current;
    if (el) setView({ top: el.scrollTop, height: el.clientHeight });
  };
  // Jump to the target row, a third of the way down, so what leads up to it shows too.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && target >= 0) el.scrollTop = Math.max(0, target * ROW - el.clientHeight / 3);
  }, [target]);
  useLayoutEffect(() => {
    if (!scroller.current) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller.current);
    return () => observer.disconnect();
  }, []);

  if (!lines.length) {
    return (
      <BlankSlate>
        <p>No textual changes (binary file, mode change or pure rename).</p>
      </BlankSlate>
    );
  }

  const first = Math.max(0, Math.floor(view.top / ROW) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((view.top + view.height) / ROW) + OVERSCAN);
  const spacer = (height: number) =>
    height > 0 && (
      <tr className="spacer">
        <td colSpan={mode === "split" ? 4 : 3} style={{ height }} />
      </tr>
    );

  return (
    <div className="diff-scroll" ref={scroller} onScroll={measure}>
      <table
        className={`diff-table ${mode === "split" ? "split-mode" : ""}`}
        style={mode === "unified" ? { minWidth: `calc(${widest}ch + 140px)` } : undefined}
      >
        {mode === "split" && (
          <colgroup>
            <col style={{ width: 50 }} />
            <col />
            <col style={{ width: 50 }} />
            <col />
          </colgroup>
        )}
        <tbody>
          {spacer(first * ROW)}
          {rows.slice(first, last).map((row, i) =>
            mode === "split" ? (
              <SplitTableRow key={first + i} row={row as SplitRow} target={first + i === target} />
            ) : (
              <UnifiedRow key={first + i} line={row as DiffLine} target={first + i === target} />
            ),
          )}
          {spacer((rows.length - last) * ROW)}
        </tbody>
      </table>
    </div>
  );
}

function UnifiedRow({ line, target }: { line: DiffLine; target: boolean }) {
  return (
    <tr className={`${line.type} ${target ? "target" : ""}`}>
      <td className="ln">{line.oldNo}</td>
      <td className="ln">{line.newNo}</td>
      <td className="code">
        <Code line={line} />
      </td>
    </tr>
  );
}

function SplitTableRow({ row, target }: { row: SplitRow; target: boolean }) {
  if (row.type === "hunk") {
    return (
      <tr className={`hunk ${target ? "target" : ""}`}>
        <td className="ln" />
        <td className="code" colSpan={3}>
          {row.hunk}
        </td>
      </tr>
    );
  }
  const side = (line: DiffLine | undefined, no: number | undefined, gap: string) =>
    line ? (
      <>
        <td className={`ln ${gap} ${line.type}`}>{no}</td>
        <td className={`code ${line.type}`} title={line.text}>
          <Code line={line} />
        </td>
      </>
    ) : (
      <td className={`empty ${gap}`} colSpan={2} />
    );
  return (
    <tr className={target ? "target" : undefined}>
      {side(row.left, row.left?.oldNo, "")}
      {side(row.right, row.right?.newNo, "split-gap")}
    </tr>
  );
}

/** A line's text, with what changed from its peer (the line it replaced, or was replaced by) marked. */
function Code({ line }: { line: DiffLine }) {
  const part = line.type === "add" || line.type === "del" ? changedPart(line) : null;
  if (!part) return <>{line.text}</>;
  const [start, end] = part;
  return (
    <>
      {line.text.slice(0, start)}
      <span className="word">{line.text.slice(start, end)}</span>
      {line.text.slice(end)}
    </>
  );
}
