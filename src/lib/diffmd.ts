// SPDX-License-Identifier: GPL-3.0-only
// diffmd's blocks: a note is read and edited one block at a time — a heading, a paragraph (or list, quote,
// table), or a fenced block such as a ```diff patch. Spec: https://ivx.run/docs/difflicit/diffmd/

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** A note's text as its blocks: runs of lines between blank lines, with headings and fences always their own. */
export function splitBlocks(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null; // the open fence's marker, while inside one
  const flush = () => {
    if (cur.length) out.push(cur.join("\n"));
    cur = [];
  };
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (fence) {
      cur.push(line);
      const close = line.match(FENCE);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length && !line.slice(close[0].length).trim()) {
        fence = null;
        flush();
      }
      continue;
    }
    const open = line.match(FENCE);
    if (open) {
      flush();
      fence = open[1];
      cur.push(line);
    } else if (!line.trim()) {
      flush();
    } else if (/^ {0,3}#{1,6}(\s|$)/.test(line)) {
      flush();
      cur.push(line);
      flush();
    } else {
      cur.push(line);
    }
  }
  flush();
  return out;
}

/** Blocks back to a note's text, a blank line between each. */
export const joinBlocks = (blocks: string[]) =>
  blocks
    .map((b) => b.replace(/^\n+|\s+$/g, ""))
    .filter(Boolean)
    .join("\n\n") + "\n";
