// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { AlertIcon, BookIcon, CpuIcon, FileDiffIcon, FileDirectoryIcon, GitCompareIcon, LinkExternalIcon } from "@primer/octicons-react";
import type { AnalysisContent, BinaryFunction, Location, Project } from "../types";
import { loadAnalysis, locationId } from "../lib/analysis";
import { artifactFunctionDiff, revealFolder } from "../lib/desktop";
import { parseUnifiedDiff } from "../lib/diff";
import { useAsync } from "../lib/util";
import { BlankSlate, DocsLink, Spinner } from "./BlankSlate";
import { DiffView } from "./DiffView";
import { FileList } from "./FileList";
import { ProjectHeader } from "./ProjectHeader";
import { Skull } from "./Skull";

interface Props {
  project: Project;
  /** null while the repo list is loading. */
  repos: unknown[] | null;
  /** The analysis on screen: a repository, or a local folder. */
  location: Location | null;
  error: string | null;
  /** The artifact on screen, and the two version ids to diff (from the URL). */
  artifact?: string | null;
  base?: string | null;
  head?: string | null;
  /** The diff file (or binary function) on screen, from the URL; null shows the write-up. */
  file: string | null;
  /** The line to jump to in it (from the URL). */
  line?: number | null;
  onFile: (path: string | null) => void;
  /** Desktop: add an artifact (shown when the project has none). */
  onAddArtifact?: () => void;
  /** The main action, shown in the project header (Analyze, or "View on …" in embeds). */
  action: React.ReactNode;
  /** Embedded in another page: project details start collapsed. */
  compact?: boolean;
}

/** A project's analysis: the write-up, plus the diff — stored patches, two git refs, or two binaries. */
export function Analysis({ project, repos, location, error: reposError, artifact, base, head, file, line = null, onFile, onAddArtifact, action, compact }: Props) {
  // A local analysis is read again whenever the window regains focus: its files were probably just edited.
  const [reads, setReads] = useState(0);
  const local = location?.kind === "local";
  useEffect(() => {
    if (!local) return;
    const reread = () => setReads((n) => n + 1);
    window.addEventListener("focus", reread);
    return () => window.removeEventListener("focus", reread);
  }, [local]);
  const [content, error] = useAsync(
    () => (location ? loadAnalysis(location, artifact, base, head) : null),
    [location && locationId(location), artifact, base, head, reads],
  );

  const files = content?.files ?? [];
  const binary = content?.binary;
  const readme = useMemo(() => content?.readme_html && DOMPurify.sanitize(content.readme_html), [content]);
  const shownError = reposError ?? error;
  const found = file === null ? -1 : files.findIndex((f) => f.path === file);
  const selected = found < 0 ? null : found;
  const selectedFn = binary && file !== null ? binary.find((f) => f.name === file) : undefined;

  let main: React.ReactNode;
  if (shownError) {
    main = (
      <BlankSlate icon={<AlertIcon size={48} className="big-icon" />} title="Couldn't load the analysis">
        <p>{shownError}</p>
      </BlankSlate>
    );
  } else if (location ? !content : !repos) {
    main = <Spinner />;
  } else if (!location) {
    main = (
      <BlankSlate icon={<Skull size={48} />} title="Not analyzed yet">
        <p>
          Press <b>Analyze</b> to start one. <DocsLink page="analyses" />
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
  } else if (content && local && !content.artifacts.length && !files.length && file === null) {
    main = (
      <BlankSlate icon={<Skull size={48} />} title="No artifacts yet">
        <p>
          Add a git repository or a file to compare its versions. <DocsLink page="analyses" />
        </p>
        {onAddArtifact && (
          <button className="btn primary" onClick={onAddArtifact}>
            Add artifact…
          </button>
        )}
      </BlankSlate>
    );
  } else if (content?.artifacts.length && !files.length && !binary && file === null) {
    main = (
      <BlankSlate icon={<GitCompareIcon size={48} className="big-icon" />} title={content.artifact?.name ?? "Pick two versions"}>
        <p>Choose a base and a head version in the Artifacts menu to see their diff.</p>
      </BlankSlate>
    );
  } else if (content?.needsDesktop) {
    main = (
      <BlankSlate icon={<CpuIcon size={48} className="big-icon" />} title="Open in the desktop app">
        <p>
          This analysis diffs artifacts (git refs, files or binaries), which Difflicit does on your computer.{" "}
          <DocsLink page="desktop" />
        </p>
      </BlankSlate>
    );
  } else if (readme) {
    main = <article className="markdown" dangerouslySetInnerHTML={{ __html: readme }} />;
  } else {
    main = (
      <BlankSlate>
        <p>
          No write-up yet. <DocsLink page="analyses" />
        </p>
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
              <button className="sidebar-header repo-link" onClick={() => revealFolder(location.path)} title="Show in folder">
                <FileDirectoryIcon size={14} />
                <span className="grow mono">{location.folder}</span>
              </button>
            )}
            <div className="sidebar-section">
              <div className={`list-item file ${file === null ? "selected" : ""}`} onClick={() => onFile(null)}>
                <BookIcon size={14} />
                <div className="main">
                  <div className="title">Write-up</div>
                </div>
              </div>
              {binary ? (
                <>
                  <div className="sidebar-header">
                    <CpuIcon size={14} />
                    {content ? `${binary.length} function${binary.length === 1 ? "" : "s"}` : "Loading…"}
                  </div>
                  <FunctionList functions={binary} selected={file} onSelect={onFile} />
                </>
              ) : (
                <>
                  <div className="sidebar-header">
                    <FileDiffIcon size={14} />
                    {content ? `${files.length} changed file${files.length === 1 ? "" : "s"}` : "Loading…"}
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
  const { project, artifact, base, head } = content;
  const [patch, error] = useAsync(
    () =>
      project && artifact && base && head
        ? artifactFunctionDiff(project, artifact, base, head, fn.name, fn.base_addr, fn.head_addr)
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
