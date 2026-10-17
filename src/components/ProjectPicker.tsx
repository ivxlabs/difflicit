// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef, useState } from "react";
import { CheckIcon, FileDirectoryIcon, LockIcon, RepoIcon, SearchIcon, SyncIcon } from "@primer/octicons-react";
import { loadIndex, loadShard, useCatalogVersion } from "../api";
import { useAsync } from "../lib/util";
import type { Facet, ProjectSummary, Scope, Shard } from "../types";
import { BlankSlate } from "./BlankSlate";

const FILTER_KEY = "difflicit-filters";
const PAGE = 100;

interface Filters {
  q: string;
  /** Index into Index.scopes; -1 is "All". */
  scope: number;
  status: "" | "analyzed" | "unanalyzed" | "mine";
  /** The chosen value of each facet, by key; missing means any. */
  values: Record<string, string>;
}
const DEFAULTS: Filters = { q: "", scope: 0, status: "", values: {} };

function monthLabel(iso: string | null) {
  if (!iso) return "Undated";
  return new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const has = (value: string | string[] | undefined, wanted: string) =>
  Array.isArray(value) ? value.includes(wanted) : value === wanted;

/** Filters within the loaded shard (`shardKey` is the facet it was split by, so already matches). */
function matches(p: ProjectSummary, f: Filters, chosen: Record<string, string>, shardKey: string, scope: Scope | null, mine: Set<string>) {
  for (const [key, value] of Object.entries(chosen)) if (key !== shardKey && !has(p.facets[key], value)) return false;
  if (scope && !chosen[scope.facet] && !scope.values.some((v) => has(p.facets[scope.facet], v))) return false;
  if (f.status === "analyzed" && !p.analyzed) return false;
  if (f.status === "unanalyzed" && p.analyzed) return false;
  if (f.status === "mine" && !mine.has(p.id.toLowerCase())) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    return [p.id, p.summary ?? "", ...p.tags].some((s) => s.toLowerCase().includes(q));
  }
  return true;
}

/**
 * Which shard to download: the narrowest chosen value of a facet with shards (a typed id can choose one, e.g. its
 * year), else the first facet's first shard. `missing` is a chosen value with no shard: nothing to load.
 */
function pickShard(facets: Facet[], chosen: Record<string, string>): { facet: Facet; shard: Shard } | { missing: string } | null {
  const sharded = facets.filter((f) => f.shards?.length);
  const picks = [];
  for (const facet of sharded) {
    if (!chosen[facet.key]) continue;
    const shard = facet.shards!.find((s) => s.name === chosen[facet.key]);
    if (!shard) return { missing: chosen[facet.key] };
    picks.push({ facet, shard });
  }
  picks.sort((a, b) => a.shard.count - b.shard.count);
  return picks[0] ?? (sharded[0] ? { facet: sharded[0], shard: sharded[0].shards![0] } : null);
}

interface Props {
  /** Lowercased ids of projects with a repo the user can see. */
  mine: Set<string>;
  current: string | null;
  onPick: (id: string) => void;
  /** Desktop: open a folder as a project. */
  desktop?: boolean;
  onOpenFolder?: () => void;
}

