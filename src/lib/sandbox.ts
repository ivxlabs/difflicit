// SPDX-License-Identifier: GPL-3.0-only
// A global, app-wide list of VNC sandbox connections, kept in this browser (desktop app). Passwords are never
// stored here — they're entered when connecting (src/components/VncViewer.tsx).

export interface Sandbox {
  id: string;
  label: string;
  host: string;
  port: number;
}

const KEY = "difflicit-sandboxes";

export function sandboxes(): Sandbox[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: Sandbox[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

/** Add or update a connection (by id). Returns the new list. */
export function saveSandbox(s: Sandbox): Sandbox[] {
  const list = sandboxes();
  const i = list.findIndex((x) => x.id === s.id);
  if (i >= 0) list[i] = s;
  else list.push(s);
  write(list);
  return list;
}

export function removeSandbox(id: string): Sandbox[] {
  const list = sandboxes().filter((x) => x.id !== id);
  write(list);
  return list;
}

export const newSandboxId = () => (crypto.randomUUID?.() ?? String(Date.now()));
