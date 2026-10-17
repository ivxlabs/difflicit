// SPDX-License-Identifier: GPL-3.0-only
//! Analysis engines: command-line tools that analyze the change between two artifacts and write it up as diffmd.
//! People use them on their own (`viper before after`) or through Difflicit, which finds them on the PATH and
//! runs them as separate processes:
//!
//! - `<engine> --about` prints what it is, as JSON (name, version, license, protocol…);
//! - `<engine> --difflicit` reads one JSON request on stdin (the two sides, where their files are, and the diff
//!   Difflicit made of them) and writes the analysis, as diffmd, to stdout. Anything on stderr is its log; a
//!   non-zero exit is a failure, explained by the end of stderr.
//!
//! So an engine can be written in any language and released under any license — or be a client for a service
//! that does the analysis. Installing one is the user's business (`brew install …`). Protocol:
//! https://ivx.run/docs/difflicit/engines/

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;

use crate::diff::{artifact_diff, resolve, version_path};

/// The request format engines are given; an engine says which it speaks in `--about`.
const PROTOCOL: u64 = 1;
/// How long `--about` may take, and an analysis.
const ABOUT_TIMEOUT: Duration = Duration::from_secs(10);
const TIMEOUT: Duration = Duration::from_secs(60 * 60);

/// Where a command is: a path as given, or the first match on the PATH.
fn find(command: &str) -> Option<PathBuf> {
    if command.contains('/') || command.contains('\\') {
        let p = PathBuf::from(command);
        return p.is_file().then_some(p);
    }
    let exe = if cfg!(windows) { format!("{command}.exe") } else { command.to_string() };
    std::env::split_paths(&std::env::var_os("PATH")?).map(|d| d.join(&exe)).find(|p| p.is_file())
}

/// Run `program args` with `input` on stdin, up to `timeout`; its stdout, or why it failed (the end of stderr).
async fn run(name: &str, program: &Path, args: &[&str], input: Option<String>, timeout: Duration) -> Result<String, String> {
    let mut child = tokio::process::Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Couldn't start {name} ({}): {e}", program.display()))?;
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    // Written while the engine runs, so a big request can't fill the pipe and stall both sides; dropped (closed)
    // when written, so the engine sees the end of it.
    let writer = tokio::spawn(async move {
        if let Some(input) = input {
            let _ = stdin.write_all(input.as_bytes()).await;
        }
    });
    let out = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| format!("{name} took too long; it was stopped."))?
        .map_err(|e| e.to_string())?;
    let _ = writer.await;
    if !out.status.success() {
        let log = String::from_utf8_lossy(&out.stderr);
        let tail: Vec<&str> = log.lines().rev().filter(|l| !l.trim().is_empty()).take(5).collect();
        let why = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
        return Err(format!("{name} failed{}", if why.is_empty() { ".".into() } else { format!(": {why}") }));
    }
    String::from_utf8(out.stdout).map_err(|_| format!("{name} wrote something other than UTF-8 text."))
}

/// What `command` is as an engine: its `--about`, with where it is.
async fn about(command: &str) -> Result<Value, String> {
    let program = find(command).ok_or_else(|| format!("{command} isn't installed."))?;
    let text = run(command, &program, &["--about"], None, ABOUT_TIMEOUT).await?;
    let mut about: Value = serde_json::from_str(text.trim()).map_err(|_| format!("{command} --about didn't print an engine's JSON."))?;
    if about.get("name").and_then(Value::as_str).is_none_or(str::is_empty) {
        return Err(format!("{command} --about has no \"name\"."));
    }
    let protocol = about.get("protocol").and_then(Value::as_u64).unwrap_or(0);
    if protocol != PROTOCOL {
        return Err(format!("{command} speaks engine protocol {protocol}; this Difflicit speaks {PROTOCOL}. Update one of them."));
    }
    about["path"] = json!(program.to_string_lossy());
    Ok(about)
}

/// Each command as an engine: `installed` with its `--about`, not installed, or installed but unusable
/// (`problem`). Commands are names on the PATH (`viper`) or paths.
#[tauri::command]
pub async fn list_engines(commands: Vec<String>) -> Vec<Value> {
    let mut out = Vec::new();
    for command in commands {
        out.push(match about(&command).await {
            Ok(mut a) => {
                a["command"] = json!(command);
                a["installed"] = json!(true);
                a
            }
            Err(_) if find(&command).is_none() => json!({ "command": command, "name": command, "installed": false }),
            Err(problem) => json!({ "command": command, "name": command, "installed": true, "problem": problem }),
        });
    }
    out
}

