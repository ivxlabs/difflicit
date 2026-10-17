// SPDX-License-Identifier: GPL-3.0-only
//! What the app shows for a file picked in a project's sidebar tree, and the project's notes: reading, creating
//! and saving them (users write notes themselves, block by block in the app or in their own editor; Analyze
//! prepares one for each change it analyzes).
//!
//! **Notes** are Markdown — ideally **diffmd**: Markdown whose ```diff / ```patch fences hold patch diffs, which
//! the app renders with its diff viewer (the splitting happens in the web app, so GitHub-rendered READMEs get
//! the same treatment). The project file names its notes with `"notes"`; without one, README.diffmd, then
//! README.md.

use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::diff::{init_project_at, installed, is_binary_file, list_dir, read_project, run, safe_name, write_project};

/// Text shown in full up to this size; bigger files are cut (the info header says so).
const MAX_TEXT: u64 = 512 * 1024;

/// Markdown (CommonMark + GitHub extensions) to HTML. The web app sanitizes it before showing it.
pub fn markdown_html(text: &str) -> String {
    let mut html = String::new();
    pulldown_cmark::html::push_html(&mut html, pulldown_cmark::Parser::new_ext(text, pulldown_cmark::Options::all()));
    html
}

/// `rel` resolved inside `dir`, refusing anything that escapes it (`..`, absolute paths, symlinks out).
fn inside(dir: &Path, rel: &str) -> Result<PathBuf, String> {
    let root = dir.canonicalize().map_err(|e| e.to_string())?;
    let path = root.join(rel).canonicalize().map_err(|_| format!("{rel} doesn't exist."))?;
    if path.starts_with(&root) { Ok(path) } else { Err(format!("{rel} is outside the project.")) }
}

/// The project's notes file (relative path), if any: the project file's `notes`, else README.diffmd/README.md.
pub fn notes_path(dir: &Path) -> Option<String> {
    if let Some(rel) = read_project(dir).get("notes").and_then(Value::as_str).filter(|rel| inside(dir, rel).is_ok_and(|p| p.is_file())) {
        return Some(rel.to_string());
    }
    let names: Vec<String> = std::fs::read_dir(dir).ok()?.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    ["README.diffmd", "README.md"]
        .iter()
        .find_map(|want| names.iter().find(|n| n.eq_ignore_ascii_case(want)).cloned())
}

/// The project's notes rendered to HTML, with the file they came from.
pub fn notes(dir: &Path) -> (Option<String>, Option<String>) {
    let rel = notes_path(dir);
    let html = rel.as_deref().and_then(|r| std::fs::read_to_string(dir.join(r)).ok()).map(|t| markdown_html(&t));
    (rel, html)
}

fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

/// A binary's format from its magic bytes.
fn binary_format(path: &Path) -> &'static str {
    use std::io::Read;
    let mut head = [0u8; 8];
    let n = std::fs::File::open(path).and_then(|mut f| f.read(&mut head)).unwrap_or(0);
    match &head[..n.min(8)] {
        [0xcf, 0xfa, 0xed, 0xfe, ..] => "Mach-O 64-bit",
        [0xce, 0xfa, 0xed, 0xfe, ..] => "Mach-O 32-bit",
        [0xca, 0xfe, 0xba, 0xbe, ..] => "Mach-O universal (fat)",
        [0x7f, b'E', b'L', b'F', ..] => "ELF",
        [b'M', b'Z', ..] => "PE (Windows)",
        h if h.starts_with(b"dyld_v1") => "dyld shared cache",
        _ => "Binary data",
    }
}

/// rabin2 (radare2) as JSON, or null if it isn't installed or can't read the file.
fn rabin2_json(flag: &str, path: &str) -> Value {
    run("rabin2", &[flag, path], "").ok().and_then(|out| serde_json::from_str(&out).ok()).unwrap_or(Value::Null)
}

