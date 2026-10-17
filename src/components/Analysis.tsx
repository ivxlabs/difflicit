// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useState } from "react";
import { AlertIcon, BookIcon, ChevronDownIcon, ChevronRightIcon, CpuIcon, FileDiffIcon, FileDirectoryIcon, GitCompareIcon, LinkExternalIcon, NoteIcon, PlusIcon } from "@primer/octicons-react";
import type { AnalysisContent, BinaryFunction, Location, Project } from "../types";
import { useCatalogVersion } from "../api";
import { loadAnalysis, locationId } from "../lib/analysis";
import { artifactFunctionDiff, openFile, revealFolder } from "../lib/desktop";
import { parseUnifiedDiff } from "../lib/diff";
import { useAsync } from "../lib/util";
import { BlankSlate, DocsLink, Spinner } from "./BlankSlate";
import { DiffView } from "./DiffView";
import { FileInfo } from "./FileInfo";
import { FileList } from "./FileList";
import { FileTree } from "./FileTree";
import { NewNoteDialog, NoteBlocks } from "./NoteEditor";
import { Notes } from "./Notes";
import { ProjectHeader } from "./ProjectHeader";
import { Skull } from "./Skull";

interface Props {
  project: Project;
  /** null while the repo list is loading. */
  repos: unknown[] | null;
  /** The analysis on screen: a repository, or a local folder. */
  location: Location | null;
  error: string | null;
  /** The artifact on screen, and the two version ids to diff (from the URL); `baseArtifact` when comparing two. */
  artifact?: string | null;
  baseArtifact?: string | null;
  base?: string | null;
  head?: string | null;
  /** The diff file (or binary function) on screen, from the URL; null shows the notes. */
  file: string | null;
  /** The line to jump to in it (from the URL). */
  line?: number | null;
  onFile: (path: string | null) => void;
  /** Desktop: the entry picked in the project tree (relative path), shown instead of a diff. */
  path?: string | null;
  onPath?: (path: string) => void;
  /** Desktop: show an artifact's diff (from the project file's view). */
  onArtifact?: (name: string) => void;
  /** Desktop: add an artifact (shown when the project has none). */
  onAddArtifact?: () => void;
  /** The main action, shown in the project header (Analyze, or "View on …" in embeds). */
  action: React.ReactNode;
  /** Embedded in another page: project details start collapsed. */
  compact?: boolean;
}

