// SPDX-License-Identifier: GPL-3.0-only
import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, FileDirectoryFillIcon, FileIcon } from "@primer/octicons-react";
import { listDir } from "../lib/desktop";
import { useAsync } from "../lib/util";

interface Entry {
  name: string;
  path: string;
  dir: boolean;
}

interface Selection {
  /** The picked entry's path relative to the project, if any. */
  selected: string | null;
  onSelect: (rel: string) => void;
}

/** One node. Picking it shows it in the main area; a folder also expands, loading its children then. */
function TreeNode({ node, rel, depth, selected, onSelect }: { node: Entry; rel: string; depth: number } & Selection) {
  // Start open when the picked entry is inside, so a deep link shows where it is.
  const [open, setOpen] = useState(() => Boolean(selected?.startsWith(`${rel}/`)));
  const [children] = useAsync(() => (open && node.dir ? listDir(node.path) : Promise.resolve(null)), [open, node.path]);
  return (
    <>
      <div
        className={`list-item tree-node ${node.dir ? "" : "file"} ${rel === selected ? "selected" : ""}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => {
          if (node.dir) setOpen((o) => !o);
          onSelect(rel);
        }}
        title={rel}
      >
        {node.dir ? open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} /> : null}
        {node.dir ? <FileDirectoryFillIcon size={14} className="tree-folder-icon" /> : <FileIcon size={14} />}
        <span className="mono tree-name">{node.name}</span>
      </div>
      {open &&
        children?.map((c) => (
          <TreeNode key={c.path} node={c} rel={`${rel}/${c.name}`} depth={depth + 1} selected={selected} onSelect={onSelect} />
        ))}
    </>
  );
}

/** Desktop: a lazily expanded file tree of a project folder, for the sidebar. */
export function FileTree({ path, selected, onSelect }: { path: string } & Selection) {
  const [roots, error] = useAsync(() => listDir(path), [path]);
  if (error) return <div className="sidebar-note muted">{error}</div>;
  if (!roots) return <div className="sidebar-note muted">Loading…</div>;
  if (!roots.length) return <div className="sidebar-note muted">Empty folder</div>;
  return (
    <>
      {roots.map((n) => (
        <TreeNode key={n.path} node={n} rel={n.name} depth={0} selected={selected} onSelect={onSelect} />
      ))}
    </>
  );
}
