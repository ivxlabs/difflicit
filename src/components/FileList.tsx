// SPDX-License-Identifier: GPL-3.0-only
import { CopyIcon, DiffAddedIcon, DiffModifiedIcon, DiffRemovedIcon, DiffRenamedIcon, EyeIcon } from "@primer/octicons-react";
import type { DiffFile } from "../lib/diff";
import { contextMenu, copyText } from "./ContextMenu";
import { DiffStat } from "./DiffView";

const STATUS_ICON = {
  added: DiffAddedIcon,
  deleted: DiffRemovedIcon,
  modified: DiffModifiedIcon,
  renamed: DiffRenamedIcon,
};

export function FileList({
  files,
  selected,
  onSelect,
}: {
  files: DiffFile[];
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  return (
    <>
      {files.map((f, i) => {
        const Icon = STATUS_ICON[f.status];
        return (
          <div
            key={i}
            className={`list-item file ${i === selected ? "selected" : ""}`}
            onClick={() => onSelect(i)}
            {...contextMenu([
              { label: "Show diff", icon: <EyeIcon size={14} />, run: () => onSelect(i) },
              { label: "Copy path", icon: <CopyIcon size={14} />, run: () => copyText(f.path) },
            ])}
          >
            <div className="main">
              <div className="title" title={f.path}>
                <bdi>{f.path}</bdi>
              </div>
            </div>
            <DiffStat additions={f.additions} deletions={f.deletions} />
            <span className={`file-status ${f.status}`} title={f.status}>
              <Icon size={14} />
            </span>
          </div>
        );
      })}
    </>
  );
}
