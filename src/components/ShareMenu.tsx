// SPDX-License-Identifier: GPL-3.0-only
import { useState } from "react";
import { CheckIcon, CodeIcon, CopyIcon, LinkExternalIcon, LockIcon, ShareIcon } from "@primer/octicons-react";
import { INSTANCE } from "../config";
import { urlFor } from "../lib/route";
import type { CveDetail, Repo } from "../types";
import { ToolbarDropdown } from "./ToolbarItem";

interface Props {
  cve: CveDetail;
  repo: Repo | null;
  file: string | null;
}

/** Share what's on screen: the URL already encodes the CVE, repository and open file. */
export function ShareMenu({ cve, repo, file }: Props) {
  const [copied, setCopied] = useState<"link" | "embed" | null>(null);
  const impact = cve.entries.find((e) => e.impact)?.impact;
  const subject = file ? `${cve.id}: ${file}` : cve.id;
  const text = `${subject}${impact ? `: ${impact}` : ""}`.slice(0, 200) + ` · patch analysis on ${INSTANCE.name}`;

  const link = urlFor({ embed: false });
  const embedCode = `<iframe src="${urlFor({ embed: true })}" title="${`${subject} · ${INSTANCE.name}`.replace(/"/g, "&quot;")}" width="100%" height="560" style="height: 560px !important; max-width: 100%; border: 0; border-radius: 8px" loading="lazy"></iframe>`;
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
    <ToolbarDropdown icon={<ShareIcon size={16} />} top="Share" main={file ? "This diff" : "This analysis"} width={160}>
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
          <div className="list-item" onClick={() => copy("embed")} title="An <iframe> for articles and blog posts">
            {copied === "embed" ? <CheckIcon size={14} /> : <CodeIcon size={14} />}
            <div className="main">{copied === "embed" ? "Copied" : "Copy embed code"}</div>
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
                navigator.share({ title: `${subject} · ${INSTANCE.name}`, text, url: link }).catch(() => {});
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
