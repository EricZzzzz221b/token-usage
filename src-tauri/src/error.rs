use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum UsageError {
    #[error("Codex official login was not found")]
    NotLoggedIn,
    #[error("Codex is not using ChatGPT OAuth authentication")]
    UnsupportedAuthMode,
    #[error("Codex credentials could not be read")]
    CredentialUnreadable,
    #[error("Codex credentials are malformed")]
    CredentialMalformed,
    #[error("Codex authentication has expired")]
    AuthenticationExpired,
    #[error("The usage request could not reach ChatGPT")]
    NetworkUnavailable,
    #[error("The usage service is rate limited")]
    RateLimited,
    #[error("The usage service is temporarily unavailable")]
    ServerUnavailable,
    #[error("The usage response is incompatible")]
    ResponseIncompatible,
    #[error("The refresh interval is invalid")]
    InvalidSettings,
    #[error("Refresh settings could not be saved")]
    SettingsUnavailable,
}

impl UsageError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NotLoggedIn => "not_logged_in",
            Self::UnsupportedAuthMode => "unsupported_auth_mode",
            Self::CredentialUnreadable => "credential_unreadable",
            Self::CredentialMalformed => "credential_malformed",
            Self::AuthenticationExpired => "authentication_expired",
            Self::NetworkUnavailable => "network_unavailable",
            Self::RateLimited => "rate_limited",
            Self::ServerUnavailable => "server_unavailable",
            Self::ResponseIncompatible => "response_incompatible",
            Self::InvalidSettings => "invalid_settings",
            Self::SettingsUnavailable => "settings_unavailable",
        }
    }

    pub fn is_transient(&self) -> bool {
        matches!(
            self,
            Self::NetworkUnavailable | Self::RateLimited | Self::ServerUnavailable
        )
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageErrorPayload {
    pub code: &'static str,
    pub message: String,
}

impl From<UsageError> for UsageErrorPayload {
    fn from(error: UsageError) -> Self {
        Self {
            code: error.code(),
            message: error.to_string(),
        }
    }
}
