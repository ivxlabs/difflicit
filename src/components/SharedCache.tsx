// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useMemo, useState } from "react";
import { DesktopDownloadIcon, DiffIcon, FileZipIcon, SearchIcon } from "@primer/octicons-react";
import {
  type Cache,
  type Image,
  dscCaches,
  dscDiff,
  dscImages,
  downloadIpsw,
  extractCacheFromIpsw,
  pickFile,
} from "../lib/desktop";
import { basename, useAsync } from "../lib/util";

export interface CachePick {
  cache: string;
  image: string;
  /** A version id for the extracted dylib — its library version, so builds stay distinct. */
  label: string;
}

/**
 * Desktop: choose a dylib from a dyld_shared_cache to extract (blacktop/ipsw). The cache can be this Mac's, one
 * pulled from an IPSW/OTA file, or one downloaded by device and build. Reports the selection to the parent,
 * which does the extraction (Add artifact, or Add version).
 */
export function SharedCacheSource({ onChange }: { onChange: (pick: CachePick | null) => void }) {
  const [caches, setCaches] = useState<Cache[] | null>(null);
  const [cache, setCache] = useState("");
  const [query, setQuery] = useState("");
  const [image, setImage] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDownload, setShowDownload] = useState(false);
  const [showCompare, setShowCompare] = useState(false);

  // The caches on disk; pick the first (this Mac's) by default.
  useEffect(() => {
    dscCaches().then((cs) => {
      setCaches(cs);
      setCache((c) => c || cs[0]?.path || "");
    }, (e) => setError(String(e)));
  }, []);

  const [images, imagesError] = useAsync(() => (cache ? dscImages(cache) : Promise.resolve(null)), [cache]);

  // Tell the parent what's selected.
  useEffect(() => {
    onChange(cache && image ? { cache, image, label } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, image, label]);

  const matches = useMemo(() => {
    if (!images) return [];
    const q = query.trim().toLowerCase();
    const hit = q ? images.filter((im) => im.name.toLowerCase().includes(q)) : images;
    return hit.slice(0, 60);
  }, [images, query]);

  const pickImage = (im: Image) => {
    setImage(im.name);
    setLabel(im.version ?? "");
  };

  // Replace the cache list after acquiring a new one, selecting the first result.
  const acquired = (result: Cache[]) => {
    dscCaches().then(setCaches);
    if (result[0]) {
      setCache(result[0].path);
      setImage("");
    }
  };

  const fromIpsw = async () => {
    const path = await pickFile("Choose an IPSW or OTA");
    if (!path) return;
    setError(null);
    setBusy("Extracting the shared cache… this can take a while.");
    try {
      acquired(await extractCacheFromIpsw(path));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="dsc">
      <label className="field">
        <span>Shared cache</span>
        <select className="select" value={cache} onChange={(e) => { setCache(e.target.value); setImage(""); }} disabled={!caches}>
          {!caches && <option value="">Looking for caches…</option>}
          {caches?.length === 0 && <option value="">No caches found — add one below</option>}
          {caches?.map((c) => (
            <option key={c.path} value={c.path}>
              {c.name} · {basename(c.path)}
            </option>
          ))}
        </select>
      </label>

      <div className="row dsc-sources">
        <button type="button" className="btn" onClick={fromIpsw} disabled={Boolean(busy)}>
          <FileZipIcon size={14} /> From IPSW/OTA…
        </button>
        <button type="button" className="btn" onClick={() => setShowDownload((s) => !s)} disabled={Boolean(busy)}>
          <DesktopDownloadIcon size={14} /> Download…
        </button>
        {cache && (caches?.length ?? 0) > 1 && (
          <button type="button" className="btn" onClick={() => setShowCompare((s) => !s)}>
            <DiffIcon size={14} /> Compare…
          </button>
        )}
      </div>

      {showDownload && <DownloadForm busy={busy} setBusy={setBusy} setError={setError} onDone={acquired} />}
      {showCompare && cache && caches && (
        <CacheCompare caches={caches} base={cache} onPickImage={(name) => { setQuery(name); setImage(name); }} />
      )}

      {cache && (
        <label className="field">
          <span>Image to extract</span>
          <div className="input-icon">
            <SearchIcon size={14} />
            <input
              className="input"
              placeholder={images ? `Search ${images.length} dylibs (e.g. libobjc, WebKit)` : "Loading images…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="dsc-images">
            {matches.map((im) => (
              <div
                key={im.name}
                className={`list-item two-line ${im.name === image ? "selected" : ""}`}
                onClick={() => pickImage(im)}
                title={im.name}
              >
                <div className="main">
                  <div className="title mono">{basename(im.name)}</div>
                  <div className="sub muted">
                    {im.name}
                    {im.version && ` · ${im.version}`}
                  </div>
                </div>
              </div>
            ))}
            {images && !matches.length && <div className="sidebar-note muted">No matching dylibs.</div>}
          </div>
        </label>
      )}

      {image && (
        <label className="field">
          <span>Version id</span>
          <input className="input" value={label} placeholder={basename(image)} onChange={(e) => setLabel(e.target.value)} />
        </label>
      )}

      {busy && !error && <div className="notice">{busy}</div>}
      {(error || imagesError) && <div className="notice error">{error ?? imagesError}</div>}
    </div>
  );
}

/** Download firmware by device and build/version; its cache is extracted during the download. */
function DownloadForm({
  busy,
  setBusy,
  setError,
  onDone,
}: {
  busy: string | null;
  setBusy: (v: string | null) => void;
  setError: (v: string | null) => void;
  onDone: (caches: Cache[]) => void;
}) {
  const [device, setDevice] = useState("");
  const [build, setBuild] = useState("");

  const run = async () => {
    setError(null);
    setBusy("Downloading firmware and extracting its cache… this can take a long time.");
    try {
      // build may be a build id (22B83) or a version (18.1); send it as whichever ipsw accepts.
      const looksLikeBuild = /[A-Za-z]/.test(build);
      onDone(await downloadIpsw(device.trim(), looksLikeBuild ? build.trim() : undefined, looksLikeBuild ? undefined : build.trim()));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="dsc-download">
      <div className="row">
        <label className="field grow">
          <span>Device</span>
          <input className="input" placeholder="iPhone15,2 or Mac18,5" value={device} onChange={(e) => setDevice(e.target.value)} />
        </label>
        <label className="field grow">
          <span>Build or version (blank = latest)</span>
          <input className="input" placeholder="22B83 or 18.1" value={build} onChange={(e) => setBuild(e.target.value)} />
        </label>
      </div>
      <button type="button" className="btn" disabled={!device.trim() || Boolean(busy)} onClick={run}>
        <DesktopDownloadIcon size={14} /> Download
      </button>
    </div>
  );
}

/** ipsw's cache-level diff: images added/removed/changed between the chosen cache and another. */
function CacheCompare({ caches, base, onPickImage }: { caches: Cache[]; base: string; onPickImage: (name: string) => void }) {
  const others = caches.filter((c) => c.path !== base);
  const [head, setHead] = useState(others[0]?.path ?? "");
  const [diff, error] = useAsync(() => (head ? dscDiff(base, head) : Promise.resolve(null)), [base, head]);
  const changed = diff?.changed ?? [];

  return (
    <div className="dsc-compare">
      <label className="field">
        <span>Compare with</span>
        <select className="select" value={head} onChange={(e) => setHead(e.target.value)}>
          {others.map((c) => (
            <option key={c.path} value={c.path}>
              {c.name} · {basename(c.path)}
            </option>
          ))}
        </select>
      </label>
      {error && <div className="notice error">{String(error)}</div>}
      {diff && (
        <>
          <div className="muted small-note">
            {changed.length} changed · {diff.added.length} added · {diff.removed.length} removed. Pick a changed
            dylib to extract it.
          </div>
          <div className="dsc-images">
            {changed.map((c) => {
              const name = typeof c === "string" ? c : (c.name ?? "");
              return (
                <div key={name} className="list-item" onClick={() => onPickImage(name)} title={name}>
                  <div className="main">
                    <div className="title mono">{basename(name)}</div>
                    {c.previous && c.version && <div className="sub muted">{c.previous} → {c.version}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
