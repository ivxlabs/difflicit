// SPDX-License-Identifier: GPL-3.0-only
//! Difflicit desktop: the same web app, in a native window. Local capabilities (files, git, analysis tools)
//! are added here as Tauri commands.
//!
//! Without a catalog (difflicit.config.json), the app lists the user's own projects: the folders in ~/Difflicit
//! with an analysis.json, plus any the user opened elsewhere (`local_projects`). An analysis folder is read
//! straight from disk (`local_analysis`).
//!
//! The website hands analyses over with `difflicit://analyze?project=…&repo=owner/name` links; the deep-link
//! plugin passes them to the web app, which asks before calling `analyze_locally`.

mod diff;
mod engines;
mod info;
mod oauth;
mod vnc;

use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// The app's home: ~/Difflicit.
fn home(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().home_dir().map_err(|e| e.to_string())?.join("Difflicit"))
}

/// Where a cloned analysis lives: ~/Difflicit/<owner>/<repo>.
fn workspace(app: &AppHandle, owner: &str, name: &str) -> Result<PathBuf, String> {
    Ok(home(app)?.join(owner).join(name))
}

/// The project id of a Difflicit project folder: its project file's `project`, else the folder name.
fn analysis_of(dir: &Path) -> Option<String> {
    let file = diff::read_project(dir);
    if !file.is_object() {
        return None;
    }
    file.get("project")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .or_else(|| dir.file_name().and_then(|n| n.to_str()).map(str::to_string))
}

/// A project file field (e.g. artifacts), or null.
fn analysis_field(dir: &Path, key: &str) -> Value {
    diff::read_project(dir).get(key).cloned().unwrap_or(Value::Null)
}

fn subdirs(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .map(|entries| entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
        .unwrap_or_default()
}

/// The analyses on this computer: folders with an analysis.json in ~/Difflicit, either cloned ones
/// (<owner>/<repo>) or made by hand (<name>), and the folders the user opened elsewhere (`opened`). Each is
/// { project, path, folder (the path to show, with ~ for home), modified (ms since 1970) }.
#[tauri::command]
fn local_projects(app: AppHandle, opened: Vec<String>) -> Result<Vec<Value>, String> {
    let user_home = app.path().home_dir().map_err(|e| e.to_string())?;
    let mut dirs: Vec<PathBuf> = Vec::new();
    for dir in subdirs(&home(&app)?) {
        if analysis_of(&dir).is_some() { dirs.push(dir) } else { dirs.extend(subdirs(&dir)) }
    }
    dirs.extend(opened.iter().map(PathBuf::from));
    dirs.sort();
    dirs.dedup();
    let mut found = Vec::new();
    for dir in dirs {
        let Some(project) = analysis_of(&dir) else { continue };
        let modified = std::fs::metadata(dir.join("analysis.json"))
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);
        let folder = match dir.strip_prefix(&user_home) {
            Ok(rest) => format!("~/{}", rest.to_string_lossy().replace('\\', "/")),
            Err(_) => dir.to_string_lossy().into_owned(),
        };
        found.push(json!({ "project": project, "path": dir.to_string_lossy(), "folder": folder, "modified": modified }));
    }
    Ok(found)
}

const MAX_PATCHES: usize = 30;
const MAX_PATCH_BYTES: u64 = 2_000_000;

/// The project's own patches (*.diff / *.patch) and notes (*.diffmd) under `dir`, as relative paths, sorted.
/// Skips .git and other hidden folders, and `artifacts/`: what's compared, not the project's own files.
#[derive(Default)]
struct ProjectFiles {
    patches: Vec<PathBuf>,
    notes: Vec<PathBuf>,
}

fn project_files(dir: &Path, rel: &Path, out: &mut ProjectFiles) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let path = entry.path();
        if name.starts_with('.') || name == "node_modules" || (rel.as_os_str().is_empty() && name == "artifacts") {
            continue;
        }
        let lower = name.to_ascii_lowercase();
        if path.is_dir() {
            project_files(&path, &rel.join(&*name), out);
        } else if lower.ends_with(".diffmd") {
            out.notes.push(rel.join(&*name));
        } else if (lower.ends_with(".diff") || lower.ends_with(".patch")) && entry.metadata().is_ok_and(|m| m.len() < MAX_PATCH_BYTES) {
            out.patches.push(rel.join(&*name));
        }
    }
}

