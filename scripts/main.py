# SPDX-License-Identifier: GPL-3.0-only
"""
Scrape Apple security advisories + NVD metadata into ivx/xnu's project catalog: the static JSON API Difflicit
reads (its format is src/types.ts), where each project is a CVE.

    uv run main.py                       # writes out/api/
    uv run main.py --limit 20            # only the first 20 advisories (quick test)
    uv run main.py --out ../public/api   # serve it to `npm run dev` (with VITE_CATALOG=/api)

Output:
    index.json              manifest: totals, facets and the year and component shards below
    years/2026.json         summaries of the CVEs whose id is CVE-2026-*
    components/kernel.json  summaries of the CVEs Apple lists under that component
    projects/CVE-….json     one file per CVE: NVD data + every advisory entry, as display sections

Which CVEs are analyzed comes from the owner's public repositories, found by the naming convention in
difflicit.config.json and confirmed by their analysis.json.

Environment:
    GITHUB_TOKEN   optional, avoids GitHub's 60 requests/hour anonymous limit
"""

import argparse
import asyncio
import json
import lzma
import os
import re
import shutil
import sys
from datetime import datetime, timezone

import aiohttp
from bs4 import BeautifulSoup
from markdownify import markdownify as md

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

APPLE_SECURITY_UPDATES_URL = "https://support.apple.com/en-us/HT201222"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(BASE_DIR, "out", "api")

NVD_FEED_URL = "https://github.com/fkie-cad/nvd-json-data-feeds/releases/latest/download/CVE-{year}.json.xz"
SEVERITIES = {"CRITICAL": "Critical", "HIGH": "High", "MEDIUM": "Medium", "LOW": "Low"}

ADVISORY_KEYWORDS = ["iOS", "iPadOS", "macOS", "watchOS", "tvOS", "Safari", "Xcode", "visionOS"]
APPLE_CONCURRENCY = 50

CVE_RE = re.compile(r"CVE-\d{4}-\d{4,7}")
RELEASED_RE = re.compile(r"Released\s+([A-Z][a-z]+ \d{1,2}, \d{4})")
HEADING_RE = re.compile(r"^(?:#{3,4}\s+(.+?)|\*\*([^*]+?)\*\*)\s*$")
FIELD_RE = re.compile(r"^(Impact|Description|Available for):\s*(.*)$")
CVE_LINE_RE = re.compile(r"^(CVE-\d{4}-\d{4,7})(?::\s*(.*))?$")

# The instance's settings, shared with the app: who publishes analyses, and how their repositories are named.
with open(os.path.join(BASE_DIR, "..", "difflicit.config.json"), encoding="utf-8") as f:
    PROJECTS = json.load(f)["projects"]
ANALYSIS_REPO_RE = re.compile(
    "^" + re.escape(PROJECTS["repo"]).replace(re.escape("{id}"), f"({PROJECTS['id']})") + "$", re.I
)

# Facets shown in the picker. Components treated as "kernel & friends" are its default scope.
PLATFORMS = ["macOS", "iOS", "iPadOS", "watchOS", "tvOS", "visionOS", "Safari", "Xcode"]
KERNEL_COMPONENTS = [
    "Kernel",
    "IOKit",
    "AMD Kernel",
    "Kext Management",
    "Sandbox",
    "APFS",
    "HFS",
    "SMB",
    "NFS",
    "Networking",
    "ASP TCP",
    "IOMobileFrameBuffer",
    "IOSurface",
    "IOSurfaceAccelerator",
    "IOGPUFamily",
    "IOHIDFamily",
    "IOUSBHostFamily",
    "AppleAVD",
    "Apple Neural Engine",
    "dyld",
    "libxpc",
    "Libsystem",
]

# Every URL that couldn't be fetched. Output replaces what's published (the upload deletes what's gone),
# so a run with any failure writes nothing rather than publishing partial data.
FAILED: list[str] = []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def detect_platforms(title: str) -> list[str]:
    tl = title.lower()
    checks = [
        ("ios", "iOS"),
        ("ipados", "iPadOS"),
        ("macos", "macOS"),
        ("os x", "macOS"),
        ("watchos", "watchOS"),
        ("tvos", "tvOS"),
        ("visionos", "visionOS"),
        ("safari", "Safari"),
        ("xcode", "Xcode"),
    ]
    platforms: list[str] = []
    for needle, name in checks:
        if needle in tl and name not in platforms:
            platforms.append(name)
    return platforms or ["Other"]


