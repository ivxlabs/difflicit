// SPDX-License-Identifier: GPL-3.0-only
import { useState } from "react";
import { FileDirectoryIcon, FileIcon, GitCompareIcon, XIcon } from "@primer/octicons-react";
import { CONNECT_LABEL, pat } from "../lib/access";
import { addFileArtifact, addGitArtifact, diffTools, isGithubUrl, pickFile, pickFolder } from "../lib/desktop";
import { useAsync } from "../lib/util";
import { DocsLink } from "./BlankSlate";

type Kind = "git" | "file";
const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? "";
const isUrl = (r: string) => r.includes("://") || r.startsWith("git@");

/**
 * Desktop: add an artifact to a project with just a path or git URL. A git repo is cloned in; a file or folder
 * is copied in as the artifact's first version. Returns the new artifact's name.
 */
export function AddArtifact({ project, onConnect, onDone, onClose }: { project: string; onConnect: () => void; onDone: (artifact: string) => void; onClose: () => void }) {
  const [tools] = useAsync(diffTools, []);
  const [kind, setKind] = useState<Kind>("git");
  const [source, setSource] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);

  const browse = async (dir: boolean) => {
    const p = dir ? await pickFolder() : await pickFile("Choose a file");
    if (p) setPath(p);
  };

  const ready = !busy && (kind === "git" ? Boolean(source.trim()) : Boolean(path));

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNeedsConnect(false);
    try {
      let name: string;
      if (kind === "git") {
        const token = pat.get() ?? undefined;
        setBusy(isUrl(source) ? "Cloning…" : "Copying the repository…");
        try {
          name = await addGitArtifact(project, source.trim(), token);
        } catch (err) {
          if (!token && isUrl(source) && (await isGithubUrl(source).catch(() => false))) setNeedsConnect(true);
          throw err;
        }
      } else {
        setBusy("Copying…");
        name = (await addFileArtifact(project, path)).name;
      }
      onDone(name);
    } catch (err) {
      setError(String(err));
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={add}>
        <header>
          <span className="grow">Add artifact</span>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            <XIcon size={16} />
          </button>
        </header>
        <div className="content">
          <p className="muted">
            Add something to compare — a git repository, or a file or folder. You'll diff two of its versions.{" "}
            <DocsLink page="analyses" />
          </p>
          <div className="segmented">
            <button type="button" className={kind === "git" ? "active" : ""} onClick={() => setKind("git")}>
              <GitCompareIcon size={14} /> Git repository
            </button>
            <button type="button" className={kind === "file" ? "active" : ""} onClick={() => setKind("file")}>
              <FileIcon size={14} /> File or folder
            </button>
          </div>

          {kind === "git" ? (
            <label className="field">
              <span>A folder, or a clone URL</span>
              <div className="row">
                <input className="input" value={source} placeholder="~/src/xnu or https://github.com/apple-oss/xnu" onChange={(e) => setSource(e.target.value)} />
                <button type="button" className="btn" onClick={async () => setSource((await pickFolder()) ?? source)}>
                  <FileDirectoryIcon size={14} /> Browse
                </button>
              </div>
            </label>
          ) : (
            <label className="field">
              <span>A file (e.g. a binary) or a folder</span>
              <div className="row">
                <button type="button" className="btn file-btn" onClick={() => browse(false)}>
                  {path ? <code>{basename(path)}</code> : <><FileIcon size={14} /> Choose file…</>}
                </button>
                <button type="button" className="btn" onClick={() => browse(true)}>
                  <FileDirectoryIcon size={14} /> Folder…
                </button>
              </div>
              {tools && !tools.binary && <span className="muted small-note">Install radare2 (radiff2, r2) for binary diffing.</span>}
            </label>
          )}

          {busy && !error && <div className="notice">{busy}</div>}
          {error && <div className="notice error">{error}</div>}
          {needsConnect && (
            <button type="button" className="btn" onClick={onConnect}>
              {CONNECT_LABEL} and try again
            </button>
          )}
        </div>
        <footer>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ready}>
            {busy ?? "Add artifact"}
          </button>
        </footer>
      </form>
    </div>
  );
}
