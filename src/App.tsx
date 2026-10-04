import { useEffect, useState } from "react";
import { AlertIcon, BugIcon } from "@primer/octicons-react";
import type { Index, Repo } from "./types";
import { loadCve, loadIndex } from "./api";
import { INSTANCE, PRODUCT } from "./config";
import { connectGitHub } from "./iam/session";
import { useSignedIn } from "./lib/access";
import { cveRepos, myCveRepos, viewer as loadViewer } from "./lib/github";
import { useRoute } from "./lib/route";
import { uniqueBy, useAsync } from "./lib/util";
import { Analysis } from "./components/Analysis";
import { BlankSlate, Spinner } from "./components/BlankSlate";
import { StarButton } from "./components/StarButton";
import { TokenDialog } from "./components/TokenDialog";
import { Toolbar } from "./components/Toolbar";

export function App({ signInError }: { signInError: string | null }) {
  const [route, navigate] = useRoute();
  const signedIn = useSignedIn();
  const [accountOpen, setAccountOpen] = useState(false);
  const [banner, setBanner] = useState(signInError);
  const [forked, setForked] = useState<Repo[]>([]);

  const [index, indexError] = useAsync(loadIndex, []);
  const [cve, cveError] = useAsync(() => (route.cve ? loadCve(route.cve) : null), [route.cve]);
  const [viewer] = useAsync(() => (signedIn ? loadViewer() : null), [signedIn]);
  const [mine] = useAsync(
    () => (signedIn ? myCveRepos().then((rs) => new Set(rs.map((r) => r.name.toUpperCase()))) : null),
    [signedIn],
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
    uniqueBy([...fetchedRepos, ...forked.filter((f) => f.name.toUpperCase() === route.cve)], (r) => r.full_name);
  const repo =
    repos?.find((r) => r.full_name === route.repo) ?? repos?.find((r) => r.owner.login === index?.org) ?? repos?.[0] ?? null;

  return (
    <div className="app">
      <Toolbar
        index={index}
        mine={mine ?? new Set()}
        cve={cve}
        cveId={route.cve}
        repos={repos ?? []}
        repo={repo}
        file={route.file}
        viewer={viewer}
        onPick={(id) => navigate({ cve: id, repo: null, file: null })}
        onRepo={(fullName) => navigate({ repo: fullName, file: null })}
        onForked={(r) => setForked((f) => [...f, r])}
        onAccount={__IAM__ ? connectGitHub : () => setAccountOpen(true)}
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
        . Connect GitHub to bring in your own repositories, private ones included, or fork an analysis and send a pull
        request.
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
