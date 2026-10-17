// SPDX-License-Identifier: GPL-3.0-only
import { AlertIcon, CpuIcon, FileDirectoryFillIcon, FileIcon, GitCommitIcon, LinkExternalIcon, NoteIcon } from "@primer/octicons-react";
import type { ArtifactPlace } from "../lib/analysis";
import { canOpenFile, fileInfo, openFile, revealFolder } from "../lib/desktop";
import { useAsync } from "../lib/util";
import type { FileInfo as Info } from "../types";
import { BlankSlate, DocsLink, Spinner } from "./BlankSlate";
import { NoteBlocks } from "./NoteEditor";
import { InlineDiffs } from "./Notes";

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`);
const hex = (n: number) => `0x${n.toString(16)}`;
const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="fact">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);
// The rabin2 fields worth reading at a glance (the rest stay a click away).
const KEY_FACTS: [string, string][] = [
  ["machine", "Architecture"],
  ["bits", "Bits"],
  ["os", "OS"],
  ["bintype", "Type"],
  ["class", "Class"],
  ["endian", "Endianness"],
  ["compiler", "Compiler"],
  ["stripped", "Stripped"],
  ["pic", "PIC"],
  ["nx", "NX"],
  ["canary", "Stack canary"],
];

interface Props {
  /** The project folder, and the picked entry's path in it. */
  project: string;
  path: string;
  /** Re-read when this changes (the window regained focus, so files may have been edited). */
  reads: number;
  onPath: (path: string) => void;
  onArtifact: (name: string) => void;
  onNotes: () => void;
  /** After a note's block is saved. */
  onSaved: () => void;
  /** The artifact the entry is (or is in), which offers Analyze starting from it. */
  artifactPlace: ArtifactPlace | null;
  onAnalyze: (place: ArtifactPlace) => void;
}

/** Desktop: what a file or folder in the project is — the main area's view of it. */
export function FileInfo({ project, path, reads, onPath, onArtifact, onNotes, onSaved, artifactPlace, onAnalyze }: Props) {
  // Read again on `reads`, keeping it on screen meanwhile (a note being edited stays open).
  const [info, error] = useAsync(() => fileInfo(project, path), [project, path], [reads]);
  if (error) {
    return (
      <BlankSlate icon={<AlertIcon size={48} className="big-icon" />} title={path}>
        <p>{error}</p>
      </BlankSlate>
    );
  }
  if (!info) return <Spinner />;
  const abs = `${project}/${path}`;

  return (
    <div className="file-info">
      <header className="file-info-head">
        {info.kind === "dir" ? <FileDirectoryFillIcon size={16} className="tree-folder-icon" /> : <FileIcon size={16} />}
        <div className="grow">
          <div className="title mono">{info.name}</div>
          <div className="sub muted">
            {path}
            {info.kind !== "dir" && ` · ${size(info.size)}`}
            {info.modified && ` · modified ${new Date(info.modified).toLocaleString()}`}
          </div>
        </div>
        {info.kind !== "dir" && canOpenFile(path) && (
          <button className="btn" onClick={() => openFile(abs)}>
            Open
          </button>
        )}
        {artifactPlace && (
          <button
            className="btn primary"
            onClick={() => onAnalyze(artifactPlace)}
            title={`Compare ${artifactPlace.artifact}${artifactPlace.version ? ` ${artifactPlace.version}` : ""} with another version`}
          >
            Analyze
          </button>
        )}
        <button className="btn" onClick={() => revealFolder(abs)} title="Show in the file manager">
          <LinkExternalIcon size={14} /> Reveal
        </button>
      </header>
      {info.kind === "notes" ? (
        <NoteBlocks project={project} path={path} reads={reads} onSaved={onSaved} />
      ) : (
        <Body info={info} path={path} onPath={onPath} onArtifact={onArtifact} onNotes={onNotes} />
      )}
    </div>
  );
}

function Body({ info, path, onPath, onArtifact, onNotes }: { info: Info; path: string } & Pick<Props, "onPath" | "onArtifact" | "onNotes">) {
  const cut = "truncated" in info && info.truncated && <div className="notice">Only the first 512 KB is shown.</div>;
  switch (info.kind) {
    case "dir":
      return info.entries.length ? (
        <div className="file-info-entries">
          {info.entries.map((e) => (
            <div key={e.name} className="list-item" onClick={() => onPath(`${path}/${e.name}`)}>
              {e.dir ? <FileDirectoryFillIcon size={14} className="tree-folder-icon" /> : <FileIcon size={14} />}
              <span className="mono">{e.name}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">Empty folder.</p>
      );
    case "project":
      return <ProjectFile info={info} onArtifact={onArtifact} onNotes={onNotes} />;
    case "patch":
      return (
        <>
          {cut}
          <InlineDiffs text={info.text} />
        </>
      );
    case "binary":
      return <Binary info={info} />;
    default:
      return (
        <>
          {cut}
          <pre className="file-text">{info.text}</pre>
        </>
      );
  }
}

/** The project file: what the project is, its notes, and its artifacts. */
function ProjectFile({ info, onArtifact, onNotes }: { info: Extract<Info, { kind: "project" }> } & Pick<Props, "onArtifact" | "onNotes">) {
  const json = (info.json ?? {}) as { project?: string; artifacts?: { name: string; kind: string; repo?: string; image?: string; versions?: { id: string }[] }[] };
  const artifacts = json.artifacts ?? [];
  return (
    <div className="project-file">
      <dl className="facts">
        <Fact label="Project">
          <span className="mono">{json.project ?? "—"}</span>
        </Fact>
        <Fact label="Notes">
          {info.notes ? (
            <button className="link" onClick={onNotes}>
              <NoteIcon size={14} /> {info.notes}
            </button>
          ) : (
            <span className="muted">
              None yet. <DocsLink page="diffmd" />
            </span>
          )}
        </Fact>
      </dl>
      <h3>Artifacts ({artifacts.length})</h3>
      {artifacts.map((a) => (
        <div key={a.name} className="list-item two-line" onClick={() => onArtifact(a.name)} title="Diff its versions">
          {a.kind === "git" ? <GitCommitIcon size={16} /> : <CpuIcon size={16} />}
          <div className="main">
            <div className="title mono">{a.name}</div>
            <div className="sub muted">
              {a.kind === "git" ? a.repo : `${a.versions?.length ?? 0} version${a.versions?.length === 1 ? "" : "s"}: ${a.versions?.map((v) => v.id).join(", ")}`}
              {a.image && ` · from ${a.image}`}
            </div>
          </div>
        </div>
      ))}
      <details>
        <summary className="muted">Raw JSON</summary>
        <pre className="file-text">{JSON.stringify(info.json, null, 2)}</pre>
      </details>
    </div>
  );
}

/** A binary: its format, and radare2's view of its headers, load commands, libraries and sections. */
function Binary({ info: { format, binary: b } }: { info: Extract<Info, { kind: "binary" }> }) {
  const info = b?.info ?? {};
  const facts = Object.entries(info).filter(([, v]) => v !== "" && v !== null && typeof v !== "object");
  return (
    <div className="binary-info">
      <dl className="facts">
        <Fact label="Format">{format}</Fact>
        {KEY_FACTS.filter(([k]) => k in info).map(([k, label]) => (
          <Fact key={k} label={label}>
            <span className="mono">{String(info[k])}</span>
          </Fact>
        ))}
      </dl>
      {facts.length > 0 && (
        <details>
          <summary className="muted">All rabin2 fields</summary>
          <dl className="facts">
            {facts.map(([k, v]) => (
              <Fact key={k} label={k}>
                <span className="mono">{String(v)}</span>
              </Fact>
            ))}
          </dl>
        </details>
      )}
      {!b && <p className="muted">Install radare2 (rabin2) to see this binary's headers, libraries and sections.</p>}
      {b && b.headers.length > 0 && (
        <>
          <h3>Headers & load commands ({b.headers.length})</h3>
          <table className="info-table">
            <tbody>
              {b.headers.map((h, i) => (
                <tr key={i}>
                  <td className="mono muted">{h.offset}</td>
                  <td className="mono">{h.name}</td>
                  <td className="muted">{h.format}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {b && b.libs.length > 0 && (
        <>
          <h3>Linked libraries ({b.libs.length})</h3>
          <ul className="mono info-list">
            {b.libs.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      )}
      {b && b.sections.length > 0 && (
        <>
          <h3>Sections ({b.sections.length})</h3>
          <table className="info-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Address</th>
                <th>Perm</th>
              </tr>
            </thead>
            <tbody>
              {b.sections.map((s) => (
                <tr key={`${s.name}${s.vaddr}`}>
                  <td className="mono">{s.name}</td>
                  <td className="mono">{size(s.size)}</td>
                  <td className="mono muted">{hex(s.vaddr)}</td>
                  <td className="mono">{s.perm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
