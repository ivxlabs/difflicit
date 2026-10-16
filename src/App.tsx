// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useState } from "react";
import { AlertIcon, DiffIcon } from "@primer/octicons-react";
import type { Index, Repo, Location } from "./types";
import { loadIndex, loadProject, localFolders, reloadCatalog, useCatalogVersion } from "./api";
import { INSTANCE, PRODUCT, PROJECTS, docsUrl } from "./config";
import { connectGitHub } from "./iam/session";
import { CONNECT_LABEL, useSignedIn } from "./lib/access";
import { hasCommand, keyLabel, runCommand, useCommand } from "./lib/commands";
import { defaultPair, locationId, versionOptions } from "./lib/analysis";
import { DOWNLOAD_URL, IS_DESKTOP, addFileVersion, gitVersions, initProject, localAnalysis, onAnalyzeLink, openExternal, pickFile, pickFolder, rememberFolder, revealFolder } from "./lib/desktop";
import { AddArtifact } from "./components/AddArtifact";
import { analysisRepos, myAnalysisRepos, viewer as loadViewer } from "./lib/github";
import { projectOfRepo, repoName, sameId } from "./lib/projects";
import { urlFor, useRoute } from "./lib/route";
import { uniqueBy, useAsync } from "./lib/util";
import { Analysis } from "./components/Analysis";
import { AnalyzeButton } from "./components/AnalyzeButton";
import { BlankSlate, DocsLink, Spinner } from "./components/BlankSlate";
import { AnalyzeLocally, OpenInDesktop } from "./components/LocalAnalysis";
import { CommandPalette, SearchPick, type Command } from "./components/Palettes";
import { StarButton } from "./components/StarButton";
import { TokenDialog } from "./components/TokenDialog";
import { Toolbar } from "./components/Toolbar";

