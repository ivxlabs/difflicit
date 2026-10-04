export type LineType = "context" | "add" | "del" | "hunk";

export interface DiffLine {
  type: LineType;
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface DiffFile {
  path: string;
  oldPath: string;
  status: "added" | "deleted" | "modified" | "renamed";
  additions: number;
  deletions: number;
  /** This file's part of the patch. Only turned into lines (diffLines) when the file is shown, to save memory. */
  text: string;
}

interface Section extends Omit<DiffFile, "text"> {
  start: number;
  end: number;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const cleanPath = (p: string) => p.replace(/\t.*$/, "").replace(/^[ab]\//, "");

function statusOf(oldPath: string, newPath: string): DiffFile["status"] {
  if (oldPath === "/dev/null") return "added";
  if (newPath === "/dev/null") return "deleted";
  return oldPath === newPath ? "modified" : "renamed";
}

/**
 * Lenient unified diff reader for `git diff`, `git format-patch` and `diff -u` output. Hunk bodies are
 * read by their declared line counts, so mail headers, signatures and other surrounding text are ignored
 * instead of failing the whole patch. Returns each file's line range; `emit` receives its diff lines.
 */
function walk(lines: string[], emit?: (line: DiffLine) => void): Section[] {
  const files: Section[] = [];
  let file: Section | undefined;
  let oldLeft = 0;
  let newLeft = 0;
  let o = 0;
  let n = 0;
  let inHunks = false; // the current file has had a hunk, so a "--- " line starts the next file

  const open = (oldPath: string, path: string, at: number): Section => {
    if (file) file.end = at;
    inHunks = false;
    const f: Section = { path, oldPath, status: statusOf(oldPath, path), additions: 0, deletions: 0, start: at, end: lines.length };
    files.push(f);
    return f;
  };

  lines.forEach((line, i) => {
    if (file && (oldLeft > 0 || newLeft > 0)) {
      const c = line[0] ?? " ";
      if (c === "+") {
        emit?.({ type: "add", text: line.slice(1), newNo: n++ });
        file.additions++;
        newLeft--;
        return;
      }
      if (c === "-") {
        emit?.({ type: "del", text: line.slice(1), oldNo: o++ });
        file.deletions++;
        oldLeft--;
        return;
      }
      if (c === " ") {
        emit?.({ type: "context", text: line.slice(1), oldNo: o++, newNo: n++ });
        oldLeft--;
        newLeft--;
        return;
      }
      if (c === "\\") return; // "\ No newline at end of file"
      oldLeft = newLeft = 0; // Malformed hunk: stop reading it and treat this line as a header.
    }

    let m: RegExpExecArray | null;
    if ((m = /^diff --git a\/(.+) b\/(.+)$/.exec(line))) {
      file = open(m[1], m[2], i);
    } else if (line.startsWith("--- ")) {
      if (!file || inHunks) file = open("", "", i);
      file.oldPath = cleanPath(line.slice(4));
    } else if (line.startsWith("+++ ") && file) {
      const newPath = cleanPath(line.slice(4));
      file.status = statusOf(file.oldPath, newPath);
      file.path = newPath === "/dev/null" ? file.oldPath : newPath;
    } else if ((m = HUNK_RE.exec(line))) {
      file ??= open("(unnamed)", "(unnamed)", i);
      inHunks = true;
      [o, oldLeft, n, newLeft] = [+m[1], m[2] === undefined ? 1 : +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
      emit?.({ type: "hunk", text: line });
    }
  });
  return files.filter((f) => f.path);
}

/** Split a patch into files with their +/- counts; the lines themselves are left as text. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const src = text.includes("\r") ? text.replace(/\r\n/g, "\n") : text; // replace() would copy it regardless
  const lines = src.split("\n");
  const offsets = [0];
  for (const line of lines) offsets.push(offsets[offsets.length - 1] + line.length + 1);
  // Slices of the patch share its memory instead of copying it.
  return walk(lines).map(({ start, end, ...file }) => ({ ...file, text: src.slice(offsets[start], offsets[end] - 1) }));
}

/** The lines of one file, for display. */
export function diffLines(file: DiffFile): DiffLine[] {
  const out: DiffLine[] = [];
  walk(file.text.split("\n"), (line) => out.push(line));
  return out;
}

export interface SplitRow {
  type: "hunk" | "pair";
  hunk?: string;
  left?: DiffLine;
  right?: DiffLine;
}

/** Pair up deletions and additions side by side, the way a split diff view renders them. */
export function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.type === "hunk") {
      rows.push({ type: "hunk", hunk: l.text });
      i++;
    } else if (l.type === "context") {
      rows.push({ type: "pair", left: l, right: l });
      i++;
    } else {
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].type === "del") dels.push(lines[i++]);
      while (i < lines.length && lines[i].type === "add") adds.push(lines[i++]);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
        rows.push({ type: "pair", left: dels[k], right: adds[k] });
      }
    }
  }
  return rows;
}
