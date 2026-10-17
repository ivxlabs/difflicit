// SPDX-License-Identifier: GPL-3.0-only
//! A **project** is a folder marked by a project file (difflicit.json, or analysis.json). It holds **artifacts**,
//! added with nothing but a path or git URL:
//!
//! - a **git** repo (cloned into `<project>/artifacts/<name>`) — its **versions** are its commits/tags;
//! - a **file** or folder — its **versions** are the copies you add (`<project>/artifacts/<name>/<version>`).
//!
//! Diffing is between two **versions of one artifact**: git refs with `git diff`, two binaries with `radiff2`,
//! and anything else with `git diff --no-index`. (Diffing across artifacts is a separate, later feature.)

use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;

// ── Running tools ────────────────────────────────────────────────────────────

fn run_ok(program: &str, args: &[&str], ok: &[i32], hint: &str) -> Result<String, String> {
    let out = Command::new(program)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0") // no window to type a password into; fail instead of hanging
        .output()
        .map_err(|e| format!("Couldn't run {program} ({e}). {hint}"))?;
    if out.status.success() || out.status.code().is_some_and(|c| ok.contains(&c)) {
        return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let last = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("it failed").trim();
    Err(last.trim_start_matches("fatal: ").to_string())
}

pub(crate) fn run(program: &str, args: &[&str], hint: &str) -> Result<String, String> {
    run_ok(program, args, &[], hint)
}

pub(crate) fn installed(program: &str) -> bool {
    Command::new(program).arg("-v").output().is_ok()
}

fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let repo = repo.to_str().ok_or("bad path")?;
    let mut all = vec!["-C", repo];
    all.extend_from_slice(args);
    run("git", &all, "Install Git and try again.")
}

fn safe_ref(r: &str) -> Result<&str, String> {
    if r.is_empty() || r.starts_with('-') {
        return Err(format!("{r:?} isn't a valid ref."));
    }
    Ok(r)
}

/// Which diff engines are usable here: git, and radiff2 + r2 for binaries.
#[tauri::command]
pub fn diff_tools() -> Value {
    json!({ "git": installed("git"), "binary": installed("radiff2") && installed("r2"), "ipsw": installed("ipsw") })
}

// ── ipsw: dyld shared cache, firmware, cache diff (blacktop/ipsw) ─────────────
//
// ipsw turns Apple firmware into something diffable: it lists and extracts the dylibs inside a
// dyld_shared_cache (the system frameworks aren't on disk otherwise), pulls a cache out of an IPSW/OTA, and can
// download firmware by device and build. An extracted dylib is a plain Mach-O, so it's added as a file
// artifact's version and diffed with radiff2 like any other binary. Big caches/firmware live in a shared
// workspace (~/Difflicit/ipsw); only the small extracted dylibs are copied into a project.

const IPSW_HINT: &str = "Install blacktop/ipsw (brew install ipsw) and try again.";

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

/// A subfolder of Difflicit's shared ipsw workspace, created on demand.
fn ipsw_dir(sub: &str) -> Result<PathBuf, String> {
    let dir = home().join("Difflicit/ipsw").join(sub);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// A fresh scratch directory for one extraction.
pub(crate) fn scratch(tag: &str) -> PathBuf {
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    std::env::temp_dir().join(format!("difflicit-{tag}-{}-{n}", std::process::id()))
}

/// Whether a file name is a primary dyld_shared_cache (not a subcache like `…arm64e.01` or a `.map`/`.symbols`).
fn is_primary_cache(name: &str) -> bool {
    name.strip_prefix("dyld_shared_cache_").is_some_and(|arch| !arch.is_empty() && !arch.contains('.'))
}

/// Add every primary dyld_shared_cache under `dir` (recursively) to `out` as { name, path }.
fn collect_caches(dir: &Path, out: &mut Vec<Value>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for path in entries.flatten().map(|e| e.path()) {
        if path.is_dir() {
            collect_caches(&path, out);
        } else if path.file_name().and_then(|n| n.to_str()).is_some_and(is_primary_cache) {
            out.push(json!({ "name": path.file_name().and_then(|n| n.to_str()), "path": path.to_string_lossy() }));
        }
    }
}

/// dyld_shared_caches on disk: this Mac's system cache, plus any Difflicit downloaded or extracted.
#[tauri::command]
pub fn dsc_caches() -> Vec<Value> {
    let mut out = vec![];
    #[cfg(target_os = "macos")]
    for (label, path) in [
        ("This Mac", "/System/Volumes/Preboot/Cryptexes/OS/System/Library/dyld/dyld_shared_cache_arm64e"),
        ("This Mac", "/System/Library/dyld/dyld_shared_cache_arm64e"),
    ] {
        if Path::new(path).exists() {
            out.push(json!({ "name": label, "path": path }));
            break; // the cryptex cache first; fall back to the old location only if it's absent
        }
    }
    if let Ok(dir) = ipsw_dir("caches") {
        collect_caches(&dir, &mut out);
    }
    out
}

/// The images (dylibs) in a dyld_shared_cache, each { name, version }, sorted by name.
#[tauri::command]
pub async fn dsc_images(cache: String) -> Result<Vec<Value>, String> {
    let out = run("ipsw", &["dyld", "info", "--dylibs", "--json", &cache], IPSW_HINT)?;
    let parsed: Value = serde_json::from_str(&out).map_err(|e| format!("Couldn't read ipsw output: {e}"))?;
    let mut images: Vec<Value> = parsed
        .get("dylibs")
        .and_then(Value::as_array)
        .map(|ds| ds.iter().map(|d| json!({ "name": d.get("name"), "version": d.get("version") })).collect())
        .unwrap_or_default();
    images.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    Ok(images)
}

/// Keep only filesystem-safe characters for a version id; fall back to `fallback` if nothing is left.
fn safe_label(label: &str, fallback: &str) -> String {
    let kept: String = label.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '-' }).collect();
    let trimmed = kept.trim_matches(['-', '.']).to_string();
    if trimmed.is_empty() { fallback.to_string() } else { trimmed }
}

