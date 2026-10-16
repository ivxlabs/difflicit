// SPDX-License-Identifier: GPL-3.0-only
import {
  DiffIcon,
  FileIcon,
  GitCommitIcon,
  GitCompareIcon,
  PlusIcon,
  GitPullRequestIcon,
  LinkExternalIcon,
  LockIcon,
  NoteIcon,
  RepoForkedIcon,
  RepoIcon,
  StarIcon,
} from "@primer/octicons-react";
import { INSTANCE, PRODUCT, PROJECTS } from "../config";
import type { Artifact, Location, Project, Repo, Viewer } from "../types";
import type { VersionOption } from "../lib/analysis";
import { AccountMenu } from "../iam/AccountMenu";
import { keyLabel, runCommand } from "../lib/commands";
import { IS_DESKTOP } from "../lib/desktop";
import { ProjectPicker } from "./ProjectPicker";
import { ShareMenu } from "./ShareMenu";
import { Skull } from "./Skull";
import { StarButton } from "./StarButton";
import { ToolbarButton, ToolbarDropdown } from "./ToolbarItem";

interface Props {
  mine: Set<string>;
  project: Project | null;
  projectId: string | null;
  repos: Repo[];
  /** Desktop: this project's analyses in folders on this computer. */
  folders: Location[];
  /** The project's artifacts, the one on screen, its versions, and the two version ids being diffed. */
  artifacts: Artifact[];
  artifact?: Artifact;
  versions: VersionOption[];
  base?: string;
  head?: string;
  onArtifact: (name: string) => void;
  onPair: (base: string, head: string) => void;
  onAddArtifact: () => void;
  onAddVersion: (artifact: string) => void;
  /** The analysis on screen, a folder or a repository; `repo` is it when it's on GitHub. */
  location: Location | null;
  repo: Repo | null;
  /** The owner's published analysis of this project, if any. */
  upstream: Repo | null;
  file: string | null;
  viewer: Viewer | null;
  onPick: (id: string) => void;
  onRepo: (fullName: string) => void;
  onAccount: () => void;
}

const repoKind = (r: Repo) =>
  r.owner.login.toLowerCase() === PROJECTS.owner.toLowerCase() ? "published" : r.fork ? "fork" : r.private ? "private" : "repo";

const RepoKindIcon = ({ repo }: { repo: Repo | null }) =>
  repo?.private ? <LockIcon size={16} /> : repo?.fork ? <RepoForkedIcon size={16} /> : <RepoIcon size={16} />;

