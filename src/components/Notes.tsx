// SPDX-License-Identifier: GPL-3.0-only
// Notes are Markdown, ideally diffmd: Markdown whose ```diff / ```patch fences hold patch diffs. Whoever rendered
// the Markdown (pulldown-cmark on the desktop, GitHub on the web), its diff blocks are found in the HTML here
// and shown with the diff viewer instead of as plain code. Spec: https://ivx.run/docs/difflicit/diffmd/
import { useMemo } from "react";
import DOMPurify from "dompurify";
import { type DiffFile, diffLines, parseUnifiedDiff } from "../lib/diff";
import { DiffView } from "./DiffView";

type Segment = { html: string } | { diff: string };

// A diff fence as rendered: pulldown-cmark's <pre><code class="language-diff">, GitHub's
// <div class="highlight highlight-source-diff"><pre> or <pre lang="diff">.
const DIFF_BLOCK =
  "div.highlight-source-diff, pre[lang=diff], pre[lang=patch], pre:has(> code.language-diff), pre:has(> code.language-patch)";
const isDiffBlock = (el: Element): boolean =>
  el.matches(DIFF_BLOCK) || (el.tagName === "DIV" && el.children.length === 1 && isDiffBlock(el.children[0]));

/** Split rendered notes into HTML runs and the diff blocks between them. */
function segments(html: string): Segment[] {
  const doc = new DOMParser().parseFromString(DOMPurify.sanitize(html), "text/html");
  // GitHub wraps a README in <div><article>…; the blocks to split are inside the innermost wrapper.
  let root: Element = doc.body;
  while (root.children.length === 1 && /^(DIV|ARTICLE)$/.test(root.children[0].tagName) && !isDiffBlock(root.children[0])) {
    root = root.children[0];
  }
  const out: Segment[] = [];
  let run = doc.createElement("div");
  const flush = () => run.innerHTML.trim() && out.push({ html: DOMPurify.sanitize(run.innerHTML) });
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && isDiffBlock(node as Element)) {
      flush();
      run = doc.createElement("div");
      out.push({ diff: node.textContent ?? "" });
    } else {
      run.appendChild(node);
    }
  }
  flush();
  return out;
}

/** A diff block's files. A block may be a full unified diff or just +/-/space lines (given a hunk header here). */
function blockFiles(text: string): DiffFile[] {
  const files = parseUnifiedDiff(text);
  if (files.length) return files;
  const body = text.replace(/\n$/, "").split("\n");
  const old = body.filter((l) => !l.startsWith("+")).length;
  const now = body.filter((l) => !l.startsWith("-")).length;
  return parseUnifiedDiff(`@@ -1,${old} +1,${now} @@\n${body.join("\n")}`);
}

const ROW = 20; // .diff-table row height
const HEADER = 40;

/** Patch diffs shown inline (in notes, or a .patch file), each file sized to fit, up to a screenful. */
export function InlineDiffs({ text }: { text: string }) {
  const files = useMemo(() => blockFiles(text), [text]);
  if (!files.length) return <pre className="notes-raw">{text}</pre>;
  return (
    <>
      {files.map((file, i) => (
        <div key={i} className="notes-diff" style={{ height: Math.min(diffLines(file).length * ROW + HEADER, 560) }}>
          <DiffView file={file} line={null} />
        </div>
      ))}
    </>
  );
}

/** Rendered Markdown or diffmd, its diff blocks as real diffs (a note's block, or a whole note in Notes). */
export function NoteHtml({ html }: { html: string }) {
  const parts = useMemo(() => segments(html), [html]);
  return <>{parts.map((p, i) => ("diff" in p ? <InlineDiffs key={i} text={p.diff} /> : <div key={i} dangerouslySetInnerHTML={{ __html: p.html }} />))}</>;
}

/** Rendered notes (Markdown or diffmd), read-only: a README from GitHub, or a note too big to edit. */
export const Notes = ({ html }: { html: string }) => (
  <article className="markdown notes">
    <NoteHtml html={html} />
  </article>
);