/// A binary's details from rabin2: summary, linked libraries, sections, and headers/load commands.
fn binary_details(path: &Path) -> Value {
    if !installed("rabin2") {
        return Value::Null;
    }
    let p = path.to_string_lossy();
    // `rabin2 -H` lists headers and load commands one per line: "<vaddr> <paddr> <size> <name>; <format>".
    let headers: Vec<Value> = run("rabin2", &["-H", &p], "")
        .unwrap_or_default()
        .lines()
        .filter_map(|line| {
            let mut cols = line.splitn(4, ' ');
            let (_vaddr, offset, _size, rest) = (cols.next()?, cols.next()?, cols.next()?, cols.next()?);
            let (name, format) = rest.split_once("; ").unwrap_or((rest, ""));
            Some(json!({ "offset": offset, "name": name, "format": format }))
        })
        .collect();
    json!({
        "info": rabin2_json("-Ij", &p).get("info").cloned().unwrap_or(Value::Null),
        "libs": rabin2_json("-lj", &p).get("libs").cloned().unwrap_or(json!([])),
        "sections": rabin2_json("-Sj", &p).get("sections").cloned().unwrap_or(json!([])),
        "headers": headers,
    })
}

/// What to show for a file or folder in a project, by kind: `dir`, `project` (the project file), `notes`
/// (Markdown/diffmd, rendered), `patch` (a unified diff), `binary` (format + rabin2 details) or `text`.
#[tauri::command]
pub async fn file_info(project: String, path: String) -> Result<Value, String> {
    let dir = PathBuf::from(&project);
    let abs = inside(&dir, &path)?;
    let meta = std::fs::metadata(&abs).map_err(|e| e.to_string())?;
    let modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64);
    let name = abs.file_name().and_then(|n| n.to_str()).unwrap_or(&path).to_string();
    let mut out = json!({ "path": path, "name": name, "size": meta.len(), "modified": modified });

    let ext = extension(&abs);
    let (kind, extra) = if meta.is_dir() {
        ("dir", json!({ "entries": list_dir(abs.to_string_lossy().into_owned())? }))
    } else if path == "difflicit.json" || path == "analysis.json" {
        ("project", json!({ "json": read_project(&dir), "notes": notes_path(&dir) }))
    } else if is_binary_file(&abs) {
        ("binary", json!({ "format": binary_format(&abs), "binary": binary_details(&abs) }))
    } else {
        let truncated = meta.len() > MAX_TEXT;
        let bytes = std::fs::read(&abs).map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_TEXT as usize)]).into_owned();
        match ext.as_str() {
            // The raw text too, for the editor.
            "diffmd" | "md" | "markdown" => ("notes", json!({ "html": markdown_html(&text), "text": text, "truncated": truncated })),
            "diff" | "patch" => ("patch", json!({ "text": text, "truncated": truncated })),
            _ => ("text", json!({ "text": text, "truncated": truncated })),
        }
    };
    out["kind"] = json!(kind);
    if let (Some(o), Some(e)) = (out.as_object_mut(), extra.as_object()) {
        o.extend(e.clone());
    }
    Ok(out)
}

/// Markdown to HTML, for the note editor's preview (rendered exactly like saved notes).
#[tauri::command]
pub fn render_markdown(text: String) -> String {
    markdown_html(&text)
}

/// Start a note: write `<name>.diffmd` at the project's root and return its path. A note the user names starts
/// from a short template (README.diffmd without a name); one Analyze prepared comes with its `text`, and gets a
/// free name (`-2`, `-3`…) rather than replacing an earlier analysis. A project's first note becomes its notes
/// (the project file's `notes`).
#[tauri::command]
pub fn create_note(project: String, name: Option<String>, text: Option<String>) -> Result<String, String> {
    let dir = PathBuf::from(&project);
    init_project_at(&dir)?;
    let title = name.as_deref().map(str::trim).filter(|n| !n.is_empty());
    let stem = match title {
        Some(t) => safe_name(&t.replace(' ', "-")).ok_or("A note's name can use letters, digits, spaces, - and _.")?,
        None => "README".into(),
    };
    let mut rel = format!("{stem}.diffmd");
    if text.is_some() {
        let mut n = 1;
        while dir.join(&rel).exists() {
            n += 1;
            rel = format!("{stem}-{n}.diffmd");
        }
    } else if dir.join(&rel).exists() {
        return Err(format!("{rel} already exists."));
    }
    let first = notes_path(&dir).is_none();
    let mut body = read_project(&dir);
    let text = text.unwrap_or_else(|| {
        let heading = title.or_else(|| body.get("project").and_then(Value::as_str)).unwrap_or("Notes");
        format!(
            "# {heading}\n\nWhat changed, and why it matters. Patches go in `diff` blocks, shown as diffs:\n\n\
             ```diff\n--- a/example.c\n+++ b/example.c\n@@ -1,3 +1,3 @@\n int check(size_t n) {{\n-    return n < LIMIT;\n+    return n <= LIMIT;\n }}\n```\n"
        )
    });
    std::fs::write(dir.join(&rel), text).map_err(|e| e.to_string())?;
    if first {
        body["notes"] = json!(rel);
        write_project(&dir, &body)?;
    }
    Ok(rel)
}

