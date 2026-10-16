// SPDX-License-Identifier: GPL-3.0-only
// Commands: actions the keyboard shortcuts and the command palette (⌘P) can run, registered by whichever
// component can do them right now (no Analyze button on screen, no "analyze" command).

import { useEffect, useRef } from "react";

const handlers = new Map<string, { current: () => void }>();

/** Make `name` run `run` while this component is mounted (and `enabled`). */
export function useCommand(name: string, run: () => void, enabled = true) {
  const ref = useRef(run);
  ref.current = run;
  useEffect(() => {
    if (!enabled) return;
    handlers.set(name, ref);
    return () => {
      if (handlers.get(name) === ref) handlers.delete(name);
    };
  }, [name, enabled]);
}

export const runCommand = (name: string) => handlers.get(name)?.current();
export const hasCommand = (name: string) => handlers.has(name);

const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);

/** How a ⌘/Ctrl shortcut reads on this platform, e.g. "⌘O" or "Ctrl+O". */
export const keyLabel = (key: string) => (MAC ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`);