/// Extract one image from a cache into `outdir`; returns the Mach-O it produced.
fn extract_image_to(cache: &str, image: &str, outdir: &Path) -> Result<PathBuf, String> {
    safe_ref(image)?; // an image path never starts with '-'
    std::fs::create_dir_all(outdir).map_err(|e| e.to_string())?;
    let out = outdir.to_str().ok_or("bad path")?;
    run("ipsw", &["dyld", "extract", cache, image, "-o", out, "--force"], IPSW_HINT)?;
    let file = outdir.join(basename(image));
    if file.is_file() {
        return Ok(file);
    }
    std::fs::read_dir(outdir)
        .ok()
        .and_then(|rd| rd.flatten().map(|e| e.path()).find(|p| p.is_file()))
        .ok_or_else(|| format!("ipsw extracted nothing for {image:?}."))
}

/// Add a dylib extracted from a dyld_shared_cache as a file artifact: a new one, or another version of the one
/// already named after it. The version id is the image's version (e.g. the library version), so versions from
/// different OS builds stay distinct.
#[tauri::command]
pub async fn add_dsc_artifact(project: String, cache: String, image: String, label: Option<String>) -> Result<Value, String> {
    let dir = PathBuf::from(&project);
    init_project_at(&dir)?;
    let base = safe_name(basename(&image)).ok_or_else(|| format!("Couldn't name an artifact from {image:?}."))?;
    let scratch = scratch("dsc");
    let done = (|| {
        let extracted = extract_image_to(&cache, &image, &scratch)?;
        add_file(&dir, &base, &safe_label(label.as_deref().unwrap_or(""), &base), &extracted, Some(&image))
    })();
    let _ = std::fs::remove_dir_all(&scratch);
    done
}

/// Extract the dyld_shared_cache(s) from an IPSW/OTA file into the shared workspace. Returns the caches on disk.
#[tauri::command]
pub async fn extract_cache_from_ipsw(path: String) -> Result<Vec<Value>, String> {
    let out = ipsw_dir("caches")?;
    let outs = out.to_string_lossy().into_owned();
    if !PathBuf::from(&path).is_file() {
        return Err(format!("{path} doesn't exist."));
    }
    tauri::async_runtime::spawn_blocking(move || run("ipsw", &["extract", "--dyld", "-o", &outs, &path], IPSW_HINT))
        .await
        .map_err(|e| e.to_string())??;
    let mut found = vec![];
    collect_caches(&out, &mut found);
    Ok(found)
}

/// Download firmware by device and build/version (via ipsw.me), extracting its dyld_shared_cache. Returns the
/// caches now on disk. Downloads land in the shared workspace and can take a long time.
#[tauri::command]
pub async fn download_ipsw(device: String, build: Option<String>, version: Option<String>) -> Result<Vec<Value>, String> {
    // A product type or board, e.g. iPhone15,2 or Mac18,5 — never a flag.
    if !device.bytes().all(|b| b.is_ascii_alphanumeric() || b == b',') || !device.contains(',') {
        return Err(format!("{device:?} isn't a device identifier (e.g. iPhone15,2 or Mac18,5)."));
    }
    let out = ipsw_dir("caches")?;
    let mut args: Vec<String> =
        ["download", "ipsw", "-y", "--dyld", "-o"].iter().map(|s| s.to_string()).collect();
    args.push(out.to_string_lossy().into_owned());
    args.push("--device".into());
    args.push(device);
    match (build.as_deref(), version.as_deref()) {
        (Some(b), _) if !b.is_empty() => {
            args.extend(["--build".into(), safe_label(b, "")]);
        }
        (_, Some(v)) if !v.is_empty() => {
            args.extend(["--version".into(), safe_label(v, "")]);
        }
        _ => args.push("--latest".into()),
    }
    tauri::async_runtime::spawn_blocking(move || {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        run("ipsw", &refs, IPSW_HINT)
    })
    .await
    .map_err(|e| e.to_string())??;
    let mut found = vec![];
    collect_caches(&out, &mut found);
    Ok(found)
}

