// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useState } from "react";
import { AlertIcon, BugIcon } from "@primer/octicons-react";
import type { Index, Repo } from "./types";
import { loadCve, loadIndex } from "./api";
import { INSTANCE, PRODUCT } from "./config";
import { connectGitHub } from "./iam/session";
import { useSignedIn } from "./lib/access";
import { cveRepos, myCveRepos, viewer as loadViewer } from "./lib/github";
import { urlFor, useRoute } from "./lib/route";
import { uniqueBy, useAsync } from "./lib/util";
import { Analysis } from "./components/Analysis";
import { AnalyzeButton } from "./components/AnalyzeButton";
import { BlankSlate, Spinner } from "./components/BlankSlate";
import { StarButton } from "./components/StarButton";
import { TokenDialog } from "./components/TokenDialog";
import { Toolbar } from "./components/Toolbar";

export function App({ signInError }: { signInError: string | null }) {
  const [route, navigate] = useRoute();
  const signedIn = useSignedIn();
  const [accountOpen, setAccountOpen] = useState(false);
  const [banner, setBanner] = useState(signInError);
  // Repos the user just forked or created: GitHub can take a moment to list them, so keep them meanwhile.
  const [started, setStarted] = useState<Repo[]>([]);

  const [index, indexError] = useAsync(loadIndex, []);
  const [cve, cveError] = useAsync(() => (route.cve ? loadCve(route.cve) : null), [route.cve]);
  // Embeds are read-only and anonymous: nothing about the reader is loaded.
  const signedInHere = signedIn && !route.embed;
  const [viewer] = useAsync(() => (signedInHere ? loadViewer() : null), [signedInHere]);
  const [mine] = useAsync(
    () => (signedInHere ? myCveRepos().then((rs) => new Set(rs.map((r) => r.name.toUpperCase()))) : null),
    [signedInHere],
  );
  const [fetchedRepos, reposError] = useAsync(
    () => (route.cve && index ? cveRepos(index.org, route.cve) : null),
    [route.cve, index, signedIn],
  );

  useEffect(() => {
    document.title = route.cve ? `${route.cve} · ${INSTANCE.name}` : `${INSTANCE.name} · ${PRODUCT}`;
  }, [route.cve]);

  // A fresh fork can take a moment to show up in GitHub's fork list; keep it locally meanwhile.
  const repos =
    fetchedRepos &&
    uniqueBy([...fetchedRepos, ...started.filter((f) => f.name.toUpperCase() === route.cve)], (r) => r.full_name);
  const upstream = repos?.find((r) => r.owner.login === index?.org) ?? null;
  const repo = repos?.find((r) => r.full_name === route.repo) ?? upstream ?? repos?.[0] ?? null;
  const connect = __IAM__ ? connectGitHub : () => setAccountOpen(true);

  /** Analyze: show the user's repo here and open it on GitHub, where the analysis happens. */
  const openRepo = (r: Repo) => {
    setStarted((list) => [...list, r]);
    navigate({ repo: r.full_name, file: null });
    window.open(r.html_url, "_blank", "noreferrer");
  };

  if (route.embed) {
    return (
      <div className="app embed">
        {cveError || indexError ? (
          <BlankSlate icon={<BugIcon size={32} className="big-icon" />} title={cveError ? `${route.cve} isn't tracked` : "Couldn't load"} />
        ) : !cve || !index ? (
          <Spinner />
        ) : (
          <Analysis
            cve={cve}
            org={index.org}
            repos={repos}
            repo={repo}
            error={reposError}
            file={route.file}
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
        index={index}
        mine={mine ?? new Set()}
        cve={cve}
        cveId={route.cve}
        repos={repos ?? []}
        repo={repo}
        upstream={upstream}
        file={route.file}
        viewer={viewer}
        onPick={(id) => navigate({ cve: id, repo: null, file: null })}
        onRepo={(fullName) => navigate({ repo: fullName, file: null })}
        onAccount={connect}
      />
      {banner && (
        <div className="notice error banner" onClick={() => setBanner(null)} title="Dismiss">
          Sign-in failed: {banner}
        </div>
      )}
      {indexError ? (
        <BlankSlate icon={<AlertIcon size={48} className="big-icon" />} title="Couldn't load the CVE database">
          <p>{indexError}</p>
        </BlankSlate>
      ) : !route.cve ? (
        <Welcome index={index} />
      ) : cveError ? (
        <BlankSlate icon={<BugIcon size={48} className="big-icon" />} title={`${route.cve} isn't tracked`}>
          <p>Only CVEs listed in Apple security advisories are in the database.</p>
        </BlankSlate>
      ) : !cve || !index ? (
        <Spinner />
      ) : (
        <Analysis
          cve={cve}
          org={index.org}
          repos={repos}
          repo={repo}
          error={reposError}
          file={route.file}
          onFile={(file) => navigate({ file })}
          action={
            <AnalyzeButton cve={cve} repos={repos} upstream={upstream} viewer={viewer} onConnect={connect} onOpen={openRepo} />
          }
        />
      )}
      {!__IAM__ && accountOpen && <TokenDialog current={viewer} onClose={() => setAccountOpen(false)} />}
    </div>
  );
}

function Welcome({ index }: { index: Index | null }) {
  return (
    <BlankSlate icon={<BugIcon size={56} className="big-icon" />} title="Find the patch behind every Apple CVE">
      <p>
        Every CVE from Apple's security advisories, enriched with NVD data. An analysis is a GitHub repository named
        after the CVE{index && (
          <>
            , published as <code>{index.org}/CVE-YYYY-NNNN</code>
          </>
        )}
        . Press <b>Analyze</b> on any CVE to start your own, private or public, or fork a published analysis and send a
        pull request.
      </p>
      {index && (
        <div className="stats">
          <div>
            <b>{index.cves.toLocaleString()}</b>
            <span className="muted">CVEs</span>
          </div>
          <div>
            <b>{index.advisories.toLocaleString()}</b>
            <span className="muted">advisories</span>
          </div>
          <div>
            <b>{index.analyzed.toLocaleString()}</b>
            <span className="muted">analyzed</span>
          </div>
        </div>
      )}
      <p>
        Open the <b>Current CVE</b> menu or press <kbd>⌘</kbd> <kbd>K</kbd> to choose a CVE.
      </p>
      <StarButton variant="button" />
    </BlankSlate>
  );
}