def _url_id(url: str) -> str:
    return url.rstrip("/").split("/")[-1]


def _clean(text: str) -> str:
    """Strip markdown emphasis and markdownify's escaping from a single line."""
    return text.replace("\\_", "_").replace("\\*", "*").strip(" *")


def parse_released(markdown: str) -> str | None:
    m = RELEASED_RE.search(markdown)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%B %d, %Y").date().isoformat()
    except ValueError:
        return None


def parse_entries(markdown: str) -> list[dict]:
    """
    Split an advisory into per-CVE entries:
        ### Kernel            (or **Kernel**)
        Impact: ...
        Description: ...
        CVE-2024-54494: credit
    The "Additional recognition" section only credits people and is skipped.
    """
    body = re.split(r"\n\s*Additional recognition\s*\n", markdown, maxsplit=1)[0]
    entries: dict[tuple[str, str], dict] = {}
    component, impact, description = "", None, None

    for raw in body.splitlines():
        line = raw.strip()
        if not line:
            continue
        heading = HEADING_RE.match(line)
        if heading:
            component = _clean(heading.group(1) or heading.group(2))
            impact = description = None
            continue
        field = FIELD_RE.match(line)
        if field:
            if field.group(1) == "Impact":
                impact = _clean(field.group(2))
            elif field.group(1) == "Description":
                description = _clean(field.group(2))
            continue
        cve_line = CVE_LINE_RE.match(_clean(line))
        if cve_line:
            cve = cve_line.group(1)
            entries[(cve, component)] = {
                "cve": cve,
                "component": component,
                "impact": impact,
                "description": description,
                "credit": _clean(cve_line.group(2) or "") or None,
            }

    # Anything mentioned but not in a recognisable entry still gets linked to the advisory.
    seen = {cve for cve, _ in entries}
    for cve in sorted(set(CVE_RE.findall(body)) - seen):
        entries[(cve, "")] = {"cve": cve, "component": "", "impact": None, "description": None, "credit": None}
    return list(entries.values())


# ---------------------------------------------------------------------------
# NVD (bulk yearly feeds from fkie-cad/nvd-json-data-feeds)
# ---------------------------------------------------------------------------


def parse_nvd(cve_obj: dict) -> dict:
    metrics = cve_obj.get("metrics", {})
    description = next(
        (d["value"] for d in cve_obj.get("descriptions", []) if d.get("lang") == "en"),
        None,
    )

    cvss, severity = None, None
    for key in ("cvssMetricV31", "cvssMetricV30"):
        if key in metrics:
            cvss = metrics[key][0]["cvssData"]
            severity = cvss.get("baseSeverity")
            break
    else:
        if "cvssMetricV2" in metrics:
            m = metrics["cvssMetricV2"][0]
            cvss = m["cvssData"]
            severity = m.get("baseSeverity") or m.get("baseMetricV2", {}).get("severity")

    cwes: list[str] = []
    for w in cve_obj.get("weaknesses", []):
        for d in w.get("description", []):
            val = d.get("value", "")
            if d.get("lang") == "en" and val.startswith("CWE-") and val not in cwes:
                cwes.append(val)

    # NVD repeats a URL once per source that submitted it; keep the first.
    refs, seen = [], set()
    for r in cve_obj.get("references", []):
        if r.get("url") and r["url"] not in seen:
            seen.add(r["url"])
            refs.append({"url": r["url"], "tags": r.get("tags", [])})

    return {
        "severity": SEVERITIES.get((severity or "").upper()),
        "cvss_score": cvss.get("baseScore") if cvss else None,
        "cvss_version": cvss.get("version") if cvss else None,
        "cvss_vector": cvss.get("vectorString") if cvss else None,
        "description": description,
        "cwes": cwes,
        "refs": refs[:25],
    }


