// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef, useState } from "react";
import {
  AlertIcon,
  BookIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  CpuIcon,
  EyeIcon,
  FileDiffIcon,
  FileDirectoryIcon,
  FileIcon,
  GitCommitIcon,
  GitCompareIcon,
  LinkExternalIcon,
  NoteIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  TypographyIcon,
} from "@primer/octicons-react";
import type { AnalysisContent, Artifact, BinaryFunction, Location, Project } from "../types";
import { type ArtifactPlace, artifactAt, loadAnalysis, locationId } from "../lib/analysis";
import { FILE_MANAGER, artifactFunctionDiff, canOpenFile, openFile, renameNote, revealFolder } from "../lib/desktop";
import { parseUnifiedDiff } from "../lib/diff";
import { useAsync } from "../lib/util";
import { BlankSlate, DocsLink, Spinner } from "./BlankSlate";
import { contextMenu, copyText, type MenuItem } from "./ContextMenu";
import { DiffView } from "./DiffView";
import { FileInfo } from "./FileInfo";
import { FileList } from "./FileList";
import { NewNoteDialog, NoteBlocks } from "./NoteEditor";
import { PublishedNote } from "./NoteEmbed";
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
  /** Desktop: what's picked in the sidebar (an artifact, a version, a note; relative path), shown instead of a diff. */
  path?: string | null;
  onPath?: (path: string) => void;
  /** Desktop: show an artifact's diff (from the project file's view). */
  onArtifact?: (name: string) => void;
  /** Desktop: analyze starting from an artifact picked in the sidebar. */
  onAnalyzeAt?: (place: ArtifactPlace) => void;
  /** Desktop: remove an artifact (from its right-click menu). */
  onRemoveArtifact?: (name: string) => void;
  /** Desktop: add an artifact (shown when the project has none). */
  onAddArtifact?: () => void;
  /** The main action, in the project header a published analysis has (Get a copy). A project folder has no
   * header: it's on screen in the sidebar, and Analyze is on each artifact. */
  action: React.ReactNode;
}

