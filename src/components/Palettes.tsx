// SPDX-License-Identifier: GPL-3.0-only
import { useMemo } from "react";
import { BookIcon, FileDiffIcon, TerminalIcon } from "@primer/octicons-react";
import { diffLines } from "../lib/diff";
import { loadAnalysis, locationId } from "../lib/analysis";
import { useAsync } from "../lib/util";
import type { Location } from "../types";
import { QuickPick, type PickItem } from "./QuickPick";

const MAX_RESULTS = 200;
const CONTEXT = 50; // characters shown either side of a match

/** `text` around the first match of `query`, with the match marked. */
function Snippet({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return <>{text}</>;
  const start = Math.max(0, at - CONTEXT);
  const end = Math.min(text.length, at + query.length + CONTEXT);
  return (
    <span className="mono">
      {start > 0 && "…"}
      {text.slice(start, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length, end)}
      {end < text.length && "…"}
    </span>
  );
}

/** The write-up's text, a line per paragraph, heading or list item. DOMParser documents run and load nothing. */
function textLines(html: string): string[] {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  body.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, pre, tr, blockquote, br").forEach((el) => el.after("\n"));
  return (body.textContent ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** ⌘K: full-text search of the open analysis, its write-up and every line of its patches. */
export function SearchPick({ location, onJump, onClose }: { location: Location; onJump: (file: string | null, line: number | null) => void; onClose: () => void }) {
  const [content] = useAsync(() => loadAnalysis(location), [locationId(location)]);
  // Parsed once per analysis, not per keystroke.
  const index = useMemo(
    () => content && { writeup: textLines(content.readme_html ?? ""), files: content.files.map((f) => ({ path: f.path, lines: diffLines(f) })) },
    [content],
  );

  const items = (query: string): PickItem[] => {
    const q = query.trim().toLowerCase();
    if (!index || q.length < 2) return [];
    const found: PickItem[] = [];
    index.writeup.forEach((text, i) => {
      if (text.toLowerCase().includes(q)) {
        found.push({ key: `w${i}`, icon: <BookIcon size={14} />, title: <Snippet text={text} query={q} />, detail: "Write-up", run: () => onJump(null, null) });
      }
    });
    for (const file of index.files) {
      if (file.path.toLowerCase().includes(q)) {
        found.push({ key: file.path, icon: <FileDiffIcon size={14} />, title: <Snippet text={file.path} query={q} />, detail: "File", run: () => onJump(file.path, null) });
      }
      file.lines.forEach((line, i) => {
        if (line.type === "hunk" || !line.text.toLowerCase().includes(q)) return;
        found.push({
          key: `${file.path}:${i}`,
          icon: <span className={`search-mark ${line.type}`}>{line.type === "add" ? "+" : line.type === "del" ? "−" : " "}</span>,
          title: <Snippet text={line.text} query={q} />,
          detail: file.path,
          hint: line.newNo ?? line.oldNo,
          run: () => onJump(file.path, i),
        });
      });
    }
    return found.slice(0, MAX_RESULTS);
  };

  return (
    <QuickPick
      placeholder={`Search ${location.kind === "github" ? location.repo.full_name : location.folder}…`}
      items={items}
      empty={(query) => (!index ? "Loading the analysis…" : query.trim().length < 2 ? "Search the write-up and every patch." : "No matches.")}
      onClose={onClose}
    />
  );
}

export interface Command {
  label: string;
  /** Its shortcut, e.g. ⌘O. */
  hint?: string;
  run: () => void;
}

/** ⌘P: every command that applies right now. */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const items = (query: string): PickItem[] =>
    commands
      .filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase()))
      .map((c) => ({ key: c.label, icon: <TerminalIcon size={14} />, title: c.label, hint: c.hint, run: c.run }));
  return <QuickPick placeholder="Run a command…" items={items} empty={() => "No commands match."} onClose={onClose} />;
}
