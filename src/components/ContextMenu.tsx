// SPDX-License-Identifier: GPL-3.0-only
// The app's right-click menu: what can be done with the thing under the pointer (an artifact or a version of one,
// a note, a changed file). One menu at a time, shown by <ContextMenuHost /> where the pointer is.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { signal } from "../lib/util";

export type MenuItem =
  | {
      label: string;
      icon?: React.ReactNode;
      run: () => void;
      danger?: boolean;
      /** Asked first: the item reads this until it's clicked again (for what can't be undone). */
      confirm?: string;
    }
  | "separator";

let menu: { x: number; y: number; items: MenuItem[] } | null = null;
const changes = signal();
const show = (next: typeof menu) => {
  menu = next;
  changes.notify();
};

/** Props for an element with a right-click menu; items whose condition fails are left out (pass `false`). */
export function contextMenu(items: (MenuItem | false | null | undefined)[]) {
  return {
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const shown = items.filter((i): i is MenuItem => Boolean(i));
      // No separator first, last or twice in a row.
      const tidy = shown.filter((i, n) => i !== "separator" || (n > 0 && n < shown.length - 1 && shown[n - 1] !== "separator"));
      if (tidy.length) show({ x: e.clientX, y: e.clientY, items: tidy });
    },
  };
}

/** Copy text from a menu item (a click, so the clipboard allows it). */
export const copyText = (text: string) => void navigator.clipboard.writeText(text);

/** The open menu, if any. Mounted once, in the app shell. */
export function ContextMenuHost() {
  const open = useSyncExternalStore(changes.subscribe, () => menu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [armed, setArmed] = useState<number | null>(null);

  // Kept inside the window: flipped left or up when it would run off the edge.
  useLayoutEffect(() => {
    setArmed(null);
    if (!open || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    setPos({
      x: open.x + width > innerWidth - 4 ? Math.max(4, open.x - width) : open.x,
      y: open.y + height > innerHeight - 4 ? Math.max(4, open.y - height) : open.y,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => show(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    addEventListener("keydown", onKey);
    addEventListener("mousedown", onDown, true);
    addEventListener("blur", close);
    addEventListener("resize", close);
    addEventListener("wheel", close, { passive: true });
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("mousedown", onDown, true);
      removeEventListener("blur", close);
      removeEventListener("resize", close);
      removeEventListener("wheel", close);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div ref={ref} className="context-menu" role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {open.items.map((item, n) =>
        item === "separator" ? (
          <div key={n} className="context-menu-separator" role="separator" />
        ) : (
          <button
            key={n}
            role="menuitem"
            className={`context-menu-item ${item.danger ? "danger" : ""}`}
            onClick={() => {
              if (item.confirm && armed !== n) return setArmed(n);
              show(null);
              item.run();
            }}
          >
            <span className="context-menu-icon">{item.icon}</span>
            {armed === n ? item.confirm : item.label}
          </button>
        ),
      )}
    </div>
  );
}

/**
 * Outside the app's own menus, the webview's (Reload, Inspect…) means nothing here; text fields and selected text
 * keep the system's, for copy and paste.
 */
export function useNoDefaultContextMenu(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]") || String(getSelection() ?? "")) return;
      e.preventDefault();
    };
    addEventListener("contextmenu", onMenu);
    return () => removeEventListener("contextmenu", onMenu);
  }, [enabled]);
}
