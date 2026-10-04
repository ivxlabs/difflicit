import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, LockIcon, RepoIcon, SearchIcon } from "@primer/octicons-react";
import { KERNEL_COMPONENTS, type CveSummary, type Index } from "../types";
import { BlankSlate } from "./BlankSlate";

const FILTER_KEY = "difflicit-picker";
const PAGE = 100;
const PLATFORMS = ["macOS", "iOS", "iPadOS", "watchOS", "tvOS", "visionOS", "Safari", "Xcode"];
const KERNEL = new Set(KERNEL_COMPONENTS);

interface Filters {
  q: string;
  scope: "kernel" | "all";
  severity: string;
  platform: string;
  component: string;
  status: "" | "analyzed" | "unanalyzed" | "mine";
}
const DEFAULTS: Filters = { q: "", scope: "kernel", severity: "", platform: "", component: "", status: "" };

function monthLabel(iso: string | null) {
  if (!iso) return "Undated";
  return new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function matches(c: CveSummary, f: Filters, mine: Set<string>) {
  if (f.component ? !c.components.includes(f.component) : f.scope === "kernel" && !c.components.some((x) => KERNEL.has(x)))
    return false;
  if (f.severity && c.severity !== f.severity) return false;
  if (f.platform && !c.platforms.includes(f.platform)) return false;
  if (f.status === "analyzed" && !c.analyzed) return false;
  if (f.status === "unanalyzed" && c.analyzed) return false;
  if (f.status === "mine" && !mine.has(c.id)) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    return [c.id, c.impact ?? "", ...c.components].some((s) => s.toLowerCase().includes(q));
  }
  return true;
}

interface Props {
  index: Index | null;
  /** CVE ids with a repo the user's token can see. */
  mine: Set<string>;
  current: string | null;
  onPick: (id: string) => void;
}

export function CvePicker({ index, mine, current, onPick }: Props) {
  const [filters, setFilters] = useState<Filters>(() => ({
    ...DEFAULTS,
    ...JSON.parse(localStorage.getItem(FILTER_KEY) ?? "{}"),
    q: "",
  }));
  const [shown, setShown] = useState(PAGE);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const components = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of index?.cves ?? []) for (const x of c.components) counts.set(x, (counts.get(x) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [index]);

  const items = useMemo(() => (index?.cves ?? []).filter((c) => matches(c, filters, mine)), [index, filters, mine]);

  useEffect(() => {
    const { q: _q, ...persist } = filters;
    localStorage.setItem(FILTER_KEY, JSON.stringify(persist));
    setShown(PAGE);
    setActive(0);
    listRef.current?.scrollTo({ top: 0 });
  }, [filters]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (shown < items.length && el.scrollTop + el.clientHeight > el.scrollHeight - 300) setShown((n) => n + PAGE);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.max(0, Math.min(items.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
      setActive(next);
      if (next >= shown) setShown((n) => n + PAGE);
      listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && items[active]) {
      onPick(items[active].id);
    }
  };

  let lastGroup = "";

  return (
    <div className="dropdown cve-picker">
      <div className="picker-head">
        <div className="search">
          <SearchIcon size={14} />
          <input
            className="input"
            autoFocus
            placeholder="Filter by CVE, component, impact…"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="picker-filters">
          <div className="segmented">
            <button
              className={filters.scope === "kernel" ? "active" : ""}
              onClick={() => set({ scope: "kernel" })}
              title={KERNEL_COMPONENTS.join(", ")}
            >
              Kernel &amp; friends
            </button>
            <button className={filters.scope === "all" ? "active" : ""} onClick={() => set({ scope: "all" })}>
              All
            </button>
          </div>
          <select className="select" value={filters.severity} onChange={(e) => set({ severity: e.target.value })}>
            <option value="">Any severity</option>
            {["Critical", "High", "Medium", "Low"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            className="select"
            value={filters.status}
            onChange={(e) => set({ status: e.target.value as Filters["status"] })}
          >
            <option value="">Any status</option>
            <option value="analyzed">Analyzed</option>
            <option value="unanalyzed">Not analyzed</option>
            {mine.size > 0 && <option value="mine">My repos ({mine.size})</option>}
          </select>
        </div>
        <div className="picker-filters">
          <select className="select" value={filters.platform} onChange={(e) => set({ platform: e.target.value })}>
            <option value="">All platforms</option>
            {PLATFORMS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select
            className="select"
            style={{ maxWidth: 170 }}
            value={filters.component}
            onChange={(e) => set({ component: e.target.value })}
          >
            <option value="">{filters.scope === "kernel" ? "Kernel components" : "All components"}</option>
            {components.map(([name, count]) => (
              <option key={name} value={name}>
                {name} ({count})
              </option>
            ))}
          </select>
          <span className="picker-count">{index ? `${items.length.toLocaleString()} CVEs` : "Loading…"}</span>
        </div>
      </div>
      <div className="picker-list" ref={listRef} onScroll={onScroll}>
        {index && items.length === 0 && (
          <BlankSlate>
            <p>No CVEs match these filters.</p>
          </BlankSlate>
        )}
        {items.slice(0, shown).map((item, i) => {
          const group = monthLabel(item.released);
          const header = group !== lastGroup ? <div className="picker-group">{group}</div> : null;
          lastGroup = group;
          return (
            <div key={item.id}>
              {header}
              <div
                data-index={i}
                className={`list-item two-line ${i === active ? "selected" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(item.id)}
              >
                <span
                  className={`sev ${item.severity ?? ""}`}
                  title={item.severity ?? "No NVD severity"}
                  style={{ marginTop: 4 }}
                />
                <div className="main">
                  <div className="title">
                    <span className="mono strong">{item.id}</span> {item.id === current && <CheckIcon size={12} />}{" "}
                    <span className="muted">{item.components.join(", ")}</span>
                  </div>
                  <div className="sub muted">{item.impact ?? "No impact statement"}</div>
                </div>
                {mine.has(item.id) && (
                  <span className="pill" title="You have a repo for this CVE">
                    <LockIcon size={12} />
                  </span>
                )}
                {item.analyzed && (
                  <span className="pill confirmed" title="Analyzed">
                    <RepoIcon size={12} />
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