async def load_nvd(session: aiohttp.ClientSession, cves: set[str]) -> dict[str, dict]:
    wanted_years = sorted({c.split("-")[1] for c in cves})
    out: dict[str, dict] = {}
    for year in wanted_years:
        print(f"NVD {year}: downloading…")
        blob = await fetch(session, NVD_FEED_URL.format(year=year))
        if not blob:
            continue
        data = json.loads(lzma.decompress(blob))
        for item in data.get("cve_items", []):
            if item["id"] in cves:
                out[item["id"]] = parse_nvd(item)
    print(f"NVD: matched {len(out)}/{len(cves)} CVEs")
    return out


# ---------------------------------------------------------------------------
# Apple scraping
# ---------------------------------------------------------------------------


async def fetch(session, url: str, headers: dict | None = None, attempts: int = 3, missing_ok: bool = False) -> bytes | None:
    """GET with retries. A URL that never succeeds is recorded in FAILED and gives None; so does a 404, without
    counting as a failure, when `missing_ok`."""
    for attempt in range(attempts):
        try:
            async with session.get(url, headers=headers) as res:
                if missing_ok and res.status == 404:
                    return None
                res.raise_for_status()
                return await res.read()
        except Exception as e:  # noqa: BLE001 - retried, then reported
            error = e
            await asyncio.sleep(2**attempt)
    print(f"Failed after {attempts} attempts: {url}: {error}")
    FAILED.append(url)
    return None


async def get_soup(session, url):
    body = await fetch(session, url)
    return BeautifulSoup(body, "html.parser") if body else None


def _links(soup) -> list[tuple[str, str]]:
    """(text, absolute href) of every link on a support.apple.com page."""
    return [
        (a.get_text().strip(), "https://support.apple.com" + a["href"] if a["href"].startswith("/") else a["href"])
        for a in soup.find_all("a", href=True)
    ]


def _is_advisory(text: str) -> bool:
    return "archive" not in text.lower() and "Apple security" not in text and any(k in text for k in ADVISORY_KEYWORDS)


async def discover_advisory_urls(session) -> list[tuple[str, str]]:
    """Return (url, title) for every advisory on the security releases page and its archives since 2020."""
    soup = await get_soup(session, APPLE_SECURITY_UPDATES_URL)
    if not soup:
        return []
    links = _links(soup)
    archives = [
        href
        for text, href in links
        if "Apple security" in text and any(int(y) >= 2020 for y in re.findall(r"\d{4}", text))
    ]
    print(f"Fetching {len(archives)} archive index pages…")
    for archive in await asyncio.gather(*[get_soup(session, h) for h in archives]):
        links += _links(archive) if archive else []

    advisories: dict[str, str] = {}
    for text, href in links:
        if _is_advisory(text):
            advisories.setdefault(href, text)
    return list(advisories.items())


async def scrape_advisory(session, url: str, title: str) -> dict | None:
    soup = await get_soup(session, url)
    if not soup:
        return None
    content = soup.find("div", {"id": "sections"}) or soup.find("div", {"class": "main"})
    markdown = md(str(content) if content else str(soup))
    entries = parse_entries(markdown)
    if not entries:
        return None
    return {
        "id": _url_id(url),
        "title": title,
        "url": url,
        "platforms": detect_platforms(title),
        "released": parse_released(markdown),
        "entries": entries,
    }


# ---------------------------------------------------------------------------
# Analysis repos
# ---------------------------------------------------------------------------


async def load_analyzed(session: aiohttp.ClientSession) -> set[str]:
    """Lowercased ids of the projects the owner has published an analysis of: a public repository named by the
    convention whose analysis.json names that project."""
    owner = PROJECTS["owner"]
    headers = {"accept": "application/vnd.github+json"}
    if token := os.environ.get("GITHUB_TOKEN"):
        headers["authorization"] = f"Bearer {token}"
    candidates: list[tuple[str, dict]] = []
    for page in range(1, 100):
        url = f"https://api.github.com/users/{owner}/repos?type=public&per_page=100&page={page}"
        body = await fetch(session, url, headers)
        if body is None:
            return set()
        batch = json.loads(body)
        candidates += [(m.group(1), r) for r in batch if (m := ANALYSIS_REPO_RE.match(r["name"]))]
        if len(batch) < 100:
            break

    async def analyzes(project: str, repo: dict) -> bool:
        # raw.githubusercontent.com doesn't count against the API rate limit.
        url = f"https://raw.githubusercontent.com/{repo['full_name']}/{repo['default_branch']}/analysis.json"
        body = await fetch(session, url, missing_ok=True)
        try:
            return body is not None and str(json.loads(body).get("project", "")).lower() == project.lower()
        except (ValueError, AttributeError):
            return False

    checks = await asyncio.gather(*[analyzes(p, r) for p, r in candidates])
    ids = {p.lower() for (p, _), ok in zip(candidates, checks) if ok}
    print(f"GitHub: {len(ids)} analyses published by {owner} ({len(candidates)} repositories named by the convention)")
    return ids


