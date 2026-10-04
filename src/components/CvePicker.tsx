// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, LockIcon, RepoIcon, SearchIcon, SyncIcon } from "@primer/octicons-react";
import { loadShard } from "../api";
import { useAsync } from "../lib/util";
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
  /** "" = the newest year, or every year when a component is chosen. */
  year: string;
  status: "" | "analyzed" | "unanalyzed" | "mine";
}
const DEFAULTS: Filters = { q: "", scope: "kernel", severity: "", platform: "", component: "", year: "", status: "" };

const yearOf = (cveId: string) => cveId.split("-")[1];

function monthLabel(iso: string | null) {
  if (!iso) return "Undated";
  return new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Filters within the loaded shard. Which shard to load (year or component) is decided in CvePicker. */
function matches(c: CveSummary, f: Filters, year: string | null, mine: Set<string>) {
  if (!f.component && f.scope === "kernel" && !c.components.some((x) => KERNEL.has(x))) return false;
  if (year && yearOf(c.id) !== year) return false;
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

  // Load one shard: the chosen component (all years), or one year — the one in a typed CVE id, else the
  // chosen year, else the newest. Everything else filters within it.
  const typedYear = /CVE-(\d{4})/i.exec(filters.q)?.[1] ?? null;
  const year = typedYear ?? (filters.year || null);
  const shownYear = year ?? index?.years[0]?.name ?? null;
  const file = filters.component
    ? index?.components.find((c) => c.name === filters.component)?.file
    : index?.years.find((y) => y.name === shownYear)?.file;
  const [shard, shardError] = useAsync(() => (file ? loadShard(file) : null), [file]);

  const items = useMemo(
    () => (shard ?? []).filter((c) => matches(c, filters, filters.component ? year : null, mine)),
    [shard, filters, year, mine],
  );
  const loading = Boolean(file) && !shard && !shardError;
  const where = filters.component ? `${filters.component}${year ? ` · ${year}` : ""}` : (shownYear ?? "");

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
          <select
            className="select"
            value={typedYear ?? filters.year}
            disabled={Boolean(typedYear)}
            title={typedYear ? "Set by the CVE id you typed" : undefined}
            onChange={(e) => set({ year: e.target.value })}
          >
            <option value="">{filters.component ? "All years" : `Newest (${index?.years[0]?.name ?? "…"})`}</option>
            {index?.years.map((y) => (
              <option key={y.name} value={y.name}>
                {y.name} ({y.count})
              </option>
            ))}
          </select>
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
            {index?.components.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.count})
              </option>
            ))}
          </select>
          <span className="picker-count" title={`Showing ${where}`}>
            {loading ? <SyncIcon size={12} className="spinner" /> : `${items.length.toLocaleString()} in ${where}`}
          </span>
        </div>
      </div>
      <div className="picker-list" ref={listRef} onScroll={onScroll}>
        {(shardError || (shard && items.length === 0) || (index && !file)) && (
          <BlankSlate>
            <p>
              {shardError ??
                (file
                  ? `No CVEs in ${where} match these filters.`
                  : `No CVEs from ${shownYear} are tracked.`)}
            </p>
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