export function App({ signInError }: { signInError: string | null }) {
  const [route, navigate] = useRoute();
  const signedIn = useSignedIn();
  const [accountOpen, setAccountOpen] = useState(false);
  const [banner, setBanner] = useState(signInError && `Sign-in failed: ${signInError}`);
  // Repos the user just forked or created: GitHub can take a moment to list them, so keep them meanwhile.
  const [started, setStarted] = useState<Repo[]>([]);
  // Analyze's last step: on the website, hand the repo to the desktop app; there, clone it and open it.
  const [handoff, setHandoff] = useState<Repo | null>(null);
  const [local, setLocal] = useState<{ repo: string; confirm: boolean } | null>(null);
  const [pick, setPick] = useState<"search" | "palette" | null>(null);
  // A folder the user opened that has no analysis.json yet: ask which project it analyzes.
  const [addingArtifact, setAddingArtifact] = useState(false);

  const [index, indexError] = useAsync(loadIndex, [useCatalogVersion()]);
  const [project, projectError] = useAsync(() => (route.project ? loadProject(route.project) : null), [route.project]);
  // Embeds are read-only and anonymous: nothing about the reader is loaded.
  const signedInHere = signedIn && !route.embed;
  const [viewer] = useAsync(() => (signedInHere ? loadViewer() : null), [signedInHere]);
  const [mine] = useAsync(
    () => (signedInHere ? myAnalysisRepos().then((rs) => new Set(rs.map((r) => projectOfRepo(r.name)!.toLowerCase()))) : null),
    [signedInHere],
  );
  const [fetchedRepos, reposError] = useAsync(
    () => (route.project ? analysisRepos(PROJECTS.owner, route.project) : null),
    [route.project, signedIn],
  );

  // The website's "Open in Difflicit" (or any difflicit:// link): show that analysis, and offer to clone it.
  useEffect(() => {
    if (!IS_DESKTOP) return;
    return onAnalyzeLink((id, repo) => {
      navigate({ project: id, repo, file: null, embed: false });
      setLocal({ repo, confirm: true });
    });
  }, [navigate]);

  // ⌘K searches the open analysis, ⌘P runs a command, ⌘O opens a project (Ctrl elsewhere). Pressing it again closes.
  useEffect(() => {
    if (route.embed) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "k" || key === "p") {
        e.preventDefault();
        const want = key === "k" ? "search" : "palette";
        setPick((open) => (open === want ? null : want));
      } else if (key === "o") {
        e.preventDefault();
        setPick(null);
        runCommand("projects");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [route.embed]);

  useEffect(() => {
    const site = IS_DESKTOP ? PRODUCT : INSTANCE.name;
    document.title = route.project ? `${route.project} · ${site}` : IS_DESKTOP ? PRODUCT : `${site} · ${PRODUCT}`;
  }, [route.project]);

  // A fresh fork can take a moment to show up in GitHub's fork list; keep it locally meanwhile.
  const repos =
    fetchedRepos &&
    uniqueBy([...fetchedRepos, ...started.filter((r) => sameId(r.name, repoName(route.project ?? "")))], (r) => r.full_name);
  const upstream = repos?.find((r) => sameId(r.owner.login, PROJECTS.owner)) ?? null;
  // What's on screen: the analysis the URL names (a folder here, or a repository), else a local one, else GitHub's.
  const folders = IS_DESKTOP && index && route.project ? localFolders(route.project) : [];
  const fallback = upstream ?? repos?.[0];
  const named = repos?.find((r) => r.full_name === route.repo);
  const location: Location | null =
    folders.find((f) => locationId(f) === route.repo) ??
    (named && { kind: "github", repo: named }) ??
    folders[0] ??
    (fallback ? { kind: "github", repo: fallback } : null);
  const repo = location?.kind === "github" ? location.repo : null;
  // A local project's artifacts (for the Artifacts control). The current artifact, its versions, and the pair on
  // screen come from the URL (else defaults).
  const [meta] = useAsync(
    () => (location?.kind === "local" ? localAnalysis(location.path) : Promise.resolve(null)),
    [location?.kind === "local" ? location.path : null, useCatalogVersion()],
  );
  const artifacts = meta?.artifacts ?? [];
  const artifact = artifacts.find((a) => a.name === route.artifact) ?? artifacts[0];
  // A git artifact's versions are its refs (fetched); a file artifact's are in the artifact itself.
  const [gitRefs] = useAsync(
    () => (artifact?.kind === "git" && location?.kind === "local" ? gitVersions(location.path, artifact.repo) : Promise.resolve(null)),
    [location?.kind === "local" ? location.path : null, artifact?.kind === "git" ? artifact.repo : null, useCatalogVersion()],
  );
  const versions = artifact ? versionOptions(artifact, gitRefs) : [];
  const fallbackPair = defaultPair(versions);
  const base = route.base ?? fallbackPair.base;
  const head = route.head ?? fallbackPair.head;
  const connect = __IAM__ ? connectGitHub : () => setAccountOpen(true);

  /** Analyze: show the user's repo here and analyze it locally, in the desktop app. */
  const openRepo = (r: Repo) => {
    setStarted((list) => [...list, r]);
    navigate({ repo: r.full_name, file: null });
    if (IS_DESKTOP) setLocal({ repo: r.full_name, confirm: false });
    else setHandoff(r);
  };

  /** Desktop: show a folder's analysis, and keep the folder among the user's projects. */
  const showFolder = (path: string, id: string) => {
    rememberFolder(path);
    reloadCatalog();
    navigate({ project: id, repo: `local:${path}`, file: null });
  };
  const openFolder = async () => {
    const path = await pickFolder();
    if (!path) return;
    try {
      await initProject(path); // mark it a Difflicit project if it isn't one (project = folder name)
      showFolder(path, path.split(/[\\/]/).filter(Boolean).pop() ?? path);
    } catch (e) {
      setBanner(String(e));
    }
  };
  /** Desktop: add another version (a file/folder) to a file artifact, then show it as head. */
  const addVersion = async (artifactName: string) => {
    if (location?.kind !== "local") return;
    const path = await pickFile("Add a version (file or folder)");
    if (!path) return;
    try {
      const version = await addFileVersion(location.path, artifactName, path);
      reloadCatalog();
      navigate({ artifact: artifactName, head: version });
    } catch (e) {
      setBanner(String(e));
    }
  };
  useCommand("open-folder", openFolder, IS_DESKTOP);
  useCommand("add-artifact", () => setAddingArtifact(true), IS_DESKTOP && location?.kind === "local");

  /** What the command palette offers right now. */
  const commands = (): Command[] =>
    [
      { label: "Open project…", hint: keyLabel("o"), run: () => runCommand("projects"), when: true },
      { label: "Add artifact…", run: () => setAddingArtifact(true), when: IS_DESKTOP && location?.kind === "local" },
      { label: "Open folder as a project…", run: openFolder, when: IS_DESKTOP },
      { label: "Search this analysis…", hint: keyLabel("k"), run: () => setPick("search"), when: Boolean(location) },
      { label: "Analyze", run: () => runCommand("analyze"), when: hasCommand("analyze") },
      { label: "Show the write-up", run: () => navigate({ file: null }), when: Boolean(location && route.file) },
      { label: "Switch repository…", run: () => runCommand("repositories"), when: hasCommand("repositories") },
      { label: "Unified diff", run: () => runCommand("diff-unified"), when: hasCommand("diff-unified") },
      { label: "Split diff", run: () => runCommand("diff-split"), when: hasCommand("diff-split") },
      { label: "Open on GitHub", run: () => repo && openExternal(repo.html_url), when: Boolean(repo) },
      { label: "Show in folder", run: () => location?.kind === "local" && revealFolder(location.path), when: location?.kind === "local" },
      {
        label: "Copy link",
        run: () => void navigator.clipboard.writeText(urlFor({ embed: false })),
        when: Boolean(project) && !IS_DESKTOP,
      },
      { label: viewer ? "GitHub account…" : CONNECT_LABEL, run: connect, when: true },
      { label: "Documentation", run: () => openExternal(docsUrl()), when: true },
      { label: "Download the desktop app", run: () => openExternal(DOWNLOAD_URL), when: !IS_DESKTOP },
    ].filter((c) => c.when);

  if (route.embed) {
    return (
      <div className="app embed">
        {projectError ? (
          <BlankSlate icon={<DiffIcon size={32} className="big-icon" />} title={`${route.project} isn't tracked`} />
        ) : !project ? (
          <Spinner />
        ) : (
          <Analysis
            project={project}
            repos={repos}
            location={location}
            error={reposError}
            file={route.file}
            line={route.line}
            onFile={(file) => navigate({ file })}
            compact
            action={
              <a className="btn embed-open" href={urlFor({ embed: false })} target="_blank" rel="noreferrer">
                {INSTANCE.icon} View on {INSTANCE.name}
              </a>
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar
        mine={mine ?? new Set()}
        project={project}
        projectId={route.project}
        repos={repos ?? []}
        folders={folders}
        location={location}
        repo={repo}
        artifacts={artifacts}
        artifact={artifact}
        versions={versions}
        base={base}
        head={head}
        onArtifact={(name) => navigate({ artifact: name })}
        onPair={(b, h) => navigate({ base: b, head: h })}
        onAddArtifact={() => setAddingArtifact(true)}
        onAddVersion={addVersion}
        upstream={upstream}
        file={route.file}
        viewer={viewer}
        onPick={(id) => navigate({ project: id, repo: null, file: null })}
        onRepo={(fullName) => navigate({ repo: fullName, file: null })}
        onAccount={connect}
      />
      {banner && (
        <div className="notice error banner" onClick={() => setBanner(null)} title="Dismiss">
          {banner}
        </div>
      )}
      {indexError ? (
        <BlankSlate icon={<AlertIcon size={48} className="big-icon" />} title="Couldn't load the projects">
          <p>{indexError}</p>
        </BlankSlate>
      ) : !route.project ? (
        <Welcome index={index} />
      ) : projectError ? (
        <BlankSlate icon={<DiffIcon size={48} className="big-icon" />} title={`${route.project} isn't tracked`}>
          <p>It isn't in this catalog.</p>
        </BlankSlate>
      ) : !project ? (
        <Spinner />
      ) : (
        <Analysis
          project={project}
          repos={repos}
          location={location}
          error={reposError}
          artifact={artifact?.name}
          base={base}
          head={head}
          file={route.file}
          line={route.line}
          onFile={(file) => navigate({ file })}
          onAddArtifact={() => setAddingArtifact(true)}
          action={
            <AnalyzeButton project={project} repos={repos} upstream={upstream} viewer={viewer} onConnect={connect} onOpen={openRepo} />
          }
        />
      )}
      {pick === "search" &&
        (location ? (
          <SearchPick location={location} onJump={(file, line) => navigate({ file, line })} onClose={() => setPick(null)} />
        ) : (
          <CommandPalette commands={commands()} onClose={() => setPick(null)} />
        ))}
      {pick === "palette" && <CommandPalette commands={commands()} onClose={() => setPick(null)} />}
      {addingArtifact && location?.kind === "local" && (
        <AddArtifact
          project={location.path}
          onConnect={connect}
          onDone={(name) => {
            setAddingArtifact(false);
            reloadCatalog();
            navigate({ artifact: name, base: null, head: null });
          }}
          onClose={() => setAddingArtifact(false)}
        />
      )}
      {handoff && route.project && <OpenInDesktop project={route.project} repo={handoff} onClose={() => setHandoff(null)} />}
      {local && (
        <AnalyzeLocally
          key={local.repo}
          {...local}
          onCloned={(path) => navigate({ repo: `local:${path}`, file: null })}
          onClose={() => setLocal(null)}
        />
      )}
      {!__IAM__ && accountOpen && <TokenDialog current={viewer} onClose={() => setAccountOpen(false)} />}
    </div>
  );
}

function Welcome({ index }: { index: Index | null }) {
  return (
    <BlankSlate icon={<img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={64} height={64} />} title={index?.title ?? PRODUCT}>
      {index && <p>{index.about}</p>}
      {index && (
        <div className="stats">
          {index.stats.map((stat) => (
            <div key={stat.label}>
              <b>{stat.value.toLocaleString()}</b>
              <span className="muted">{stat.label}</span>
            </div>
          ))}
        </div>
      )}
      <p>
        <kbd>{keyLabel("o")}</kbd> opens a project, <kbd>{keyLabel("p")}</kbd> runs a command. <DocsLink />
      </p>
      <StarButton variant="button" />
    </BlankSlate>
  );
}