export function ProjectPicker({ mine, current, onPick, desktop, onOpenFolder }: Props) {
  const [index, indexError] = useAsync(loadIndex, [useCatalogVersion()]);
  const [filters, setFilters] = useState<Filters>(() => ({
    ...DEFAULTS,
    ...JSON.parse(localStorage.getItem(FILTER_KEY) ?? "{}"),
    q: "",
  }));
  const [shown, setShown] = useState(PAGE);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const facets = index?.facets ?? [];
  // What the search says about a facet, e.g. the year in a typed CVE id.
  const typed: Record<string, string> = {};
  for (const f of facets) {
    const m = f.match && new RegExp(f.match, "i").exec(filters.q);
    if (m?.[1]) typed[f.key] = m[1];
  }
  const chosen = { ...filters.values, ...typed };
  const pick = pickShard(facets, chosen);
  const file = pick && "shard" in pick ? pick.shard.file : null;
  const shardKey = pick && "facet" in pick ? pick.facet.key : "";
  const scope = index?.scopes[filters.scope] ?? null;
  const [shard, shardError] = useAsync(() => (file ? loadShard(file) : null), [file]);

  // Small catalogs (like the user's own projects) list everything in the index instead of shards.
  const all = index?.projects ?? shard;
  const items = (all ?? []).filter((p) => matches(p, filters, chosen, shardKey, scope, mine));
  const loading = (!index && !indexError) || (Boolean(file) && !shard && !shardError);
  const error = indexError ?? shardError;
  const where = index?.projects ? "all" : pick && "shard" in pick ? [pick.shard.name, ...Object.values(chosen).filter((v) => v !== pick.shard.name)].join(" · ") : "";

  useEffect(() => {
    const { q: _q, ...persist } = filters;
    localStorage.setItem(FILTER_KEY, JSON.stringify(persist));
    setShown(PAGE);
    setActive(0);
    listRef.current?.scrollTo({ top: 0 });
  }, [filters]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const setValue = (key: string, value: string) => {
    const { [key]: _old, ...values } = filters.values;
    set({ values: value ? { ...values, [key]: value } : values });
  };

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
    <div className="dropdown project-picker">
      <div className="picker-head">
        <div className="search">
          <SearchIcon size={14} />
          <input
            className="input"
            autoFocus
            placeholder="Filter projects…"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="picker-filters">
          {index && index.scopes.length > 0 && (
            <div className="segmented">
              {index.scopes.map((s, i) => (
                <button key={s.label} className={filters.scope === i ? "active" : ""} onClick={() => set({ scope: i })} title={s.values.join(", ")}>
                  {s.label}
                </button>
              ))}
              <button className={filters.scope === -1 ? "active" : ""} onClick={() => set({ scope: -1 })}>
                All
              </button>
            </div>
          )}
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
          {facets.map((f) => {
            // The first sharded facet decides what's shown when nothing narrower is chosen.
            const isDefault = !chosen[f.key] && pick && "facet" in pick && pick.facet === f;
            return (
              <select
                key={f.key}
                className="select"
                style={{ maxWidth: 170 }}
                value={chosen[f.key] ?? ""}
                disabled={Boolean(typed[f.key])}
                title={typed[f.key] ? "Set by what you typed" : undefined}
                onChange={(e) => setValue(f.key, e.target.value)}
              >
                <option value="">{isDefault ? `${f.shards![0].name} (default)` : f.any}</option>
                {f.shards
                  ? f.shards.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name} ({s.count})
                      </option>
                    ))
                  : f.values?.map((v) => <option key={v}>{v}</option>)}
              </select>
            );
          })}
          {desktop && (
            <button className="btn" onClick={onOpenFolder} title="Open a folder as a project">
              <FileDirectoryIcon size={14} /> Open folder…
            </button>
          )}
          <span className="picker-count" title={`Showing ${where}`}>
            {loading ? <SyncIcon size={12} className="spinner" /> : where && `${items.length.toLocaleString()} in ${where}`}
          </span>
        </div>
      </div>
      <div className="picker-list" ref={listRef} onScroll={onScroll}>
        {(error || (all && items.length === 0) || (pick && "missing" in pick)) && (
          <BlankSlate>
            <p>
              {error ??
                (pick && "missing" in pick
                  ? `No projects from ${pick.missing}.`
                  : all?.length === 0
                    ? "No projects yet."
                    : `No projects in ${where} match these filters.`)}
            </p>
          </BlankSlate>
        )}
        {items.slice(0, shown).map((item, i) => {
          const group = monthLabel(item.date);
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
                <span className={`sev ${item.badge?.tone ?? ""}`} title={item.badge?.label} style={{ marginTop: 4 }} />
                <div className="main">
                  <div className="title">
                    <span className="mono strong">{item.id}</span> {item.id === current && <CheckIcon size={12} />}{" "}
                    <span className="muted">{item.tags.join(", ")}</span>
                  </div>
                  <div className="sub muted">{item.summary ?? ""}</div>
                </div>
                {mine.has(item.id.toLowerCase()) && (
                  <span className="pill" title="You have a repo for this project">
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
