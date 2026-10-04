import { useEffect, useState } from "react";

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

/** Runs `load` whenever `deps` change and returns [result, error]; results of stale runs are ignored. */
export function useAsync<T>(load: () => Promise<T> | null, deps: unknown[]): [T | null, string | null] {
  const [state, setState] = useState<[T | null, string | null]>([null, null]);
  useEffect(() => {
    setState([null, null]);
    let live = true;
    load()?.then(
      (value) => live && setState([value, null]),
      (e: Error) => live && setState([null, e.message]),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