# ---------------------------------------------------------------------------
# JSON output
# ---------------------------------------------------------------------------


def _slug(name: str) -> str:
    """A file name for a year or component, e.g. "Model I/O" -> "model-i-o"."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "unnamed"


def _write_json(path: str, data) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def _badge(n: dict) -> dict | None:
    """A CVE's severity (and CVSS score), coloured by severity."""
    if not n.get("severity"):
        return None
    score = n.get("cvss_score")
    return {"label": n["severity"] + (f" {score:.1f}" if score is not None else ""), "tone": n["severity"].lower()}


def _sections(cve: str, n: dict, entries: list[dict]) -> list[dict]:
    """What Apple and NVD say about a CVE, as the project header's sections."""
    # The same CVE often appears in several advisories with an identical write-up; show each write-up once.
    writeups: dict[tuple, dict] = {}
    for e in entries:
        writeups.setdefault((e["component"], e["description"]), e)
    nvd: list[dict] = [{"type": "text", "text": n.get("description") or "No NVD description."}]
    if n.get("cvss_vector"):
        nvd.append({"type": "code", "label": f"CVSS {n['cvss_version']}", "code": n["cvss_vector"]})
    if n.get("cwes"):
        nvd.append(
            {
                "type": "tags",
                "items": [
                    {"label": w, "url": f"https://cwe.mitre.org/data/definitions/{w.removeprefix('CWE-')}.html"}
                    for w in n["cwes"]
                ],
            }
        )
    refs = [{"label": "NVD entry", "url": f"https://nvd.nist.gov/vuln/detail/{cve}"}]
    refs.append({"label": "cve.org", "url": f"https://www.cve.org/CVERecord?id={cve}"})
    refs += [
        {"label": r["url"], "url": r["url"], **({"note": ", ".join(r["tags"])} if r["tags"] else {})}
        for r in n.get("refs", [])
        if "support.apple.com" not in r["url"]
    ][:10]
    return [
        {
            "title": "Apple",
            "blocks": [
                {
                    "type": "entry",
                    "title": e["component"] or "Unspecified component",
                    "detail": e["impact"],
                    "notes": [x for x in (e["description"], e["credit"] and f"Credit: {e['credit']}") if x],
                }
                for e in writeups.values()
            ],
        },
        {"title": "NVD", "blocks": nvd},
        {"title": "References", "wide": True, "blocks": [{"type": "links", "items": refs}]},
    ]


def _menu(entries: list[dict]) -> dict:
    """The advisories a CVE was fixed in, newest first."""
    advisories: dict[str, dict] = {}
    for e in entries:
        advisories.setdefault(e["advisory_id"], e)
    return {
        "label": "Fixed in",
        "items": [
            {"title": a["title"], "detail": f"{a['released'] or 'undated'} · {', '.join(a['platforms'])}", "url": a["url"]}
            for a in advisories.values()
        ],
    }


