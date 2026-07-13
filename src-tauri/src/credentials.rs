use std::{fs, path::PathBuf};

#[cfg(target_os = "macos")]
use std::process::Command;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::UsageError;

#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "Codex Auth";
const STALE_AFTER_DAYS: i64 = 8;

#[derive(Debug)]
pub(crate) struct OAuthCredentials {
    pub(crate) access_token: String,
    pub(crate) account_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialStatus {
    Valid,
    Stale,
    NotFound,
    Unsupported,
    Invalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialSource {
    Keychain,
    File,
    None,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialReport {
    pub status: CredentialStatus,
    pub source: CredentialSource,
}

#[derive(Debug, Deserialize)]
struct CodexAuthJson {
    auth_mode: Option<String>,
    tokens: Option<CodexTokens>,
    last_refresh: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodexTokens {
    access_token: Option<String>,
    account_id: Option<String>,
}

pub fn inspect_credentials() -> CredentialReport {
    match read_credentials_with_source() {
        Ok((_, source, stale)) => CredentialReport {
            status: if stale {
                CredentialStatus::Stale
            } else {
                CredentialStatus::Valid
            },
            source,
        },
        Err(UsageError::NotLoggedIn) => CredentialReport {
            status: CredentialStatus::NotFound,
            source: CredentialSource::None,
        },
        Err(UsageError::UnsupportedAuthMode) => CredentialReport {
            status: CredentialStatus::Unsupported,
            source: CredentialSource::None,
        },
        Err(_) => CredentialReport {
            status: CredentialStatus::Invalid,
            source: CredentialSource::None,
        },
    }
}

pub(crate) fn read_credentials() -> Result<OAuthCredentials, UsageError> {
    read_credentials_with_source().map(|(credentials, _, _)| credentials)
}

fn read_credentials_with_source() -> Result<(OAuthCredentials, CredentialSource, bool), UsageError>
{
    #[cfg(target_os = "macos")]
    if let Some(content) = read_keychain_entry() {
        let (credentials, stale) = parse_credentials(&content)?;
        return Ok((credentials, CredentialSource::Keychain, stale));
    }

    let path = codex_auth_path();
    if !path.exists() {
        return Err(UsageError::NotLoggedIn);
    }
    let content = fs::read_to_string(path).map_err(|_| UsageError::CredentialUnreadable)?;
    let (credentials, stale) = parse_credentials(&content)?;
    Ok((credentials, CredentialSource::File, stale))
}

#[cfg(target_os = "macos")]
fn read_keychain_entry() -> Option<String> {
    let output = Command::new("security")
        .args(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let content = String::from_utf8(output.stdout).ok()?;
    (!content.trim().is_empty()).then(|| content.trim().to_owned())
}

fn codex_auth_path() -> PathBuf {
    codex_auth_path_from(std::env::var_os("CODEX_HOME"), dirs::home_dir())
}

fn codex_auth_path_from(codex_home: Option<std::ffi::OsString>, home: Option<PathBuf>) -> PathBuf {
    codex_home
        .map(PathBuf::from)
        .or_else(|| home.map(|path| path.join(".codex")))
        .unwrap_or_else(|| PathBuf::from(".codex"))
        .join("auth.json")
}

fn parse_credentials(content: &str) -> Result<(OAuthCredentials, bool), UsageError> {
    let auth: CodexAuthJson =
        serde_json::from_str(content).map_err(|_| UsageError::CredentialMalformed)?;
    if auth.auth_mode.as_deref() != Some("chatgpt") {
        return Err(UsageError::UnsupportedAuthMode);
    }
    let tokens = auth.tokens.ok_or(UsageError::CredentialMalformed)?;
    let access_token = tokens
        .access_token
        .filter(|token| !token.trim().is_empty())
        .ok_or(UsageError::CredentialMalformed)?;
    let stale = auth
        .last_refresh
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .is_some_and(|value| {
            Utc::now()
                .signed_duration_since(value.with_timezone(&Utc))
                .num_days()
                > STALE_AFTER_DAYS
        });

    Ok((
        OAuthCredentials {
            access_token,
            account_id: tokens.account_id,
        },
        stale,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = r#"{
      "auth_mode": "chatgpt",
      "tokens": { "access_token": "fixture-token", "account_id": "fixture-account" },
      "last_refresh": "2099-01-01T00:00:00Z"
    }"#;

    #[test]
    fn parses_oauth_without_exposing_it_in_reports() {
        let (credentials, stale) = parse_credentials(VALID).expect("valid fixture");
        assert_eq!(credentials.access_token, "fixture-token");
        assert_eq!(credentials.account_id.as_deref(), Some("fixture-account"));
        assert!(!stale);
        let report = CredentialReport {
            status: CredentialStatus::Valid,
            source: CredentialSource::File,
        };
        let serialized = serde_json::to_string(&report).expect("serialize report");
        assert!(!serialized.contains("fixture-token"));
        assert!(!serialized.contains("fixture-account"));
    }

    #[test]
    fn rejects_api_key_mode() {
        let error = parse_credentials(r#"{"auth_mode":"apikey"}"#).unwrap_err();
        assert_eq!(error.code(), "unsupported_auth_mode");
    }

    #[test]
    fn resolves_custom_codex_home() {
        let path = codex_auth_path_from(Some("/tmp/custom-codex".into()), None);
        assert_eq!(path, PathBuf::from("/tmp/custom-codex/auth.json"));
    }

    #[test]
    fn resolves_non_ascii_codex_home_with_spaces() {
        let home = PathBuf::from("Codex 测试 用户");
        let path = codex_auth_path_from(Some(home.clone().into_os_string()), None);
        assert_eq!(path, home.join("auth.json"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn resolves_windows_user_profile_default() {
        let profile = PathBuf::from(r"C:\Users\测试 用户");
        let path = codex_auth_path_from(None, Some(profile.clone()));
        assert_eq!(path, profile.join(".codex").join("auth.json"));
    }
}
