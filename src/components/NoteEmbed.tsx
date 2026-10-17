// SPDX-License-Identifier: GPL-3.0-only
import { NoteIcon } from "@primer/octicons-react";
import { INSTANCE } from "../config";
import { notesHtml } from "../lib/github";
import { urlFor } from "../lib/route";
import { useAsync } from "../lib/util";
import type { Project, Repo } from "../types";
import { BlankSlate, Spinner } from "./BlankSlate";
import { Notes } from "./Notes";

/**
 * Embedded in another page (an <iframe>): one diffmd note of a published analysis, its patch diffs included, and a
 * link to the whole project. `path` picks the note; without it, the project's notes.
 */
export function NoteEmbed({ project, repo, path }: { project: Project; repo: Repo | null; path: string | null }) {
  return (
    <div className="note-embed">
      <header className="note-embed-head">
        <NoteIcon size={14} />
        <span className="mono grow">
          {project.id}
          {path && <span className="muted"> · {path}</span>}
        </span>
        <a className="btn embed-open" href={urlFor({ embed: false, path: null })} target="_blank" rel="noreferrer">
          {INSTANCE.icon} View on {INSTANCE.name}
        </a>
      </header>
      {repo ? <PublishedNote repo={repo} path={path} /> : <BlankSlate title="Not analyzed yet" />}
    </div>
  );
}

/** A note of a published analysis, rendered: `path`, or (without it) the analysis's notes. */
export function PublishedNote({ repo, path }: { repo: Repo; path: string | null }) {
  const [html, error] = useAsync(() => notesHtml(repo, path ?? undefined), [repo.full_name, path]);
  if (error) {
    return (
      <BlankSlate title="Couldn't load the note">
        <p>{error}</p>
      </BlankSlate>
    );
  }
  return html === null ? <Spinner /> : <Notes html={html} />;
}