/// Save a note written in the app: a .diffmd or Markdown file already in the project.
#[tauri::command]
pub fn write_note(project: String, path: String, text: String) -> Result<(), String> {
    let file = inside(Path::new(&project), &path)?;
    if !matches!(extension(&file).as_str(), "diffmd" | "md" | "markdown") {
        return Err("Only notes (.diffmd or .md files) can be edited here.".into());
    }
    std::fs::write(&file, text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diff::scratch;

    #[test]
    fn notes_and_info() {
        let dir = scratch("info");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("README.md"), "# Old").unwrap();
        std::fs::write(dir.join("README.diffmd"), "# Notes\n\n```diff\n-a\n+b\n```\n").unwrap();
        // README.diffmd wins over README.md; a `notes` link wins over both.
        assert_eq!(notes_path(&dir).as_deref(), Some("README.diffmd"));
        std::fs::write(dir.join("difflicit.json"), r#"{"project":"t","notes":"README.md"}"#).unwrap();
        assert_eq!(notes_path(&dir).as_deref(), Some("README.md"));

        let info = |path: &str| tauri::async_runtime::block_on(file_info(dir.to_string_lossy().into(), path.into()));
        let notes = info("README.diffmd").unwrap();
        assert_eq!(notes["kind"], "notes");
        assert!(notes["html"].as_str().unwrap().contains("language-diff"));
        assert_eq!(info("difflicit.json").unwrap()["kind"], "project");
        assert_eq!(info("sub").unwrap()["kind"], "dir");
        std::fs::write(dir.join("blob"), [0xcfu8, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]).unwrap();
        let blob = info("blob").unwrap();
        assert_eq!((blob["kind"].as_str(), blob["format"].as_str()), (Some("binary"), Some("Mach-O 64-bit")));
        // Nothing outside the project.
        assert!(info("../").is_err());

        // Writing notes: a new one is linked only when it's the project's first; only notes can be saved.
        let fresh = scratch("notes");
        std::fs::create_dir_all(&fresh).unwrap();
        let p = || fresh.to_string_lossy().into_owned();
        assert_eq!(create_note(p(), Some("root cause".into()), None).unwrap(), "root-cause.diffmd");
        assert_eq!(read_project(&fresh)["notes"], "root-cause.diffmd");
        assert_eq!(create_note(p(), None, None).unwrap(), "README.diffmd");
        assert_eq!(read_project(&fresh)["notes"], "root-cause.diffmd");
        assert!(create_note(p(), None, None).is_err()); // exists
        assert!(create_note(p(), Some("../x".into()), None).is_err());
        // Analyze's notes never replace an earlier one.
        assert_eq!(create_note(p(), Some("README".into()), Some("# A".into())).unwrap(), "README-2.diffmd");
        assert_eq!(std::fs::read_to_string(fresh.join("README-2.diffmd")).unwrap(), "# A");
        write_note(p(), "README.diffmd".into(), "# Edited".into()).unwrap();
        assert_eq!(std::fs::read_to_string(fresh.join("README.diffmd")).unwrap(), "# Edited");
        assert!(write_note(p(), "difflicit.json".into(), "{}".into()).is_err());
        let _ = std::fs::remove_dir_all(&fresh);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