export function Toolbar(props: Props) {
  const { mine, project, projectId, repos, folders, location, repo, upstream, file, viewer, onPick, onRepo, onAccount } = props;
  const { artifacts, artifact, versions, base, head, onArtifact, onPair, onAddArtifact, onAddVersion } = props;
  const diffingArtifacts = location?.kind === "local";
  const menu = project?.menu;

  return (
    <header className="toolbar" data-tauri-drag-region>
      <div className="toolbar-brand" data-tauri-drag-region>
        {/* The favicon, so the logo lives in one file (public/favicon.svg). */}
        <img className="brand-logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={30} height={30} />
        <span className="brand-text">
          <span className="product">{PRODUCT}</span>
          <span className="instance mono">
            {IS_DESKTOP ? <IvxMark /> : `${INSTANCE.icon} | ${INSTANCE.name}`}
          </span>
        </span>
      </div>

      <ToolbarDropdown
        icon={<DiffIcon size={16} />}
        top="Current project"
        main={projectId ?? "No project opened"}
        width={280}
        title={`Switch project (${keyLabel("o")})`}
        defaultOpen={!projectId}
        command="projects"
      >
        {(close) => (
          <ProjectPicker
            mine={mine}
            current={projectId}
            onPick={(id) => {
              close();
              onPick(id);
            }}
            desktop={IS_DESKTOP}
            onOpenFolder={() => {
              close();
              runCommand("open-folder");
            }}
            onNewAnalysis={() => {
              close();
              runCommand("new-analysis");
            }}
          />
        )}
      </ToolbarDropdown>

      <ToolbarDropdown
        icon={diffingArtifacts ? <GitCompareIcon size={16} /> : <RepoKindIcon repo={repo} />}
        top={diffingArtifacts ? "Artifacts" : repo ? `Repository (${repoKind(repo)})` : "Repository"}
        main={
          diffingArtifacts ? (
            artifact ? (
              <>
                {artifact.name}
                {base && head && (
                  <>
                    {" "}
                    <span className="muted">· {base} →</span> {head}
                  </>
                )}
              </>
            ) : (
              "No artifacts"
            )
          ) : (
            (repo?.full_name ?? (project ? "Not analyzed" : "–"))
          )
        }
        width={300}
        disabled={!diffingArtifacts && !repos.length && !folders.length}
        command="repositories"
      >
        {(close) =>
          diffingArtifacts ? (
            <div className="dropdown menu artifacts-menu">
              {!artifacts.length && (
                <div className="list-item notice-row">
                  <div className="main muted">No artifacts yet. Add a git repo or a file to compare its versions.</div>
                </div>
              )}
              {artifacts.length > 0 && (
                <div className="artifacts-pick">
                  {artifacts.length > 1 && (
                    <label className="field">
                      <span>Artifact</span>
                      <select className="select" value={artifact?.name} onChange={(e) => onArtifact(e.target.value)}>
                        {artifacts.map((a) => (
                          <option key={a.name} value={a.name}>
                            {a.name} ({a.kind})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="artifacts-pair">
                    <label className="field">
                      <span>Base</span>
                      <select className="select" value={base ?? ""} onChange={(e) => head && onPair(e.target.value, head)} disabled={!versions.length}>
                        {versions.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="muted">→</span>
                    <label className="field">
                      <span>Head</span>
                      <select className="select" value={head ?? ""} onChange={(e) => base && onPair(base, e.target.value)} disabled={!versions.length}>
                        {versions.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {artifact && !versions.length && <div className="muted small-note">Loading versions…</div>}
                  {artifact?.kind === "file" && (
                    <button
                      className="btn"
                      onClick={() => {
                        close();
                        onAddVersion(artifact.name);
                      }}
                    >
                      <PlusIcon size={14} /> Add version…
                    </button>
                  )}
                </div>
              )}
              {artifacts.map((a) => (
                <div
                  key={a.name}
                  className={`list-item two-line ${a.name === artifact?.name ? "selected" : ""}`}
                  onClick={() => onArtifact(a.name)}
                >
                  {a.kind === "git" ? <GitCommitIcon size={16} /> : <FileIcon size={16} />}
                  <div className="main">
                    <div className="title mono">{a.name}</div>
                    <div className="sub muted">{a.kind === "git" ? a.repo : `${a.versions.length} version${a.versions.length === 1 ? "" : "s"}`}</div>
                  </div>
                </div>
              ))}
              <button
                className="btn"
                onClick={() => {
                  close();
                  onAddArtifact();
                }}
              >
                <PlusIcon size={14} /> Add artifact…
              </button>
            </div>
          ) : (
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
                    {repoKind(r)}
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
          )
        }
      </ToolbarDropdown>

      {menu && menu.items.length > 0 && (
        <ToolbarDropdown
          icon={<NoteIcon size={16} />}
          top={menu.items.length > 1 ? `${menu.label} (${menu.items.length})` : menu.label}
          main={menu.items[0].title}
          width={240}
        >
          {() => (
            <div className="dropdown menu">
              {menu.items.map((item) => (
                <a key={item.url} className="list-item two-line" href={item.url} target="_blank" rel="noreferrer">
                  <div className="main">
                    <div className="title strong">{item.title}</div>
                    {item.detail && <div className="sub muted">{item.detail}</div>}
                  </div>
                  <LinkExternalIcon size={14} />
                </a>
              ))}
            </div>
          )}
        </ToolbarDropdown>
      )}

      <div className="toolbar-spacer" data-tauri-drag-region />

      {/* Links from the desktop app would point at the app itself; share from the website instead. */}
      {project && !IS_DESKTOP && <ShareMenu project={project} repo={repo} file={file} />}
      {upstream && <ContributeButton {...props} upstream={upstream} />}
      <StarButton variant="toolbar" />
      {__IAM__ ? (
        <AccountMenu viewer={viewer} />
      ) : (
        <ToolbarButton
          icon={viewer ? <img className="avatar-img" src={viewer.avatar_url} alt="" /> : <Skull />}
          top={viewer ? viewer.login : "Sign In to"}
          main={viewer ? "Connected" : "Connect GitHub"}
          onClick={onAccount}
        />
      )}
    </header>
  );
}

/**
 * The desktop app isn't any one site, so it names its maker instead: "ivx/res", unfurling to "ivx research" on
 * hover (like the mark on ivx.run).
 */
const IvxMark = () => (
  <a className="ivx-mark" href="https://ivx.run" target="_blank" rel="noreferrer" aria-label="ivx research">
    ivx<span className="ivx-mark__slash" />
    res<span className="ivx-mark__rest">earch</span>
  </a>
);

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
