// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef, useState } from "react";
import { SearchIcon } from "@primer/octicons-react";

export interface PickItem {
  key: string;
  icon?: React.ReactNode;
  title: React.ReactNode;
  detail?: React.ReactNode;
  /** Shown on the right, e.g. a shortcut or a line number. */
  hint?: React.ReactNode;
  run: () => void;
}

interface Props {
  placeholder: string;
  /** The items for what's typed. */
  items: (query: string) => PickItem[];
  /** Shown when nothing matches. */
  empty: (query: string) => React.ReactNode;
  onClose: () => void;
}

/** A keyboard-first list in a dialog, for search (⌘K) and the command palette (⌘P). */
export function QuickPick({ placeholder, items, empty, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const shown = items(query);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (item: PickItem | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, Math.min(shown.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal quick-pick" role="dialog" aria-label={placeholder}>
        <div className="search">
          <SearchIcon size={14} />
          <input
            className="input"
            autoFocus
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="quick-pick-list" ref={list}>
          {shown.length === 0 && <div className="quick-pick-empty muted">{empty(query)}</div>}
          {shown.map((item, i) => (
            <div
              key={item.key}
              data-index={i}
              className={`list-item two-line ${i === active ? "selected" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(item)}
            >
              {item.icon}
              <div className="main">
                <div className="title">{item.title}</div>
                {item.detail && <div className="sub muted">{item.detail}</div>}
              </div>
              {item.hint && <span className="muted mono">{item.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
