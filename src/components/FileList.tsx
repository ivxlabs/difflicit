// SPDX-License-Identifier: GPL-3.0-only
import { DiffAddedIcon, DiffModifiedIcon, DiffRemovedIcon, DiffRenamedIcon } from "@primer/octicons-react";
import type { DiffFile } from "../lib/diff";
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
          <div key={i} className={`list-item file ${i === selected ? "selected" : ""}`} onClick={() => onSelect(i)}>
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
