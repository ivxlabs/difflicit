import { useMemo } from "react";
import DOMPurify from "dompurify";
import { AlertIcon, BookIcon, FileDiffIcon, LinkExternalIcon } from "@primer/octicons-react";
import type { CveDetail, Repo } from "../types";
import { CONNECT_LABEL } from "../lib/access";
import { repoContent } from "../lib/github";
import { useAsync } from "../lib/util";
import { BlankSlate, Spinner } from "./BlankSlate";
import { CveHeader } from "./CveHeader";
import { DiffView } from "./DiffView";
import { FileList } from "./FileList";
import { Skull } from "./Skull";

interface Props {
  cve: CveDetail;
  org: string;
  /** null while the repo list is loading. */
  repos: Repo[] | null;
  repo: Repo | null;
  error: string | null;
  /** Path of the diff file on screen (from the URL); null shows the write-up. */
  file: string | null;
  onFile: (path: string | null) => void;
  /** The main action, shown in the CVE header (Analyze). */
  action: React.ReactNode;
}

/** A CVE's analysis: README write-up plus every *.diff / *.patch in the repo, GitHub Desktop style. */
export function Analysis({ cve, org, repos, repo, error: reposError, file, onFile, action }: Props) {
  const [content, error] = useAsync(() => (repo ? repoContent(repo) : null), [repo]);

  const files = content?.files ?? [];
  const readme = useMemo(() => content?.readme_html && DOMPurify.sanitize(content.readme_html), [content]);
  const shownError = reposError ?? error;
  const found = file === null ? -1 : files.findIndex((f) => f.path === file);
  const selected = found < 0 ? null : found;

  let main: React.ReactNode;
  if (shownError) {
    main = (
      <BlankSlate icon={<AlertIcon size={48} className="big-icon" />} title="Couldn't load the analysis">
        <p>{shownError}</p>
      </BlankSlate>
    );
  } else if (!repos || (repo && !content)) {
    main = <Spinner />;
  } else if (!repo) {
    main = (
      <BlankSlate icon={<Skull size={48} />} title="Not analyzed yet">
        <p>
          Analyses are GitHub repositories named after the CVE, published as <code>{`${org}/${cve.id}`}</code>. Press{" "}
          <b>Analyze</b> to start your own, or {CONNECT_LABEL.toLowerCase()} to see one you already have (private works
          too). The write-up goes in <code>README.md</code> and the fix in <code>*.diff</code> or <code>*.patch</code>{" "}
          files.
        </p>
      </BlankSlate>
    );
  } else if (selected !== null) {
    main = <DiffView file={files[selected]} />;
  } else if (file !== null) {
    main = (
      <BlankSlate>
        <p>
          <code>{file}</code> isn't in this repository's patches anymore.
        </p>
      </BlankSlate>
    );
  } else if (readme) {
    main = <article className="markdown" dangerouslySetInnerHTML={{ __html: readme }} />;
  } else {
    main = (
      <BlankSlate>
        <p>
          This repository has no README yet. Add one, plus the fix as <code>*.diff</code> or <code>*.patch</code> files,
          and they will show up here.
        </p>
      </BlankSlate>
    );
  }

  return (
    <div className="body">
      <aside className="sidebar">
        {repo && (
          <>
            <a className="sidebar-header repo-link" href={repo.html_url} target="_blank" rel="noreferrer" title="Open on GitHub">
              <Skull size={14} />
              <span className="grow mono">{repo.full_name}</span>
              <LinkExternalIcon size={12} />
            </a>
            <div className="sidebar-section">
              <div className={`list-item file ${file === null ? "selected" : ""}`} onClick={() => onFile(null)}>
                <BookIcon size={14} />
                <div className="main">
                  <div className="title">Write-up</div>
                </div>
              </div>
              <div className="sidebar-header">
                <FileDiffIcon size={14} />
                {content ? `${files.length} changed file${files.length === 1 ? "" : "s"}` : "Loading…"}
              </div>
              <FileList files={files} selected={selected} onSelect={(i) => onFile(files[i].path)} />
            </div>
          </>
        )}
      </aside>
      <main className="main-panel">
        <CveHeader cve={cve} action={action} />
        {main}
      </main>
    </div>
  );
}