/// ipsw's own cache-level diff: the images added, removed and changed between two dyld_shared_caches.
#[tauri::command]
pub async fn dsc_diff(base: String, head: String) -> Result<Value, String> {
    let out = run("ipsw", &["dyld", "info", "--dylibs", "--diff", "--json", &base, &head], IPSW_HINT)?;
    serde_json::from_str(&out).map_err(|e| format!("Couldn't read ipsw output: {e}"))
}

/// A folder's immediate children, for a folder's view in the main area. Folders first, then files, each
/// alphabetical; dotfiles (.git, …) are hidden.
pub fn list_dir(path: String) -> Result<Vec<Value>, String> {
    let mut entries: Vec<Value> = std::fs::read_dir(&path)
        .map_err(|e| format!("Couldn't read {path}: {e}"))?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                return None;
            }
            let dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            Some(json!({ "name": name, "path": e.path().to_string_lossy(), "dir": dir }))
        })
        .collect();
    entries.sort_by(|a, b| {
        let (ad, bd) = (a["dir"].as_bool().unwrap_or(false), b["dir"].as_bool().unwrap_or(false));
        bd.cmp(&ad).then_with(|| a["name"].as_str().cmp(&b["name"].as_str()))
    });
    Ok(entries)
}

// ── Installed binaries (a shortcut for picking a file artifact) ───────────────

/// Native apps and on-disk libraries the user can pick as a file artifact without hunting through the
/// filesystem. macOS apps are the usual /Applications bundles (the Mach-O inside each); libraries are the
/// `.dylib`/`.so` files under common library directories. Everything is served by path, which the picker copies
/// in as a version like any other file. (System frameworks in the dyld shared cache aren't on disk, so they
/// don't appear here.)
#[tauri::command]
pub fn installed_binaries() -> Value {
    json!({ "apps": installed_apps(), "libraries": installed_libraries() })
}

fn binary_entry(name: &str, path: &Path) -> Value {
    json!({ "name": name, "path": path.to_string_lossy() })
}

fn sorted_unique(mut entries: Vec<Value>, limit: usize) -> Vec<Value> {
    entries.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    entries.dedup_by(|a, b| a["name"] == b["name"]);
    entries.truncate(limit);
    entries
}

#[cfg(target_os = "macos")]
fn installed_apps() -> Vec<Value> {
    let mut dirs = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/Applications/Utilities"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join("Applications"));
    }
    let mut out = vec![];
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for app in entries.flatten().map(|e| e.path()) {
            if app.extension().and_then(|e| e.to_str()) != Some("app") {
                continue;
            }
            if let Some((name, bin)) = app_binary(&app) {
                out.push(binary_entry(&name, &bin));
            }
        }
    }
    sorted_unique(out, 300)
}

/// The Mach-O inside an .app bundle: Contents/MacOS/<app name>, else the first file there.
#[cfg(target_os = "macos")]
fn app_binary(app: &Path) -> Option<(String, PathBuf)> {
    let name = app.file_stem()?.to_string_lossy().into_owned();
    let macos = app.join("Contents/MacOS");
    let preferred = macos.join(&name);
    let bin = if preferred.is_file() {
        preferred
    } else {
        std::fs::read_dir(&macos).ok()?.flatten().map(|e| e.path()).find(|p| p.is_file())?
    };
    Some((name, bin))
}

#[cfg(not(target_os = "macos"))]
fn installed_apps() -> Vec<Value> {
    Vec::new()
}

fn installed_libraries() -> Vec<Value> {
    #[cfg(target_os = "macos")]
    let dirs: &[&str] = &["/opt/homebrew/lib", "/usr/local/lib", "/opt/local/lib"];
    #[cfg(target_os = "linux")]
    let dirs: &[&str] = &["/usr/lib", "/lib", "/usr/local/lib", "/usr/lib/x86_64-linux-gnu"];
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let dirs: &[&str] = &[];

    let mut out = vec![];
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else { continue };
        for path in entries.flatten().map(|e| e.path()) {
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
            if path.is_file() && (name.ends_with(".dylib") || name.contains(".so")) {
                out.push(binary_entry(name, &path));
            }
        }
    }
    sorted_unique(out, 400)
}

// ── git refs (a git artifact's versions) ─────────────────────────────────────