/// One side of the comparison as engines see it: the artifact, its kind and version, and where its files are
/// (a file artifact's copy of that version; a git artifact's repository, at that ref).
fn side(dir: &Path, artifact: &Value, version: &str) -> Result<Value, String> {
    let name = artifact.get("name").and_then(Value::as_str).unwrap_or("");
    Ok(if artifact.get("kind").and_then(Value::as_str) == Some("git") {
        let repo = resolve(dir, artifact.get("repo").and_then(Value::as_str).unwrap_or(""));
        json!({ "artifact": name, "kind": "git", "version": version, "repo": repo.to_string_lossy() })
    } else {
        json!({ "artifact": name, "kind": "file", "version": version, "path": version_path(dir, artifact, version)?.to_string_lossy() })
    })
}

/// Analyze `base` (of `base_artifact`, else of `artifact`) → `head` with the engine `command`; returns its diffmd.
#[tauri::command]
pub async fn run_engine(command: String, project: String, artifact: Value, base: String, head: String, base_artifact: Option<Value>) -> Result<String, String> {
    let engine = about(&command).await?;
    let name = engine["name"].as_str().unwrap_or(&command).to_string();
    let dir = PathBuf::from(&project);
    let request = json!({
        "protocol": PROTOCOL,
        "project": project,
        "before": side(&dir, base_artifact.as_ref().unwrap_or(&artifact), &base)?,
        "after": side(&dir, &artifact, &head)?,
        // Difflicit's own diff of the two, so an engine can build on it: unified text, or a binary's functions.
        "diff": artifact_diff(project.clone(), artifact.clone(), base.clone(), head.clone(), base_artifact.clone()).await?,
    });
    let program = PathBuf::from(engine["path"].as_str().unwrap_or_default());
    let diffmd = run(&name, &program, &["--difflicit"], Some(request.to_string()), TIMEOUT).await?;
    if diffmd.trim().is_empty() {
        return Err(format!("{name} wrote no analysis."));
    }
    Ok(diffmd)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::diff::scratch;
    use std::os::unix::fs::PermissionsExt;
    use tauri::async_runtime::block_on;

    /// A script engine at a path: `--about` prints `about`, `--difflicit` runs `body` (sh).
    fn engine(dir: &Path, about: &str, body: &str) -> String {
        std::fs::create_dir_all(dir).unwrap();
        let script = dir.join("engine");
        std::fs::write(&script, format!("#!/bin/sh\nif [ \"$1\" = --about ]; then echo '{about}'; exit 0; fi\n{body}\n")).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script.to_string_lossy().into_owned()
    }

    #[test]
    fn lists_engines() {
        let dir = scratch("engines");
        let good = engine(&dir.join("good"), r#"{"name":"Echo","version":"1.0","license":"MIT","protocol":1}"#, "");
        let old = engine(&dir.join("old"), r#"{"name":"Old","protocol":9}"#, "");
        let listed = block_on(list_engines(vec![good.clone(), old, "no-such-engine-anywhere".into()]));
        assert_eq!((listed[0]["name"].as_str(), listed[0]["installed"].as_bool()), (Some("Echo"), Some(true)));
        assert_eq!(listed[0]["command"], good);
        assert!(listed[1]["problem"].as_str().unwrap().contains("protocol 9"));
        assert_eq!(listed[2]["installed"], false);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn runs_an_engine() {
        // A project with a file artifact in two versions.
        let project = scratch("engine-project");
        std::fs::create_dir_all(&project).unwrap();
        let p = project.to_string_lossy().into_owned();
        crate::diff::init_project(p.clone()).unwrap();
        let (a, b) = (project.join("in/a/lib.c"), project.join("in/b/lib.c"));
        for (f, text) in [(&a, "int x = 1;\n"), (&b, "int x = 2;\n")] {
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, text).unwrap();
        }
        let v1 = block_on(crate::diff::add_file_artifact(p.clone(), a.to_string_lossy().into())).unwrap()["version"].as_str().unwrap().to_string();
        let v2 = block_on(crate::diff::add_file_artifact(p.clone(), b.to_string_lossy().into())).unwrap()["version"].as_str().unwrap().to_string();
        let artifact = crate::diff::read_project(&project)["artifacts"][0].clone();

        // An engine that echoes what it was asked, as diffmd; then one that fails.
        let dir = scratch("engine-bin");
        let about = r#"{"name":"Echo","protocol":1}"#;
        let echo = engine(&dir, about, "read -r req\necho '# Analysis'\necho \"$req\" | grep -q '\"protocol\":1' && echo ok\necho \"$req\" | grep -q '+int x = 2' && echo diff");
        let out = block_on(run_engine(echo, p.clone(), artifact.clone(), v1.clone(), v2.clone(), None)).unwrap();
        assert_eq!(out, "# Analysis\nok\ndiff\n");
        let failing = engine(&dir, about, "echo 'no licence key' >&2\nexit 3");
        let err = block_on(run_engine(failing, p, artifact, v1, v2, None)).unwrap_err();
        assert_eq!(err, "Echo failed: no licence key");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&project);
    }
}