/** A project's analysis: the notes, plus the diff — stored patches, two git refs, or two binaries. */
export function Analysis(props: Props) {
  const { project, repos, location, error: reposError, artifact, baseArtifact, base, head, file, line = null, onFile, path = null, onPath, onArtifact, onAddArtifact, action, compact } =
    props;
  // A local analysis is read again whenever the window regains focus: its files were probably just edited.
  const [reads, setReads] = useState(0);
  const [treeOpen, setTreeOpen] = useState(true);
  // Desktop: the New note dialog, and a nudge for the tree to re-list.
  const [newNote, setNewNote] = useState(false);
  const [treeVersion, setTreeVersion] = useState(0);
  // The tree also re-lists when the project changes on disk from elsewhere in the app (Analyze writing a note).
  const catalogVersion = useCatalogVersion();
  const local = location?.kind === "local";
  useEffect(() => {
    if (!local) return;
    const reread = () => setReads((n) => n + 1);
    window.addEventListener("focus", reread);
    return () => window.removeEventListener("focus", reread);
  }, [local]);
  // Reading it again keeps it on screen, so a note being edited stays open.
  const [content, error] = useAsync(
    () => (location ? loadAnalysis(location, artifact, base, head, baseArtifact) : null),
    [location && locationId(location), artifact, baseArtifact, base, head],
    [reads],
  );
  const reread = () => setReads((n) => n + 1);

  const files = content?.files ?? [];
  const binary = content?.binary;
  const shownError = reposError ?? error;
  const found = file === null ? -1 : files.findIndex((f) => f.path === file);
  const selected = found < 0 ? null : found;
  const selectedFn = binary && file !== null ? binary.find((f) => f.name === file) : undefined;

  const notesActions = local && (
    <button className="btn" onClick={() => setNewNote(true)}>
      <NoteIcon size={14} /> Start notes
    </button>
  );

  let main: React.ReactNode;
  if (shownError) {
    main = (
      <BlankSlate icon={<AlertIcon size={48} className="big-icon" />} title="Couldn't load the analysis">
        <p>{shownError}</p>
      </BlankSlate>
    );
  } else if (location?.kind === "local" && path) {
    main = (
      <FileInfo
        project={location.path}
        path={path}
        reads={reads}
        onPath={(p) => onPath?.(p)}
        onArtifact={(a) => onArtifact?.(a)}
        onNotes={() => onFile(null)}
        onSaved={reread}
      />
    );
  } else if (location ? !content : !repos) {
    main = <Spinner />;
  } else if (!location) {
    main = (
      <BlankSlate icon={<Skull size={48} />} title="Not analyzed yet">
        <p>
          Press <b>Get a copy</b> to start one. <DocsLink page="analyses" />
        </p>
      </BlankSlate>
    );
  } else if (selectedFn) {
    main = <FunctionDiff fn={selectedFn} content={content!} line={line} />;
  } else if (selected !== null) {
    main = <DiffView file={files[selected]} line={line} />;
  } else if (file !== null) {
    main = (
      <BlankSlate>
        <p>
          <code>{file}</code> isn't in this analysis anymore.
        </p>
      </BlankSlate>
    );
  } else if (location.kind === "local" && content?.notes_path) {
    main = (
      <>
        <div className="notes-bar">
          <NoteIcon size={14} />
          <span className="mono grow">{content.notes_path}</span>
          <DocsLink page="diffmd">diffmd</DocsLink>
          <button className="btn" onClick={() => openFile(`${location.path}/${content.notes_path}`)}>
            Open in your editor
          </button>
        </div>
        <NoteBlocks project={location.path} path={content.notes_path} reads={reads} onSaved={reread} />
      </>
    );
  } else if (content?.notes_html) {
    main = <Notes html={content.notes_html} />;
  } else if (content?.needsDesktop) {
    main = (
      <BlankSlate icon={<CpuIcon size={48} className="big-icon" />} title="Open in the desktop app">
        <p>
          This analysis diffs artifacts (git refs, files or binaries), which Difflicit does on your computer.{" "}
          <DocsLink page="desktop" />
        </p>
      </BlankSlate>
    );
  } else if (content && local && !content.artifacts.length && !files.length) {
    main = (
      <BlankSlate icon={<Skull size={48} />} title="No artifacts yet">
        <p>
          Add a git repository or a file to compare its versions, and keep notes next to them. <DocsLink page="analyses" />
        </p>
        {onAddArtifact && (
          <button className="btn primary" onClick={onAddArtifact}>
            Add artifact…
          </button>
        )}
        {notesActions}
      </BlankSlate>
    );
  } else if (content?.artifacts.length && !files.length && !binary) {
    main = (
      <BlankSlate icon={<GitCompareIcon size={48} className="big-icon" />} title={content.artifact?.name ?? "Pick two versions"}>
        <p>
          {content.base && content.base === content.head
            ? "Base and head are the same version. Add another version, or pick a different base, in the Artifacts menu."
            : "Choose a base and a head version in the Artifacts menu to see their diff."}
        </p>
        {notesActions}
      </BlankSlate>
    );
  } else {
    main = (
      <BlankSlate icon={<NoteIcon size={48} className="big-icon" />} title="No notes yet">
        <p>
          Notes are Markdown with patch diffs in them. <DocsLink page="diffmd">diffmd</DocsLink>
        </p>
        {notesActions}
      </BlankSlate>
    );
  }

  return (
    <div className="body">
      <aside className="sidebar">
        {location && (
          <>
            {location.kind === "github" ? (
              <a className="sidebar-header repo-link" href={location.repo.html_url} target="_blank" rel="noreferrer" title="Open on GitHub">
                <Skull size={14} />
                <span className="grow mono">{location.repo.full_name}</span>
                <LinkExternalIcon size={12} />
              </a>
            ) : (
              <>
                <div className="sidebar-header repo-link tree-root" onClick={() => setTreeOpen((o) => !o)} title="Project files">
                  {treeOpen ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                  <FileDirectoryIcon size={14} />
                  <span className="grow mono">{location.folder}</span>
                  <button
                    type="button"
                    className="icon-link"
                    title="Show in file manager"
                    onClick={(e) => {
                      e.stopPropagation();
                      revealFolder(location.path);
                    }}
                  >
                    <LinkExternalIcon size={12} />
                  </button>
                </div>
                {treeOpen && (
                  <div className="sidebar-section tree">
                    <FileTree key={`${treeVersion}:${catalogVersion}`} path={location.path} selected={path} onSelect={(rel) => onPath?.(rel)} />
                  </div>
                )}
              </>
            )}
            <div className="sidebar-section">
              <div className={`list-item file ${file === null && !path ? "selected" : ""}`} onClick={() => onFile(null)}>
                <BookIcon size={14} />
                <div className="main">
                  <div className="title">Notes</div>
                </div>
                {local && (
                  <button
                    type="button"
                    className="icon-link"
                    title="New note"
                    onClick={(e) => {
                      e.stopPropagation();
                      setNewNote(true);
                    }}
                  >
                    <PlusIcon size={14} />
                  </button>
                )}
              </div>
              {binary ? (
                <>
                  <div className="sidebar-header">
                    <CpuIcon size={14} />
                    {content ? `${binary.length} function${binary.length === 1 ? "" : "s"}` : error ? "Couldn't load" : "Loading…"}
                  </div>
                  <FunctionList functions={binary} selected={file} onSelect={onFile} />
                </>
              ) : (
                <>
                  <div className="sidebar-header">
                    <FileDiffIcon size={14} />
                    {content ? `${files.length} changed file${files.length === 1 ? "" : "s"}` : error ? "Couldn't load" : "Loading…"}
                  </div>
                  <FileList files={files} selected={selected} onSelect={(i) => onFile(files[i].path)} />
                </>
              )}
            </div>
          </>
        )}
      </aside>
      <main className="main-panel">
        <ProjectHeader project={project} action={action} compact={compact} />
        {main}
      </main>
      {newNote && location?.kind === "local" && (
        <NewNoteDialog
          project={location.path}
          onClose={() => setNewNote(false)}
          onCreated={(rel) => {
            setNewNote(false);
            setTreeVersion((v) => v + 1);
            reread();
            onPath?.(rel);
          }}
        />
      )}
    </div>
  );
}

/** The binary's functions, changed ones first, each with its similarity. Only changed ones open a diff. */
function FunctionList({ functions, selected, onSelect }: { functions: BinaryFunction[]; selected: string | null; onSelect: (name: string) => void }) {
  const order = { changed: 0, added: 1, removed: 2, same: 3 };
  const sorted = [...functions].sort((a, b) => order[a.status] - order[b.status] || a.similarity - b.similarity);
  return (
    <>
      {sorted.map((fn) => (
        <div
          key={fn.name}
          className={`list-item file two-line ${fn.name === selected ? "selected" : ""} ${fn.status === "same" ? "dim" : ""}`}
          onClick={() => onSelect(fn.name)}
          title={fn.name}
        >
          <div className="main">
            <div className="title mono">
              <bdi>{fn.name}</bdi>
            </div>
            <div className="sub muted">
              {fn.status}
              {fn.status === "changed" && ` · ${Math.round(fn.similarity * 100)}% alike`}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

/** A binary function's disassembly diff, disassembled and diffed on demand. */
function FunctionDiff({ fn, content, line }: { fn: BinaryFunction; content: AnalysisContent; line: number | null }) {
  const { project, artifact, baseArtifact, base, head } = content;
  const [patch, error] = useAsync(
    () =>
      project && artifact && base && head
        ? artifactFunctionDiff(project, artifact, base, head, fn.name, fn.base_addr, fn.head_addr, baseArtifact)
        : Promise.resolve(""),
    [fn.name],
  );
  if (error)
    return <BlankSlate icon={<AlertIcon size={48} className="big-icon" />} title="Couldn't disassemble"><p>{error}</p></BlankSlate>;
  if (patch === null) return <Spinner />;
  const files = parseUnifiedDiff(patch);
  if (!files.length) {
    return (
      <BlankSlate icon={<CpuIcon size={48} className="big-icon" />} title={fn.name}>
        <p>No disassembly difference{fn.status === "same" ? " — this function is unchanged." : "."}</p>
      </BlankSlate>
    );
  }
  return <DiffView file={files[0]} line={line} />;
}
