// SPDX-License-Identifier: GPL-3.0-only
import { useState } from "react";
import { CheckIcon, CopyIcon, LinkExternalIcon, LockIcon, ShareIcon } from "@primer/octicons-react";
import { INSTANCE } from "../config";
import type { CveDetail, Repo } from "../types";
import { ToolbarDropdown } from "./ToolbarItem";

interface Props {
  cve: CveDetail;
  repo: Repo | null;
  file: string | null;
}

/** Share what's on screen: the URL already encodes the CVE, repository and open file. */
export function ShareMenu({ cve, repo, file }: Props) {
  const [copied, setCopied] = useState(false);
  const impact = cve.entries.find((e) => e.impact)?.impact;
  const subject = file ? `${cve.id}: ${file}` : cve.id;
  const text = `${subject}${impact ? `: ${impact}` : ""}`.slice(0, 200) + ` · patch analysis on ${INSTANCE.name}`;

  const copy = async () => {
    await navigator.clipboard.writeText(location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const targets = [
    { label: "Post on X", href: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(location.href)}` },
    { label: "Post on LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(location.href)}` },
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
          <div className="list-item" onClick={copy}>
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            <div className="main">{copied ? "Copied" : "Copy link"}</div>
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
                navigator.share({ title: `${subject} · ${INSTANCE.name}`, text, url: location.href }).catch(() => {});
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
