import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "@primer/octicons-react";
import { uniqueBy } from "../lib/util";
import type { CveDetail } from "../types";

export function CveHeader({ cve }: { cve: CveDetail }) {
  const [open, setOpen] = useState(() => localStorage.getItem("difflicit-details") !== "closed");
  const toggle = () => {
    localStorage.setItem("difflicit-details", open ? "closed" : "open");
    setOpen(!open);
  };
  const first = cve.entries.find((e) => e.impact) ?? cve.entries[0];
  // The same CVE often appears in several advisories with an identical write-up; show each write-up once.
  const writeups = uniqueBy(cve.entries, (e) => `${e.component}\n${e.description}`);

  return (
    <section className="cve-header">
      <div className="cve-header-bar" onClick={toggle}>
        {open ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
        <h1>{cve.id}</h1>
        {cve.severity && (
          <span className={`pill ${cve.severity}`}>
            {cve.severity}
            {cve.cvss_score != null && ` ${cve.cvss_score.toFixed(1)}`}
          </span>
        )}
        {first?.component && <span className="pill">{first.component}</span>}
        <span className="impact">{first?.impact}</span>
      </div>
      {open && (
        <div className="cve-details">
          <div>
            <h3>Apple</h3>
            {writeups.map((e) => (
              <div className="entry" key={`${e.advisory_id}-${e.component}`}>
                <p>
                  <b>{e.component || "Unspecified component"}</b>
                  {e.impact && <> — {e.impact}</>}
                </p>
                {e.description && <p className="muted">{e.description}</p>}
                {e.credit && <p className="muted">Credit: {e.credit}</p>}
              </div>
            ))}
          </div>
          <div>
            <h3>NVD</h3>
            <p>{cve.nvd_description ?? "No NVD description."}</p>
            {cve.cvss_vector && (
              <p className="muted">
                CVSS {cve.cvss_version}: <code>{cve.cvss_vector}</code>
              </p>
            )}
            {cve.cwes.length > 0 && (
              <p>
                {cve.cwes.map((w) => (
                  <a
                    key={w}
                    className="pill"
                    style={{ marginRight: 4 }}
                    href={`https://cwe.mitre.org/data/definitions/${w.replace("CWE-", "")}.html`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {w}
                  </a>
                ))}
              </p>
            )}
          </div>
          <div className="wide">
            <h3>References</h3>
            <ul className="refs">
              <li>
                <a href={`https://nvd.nist.gov/vuln/detail/${cve.id}`} target="_blank" rel="noreferrer">
                  NVD entry
                </a>
                {" · "}
                <a href={`https://www.cve.org/CVERecord?id=${cve.id}`} target="_blank" rel="noreferrer">
                  cve.org
                </a>
              </li>
              {cve.refs
                .filter((r) => !r.url.includes("support.apple.com"))
                .slice(0, 10)
                .map((r) => (
                  <li key={r.url}>
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {r.url}
                    </a>
                    {r.tags.length > 0 && <span className="muted"> ({r.tags.join(", ")})</span>}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