def write_api(out: str, advisories: list[dict], nvd: dict[str, dict], analyzed: set[str]) -> None:
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(os.path.join(out, "projects"))

    # Group every advisory entry under its CVE, newest advisory first.
    by_cve: dict[str, list[dict]] = {}
    for a in sorted(advisories, key=lambda a: a["released"] or "", reverse=True):
        for e in a["entries"]:
            by_cve.setdefault(e["cve"], []).append(
                {
                    "advisory_id": a["id"],
                    "component": e["component"],
                    "impact": e["impact"],
                    "description": e["description"],
                    "credit": e["credit"],
                    "title": a["title"],
                    "url": a["url"],
                    "released": a["released"],
                    "platforms": a["platforms"],
                }
            )

    index = []
    for cve, entries in by_cve.items():
        n = nvd.get(cve, {})
        components = list(dict.fromkeys(e["component"] for e in entries if e["component"]))
        impact = next((e["impact"] for e in entries if e["impact"]), None)
        _write_json(
            os.path.join(out, "projects", f"{cve}.json"),
            {
                "id": cve,
                "summary": impact,
                "badge": _badge(n),
                "tags": components,
                "sections": _sections(cve, n, entries),
                "menu": _menu(entries),
            },
        )
        index.append(
            {
                "id": cve,
                "summary": impact,
                "date": max((e["released"] for e in entries if e["released"]), default=None),
                "badge": _badge(n),
                "tags": components,
                "facets": {
                    "severity": n.get("severity"),
                    "year": cve.split("-")[1],
                    "platform": sorted({p for e in entries for p in e["platforms"]}),
                    "component": components,
                },
                "analyzed": cve.lower() in analyzed,
            }
        )

    index.sort(key=lambda c: (c["date"] or "", c["id"]), reverse=True)

    # Shards, so a browser only downloads the slice it is looking at: by the CVE id's year, and by component.
    # Grouped by file name, so names that only differ in case or punctuation ("Wi-Fi", "Wi Fi") share a shard.
    def shard(folder: str, key) -> list[dict]:
        groups: dict[str, tuple[str, list[dict]]] = {}
        for c in index:
            for name in key(c):
                groups.setdefault(_slug(name), (name, []))[1].append(c)
        os.makedirs(os.path.join(out, folder))
        listing = []
        for slug, (name, cves) in groups.items():
            _write_json(os.path.join(out, folder, f"{slug}.json"), cves)
            listing.append({"name": name, "file": f"{folder}/{slug}.json", "count": len(cves)})
        return listing

    years = sorted(shard("years", lambda c: [c["facets"]["year"]]), key=lambda s: s["name"], reverse=True)
    components = sorted(shard("components", lambda c: c["facets"]["component"]), key=lambda s: -s["count"])
    analyzed_count = sum(c["analyzed"] for c in index)
    _write_json(
        os.path.join(out, "index.json"),
        {
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "title": "Find the patch behind every Apple CVE",
            "about": "Apple security advisories since 2020, with NVD data.",
            "stats": [
                {"label": "CVEs", "value": len(index)},
                {"label": "advisories", "value": len(advisories)},
                {"label": "analyzed", "value": analyzed_count},
            ],
            # The first facet with shards (years, newest first) is the default view.
            "facets": [
                {"key": "severity", "any": "Any severity", "values": list(SEVERITIES.values())},
                {"key": "year", "any": "All years", "shards": years, "match": r"CVE-(\d{4})"},
                {"key": "platform", "any": "All platforms", "values": PLATFORMS},
                {"key": "component", "any": "All components", "shards": components},
            ],
            "scopes": [{"label": "Kernel & friends", "facet": "component", "values": KERNEL_COMPONENTS}],
        },
    )
    print(f"Wrote {out}: {len(advisories)} advisories, {len(index)} CVEs, {analyzed_count} analyzed")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def main(out: str, limit: int | None) -> None:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/17.2 Safari/605.1.15"
        )
    }
    connector = aiohttp.TCPConnector(limit=APPLE_CONCURRENCY + 10)
    async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
        urls = await discover_advisory_urls(session)
        if limit:
            urls = urls[:limit]
        print(f"Scraping {len(urls)} advisories…")

        sem = asyncio.Semaphore(APPLE_CONCURRENCY)

        async def bounded(url: str, title: str):
            async with sem:
                return await scrape_advisory(session, url, title)

        results = await asyncio.gather(*[bounded(u, t) for u, t in urls])
        advisories = [a for a in results if a]

        cves = {e["cve"] for a in advisories for e in a["entries"]}
        nvd = await load_nvd(session, cves)
        analyzed = await load_analyzed(session)

    if FAILED or not advisories:
        sys.exit(f"{len(FAILED)} request(s) failed; wrote nothing, so the published data stays as it was.")
    write_api(out, advisories, nvd, analyzed)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=DEFAULT_OUT, help="output directory")
    parser.add_argument("--limit", type=int, help="only scrape the first N advisories")
    args = parser.parse_args()
    asyncio.run(main(args.out, args.limit))