/// A project folder as the app shows it: the project its project file names (null without one), its notes
/// rendered to HTML (sanitized by the app) with their path, every note in it (*.diffmd), and the text of each
/// patch, like the GitHub version.
#[tauri::command]
async fn local_analysis(path: String) -> Result<Value, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("{path} isn't a folder (anymore)."));
    }
    let (notes_path, notes_html) = info::notes(&dir);
    let mut found = ProjectFiles::default();
    project_files(&dir, Path::new(""), &mut found);
    let slashed = |rel: &PathBuf| rel.to_string_lossy().replace('\\', "/");
    let patches: Vec<Value> = found
        .patches
        .iter()
        .take(MAX_PATCHES)
        .filter_map(|rel| {
            let text = std::fs::read_to_string(dir.join(rel)).ok()?;
            Some(json!({ "path": slashed(rel), "text": text }))
        })
        .collect();
    Ok(json!({
        "project": analysis_of(&dir),
        "artifacts": analysis_field(&dir, "artifacts"),
        "notes_path": notes_path,
        "notes_html": notes_html,
        "notes_files": found.notes.iter().map(slashed).collect::<Vec<_>>(),
        "patches": patches,
    }))
}

/// GitHub's own rules, so a link can't smuggle a path (`..`) or a git option (`-…`) into the clone.
fn valid_repo(full_name: &str) -> Option<(&str, &str)> {
    let (owner, name) = full_name.split_once('/')?;
    let owner_ok = !owner.is_empty() && !owner.starts_with('-') && owner.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    let name_ok = !name.is_empty()
        && !name.starts_with(['-', '.'])
        && name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    (owner_ok && name_ok).then_some((owner, name))
}

fn git(args: &[&str]) -> Result<(), String> {
    let out = Command::new("git")
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0") // no window to type a password into; fail instead of hanging
        .output()
        .map_err(|e| format!("Couldn't run git ({e}). Install Git and try again."))?;
    if out.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let last = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("git failed").trim();
    Err(last.trim_start_matches("fatal: ").to_string())
}

/// Clone `owner/name` from GitHub into the workspace (or fetch it, if it's already there) and open the folder.
/// Private repositories use the credentials git already has for github.com. Returns the folder's path.
#[tauri::command]
async fn analyze_locally(app: AppHandle, repo: String) -> Result<String, String> {
    let (owner, name) = valid_repo(&repo).ok_or_else(|| format!("{repo} isn't a GitHub repository name."))?;
    let dir = workspace(&app, owner, name)?;
    let path = dir.to_string_lossy().into_owned();
    let url = format!("https://github.com/{owner}/{name}.git");
    let target = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if dir.join(".git").exists() {
            // Never touch the user's working tree; just bring the remote branches up to date.
            git(&["-C", &target, "fetch", "--quiet", "origin"])
        } else {
            std::fs::create_dir_all(dir.parent().unwrap()).map_err(|e| e.to_string())?;
            // GitHub answers "not found" for private repositories git has no credentials for, too.
            git(&["clone", "--quiet", &url, &target]).map_err(|e| {
                format!("{e}. If the repository is private, sign git in to GitHub first (e.g. `gh auth login`).")
            })
        }
    })
    .await
    .map_err(|e| e.to_string())??;
    app.opener().open_path(&path, None::<&str>).map_err(|e| e.to_string())?;
    Ok(path)
}

