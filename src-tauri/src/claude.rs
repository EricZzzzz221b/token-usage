use std::path::PathBuf;

#[cfg(target_os = "macos")]
use std::fs;

#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::process::Stdio;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeEnvironmentReport {
    pub desktop_installed: bool,
    pub desktop_running: bool,
    pub code_available: bool,
    pub task_source: &'static str,
    pub usage_status: &'static str,
}

pub fn inspect_environment() -> ClaudeEnvironmentReport {
    ClaudeEnvironmentReport {
        desktop_installed: desktop_installed(),
        desktop_running: desktop_running(),
        code_available: claude_projects_path().is_dir(),
        task_source: "local_claude_code_sessions",
        usage_status: "unavailable",
    }
}

fn claude_projects_path() -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|path| path.join(".claude")))
        .unwrap_or_else(|| PathBuf::from(".claude"))
        .join("projects")
}

#[cfg(target_os = "macos")]
fn desktop_installed() -> bool {
    [
        PathBuf::from("/Applications/Claude.app"),
        dirs::home_dir()
            .unwrap_or_default()
            .join("Applications/Claude.app"),
    ]
    .into_iter()
    .any(|path| fs::metadata(path).is_ok())
}

#[cfg(target_os = "windows")]
fn desktop_installed() -> bool {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .is_some_and(|path| path.join("AnthropicClaude/claude.exe").is_file())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn desktop_installed() -> bool {
    false
}

#[cfg(target_os = "macos")]
fn desktop_running() -> bool {
    std::process::Command::new("pgrep")
        .args(["-x", "Claude"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

#[cfg(target_os = "windows")]
fn desktop_running() -> bool {
    std::process::Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq claude.exe", "/NH"])
        .stderr(Stdio::null())
        .output()
        .is_ok_and(|output| String::from_utf8_lossy(&output.stdout).contains("claude.exe"))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn desktop_running() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn environment_report_never_contains_credentials() {
        let encoded = serde_json::to_string(&inspect_environment()).expect("serialize report");
        assert!(!encoded.contains("token"));
        assert!(!encoded.contains("cookie"));
    }
}
