use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::{header, redirect::Policy, StatusCode};

use crate::{
    credentials::OAuthCredentials,
    error::UsageError,
    model::{CodexRateLimitWindow, CodexUsageResponse, UsageSnapshot, UsageWindow},
};

const OFFICIAL_USAGE_ENDPOINT: &str = "https://chatgpt.com/backend-api/wham/usage";

pub(crate) struct UsageClient {
    client: reqwest::Client,
    endpoint: String,
}

impl UsageClient {
    pub(crate) fn official() -> Self {
        Self::new(OFFICIAL_USAGE_ENDPOINT)
    }

    fn new(endpoint: impl Into<String>) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(Policy::none())
            .build()
            .expect("static HTTP client configuration is valid");
        Self {
            client,
            endpoint: endpoint.into(),
        }
    }

    pub(crate) async fn fetch(
        &self,
        credentials: &OAuthCredentials,
    ) -> Result<UsageSnapshot, UsageError> {
        let mut authorization =
            header::HeaderValue::from_str(&format!("Bearer {}", credentials.access_token))
                .map_err(|_| UsageError::CredentialMalformed)?;
        authorization.set_sensitive(true);

        let mut request = self
            .client
            .get(&self.endpoint)
            .header(header::AUTHORIZATION, authorization)
            .header(header::USER_AGENT, "codex-cli")
            .header(header::ACCEPT, "application/json");
        if let Some(account_id) = credentials.account_id.as_deref() {
            request = request.header("ChatGPT-Account-Id", account_id);
        }

        let response = request
            .send()
            .await
            .map_err(|_| UsageError::NetworkUnavailable)?;
        match response.status() {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                return Err(UsageError::AuthenticationExpired)
            }
            StatusCode::TOO_MANY_REQUESTS => return Err(UsageError::RateLimited),
            status if !status.is_success() => return Err(UsageError::ServerUnavailable),
            _ => {}
        }

        let body = response
            .json::<CodexUsageResponse>()
            .await
            .map_err(|_| UsageError::ResponseIncompatible)?;
        normalize(body)
    }
}

fn normalize(body: CodexUsageResponse) -> Result<UsageSnapshot, UsageError> {
    let rate_limit = body.rate_limit.ok_or(UsageError::ResponseIncompatible)?;
    let windows = [rate_limit.primary_window, rate_limit.secondary_window]
        .into_iter()
        .flatten()
        .filter_map(normalize_window)
        .collect::<Vec<_>>();
    if windows.is_empty() {
        return Err(UsageError::ResponseIncompatible);
    }
    Ok(UsageSnapshot {
        source: "codex_oauth",
        windows,
        queried_at: now_millis(),
    })
}

fn normalize_window(window: CodexRateLimitWindow) -> Option<UsageWindow> {
    let used_percent = window.used_percent?.clamp(0.0, 100.0);
    let (id, label) = window_label(window.limit_window_seconds);
    Some(UsageWindow {
        id,
        label,
        duration_seconds: window.limit_window_seconds,
        used_percent,
        reset_at: window.reset_at,
    })
}

fn window_label(duration: Option<i64>) -> (String, String) {
    match duration {
        Some(18_000) => ("five_hour".into(), "5 hours".into()),
        Some(604_800) => ("seven_day".into(), "7 days".into()),
        Some(2_592_000) => ("thirty_day".into(), "30 days".into()),
        Some(seconds) if seconds >= 86_400 => {
            let days = seconds / 86_400;
            (format!("{days}_day"), format!("{days} days"))
        }
        Some(seconds) if seconds >= 3_600 => {
            let hours = seconds / 3_600;
            (format!("{hours}_hour"), format!("{hours} hours"))
        }
        _ => ("unknown".into(), "Usage window".into()),
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use httpmock::prelude::*;

    use super::*;

    #[test]
    fn normalizes_known_and_unknown_windows() {
        let body: CodexUsageResponse = serde_json::from_value(serde_json::json!({
            "rate_limit": {
                "primary_window": { "used_percent": 42.4, "limit_window_seconds": 18000, "reset_at": 2000000000 },
                "secondary_window": { "used_percent": 68.1, "limit_window_seconds": 172800, "reset_at": 2000100000 }
            }
        })).expect("valid response fixture");
        let snapshot = normalize(body).expect("normalized response");
        assert_eq!(snapshot.windows[0].id, "five_hour");
        assert_eq!(snapshot.windows[1].label, "2 days");
    }

    #[tokio::test]
    async fn sends_expected_headers_without_following_redirects() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/usage")
                .header("authorization", "Bearer fixture-token")
                .header("chatgpt-account-id", "fixture-account")
                .header("user-agent", "codex-cli");
            then.status(200).json_body(serde_json::json!({
                "rate_limit": {
                    "primary_window": { "used_percent": 12.0, "limit_window_seconds": 18000, "reset_at": 2000000000 }
                }
            }));
        });
        let credentials = OAuthCredentials {
            access_token: "fixture-token".into(),
            account_id: Some("fixture-account".into()),
        };
        let snapshot = UsageClient::new(format!("{}/usage", server.base_url()))
            .fetch(&credentials)
            .await
            .expect("mock response");
        mock.assert();
        assert_eq!(snapshot.windows[0].used_percent, 12.0);
    }

    #[tokio::test]
    async fn classifies_authentication_failure() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/usage");
            then.status(401);
        });
        let credentials = OAuthCredentials {
            access_token: "fixture-token".into(),
            account_id: None,
        };
        let error = UsageClient::new(format!("{}/usage", server.base_url()))
            .fetch(&credentials)
            .await
            .unwrap_err();
        assert_eq!(error.code(), "authentication_expired");
    }
}
