// SPDX-License-Identifier: GPL-3.0-only
import {
  BugIcon,
  GitPullRequestIcon,
  LinkExternalIcon,
  LockIcon,
  NoteIcon,
  RepoForkedIcon,
  RepoIcon,
  StarIcon,
} from "@primer/octicons-react";
import { INSTANCE, PRODUCT } from "../config";
import type { CveDetail, Index, Repo, Viewer } from "../types";
import { uniqueBy } from "../lib/util";
import { AccountMenu } from "../iam/AccountMenu";
import { CvePicker } from "./CvePicker";
import { ShareMenu } from "./ShareMenu";
import { Skull } from "./Skull";
import { StarButton } from "./StarButton";
import { ToolbarButton, ToolbarDropdown } from "./ToolbarItem";

interface Props {
  index: Index | null;
  mine: Set<string>;
  cve: CveDetail | null;
  cveId: string | null;
  repos: Repo[];
  repo: Repo | null;
  /** The org's published analysis of this CVE, if any. */
  upstream: Repo | null;
  file: string | null;
  viewer: Viewer | null;
  onPick: (id: string) => void;
  onRepo: (fullName: string) => void;
  onAccount: () => void;
}

const repoKind = (r: Repo, org: string) =>
  r.owner.login === org ? "analysis" : r.fork ? "fork" : r.private ? "private" : "repo";

const RepoKindIcon = ({ repo }: { repo: Repo | null }) =>
  repo?.private ? <LockIcon size={16} /> : repo?.fork ? <RepoForkedIcon size={16} /> : <RepoIcon size={16} />;

export function Toolbar(props: Props) {
  const { index, mine, cve, cveId, repos, repo, upstream, file, viewer, onPick, onRepo, onAccount } = props;
  const org = index?.org ?? "";
  const advisories = uniqueBy(cve?.entries ?? [], (e) => e.advisory_id);

  return (
    <header className="toolbar">
      <div className="toolbar-brand">
        <span className="product">{PRODUCT}</span>
        <span className="instance mono">
          {INSTANCE.icon} | {INSTANCE.name}
        </span>
      </div>

      <ToolbarDropdown
        icon={<BugIcon size={16} />}
        top="Current CVE"
        main={cveId ?? "Select a CVE"}
        width={280}
        title="Switch CVE (⌘K)"
        defaultOpen={!cveId}
        shortcut="k"
      >
        {(close) => (
          <CvePicker
            index={index}
            mine={mine}
            current={cveId}
            onPick={(id) => {
              close();
              onPick(id);
            }}
          />
        )}
      </ToolbarDropdown>

      <ToolbarDropdown
        icon={<RepoKindIcon repo={repo} />}
        top={repo ? `Repository (${repoKind(repo, org)})` : "Repository"}
        main={repo?.full_name ?? (cve ? "Not analyzed" : "–")}
        width={280}
        disabled={!repos.length}
      >
        {(close) => (
          <div className="dropdown menu">
            {repos.map((r) => (
              <div
                key={r.full_name}
                className={`list-item two-line ${r.full_name === repo?.full_name ? "selected" : ""}`}
                onClick={() => {
                  close();
                  onRepo(r.full_name);
                }}
              >
                <RepoKindIcon repo={r} />
                <div className="main">
                  <div className="title mono">{r.full_name}</div>
                  <div className="sub muted">
                    {repoKind(r, org)}
                    {r.pushed_at && ` · updated ${new Date(r.pushed_at).toLocaleDateString()}`}
                  </div>
                </div>
                {r.stargazers_count > 0 && (
                  <span className="pill">
                    <StarIcon size={12} /> {r.stargazers_count}
                  </span>
                )}
                <a href={r.html_url} target="_blank" rel="noreferrer" title="Open on GitHub" onClick={(e) => e.stopPropagation()}>
                  <LinkExternalIcon size={14} />
                </a>
              </div>
            ))}
          </div>
        )}
      </ToolbarDropdown>

      <ToolbarDropdown
        icon={<NoteIcon size={16} />}
        top={advisories.length > 1 ? `Fixed in ${advisories.length} advisories` : "Fixed in"}
        main={advisories[0]?.title ?? "–"}
        width={240}
        disabled={!cve}
      >
        {() => (
          <div className="dropdown menu">
            {advisories.map((a) => (
              <a key={a.advisory_id} className="list-item two-line" href={a.url} target="_blank" rel="noreferrer">
                <div className="main">
                  <div className="title strong">{a.title}</div>
                  <div className="sub muted">
                    {a.released ?? "undated"} · {a.platforms.join(", ")}
                  </div>
                </div>
                <LinkExternalIcon size={14} />
              </a>
            ))}
          </div>
        )}
      </ToolbarDropdown>

      <div className="toolbar-spacer" />

      {cve && <ShareMenu cve={cve} repo={repo} file={file} />}
      {upstream && <ContributeButton {...props} upstream={upstream} />}
      <StarButton variant="toolbar" />
      {__IAM__ ? (
        <AccountMenu viewer={viewer} />
      ) : (
        <ToolbarButton
          icon={viewer ? <img className="avatar-img" src={viewer.avatar_url} alt="" /> : <Skull />}
          top={viewer ? viewer.login : "GitHub"}
          main={viewer ? "Connected" : "Connect GitHub"}
          onClick={onAccount}
        />
      )}
    </header>
  );
}

/** Once the user has forked the published analysis: send their changes back, like GitHub Desktop's primary action. */
function ContributeButton({ upstream, repos, viewer }: Props & { upstream: Repo }) {
  const mine = viewer && repos.find((r) => r.fork && r.owner.login.toLowerCase() === viewer.login.toLowerCase());
  if (!mine) return null;
  const branch = upstream.default_branch;
  return (
    <ToolbarButton
      icon={<GitPullRequestIcon size={16} />}
      top={mine.full_name}
      main="Create pull request"
      href={`https://github.com/${upstream.full_name}/compare/${branch}...${mine.owner.login}:${mine.name}:${mine.default_branch}`}
      title="Open a pull request from your fork on GitHub"
    />
  );
}