/// The tools Difflicit runs (git, radare2, ipsw, analysis engines) are usually installed with Homebrew or Cargo.
/// An app opened from the Dock or Finder doesn't get the shell's PATH, which has their folders; this adds them.
fn with_tool_folders_on_path() {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let extra = [
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/home/linuxbrew/.linuxbrew/bin"),
        home.join(".cargo/bin"),
        home.join(".local/bin"),
    ];
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    for dir in extra {
        if dir.is_dir() && !paths.contains(&dir) {
            paths.push(dir);
        }
    }
    if let Ok(joined) = std::env::join_paths(paths) {
        // SAFETY: called first thing in run(), before any other thread exists to read the environment.
        unsafe { std::env::set_var("PATH", joined) };
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    with_tool_folders_on_path();
    let mut builder = tauri::Builder::default();
    // Must come first: a link opened while the app runs starts a second copy (Windows, Linux), which hands the
    // link to this one (the deep-link feature) and quits.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Sign In with ivx: iam's GitHub proxy only allows the website's origin (CORS), so the desktop app calls
        // it natively through this plugin, which isn't subject to CORS (see src/iam/session.ts).
        .plugin(tauri_plugin_http::init())
        .setup(|_app| {
            // Installers register difflicit:// on Windows and Linux; this covers `tauri dev` and AppImages.
            // (macOS only knows the scheme from an installed app bundle.)
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                _app.deep_link().register_all()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            analyze_locally,
            local_projects,
            local_analysis,
            diff::init_project,
            diff::add_git_artifact,
            diff::add_file_artifact,
            diff::remove_artifact,
            diff::git_versions,
            diff::artifact_diff,
            diff::artifact_function_diff,
            diff::diff_tools,
            diff::installed_binaries,
            diff::dsc_caches,
            diff::dsc_images,
            diff::add_dsc_artifact,
            diff::extract_cache_from_ipsw,
            diff::download_ipsw,
            diff::dsc_diff,
            engines::list_engines,
            engines::run_engine,
            info::file_info,
            info::create_note,
            info::write_note,
            info::rename_note,
            info::render_markdown,
            diff::is_github,
            vnc::vnc_connect,
            oauth::oauth_callback,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Difflicit");
}

#[cfg(test)]
mod tests {
    use super::{analysis_of, local_analysis, valid_repo};
    use super::diff::init_project;

    #[test]
    fn repo_names() {
        assert_eq!(valid_repo("ivxlabs/CVE-2024-54494"), Some(("ivxlabs", "CVE-2024-54494")));
        assert_eq!(valid_repo("a-b/c_d.e"), Some(("a-b", "c_d.e")));
        for bad in ["", "ivxlabs", "/x", "x/", "../x", "x/..", "x/.git", "-x/y", "x/-y", "x/y/z", "x/y z", "x/y;rm"] {
            assert_eq!(valid_repo(bad), None, "{bad}");
        }
    }

    #[test]
    fn project_marker() {
        let dir = std::env::temp_dir().join(format!("difflicit-mark-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let name = dir.file_name().unwrap().to_str().unwrap().to_string();
        assert_eq!(analysis_of(&dir), None); // not a project yet
        // The project id is the file's `project`, else the folder name. Any marker makes it a project.
        for (text, want) in [
            (r#"{"project": "CVE-2024-54494"}"#, "CVE-2024-54494".to_string()),
            (r#"{"project": ""}"#, name.clone()),
            (r#"{"title": "x"}"#, name.clone()),
        ] {
            std::fs::write(dir.join("analysis.json"), text).unwrap();
            assert_eq!(analysis_of(&dir).as_deref(), Some(want.as_str()), "{text}");
        }
        std::fs::remove_file(dir.join("analysis.json")).unwrap();
        assert_eq!(analysis_of(&dir), None);
        init_project(dir.to_string_lossy().into()).unwrap();
        assert_eq!(analysis_of(&dir).as_deref(), Some(name.as_str())); // difflicit.json written, project = folder name
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn local_analyses() {
        let dir = std::env::temp_dir().join(format!("difflicit-local-{}", std::process::id()));
        let path = dir.to_string_lossy().to_string();
        std::fs::create_dir_all(dir.join("patches")).unwrap();
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        std::fs::write(dir.join("README.md"), "# Root cause\n\n| a | b |\n|---|---|\n| 1 | 2 |\n").unwrap();
        std::fs::write(dir.join("patches/fix.diff"), "--- a/x\n+++ b/x\n").unwrap();
        std::fs::write(dir.join(".git/ignored.diff"), "").unwrap();

        let a = tauri::async_runtime::block_on(local_analysis(path.clone())).unwrap();
        assert!(a["project"].is_null()); // no marker yet
        assert!(a["notes_html"].as_str().unwrap().contains("<h1>Root cause</h1>"));
        assert!(a["notes_html"].as_str().unwrap().contains("<table>"));
        assert_eq!(a["patches"].as_array().unwrap().len(), 1);
        assert_eq!(a["patches"][0]["path"], "patches/fix.diff");

        init_project(path.clone()).unwrap();
        assert!(analysis_of(&dir).is_some()); // now marked a project (project = folder name)
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
