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
  lines: DiffLine[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const cleanPath = (p: string) => p.replace(/\t.*$/, "").replace(/^[ab]\//, "");

function statusOf(oldPath: string, newPath: string): DiffFile["status"] {
  if (oldPath === "/dev/null") return "added";
  if (newPath === "/dev/null") return "deleted";
  return oldPath === newPath ? "modified" : "renamed";
}

/**
 * Lenient unified diff parser for `git diff`, `git format-patch` and `diff -u` output.
 * Hunk bodies are read by their declared line counts, so mail headers, signatures and
 * other surrounding text are ignored instead of failing the whole patch.
 */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let oldLeft = 0;
  let newLeft = 0;
  let o = 0;
  let n = 0;

  const open = (oldPath: string, path: string): DiffFile => {
    const f: DiffFile = { path, oldPath, status: statusOf(oldPath, path), additions: 0, deletions: 0, lines: [] };
    files.push(f);
    return f;
  };

  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (file && (oldLeft > 0 || newLeft > 0)) {
      const c = line[0] ?? " ";
      if (c === "+") {
        file.lines.push({ type: "add", text: line.slice(1), newNo: n++ });
        file.additions++;
        newLeft--;
        continue;
      }
      if (c === "-") {
        file.lines.push({ type: "del", text: line.slice(1), oldNo: o++ });
        file.deletions++;
        oldLeft--;
        continue;
      }
      if (c === " ") {
        file.lines.push({ type: "context", text: line.slice(1), oldNo: o++, newNo: n++ });
        oldLeft--;
        newLeft--;
        continue;
      }
      if (c === "\\") continue; // "\ No newline at end of file"
      oldLeft = newLeft = 0; // Malformed hunk: stop reading it and treat this line as a header.
    }

    let m: RegExpExecArray | null;
    if ((m = /^diff --git a\/(.+) b\/(.+)$/.exec(line))) {
      file = open(m[1], m[2]);
    } else if (line.startsWith("--- ")) {
      if (!file || file.lines.length) file = open("", "");
      file.oldPath = cleanPath(line.slice(4));
    } else if (line.startsWith("+++ ") && file) {
      const newPath = cleanPath(line.slice(4));
      file.status = statusOf(file.oldPath, newPath);
      file.path = newPath === "/dev/null" ? file.oldPath : newPath;
    } else if ((m = HUNK_RE.exec(line))) {
      file ??= open("(unnamed)", "(unnamed)");
      [o, oldLeft, n, newLeft] = [+m[1], m[2] === undefined ? 1 : +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
      file.lines.push({ type: "hunk", text: line });
    }
  }
  return files.filter((f) => f.path);
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