/** A project's analysis: the notes, plus the diff — stored patches, two git refs, or two binaries. */
export function Analysis(props: Props) {
  const { project, repos, location, error: reposError, artifact, baseArtifact, base, head, file, line = null, onFile, path = null, onPath, onArtifact, onAddArtifact, onAnalyzeAt, onRemoveArtifact, action } =
    props;
  // A local analysis is read again whenever the window regains focus: its files were probably just edited.
  const [reads, setReads] = useState(0);
  // Desktop: the New note dialog, and the note being renamed in the sidebar (its path) with what went wrong.
  const [newNote, setNewNote] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
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
  // Every note in the project (each *.diffmd, and the notes file if it's plain Markdown), its notes first.
  const notesList = [...new Set([content?.notes_path, ...(content?.notes_files ?? [])].filter((n): n is string => Boolean(n)))];
  const showingNotes = file === null && !path;

  /** Rename a note to `name` (from the sidebar); what's on screen follows it. False when it couldn't. */
  const rename = async (note: string, name: string) => {
    if (location?.kind !== "local") return false;
    try {
      const renamed = await renameNote(location.path, note, name);
      setRenaming(null);
      setRenameError(null);
      reread();
      if (path === note) onPath?.(renamed);
      return true;
    } catch (e) {
      setRenameError(String(e));
      return false;
    }
  };

  // Desktop: the right-click menu of the sidebar's section headings: the project as a whole.
  const projectMenu: (MenuItem | false)[] =
    location?.kind === "local"
      ? [
          { label: "New note…", icon: <NoteIcon size={14} />, run: () => setNewNote(true) },
          Boolean(onAddArtifact) && { label: "Add artifact…", icon: <PlusIcon size={14} />, run: () => onAddArtifact!() },
          "separator",
          { label: `Reveal project in ${FILE_MANAGER}`, icon: <FileDirectoryIcon size={14} />, run: () => revealFolder(location.path) },
          { label: "Copy project path", icon: <CopyIcon size={14} />, run: () => copyText(location.path) },
        ]
      : [];

  // Desktop: the right-click menu of an artifact, a version of one, or a note.
  const entryMenu = (rel: string, dir: boolean): (MenuItem | false)[] => {
    if (location?.kind !== "local") return [];
    const abs = `${location.path}/${rel}`;
    const place = artifactAt(content?.artifacts ?? [], rel);
    const isNote = !place && /\.(diffmd|md|markdown)$/i.test(rel);
    const isArtifact = place && !place.version && (rel === `artifacts/${place.artifact}` || content?.artifacts.some((a) => a.kind === "git" && a.repo === rel));
    return [
      { label: dir ? "Show folder" : "Show", icon: <EyeIcon size={14} />, run: () => onPath?.(rel) },
      !dir && canOpenFile(rel) && { label: "Open in your editor", icon: <PencilIcon size={14} />, run: () => openFile(abs) },
      isNote && { label: "Rename…", icon: <TypographyIcon size={14} />, run: () => setRenaming(rel) },
      Boolean(place && onAnalyzeAt) && { label: `Analyze ${place!.version ?? place!.artifact}…`, icon: <GitCompareIcon size={14} />, run: () => onAnalyzeAt!(place!) },
      "separator",
      { label: `Reveal in ${FILE_MANAGER}`, icon: <FileDirectoryIcon size={14} />, run: () => revealFolder(abs) },
      { label: "Copy path", icon: <CopyIcon size={14} />, run: () => copyText(abs) },
      { label: "Copy relative path", run: () => copyText(rel) },
      Boolean(isArtifact && onRemoveArtifact) && "separator",
      Boolean(isArtifact && onRemoveArtifact) && {
        label: `Remove ${place!.artifact}…`,
        confirm: `Remove ${place!.artifact} and delete ${rel}`,
        danger: true,
        icon: <TrashIcon size={14} />,
        run: () => onRemoveArtifact!(place!.artifact),
      },
    ];
  };
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
  } else if (location?.kind === "github" && path) {
    main = <PublishedNote repo={location.repo} path={path} />;
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
        artifactPlace={artifactAt(content?.artifacts ?? [], path)}
        onAnalyze={(place) => onAnalyzeAt?.(place)}
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
      <BlankSlate icon={<GitCompareIcon size={48} className="big-icon" />} title={content.artifact?.name ?? "Compare two versions"}>
        <p>
          {content.base && content.base === content.head
            ? "There's only one version so far. Add another copy under the same name, then Analyze the two."
            : "Pick an artifact or a version on the left and press Analyze to compare it with another."}
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
              <ArtifactList
                artifacts={content?.artifacts ?? []}
                path={path}
                onPath={(p) => onPath?.(p)}
                onAdd={onAddArtifact}
                headMenu={projectMenu}
                entryMenu={entryMenu}
              />
            )}
            <div className="sidebar-section">
              <div
                className={`list-item file section-head ${showingNotes && !notesList.includes(content?.notes_path ?? "") ? "selected" : ""}`}
                onClick={() => onFile(null)}
                {...contextMenu(projectMenu)}
              >
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
              {notesList.map((note) =>
                renaming === note ? (
                  <RenameRow
                    key={note}
                    path={note}
                    error={renameError}
                    onRename={(name) => rename(note, name)}
                    onCancel={() => {
                      setRenaming(null);
                      setRenameError(null);
                    }}
                  />
                ) : (
                <div
                  key={note}
                  className={`list-item file sub-item ${path === note || (showingNotes && note === content?.notes_path) ? "selected" : ""}`}
                  onClick={() => onPath?.(note)}
                  title={note}
                  {...contextMenu(entryMenu(note, false))}
                >
                  <NoteIcon size={14} />
                  <div className="main">
                    <div className="title mono">
                      <bdi>{note}</bdi>
                    </div>
                  </div>
                </div>
                ),
              )}
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
        {!local && <ProjectHeader project={project} action={action} />}
        {main}
      </main>
      {newNote && location?.kind === "local" && (
        <NewNoteDialog
          project={location.path}
          onClose={() => setNewNote(false)}
          onCreated={(rel) => {
            setNewNote(false);
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

/**
 * Desktop: the project's artifacts in the sidebar, each opening to its versions (a file artifact's copies; a git
 * artifact's are its refs, picked in Analyze). Picking one shows it, with Analyze starting from it.
 */
function ArtifactList({
  artifacts,
  path,
  onPath,
  onAdd,
  headMenu,
  entryMenu,
}: {
  artifacts: Artifact[];
  path: string | null;
  onPath: (path: string) => void;
  onAdd?: () => void;
  headMenu: (MenuItem | false)[];
  entryMenu: (rel: string, dir: boolean) => (MenuItem | false)[];
}) {
  const [open, setOpen] = useState(true);
  // Opened by hand, or because what's on screen is inside it.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const home = (a: Artifact) => (a.kind === "git" ? a.repo : `artifacts/${a.name}`);
  const isOpen = (a: Artifact) => expanded.has(a.name) || Boolean(path?.startsWith(`${home(a)}/`));
  const toggle = (name: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  return (
    <div className="sidebar-section artifacts-section">
      <div className="list-item file section-head" onClick={() => setOpen((o) => !o)} {...contextMenu(headMenu)}>
        <PackageIcon size={14} />
        <div className="main">
          <div className="title">Artifacts</div>
        </div>
        {onAdd && (
          <button
            type="button"
            className="icon-link"
            title="Add artifact"
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
          >
            <PlusIcon size={14} />
          </button>
        )}
      </div>
      {open && !artifacts.length && <div className="sidebar-note muted">None yet: + adds a git repository or a file.</div>}
      {open &&
        artifacts.map((a) => (
          <div key={a.name}>
            <div
              className={`list-item file sub-item ${path === home(a) ? "selected" : ""}`}
              onClick={() => onPath(home(a))}
              title={a.kind === "git" ? `${a.name} (git repository)` : `${a.name} (${a.versions.length} versions)`}
              {...contextMenu(entryMenu(home(a), true))}
            >
              {a.kind === "file" ? (
                <button
                  type="button"
                  className="icon-link chevron"
                  aria-label={isOpen(a) ? "Hide versions" : "Show versions"}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(a.name);
                  }}
                >
                  {isOpen(a) ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                </button>
              ) : (
                <span className="chevron" />
              )}
              {a.kind === "git" ? <GitCommitIcon size={14} /> : <FileIcon size={14} />}
              <div className="main">
                <div className="title mono">{a.name}</div>
              </div>
            </div>
            {a.kind === "file" &&
              isOpen(a) &&
              [...a.versions].reverse().map((v) => (
                <div
                  key={v.id}
                  className={`list-item file version-item ${path === v.path || path?.startsWith(`${v.path}/`) ? "selected" : ""}`}
                  onClick={() => onPath(v.path)}
                  title={v.path}
                  {...contextMenu(entryMenu(v.path, false))}
                >
                  <div className="main">
                    <div className="title mono">{v.id}</div>
                  </div>
                </div>
              ))}
          </div>
        ))}
    </div>
  );
}

/** A note's name being edited in place: Enter renames it, Escape (or leaving it unchanged) doesn't. */
function RenameRow({ path, error, onRename, onCancel }: { path: string; error: string | null; onRename: (name: string) => Promise<boolean>; onCancel: () => void }) {
  const file = path.split("/").pop() ?? path;
  const [name, setName] = useState(file);
  // Enter and then the blur as the field goes away would rename twice: once is enough.
  const pending = useRef(false);
  const done = async () => {
    if (pending.current) return;
    if (!name.trim() || name.trim() === file) return onCancel();
    pending.current = true;
    if (!(await onRename(name.trim()))) pending.current = false;
  };
  return (
    <div className="list-item file sub-item renaming">
      <NoteIcon size={14} />
      <div className="main">
        <input
          className="input mono rename-input"
          value={name}
          autoFocus
          aria-label="New name"
          // The name without its extension selected, ready to type over.
          onFocus={(e) => e.target.setSelectionRange(0, file.lastIndexOf(".") > 0 ? file.lastIndexOf(".") : file.length)}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void done();
            else if (e.key === "Escape") onCancel();
          }}
          onBlur={() => void done()}
        />
        {error && <div className="sub error-text">{error}</div>}
      </div>
    </div>
  );
}
