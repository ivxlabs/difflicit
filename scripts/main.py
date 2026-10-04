"""
Scrape Apple security advisories + NVD metadata into the static JSON API Difflicit reads.

    uv run main.py                       # writes out/api/
    uv run main.py --limit 20            # only the first 20 advisories (quick test)
    uv run main.py --out ../public/api   # serve it to `npm run dev` (with VITE_API_BASE=/api)

Output:
    index.json            manifest: totals, and the year and component shards below
    years/2026.json       summaries of the CVEs whose id is CVE-2026-*
    components/kernel.json  summaries of the CVEs Apple lists under that component
    cves/CVE-….json       one file per CVE: NVD data + every advisory entry

Environment:
    ANALYSIS_ORG   GitHub account whose CVE-YYYY-NNNN repos mark CVEs as analyzed (default: ivxlabs)
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

ANALYSIS_ORG = os.environ.get("ANALYSIS_ORG", "ivxlabs")

# Every URL that couldn't be fetched. Output replaces what's published (the upload deletes what's gone),
# so a run with any failure writes nothing rather than publishing partial data.
FAILED: list[str] = []
ANALYSIS_REPO_RE = re.compile(r"^CVE-\d{4}-\d{4,}$", re.I)


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


async def fetch(session, url: str, headers: dict | None = None, attempts: int = 3) -> bytes | None:
    """GET with retries. A URL that never succeeds is recorded in FAILED and gives None."""
    for attempt in range(attempts):
        try:
            async with session.get(url, headers=headers) as res:
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
    """CVE ids that have a public github.com/<ANALYSIS_ORG>/CVE-YYYY-NNNN repo."""
    headers = {"accept": "application/vnd.github+json"}
    if token := os.environ.get("GITHUB_TOKEN"):
        headers["authorization"] = f"Bearer {token}"
    names: set[str] = set()
    for page in range(1, 100):
        url = f"https://api.github.com/users/{ANALYSIS_ORG}/repos?type=public&per_page=100&page={page}"
        body = await fetch(session, url, headers)
        if body is None:
            return set()
        batch = json.loads(body)
        names |= {r["name"].upper() for r in batch if ANALYSIS_REPO_RE.match(r["name"])}
        if len(batch) < 100:
            break
    print(f"GitHub: {len(names)} analysis repos in {ANALYSIS_ORG}")
    return names


# ---------------------------------------------------------------------------
# JSON output
# ---------------------------------------------------------------------------


def _slug(name: str) -> str:
    """A file name for a year or component, e.g. "Model I/O" -> "model-i-o"."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "unnamed"


def _write_json(path: str, data) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def write_api(out: str, advisories: list[dict], nvd: dict[str, dict], analyzed: set[str]) -> None:
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(os.path.join(out, "cves"))

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
        _write_json(
            os.path.join(out, "cves", f"{cve}.json"),
            {
                "id": cve,
                "severity": n.get("severity"),
                "cvss_score": n.get("cvss_score"),
                "cvss_version": n.get("cvss_version"),
                "cvss_vector": n.get("cvss_vector"),
                "nvd_description": n.get("description"),
                "cwes": n.get("cwes", []),
                "refs": n.get("refs", []),
                "entries": entries,
            },
        )
        index.append(
            {
                "id": cve,
                "severity": n.get("severity"),
                "cvss_score": n.get("cvss_score"),
                "components": list(dict.fromkeys(e["component"] for e in entries if e["component"])),
                "impact": next((e["impact"] for e in entries if e["impact"]), None),
                "released": max((e["released"] for e in entries if e["released"]), default=None),
                "platforms": sorted({p for e in entries for p in e["platforms"]}),
                "analyzed": cve in analyzed,
            }
        )

    index.sort(key=lambda c: (c["released"] or "", c["id"]), reverse=True)

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

    _write_json(
        os.path.join(out, "index.json"),
        {
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "org": ANALYSIS_ORG,
            "advisories": len(advisories),
            "cves": len(index),
            "analyzed": sum(c["analyzed"] for c in index),
            "years": sorted(shard("years", lambda c: [c["id"].split("-")[1]]), key=lambda s: s["name"], reverse=True),
            "components": sorted(shard("components", lambda c: c["components"]), key=lambda s: -s["count"]),
        },
    )
    print(f"Wrote {out}: {len(advisories)} advisories, {len(index)} CVEs, {len(analyzed)} analyzed")


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