fn log(repo: &Path, limit: u32) -> Result<Vec<Value>, String> {
    let n = format!("-{limit}");
    let out = git(repo, &["log", &n, "--no-color", "--pretty=%H%x1f%h%x1f%s%x1f%cs"])?;
    Ok(out
        .lines()
        .filter_map(|l| {
            let mut f = l.split('\u{1f}');
            Some(json!({ "hash": f.next()?, "short": f.next()?, "subject": f.next()?, "date": f.next()? }))
        })
        .collect())
}

fn tags(repo: &Path) -> Result<Vec<String>, String> {
    Ok(git(repo, &["tag", "--sort=-creatordate"])?.lines().map(str::to_string).filter(|s| !s.is_empty()).collect())
}

/// A git artifact's versions: its tags, then recent commits.
#[tauri::command]
pub async fn git_versions(project: String, repo: String) -> Result<Value, String> {
    let dir = PathBuf::from(&project).join(&repo);
    Ok(json!({ "tags": tags(&dir)?, "commits": log(&dir, 100)? }))
}

// ── Cloning / copying an artifact into the project ───────────────────────────

fn github_slug(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix("git@github.com:").or_else(|| url.strip_prefix("https://github.com/"))?;
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let (owner, name) = rest.split_once('/')?;
    (!owner.is_empty() && !name.is_empty() && !name.contains('/')).then(|| (owner.to_string(), name.to_string()))
}

/// Whether a clone URL is a github.com repo (so connecting GitHub could unblock a failed clone).
#[tauri::command]
pub fn is_github(url: String) -> bool {
    github_slug(&url).is_some()
}

fn basename(p: &str) -> &str {
    p.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or(p)
}

/// A safe path segment: no separators, leading dots/dashes, or odd characters.
pub(crate) fn safe_name(name: &str) -> Option<String> {
    let name = name.trim().trim_end_matches(".git");
    let ok = !name.is_empty() && !name.starts_with(['.', '-']) && name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    ok.then(|| name.to_string())
}

// ── The project file (difflicit.json, or analysis.json) ──────────────────────

pub const ANALYSIS_SCHEMA: &str = "https://raw.githubusercontent.com/ivxlabs/difflicit/main/analysis.schema.json";

fn project_file(dir: &Path) -> PathBuf {
    let preferred = dir.join("difflicit.json");
    if preferred.exists() { preferred } else { dir.join("analysis.json") }
}

/// A folder's project file (difflicit.json, else analysis.json), parsed; null if there is none.
pub(crate) fn read_project(dir: &Path) -> Value {
    std::fs::read_to_string(project_file(dir))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(Value::Null)
}

/// Write the project file (always difflicit.json for projects this app manages).
pub(crate) fn write_project(dir: &Path, body: &Value) -> Result<(), String> {
    std::fs::write(dir.join("difflicit.json"), serde_json::to_string_pretty(body).unwrap() + "\n").map_err(|e| e.to_string())
}

fn artifacts_of(body: &Value) -> Vec<Value> {
    body.get("artifacts").and_then(Value::as_array).cloned().unwrap_or_default()
}

fn artifact_name(a: &Value) -> &str {
    a.get("name").and_then(Value::as_str).unwrap_or("")
}

/// Make `base` unique among the project's existing artifact names.
fn unique_name(body: &Value, base: &str) -> String {
    let taken: Vec<String> = artifacts_of(body).iter().filter_map(|a| a.get("name").and_then(Value::as_str).map(str::to_string)).collect();
    let mut name = base.to_string();
    for i in 2.. {
        if !taken.contains(&name) {
            break;
        }
        name = format!("{base}-{i}");
    }
    name
}

/// Mark a folder as a Difflicit project (writes difflicit.json) if it isn't one already.
#[tauri::command]
pub fn init_project(path: String) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    if read_project(&dir).is_object() {
        return Ok(());
    }
    let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("project");
    write_project(&dir, &json!({ "$schema": ANALYSIS_SCHEMA, "project": name }))
}

// ── Adding artifacts ─────────────────────────────────────────────────────────

/// Add a git repository (path or URL) as an artifact: clone it into the project. Returns the artifact name.
#[tauri::command]
pub async fn add_git_artifact(_app: AppHandle, project: String, source: String, token: Option<String>) -> Result<String, String> {
    let dir = PathBuf::from(&project);
    init_project_at(&dir)?;
    let mut body = read_project(&dir);
    let base = safe_name(basename(&source)).ok_or_else(|| format!("Couldn't name an artifact from {source:?}."))?;
    let name = unique_name(&body, &base);
    let rel = format!("artifacts/{name}");
    let dest = dir.join(&rel);
    let url = match (&token, github_slug(&source)) {
        (Some(t), Some((owner, repo))) => format!("https://x-access-token:{t}@github.com/{owner}/{repo}.git"),
        _ => source,
    };
    let target = dest.to_string_lossy().into_owned();
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
        run("git", &["clone", "--quiet", &url, &target], "Install Git and try again.").map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())??;
    append_artifact(&mut body, json!({ "name": name, "kind": "git", "repo": rel }));
    write_project(&dir, &body)?;
    Ok(name)
}

