// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef, useState } from "react";

/** The last segment of a filesystem path or URL (handles both separators); the input itself if it has none. */
export const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** The first item for each key, in order. */
export function uniqueBy<T>(items: T[], key: (item: T) => unknown): T[] {
  const seen = new Set();
  return items.filter((item) => {
    const k = key(item);
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

/** Runs `load` once and shares the result; a failure is not kept, so the next call retries. */
export function cached<T>(load: () => Promise<T>) {
  let pending: Promise<T> | null = null;
  const get = () =>
    (pending ??= load().catch((e) => {
      pending = null;
      throw e;
    }));
  return Object.assign(get, { reset: () => void (pending = null) });
}

/** A change notification for useSyncExternalStore. */
export function signal() {
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener)),
    notify: () => listeners.forEach((l) => l()),
  };
}

/** Runs `load` whenever `deps` (or `refresh`) change and returns [result, error]; results of stale runs are ignored. */
export function useAsync<T>(load: () => Promise<T> | null, deps: unknown[], refresh: unknown[] = []): [T | null, string | null] {
  const [state, setState] = useState<[T | null, string | null]>([null, null]);
  // What was loaded for: a change in `deps` clears the value while loading; one in `refresh` (reading the same
  // thing again) keeps it on screen, so whatever shows it isn't torn down meanwhile.
  const loadedFor = useRef<unknown[] | null>(null);
  useEffect(() => {
    const same = loadedFor.current?.length === deps.length && deps.every((d, i) => Object.is(d, loadedFor.current![i]));
    loadedFor.current = deps;
    if (!same) setState([null, null]);
    let live = true;
    load()?.then(
      (value) => live && setState([value, null]),
      // Desktop (Tauri) commands reject with a plain string, not an Error: keep it, or a failure looks like loading.
      (e: unknown) => live && setState([null, e instanceof Error ? e.message : String(e)]),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, ...refresh]);
  return state;
}
