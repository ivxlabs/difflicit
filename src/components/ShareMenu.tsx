// SPDX-License-Identifier: GPL-3.0-only
import { useState } from "react";
import { CheckIcon, CodeIcon, CopyIcon, LinkExternalIcon, LockIcon, ShareIcon } from "@primer/octicons-react";
import { INSTANCE } from "../config";
import { urlFor } from "../lib/route";
import type { Project, Repo } from "../types";
import { ToolbarDropdown } from "./ToolbarItem";

interface Props {
  project: Project;
  repo: Repo | null;
}

/**
 * Share the project: a link to all of it (its notes, patches and artifacts), not to one file. Embedding is about
 * notes instead: an <iframe> that shows the project's diffmd notes, diffs included, in any HTML page.
 */
export function ShareMenu({ project, repo }: Props) {
  const [copied, setCopied] = useState<"link" | "embed" | null>(null);
  const text = `${project.id}${project.summary ? `: ${project.summary}` : ""}`.slice(0, 200) + ` · patch analysis on ${INSTANCE.name}`;

  const link = urlFor({ embed: false, file: null, line: null, path: null });
  const title = `${project.id} notes · ${INSTANCE.name}`.replace(/"/g, "&quot;");
  const embedCode = `<iframe src="${urlFor({ embed: true, file: null, line: null, path: null })}" title="${title}" width="100%" height="560" style="height: 560px !important; max-width: 100%; border: 0; border-radius: 8px" loading="lazy"></iframe>`;
  // The inline !important matters: many blog themes give every iframe `height: auto`, which collapses it to 150px.

  const copy = async (what: "link" | "embed") => {
    await navigator.clipboard.writeText(what === "link" ? link : embedCode);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  const targets = [
    { label: "Post on X", href: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}` },
    { label: "Post on LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}` },
  ];

  return (
    <ToolbarDropdown icon={<ShareIcon size={16} />} top="Share" main="This project" width={160}>
      {(close) => (
        <div className="dropdown menu action-menu">
          {repo?.private && (
            <div className="list-item notice-row">
              <LockIcon size={14} />
              <div className="main muted">
                <code>{repo.full_name}</code> is private: only people with access to it, and GitHub connected here, can
                see the analysis.
              </div>
            </div>
          )}
          <div className="list-item" onClick={() => copy("link")}>
            {copied === "link" ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            <div className="main">{copied === "link" ? "Copied" : "Copy link"}</div>
          </div>
          <div className="list-item" onClick={() => copy("embed")} title="The project's diffmd notes, diffs included, as an <iframe> for articles and blog posts">
            {copied === "embed" ? <CheckIcon size={14} /> : <CodeIcon size={14} />}
            <div className="main">{copied === "embed" ? "Copied" : "Embed the notes"}</div>
          </div>
          {targets.map((t) => (
            <a key={t.label} className="list-item" href={t.href} target="_blank" rel="noreferrer" onClick={close}>
              <LinkExternalIcon size={14} />
              <div className="main">{t.label}</div>
            </a>
          ))}
          {"share" in navigator && (
            <div
              className="list-item"
              onClick={() => {
                close();
                navigator.share({ title: `${project.id} · ${INSTANCE.name}`, text, url: link }).catch(() => {});
              }}
            >
              <ShareIcon size={14} />
              <div className="main">More…</div>
            </div>
          )}
        </div>
      )}
    </ToolbarDropdown>
  );
}