/// Copy a file or directory into `artifacts/<name>/<version>`; returns the project-relative path.
fn copy_in(dir: &Path, name: &str, version: &str, src: &Path) -> Result<String, String> {
    let rel = format!("artifacts/{name}/{version}");
    let dest = dir.join(&rel);
    std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
    if src.is_dir() {
        copy_dir(src, &dest)?;
    } else {
        std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
    }
    Ok(rel)
}

fn copy_dir(src: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let to = dest.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else {
            std::fs::copy(entry.path(), &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Add a file or folder as an artifact: a new one, or another version of the file artifact already named after it.
/// Returns { name, version }.
#[tauri::command]
pub async fn add_file_artifact(project: String, path: String) -> Result<Value, String> {
    let dir = PathBuf::from(&project);
    init_project_at(&dir)?;
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("{path} doesn't exist."));
    }
    let base = safe_name(basename(&path)).ok_or_else(|| format!("Couldn't name an artifact from {path:?}."))?;
    add_file(&dir, &base, &base, &src, None)
}

/// Copy `src` into the project under the file artifact `name`. The same name is the same thing in another version
/// (that's what gets compared), so an existing file artifact gets a new version rather than a renamed twin;
/// otherwise a new artifact starts (named apart from a git artifact that has the name). `image` records a
/// dyld_shared_cache image the file came from. Returns { name, version }.
fn add_file(dir: &Path, name: &str, version: &str, src: &Path, image: Option<&str>) -> Result<Value, String> {
    let mut body = read_project(dir);
    let grouped = artifacts_of(&body).iter().any(|a| artifact_name(a) == name && a.get("kind").and_then(Value::as_str) == Some("file"));
    let (name, version) = if grouped {
        let arts = body.get_mut("artifacts").and_then(Value::as_array_mut).ok_or("no artifacts")?;
        let a = arts.iter_mut().find(|a| artifact_name(a) == name).ok_or_else(|| format!("No artifact {name:?}."))?;
        let version = unique_version(a, version);
        let rel = copy_in(dir, name, &version, src)?;
        a["versions"].as_array_mut().ok_or_else(|| format!("{name} has no versions list."))?.push(json!({ "id": version, "path": rel }));
        (name.to_string(), version)
    } else {
        let name = unique_name(&body, name);
        let rel = copy_in(dir, &name, version, src)?;
        let mut artifact = json!({ "name": name, "kind": "file", "versions": [{ "id": version, "path": rel }] });
        if let Some(image) = image {
            artifact["image"] = json!(image);
        }
        append_artifact(&mut body, artifact);
        (name, version.to_string())
    };
    write_project(dir, &body)?;
    Ok(json!({ "name": name, "version": version }))
}


/// Remove an artifact from the project, with its copies in `artifacts/<name>` (a git artifact's clone, a file
/// artifact's versions). Anything it points to outside that folder is left alone.
#[tauri::command]
pub fn remove_artifact(project: String, name: String) -> Result<(), String> {
    let dir = PathBuf::from(&project);
    let name = safe_name(&name).ok_or_else(|| format!("No artifact {name:?}."))?;
    let mut body = read_project(&dir);
    let arts = body.get_mut("artifacts").and_then(Value::as_array_mut).ok_or_else(|| format!("No artifact {name:?}."))?;
    let before = arts.len();
    arts.retain(|a| artifact_name(a) != name);
    if arts.len() == before {
        return Err(format!("No artifact {name:?}."));
    }
    write_project(&dir, &body)?;
    let copies = dir.join("artifacts").join(&name);
    if copies.is_dir() {
        std::fs::remove_dir_all(&copies).map_err(|e| format!("Removed {name} from the project, but not its files: {e}"))?;
    }
    Ok(())
}

/// Make `base` unique among an artifact's existing version ids.
fn unique_version(artifact: &Value, base: &str) -> String {
    let taken: Vec<String> = artifact
        .get("versions")
        .and_then(Value::as_array)
        .map(|vs| vs.iter().filter_map(|v| v.get("id").and_then(Value::as_str).map(str::to_string)).collect())
        .unwrap_or_default();
    let mut version = base.to_string();
    for i in 2.. {
        if !taken.contains(&version) {
            break;
        }
        version = format!("{base}-{i}");
    }
    version
}

pub(crate) fn init_project_at(dir: &Path) -> Result<(), String> {
    if !read_project(dir).is_object() {
        let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("project");
        write_project(dir, &json!({ "$schema": ANALYSIS_SCHEMA, "project": name }))?;
    }
    Ok(())
}

fn append_artifact(body: &mut Value, artifact: Value) {
    if !body.is_object() {
        *body = json!({ "$schema": ANALYSIS_SCHEMA });
    }
    body.as_object_mut().unwrap().entry("artifacts").or_insert_with(|| json!([])).as_array_mut().unwrap().push(artifact);
}

// ── Diffing two versions of an artifact ──────────────────────────────────────

pub(crate) fn resolve(dir: &Path, p: &str) -> PathBuf {
    let p = PathBuf::from(p);
    if p.is_absolute() { p } else { dir.join(p) }
}

/// The path of a file artifact's version.
pub(crate) fn version_path(dir: &Path, artifact: &Value, id: &str) -> Result<PathBuf, String> {
    artifact
        .get("versions")
        .and_then(Value::as_array)
        .and_then(|vs| vs.iter().find(|v| v.get("id").and_then(Value::as_str) == Some(id)))
        .and_then(|v| v.get("path").and_then(Value::as_str))
        .map(|p| resolve(dir, p))
        .ok_or_else(|| format!("No version {id:?}."))
}

/// Whether a file is binary: a NUL byte in its first 8 KiB (only that much is read, however big the file).
pub(crate) fn is_binary_file(path: &Path) -> bool {
    use std::io::Read;
    let mut head = Vec::with_capacity(8192);
    std::fs::File::open(path).and_then(|f| f.take(8192).read_to_end(&mut head)).is_ok() && head.contains(&0)
}

/// `git diff --no-index` of two files or folders, with paths as people read them. git names files by the full
/// path it was given (`a/Users/…/artifacts/lib/1.0/src/x.c`), so every file of two versions would look renamed;
/// instead a folder's files are named inside it (`a/src/x.c` → `b/src/x.c`), and two files by `name`.
fn no_index(a: &Path, b: &Path, name: &str) -> Result<String, String> {
    let (sa, sb) = (a.to_str().ok_or("bad path")?, b.to_str().ok_or("bad path")?);
    let text = run_ok("git", &["diff", "--no-color", "--no-index", "--", sa, sb], &[1], "Install Git and try again.")?;
    // As git prints them: without a leading slash (and with / on Windows too).
    let (pa, pb) = (sa.replace('\\', "/").trim_start_matches('/').to_string(), sb.replace('\\', "/").trim_start_matches('/').to_string());
    let rename = |line: &str| -> String {
        if a.is_dir() {
            let mut line = line.to_string();
            // An added or deleted file is named under the other folder on both sides.
            for p in [&pa, &pb] {
                line = line.replace(&format!("a/{p}/"), "a/").replace(&format!("b/{p}/"), "b/");
            }
            line
        } else {
            line.replace(&format!("a/{pa}"), &format!("a/{name}")).replace(&format!("b/{pb}"), &format!("b/{name}"))
        }
    };
    let headers = ["diff --git ", "--- ", "+++ "];
    let mut in_hunk = false;
    Ok(text
        .lines()
        .map(|line| {
            // Only the headers carry paths; a hunk's "--- " line is a removed line that happens to start that way.
            if line.starts_with("diff --git ") {
                in_hunk = false;
            } else if line.starts_with("@@") {
                in_hunk = true;
            }
            if !in_hunk && headers.iter().any(|h| line.starts_with(h)) { rename(line) } else { line.to_string() }
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n")
}

/// The files to compare: `base` of `base_artifact` (or of `artifact`) and `head` of `artifact`. Two versions of one
/// artifact, or versions of two different file artifacts (two builds added separately, say).
fn pair_paths(dir: &Path, artifact: &Value, base_artifact: Option<&Value>, base: &str, head: &str) -> Result<(PathBuf, PathBuf), String> {
    let from = base_artifact.unwrap_or(artifact);
    if from != artifact && [from, artifact].iter().any(|a| a.get("kind").and_then(Value::as_str) == Some("git")) {
        return Err("A git repository can only be compared with its own versions: pick two versions of the same repository.".into());
    }
    Ok((version_path(dir, from, base)?, version_path(dir, artifact, head)?))
}

/// The diff between two versions (`base`, `head`) of an artifact — or `base` of another artifact (`base_artifact`)
/// — as unified-diff text or a binary function table.
#[tauri::command]
pub async fn artifact_diff(project: String, artifact: Value, base: String, head: String, base_artifact: Option<Value>) -> Result<Value, String> {
    let dir = PathBuf::from(&project);
    let same = base_artifact.as_ref().is_none_or(|b| b == &artifact);
    if same && artifact.get("kind").and_then(Value::as_str) == Some("git") {
        let repo = resolve(&dir, artifact.get("repo").and_then(Value::as_str).unwrap_or(""));
        let text = git(&repo, &["diff", "--no-color", safe_ref(&base)?, safe_ref(&head)?, "--"])?;
        return Ok(json!({ "kind": "unified", "text": text }));
    }
    let (b, h) = pair_paths(&dir, &artifact, base_artifact.as_ref(), &base, &head)?;
    if is_binary_file(&b) && is_binary_file(&h) {
        return Ok(json!({ "kind": "binary", "functions": radiff(&b, &h)? }));
    }
    let name = artifact.get("name").and_then(Value::as_str).unwrap_or("file");
    Ok(json!({ "kind": "unified", "text": no_index(&b, &h, name)? }))
}

// ── Binaries (radare2) ───────────────────────────────────────────────────────

const RADARE_HINT: &str = "Install radare2 (radiff2 and r2) for binary diffing.";

fn radiff(base: &Path, head: &Path) -> Result<Vec<Value>, String> {
    let (b, h) = (base.to_str().ok_or("bad path")?, head.to_str().ok_or("bad path")?);
    let out = run("radiff2", &["-A", "-C", "-j", b, h], RADARE_HINT)?;
    // No functions to compare (e.g. a stub dylib with an empty __text): radiff2 prints nothing at all.
    if out.trim().is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<Value> = serde_json::from_str(out.trim()).map_err(|e| format!("radiff2 gave unexpected output: {e}"))?;
    Ok(rows
        .iter()
        .map(|r| {
            let dist = r.get("dist").and_then(Value::as_f64).unwrap_or(1.0);
            let name = r.get("name").and_then(Value::as_str).unwrap_or("");
            let diff_name = r.get("diff_name").and_then(Value::as_str).unwrap_or("");
            let status = if name.is_empty() {
                "added"
            } else if diff_name.is_empty() {
                "removed"
            } else if dist >= 1.0 {
                "same"
            } else {
                "changed"
            };
            json!({
                "name": if name.is_empty() { diff_name } else { name },
                "status": status,
                "similarity": dist,
                "base_addr": r.get("addr").and_then(Value::as_u64).map(|a| format!("0x{a:x}")),
                "head_addr": r.get("diff_addr").and_then(Value::as_u64).map(|a| format!("0x{a:x}")),
            })
        })
        .collect())
}

fn safe_addr(a: &str) -> Result<&str, String> {
    let ok = a.starts_with("0x") && a.len() > 2 && a[2..].bytes().all(|b| b.is_ascii_hexdigit());
    ok.then_some(a).ok_or_else(|| format!("{a:?} isn't an address."))
}

fn disasm(binary: &Path, addr: &str) -> Result<String, String> {
    let seek = format!("s {}; pdf", safe_addr(addr)?);
    let out = run(
        "r2",
        &[
            "-q", "-e", "scr.color=0", "-e", "asm.lines=false", "-e", "asm.addr=false", "-e", "asm.bytes=false",
            "-e", "asm.comments=false", "-e", "asm.xrefs=false", "-e", "asm.flags=false", "-A", "-c", &seek,
            binary.to_str().ok_or("bad path")?,
        ],
        RADARE_HINT,
    )?;
    Ok(out
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with(';') && !l.contains("section size"))
        .map(|l| format!("{l}\n"))
        .collect())
}

/// A unified diff of one function's normalized disassembly between two binary versions of an artifact.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // one Tauri command's arguments, named as the web app sends them
pub async fn artifact_function_diff(
    project: String,
    artifact: Value,
    base: String,
    head: String,
    name: String,
    base_addr: Option<String>,
    head_addr: Option<String>,
    base_artifact: Option<Value>,
) -> Result<String, String> {
    let dir = PathBuf::from(&project);
    let (b, h) = pair_paths(&dir, &artifact, base_artifact.as_ref(), &base, &head)?;
    let before = base_addr.as_deref().map(|a| disasm(&b, a)).transpose()?.unwrap_or_default();
    let after = head_addr.as_deref().map(|a| disasm(&h, a)).transpose()?.unwrap_or_default();
    let path = name.replace(['\n', ' '], "_");
    let diff = similar::TextDiff::from_lines(&before, &after);
    let hunks = diff.unified_diff().context_radius(3).to_string();
    if hunks.trim().is_empty() {
        return Ok(String::new());
    }
    Ok(format!("diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n{hunks}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers() {
        assert_eq!(github_slug("git@github.com:apple-oss/xnu.git"), Some(("apple-oss".into(), "xnu".into())));
        assert_eq!(basename("/a/b/kernelcache"), "kernelcache");
        assert_eq!(safe_name("xnu.git").as_deref(), Some("xnu"));
        assert!(safe_addr("0x100000460").is_ok() && safe_addr("x").is_err());
    }

    #[test]
    fn ipsw_helpers() {
        assert!(is_primary_cache("dyld_shared_cache_arm64e"));
        assert!(!is_primary_cache("dyld_shared_cache_arm64e.01.dylddata"));
        assert!(!is_primary_cache("dyld_shared_cache_arm64e.symbols"));
        assert!(!is_primary_cache("something_else"));
        assert_eq!(safe_label("951.7.0.0.0", "x"), "951.7.0.0.0");
        assert_eq!(safe_label("iOS 18.1 (22B83)", "x"), "iOS-18.1--22B83");
        assert_eq!(safe_label("///", "fallback"), "fallback");
    }

    #[test]
    fn folder_diffs_name_files_inside() {
        let dir = scratch("folders");
        let (v1, v2) = (dir.join("v1"), dir.join("v2"));
        std::fs::create_dir_all(v1.join("src")).unwrap();
        std::fs::create_dir_all(v2.join("src")).unwrap();
        std::fs::write(v1.join("src/x.c"), "-- one\n").unwrap();
        std::fs::write(v2.join("src/x.c"), "-- two\n").unwrap();
        std::fs::write(v2.join("new.c"), "new\n").unwrap();
        let text = no_index(&v1, &v2, "lib").unwrap();
        assert!(text.contains("diff --git a/src/x.c b/src/x.c\n"), "{text}");
        assert!(text.contains("--- a/src/x.c\n+++ b/src/x.c\n"), "{text}");
        assert!(text.contains("diff --git a/new.c b/new.c\n--- /dev/null\n+++ b/new.c\n") || text.contains("+++ b/new.c\n"), "{text}");
        // A removed line that looks like a header is left alone.
        assert!(text.contains("\n--- one\n"), "{text}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_artifact_and_diff() {
        let dir = scratch("proj");
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.to_string_lossy().to_string();
        init_project(p.clone()).unwrap();

        let a = scratch("v").with_extension("txt");
        std::fs::write(&a, "one\ntwo\n").unwrap();
        let added = tauri::async_runtime::block_on(add_file_artifact(p.clone(), a.to_string_lossy().into())).unwrap();
        let name = added["name"].as_str().unwrap().to_string();
        let v1 = added["version"].as_str().unwrap().to_string();

        // A newer copy of the same file (same name) is another version of its artifact, not a second artifact.
        let b = dir.join("newer").join(a.file_name().unwrap());
        std::fs::create_dir_all(b.parent().unwrap()).unwrap();
        std::fs::write(&b, "one\ntwo\nthree\n").unwrap();
        let again = tauri::async_runtime::block_on(add_file_artifact(p.clone(), b.to_string_lossy().into())).unwrap();
        assert_eq!(again["name"].as_str(), Some(name.as_str()));
        let v2 = again["version"].as_str().unwrap().to_string();
        assert_ne!(v1, v2);
        assert_eq!(read_project(&dir)["artifacts"].as_array().unwrap().len(), 1);

        let artifact = read_project(&dir)["artifacts"][0].clone();
        let out = tauri::async_runtime::block_on(artifact_diff(p.clone(), artifact.clone(), v1.clone(), v2.clone(), None)).unwrap();
        assert_eq!(out["kind"], "unified");
        assert!(out["text"].as_str().unwrap().contains("+three"));
        // Named after the artifact, not by where the two copies are.
        assert!(out["text"].as_str().unwrap().contains(&format!("--- a/{name}\n+++ b/{name}\n")));

        // Across artifacts: v1 of the first against another file artifact's version.
        let c = dir.join("other.txt");
        std::fs::write(&c, "one\nfour\n").unwrap();
        let other = tauri::async_runtime::block_on(add_file_artifact(p.clone(), c.to_string_lossy().into())).unwrap();
        let arts = read_project(&dir)["artifacts"].clone();
        let other_version = other["version"].as_str().unwrap().to_string();
        let across = tauri::async_runtime::block_on(artifact_diff(p.clone(), arts[1].clone(), v1.clone(), other_version, Some(arts[0].clone()))).unwrap();
        assert!(across["text"].as_str().unwrap().contains("+four"));
        // A git repository against another artifact is refused, not guessed at.
        let git_like = json!({ "name": "g", "kind": "git", "repo": "artifacts/g" });
        assert!(pair_paths(&dir, &git_like, Some(&arts[0]), &v1, "HEAD").is_err());

        // Removing an artifact drops it and its copies, nothing else.
        remove_artifact(p.clone(), name.clone()).unwrap();
        assert_eq!(read_project(&dir)["artifacts"].as_array().unwrap().len(), 1);
        assert!(!dir.join("artifacts").join(&name).exists());
        assert!(remove_artifact(p.clone(), name.clone()).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
        let _ = std::fs::remove_file(&a);
    }
}
