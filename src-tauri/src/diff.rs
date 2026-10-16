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

fn run(program: &str, args: &[&str], hint: &str) -> Result<String, String> {
    run_ok(program, args, &[], hint)
}

fn installed(program: &str) -> bool {
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

#[cfg(test)]
fn unique_tmp(tag: &str) -> PathBuf {
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    std::env::temp_dir().join(format!("difflicit-{tag}-{}-{n}", std::process::id()))
}

/// Which diff engines are usable here: git, and radiff2 + r2 for binaries.
#[tauri::command]
pub fn diff_tools() -> Value {
    json!({ "git": installed("git"), "binary": installed("radiff2") && installed("r2") })
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
pub fn git_versions(project: String, repo: String) -> Result<Value, String> {
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
fn safe_name(name: &str) -> Option<String> {
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

fn read_project(dir: &Path) -> Value {
    std::fs::read_to_string(project_file(dir))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(Value::Null)
}

/// Write the project file (always difflicit.json for projects this app manages).
fn write_project(dir: &Path, body: &Value) -> Result<(), String> {
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

/// Add a file or folder as a new artifact (its first version). Returns { name, version }.
#[tauri::command]
pub fn add_file_artifact(project: String, path: String) -> Result<Value, String> {
    let dir = PathBuf::from(&project);
    init_project_at(&dir)?;
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("{path} doesn't exist."));
    }
    let mut body = read_project(&dir);
    let base = safe_name(basename(&path)).ok_or_else(|| format!("Couldn't name an artifact from {path:?}."))?;
    let name = unique_name(&body, &base);
    let version = base.clone();
    let rel = copy_in(&dir, &name, &version, &src)?;
    append_artifact(&mut body, json!({ "name": name, "kind": "file", "versions": [{ "id": version, "path": rel }] }));
    write_project(&dir, &body)?;
    Ok(json!({ "name": name, "version": version }))
}

/// Add another version (a file or folder) to an existing file artifact. Returns the version id.
#[tauri::command]
pub fn add_file_version(project: String, artifact: String, path: String) -> Result<String, String> {
    let dir = PathBuf::from(&project);
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("{path} doesn't exist."));
    }
    let mut body = read_project(&dir);
    let base = safe_name(basename(&path)).ok_or_else(|| format!("Couldn't name a version from {path:?}."))?;
    let arts = body.get_mut("artifacts").and_then(Value::as_array_mut).ok_or("no artifacts")?;
    let a = arts.iter_mut().find(|a| artifact_name(a) == artifact).ok_or_else(|| format!("No artifact {artifact:?}."))?;
    let versions = a.get("versions").and_then(Value::as_array).cloned().unwrap_or_default();
    let taken: Vec<String> = versions.iter().filter_map(|v| v.get("id").and_then(Value::as_str).map(str::to_string)).collect();
    let mut version = base.clone();
    for i in 2.. {
        if !taken.contains(&version) {
            break;
        }
        version = format!("{base}-{i}");
    }
    let rel = copy_in(&dir, &artifact, &version, &src)?;
    a["versions"].as_array_mut().unwrap().push(json!({ "id": version, "path": rel }));
    write_project(&dir, &body)?;
    Ok(version)
}

fn init_project_at(dir: &Path) -> Result<(), String> {
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

fn resolve(dir: &Path, p: &str) -> PathBuf {
    let p = PathBuf::from(p);
    if p.is_absolute() { p } else { dir.join(p) }
}

/// The path of a file artifact's version.
fn version_path(dir: &Path, artifact: &Value, id: &str) -> Result<PathBuf, String> {
    artifact
        .get("versions")
        .and_then(Value::as_array)
        .and_then(|vs| vs.iter().find(|v| v.get("id").and_then(Value::as_str) == Some(id)))
        .and_then(|v| v.get("path").and_then(Value::as_str))
        .map(|p| resolve(dir, p))
        .ok_or_else(|| format!("No version {id:?}."))
}

fn is_binary_file(path: &Path) -> bool {
    path.is_file() && std::fs::read(path).ok().map(|b| b[..b.len().min(8192)].contains(&0)).unwrap_or(false)
}

fn no_index(a: &Path, b: &Path) -> Result<String, String> {
    run_ok(
        "git",
        &["diff", "--no-color", "--no-index", "--", a.to_str().ok_or("bad path")?, b.to_str().ok_or("bad path")?],
        &[1],
        "Install Git and try again.",
    )
}

/// The diff between two versions (`base`, `head`) of an artifact, as unified-diff text or a binary function table.
#[tauri::command]
pub fn artifact_diff(project: String, artifact: Value, base: String, head: String) -> Result<Value, String> {
    let dir = PathBuf::from(&project);
    if artifact.get("kind").and_then(Value::as_str) == Some("git") {
        let repo = resolve(&dir, artifact.get("repo").and_then(Value::as_str).unwrap_or(""));
        let text = git(&repo, &["diff", "--no-color", safe_ref(&base)?, safe_ref(&head)?, "--"])?;
        return Ok(json!({ "kind": "unified", "text": text }));
    }
    let b = version_path(&dir, &artifact, &base)?;
    let h = version_path(&dir, &artifact, &head)?;
    if is_binary_file(&b) && is_binary_file(&h) {
        return Ok(json!({ "kind": "binary", "functions": radiff(&b, &h)? }));
    }
    Ok(json!({ "kind": "unified", "text": no_index(&b, &h)? }))
}

// ── Binaries (radare2) ───────────────────────────────────────────────────────

const RADARE_HINT: &str = "Install radare2 (radiff2 and r2) for binary diffing.";

fn radiff(base: &Path, head: &Path) -> Result<Vec<Value>, String> {
    let (b, h) = (base.to_str().ok_or("bad path")?, head.to_str().ok_or("bad path")?);
    let out = run("radiff2", &["-A", "-C", "-j", b, h], RADARE_HINT)?;
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
pub fn artifact_function_diff(project: String, artifact: Value, base: String, head: String, name: String, base_addr: Option<String>, head_addr: Option<String>) -> Result<String, String> {
    let dir = PathBuf::from(&project);
    let b = version_path(&dir, &artifact, &base)?;
    let h = version_path(&dir, &artifact, &head)?;
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
    fn file_artifact_and_diff() {
        let dir = unique_tmp("proj");
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.to_string_lossy().to_string();
        init_project(p.clone()).unwrap();

        let a = unique_tmp("v").with_extension("txt");
        std::fs::write(&a, "one\ntwo\n").unwrap();
        let added = add_file_artifact(p.clone(), a.to_string_lossy().into()).unwrap();
        let name = added["name"].as_str().unwrap().to_string();
        let v1 = added["version"].as_str().unwrap().to_string();

        let b = dir.join("newer.txt");
        std::fs::write(&b, "one\ntwo\nthree\n").unwrap();
        let v2 = add_file_version(p.clone(), name.clone(), b.to_string_lossy().into()).unwrap();

        let artifact = read_project(&dir)["artifacts"][0].clone();
        let out = artifact_diff(p, artifact, v1, v2).unwrap();
        assert_eq!(out["kind"], "unified");
        assert!(out["text"].as_str().unwrap().contains("+three"));
        std::fs::remove_dir_all(&dir).unwrap();
        let _ = std::fs::remove_file(&a);
    }
}
