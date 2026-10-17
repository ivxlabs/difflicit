// SPDX-License-Identifier: GPL-3.0-only
import { useState } from "react";
import { XIcon } from "@primer/octicons-react";
import { addDscVersion } from "../lib/desktop";
import { type CachePick, SharedCacheSource } from "./SharedCache";

/**
 * Desktop: add another version to a file artifact by extracting a dylib from another dyld shared cache — the way
 * you line up the same framework from two OS builds to diff them.
 */
export function AddCacheVersion({
  project,
  artifact,
  onDone,
  onClose,
}: {
  project: string;
  artifact: string;
  onDone: (version: string) => void;
  onClose: () => void;
}) {
  const [pick, setPick] = useState<CachePick | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await addDscVersion(project, artifact, pick.cache, pick.image, pick.label || undefined));
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={add}>
        <header>
          <span className="grow">Add version to {artifact}</span>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            <XIcon size={16} />
          </button>
        </header>
        <div className="content">
          <p className="muted">Extract this dylib from another shared cache to compare the two versions.</p>
          <SharedCacheSource onChange={setPick} />
          {error && <div className="notice error">{error}</div>}
        </div>
        <footer>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!pick || busy}>
            {busy ? "Extracting…" : "Add version"}
          </button>
        </footer>
      </form>
    </div>
  );
}
