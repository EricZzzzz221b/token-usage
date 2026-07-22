use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::{header, redirect::Policy, StatusCode};

use crate::{
    credentials::OAuthCredentials,
    error::UsageError,
    model::{
        CodexRateLimitWindow, CodexResetCredits, CodexUsageResponse, CreditBalance,
        RateLimitResetCredit, RateLimitResetCredits, UsageSnapshot, UsageWindow,
    },
};

const OFFICIAL_USAGE_ENDPOINT: &str = "https://chatgpt.com/backend-api/wham/usage";
const OFFICIAL_RESET_CREDITS_ENDPOINT: &str =
    "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";

pub(crate) struct UsageClient {
    client: reqwest::Client,
    endpoint: String,
    reset_credits_endpoint: Option<String>,
}

impl UsageClient {
    pub(crate) fn official() -> Self {
        Self::new_with_reset_credits(
            OFFICIAL_USAGE_ENDPOINT,
            Some(OFFICIAL_RESET_CREDITS_ENDPOINT.into()),
        )
    }

    #[cfg(test)]
    fn new(endpoint: impl Into<String>) -> Self {
        Self::new_with_reset_credits(endpoint, None)
    }

    fn new_with_reset_credits(
        endpoint: impl Into<String>,
        reset_credits_endpoint: Option<String>,
    ) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(Policy::none())
            .build()
            .expect("static HTTP client configuration is valid");
        Self {
            client,
            endpoint: endpoint.into(),
            reset_credits_endpoint,
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

        let mut body = response
            .json::<CodexUsageResponse>()
            .await
            .map_err(|_| UsageError::ResponseIncompatible)?;
        let needs_reset_details = body
            .rate_limit_reset_credits
            .as_ref()
            .is_none_or(|value| value.credits.is_empty());
        if needs_reset_details {
            if let Some(detailed) = self.fetch_reset_credits(credentials).await.ok().flatten() {
                match body.rate_limit_reset_credits.as_mut() {
                    Some(summary) => {
                        if summary.available_count.is_none() {
                            summary.available_count = detailed.available_count;
                        }
                        if !detailed.credits.is_empty() {
                            summary.credits = detailed.credits;
                        }
                    }
                    None => body.rate_limit_reset_credits = Some(detailed),
                }
            }
        }
        normalize(body)
    }

    async fn fetch_reset_credits(
        &self,
        credentials: &OAuthCredentials,
    ) -> Result<Option<CodexResetCredits>, UsageError> {
        let Some(endpoint) = &self.reset_credits_endpoint else {
            return Ok(None);
        };
        let mut request = self
            .client
            .get(endpoint)
            .bearer_auth(&credentials.access_token)
            .header(header::USER_AGENT, "codex-cli")
            .header(header::ACCEPT, "application/json");
        if let Some(account_id) = credentials.account_id.as_deref() {
            request = request.header("ChatGPT-Account-Id", account_id);
        }
        let response = request
            .send()
            .await
            .map_err(|_| UsageError::NetworkUnavailable)?;
        if !response.status().is_success() {
            return Ok(None);
        }
        let payload = response
            .json::<serde_json::Value>()
            .await
            .map_err(|_| UsageError::ResponseIncompatible)?;
        parse_reset_credits_payload(payload).map(Some)
    }
}

fn parse_reset_credits_payload(
    payload: serde_json::Value,
) -> Result<CodexResetCredits, UsageError> {
    if let serde_json::Value::Array(credits) = payload {
        let available_count = Some(serde_json::Value::from(credits.len()));
        let credits = serde_json::from_value(serde_json::Value::Array(credits))
            .map_err(|_| UsageError::ResponseIncompatible)?;
        return Ok(CodexResetCredits {
            available_count,
            credits,
        });
    }

    if let Some(object) = payload.as_object() {
        let is_direct_payload = object.contains_key("available_count")
            || object.contains_key("availableCount")
            || object.contains_key("count")
            || object.contains_key("credits")
            || object
                .get("reset_credits")
                .is_some_and(serde_json::Value::is_array)
            || object
                .get("resetCredits")
                .is_some_and(serde_json::Value::is_array);
        if is_direct_payload {
            return serde_json::from_value(payload).map_err(|_| UsageError::ResponseIncompatible);
        }
        for key in [
            "rate_limit_reset_credits",
            "reset_credits",
            "resetCredits",
            "data",
        ] {
            if let Some(nested) = object.get(key) {
                if nested.is_object() || nested.is_array() {
                    return parse_reset_credits_payload(nested.clone());
                }
            }
        }
    }

    serde_json::from_value(payload).map_err(|_| UsageError::ResponseIncompatible)
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
        source: "codex_oauth".into(),
        windows,
        queried_at: now_millis(),
        plan_type: body.plan_type,
        credits: body.credits.map(|credits| CreditBalance {
            has_credits: credits.has_credits,
            unlimited: credits.unlimited,
            balance: credits.balance.and_then(normalize_balance),
            expires_at: credits.expires_at,
        }),
        reset_credits: body.rate_limit_reset_credits.map(normalize_reset_credits),
    })
}

fn normalize_reset_credits(value: CodexResetCredits) -> RateLimitResetCredits {
    let available_count = value
        .available_count
        .as_ref()
        .and_then(value_to_u32)
        .unwrap_or(value.credits.len() as u32);
    RateLimitResetCredits {
        available_count,
        credits: value
            .credits
            .into_iter()
            .map(|credit| RateLimitResetCredit {
                id: credit.id,
                reset_type: credit.reset_type,
                status: credit.status,
                title: credit.title,
                description: credit.description,
                expires_at: credit.expires_at.as_ref().and_then(value_to_timestamp),
            })
            .collect(),
    }
}

fn value_to_u32(value: &serde_json::Value) -> Option<u32> {
    value
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .or_else(|| value.as_str()?.parse().ok())
}

fn value_to_timestamp(value: &serde_json::Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str()?.parse().ok())
        .or_else(|| {
            chrono::DateTime::parse_from_rfc3339(value.as_str()?)
                .ok()
                .map(|value| value.timestamp())
        })
}

fn normalize_balance(value: serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(value) => Some(value),
        serde_json::Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
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

    #[test]
    fn normalizes_credit_balance_without_inventing_expiry() {
        let body: CodexUsageResponse = serde_json::from_value(serde_json::json!({
            "rate_limit": { "primary_window": { "used_percent": 10, "limit_window_seconds": 18000 } },
            "plan_type": "plus",
            "credits": { "has_credits": true, "unlimited": false, "balance": "120" }
        })).expect("valid response fixture");
        let snapshot = normalize(body).expect("normalized response");
        assert_eq!(snapshot.plan_type.as_deref(), Some("plus"));
        assert_eq!(
            snapshot
                .credits
                .as_ref()
                .and_then(|value| value.balance.as_deref()),
            Some("120")
        );
        assert_eq!(snapshot.credits.and_then(|value| value.expires_at), None);
    }

    #[test]
    fn normalizes_reset_credit_count_and_expiry() {
        let body: CodexUsageResponse = serde_json::from_value(serde_json::json!({
            "rate_limit": { "primary_window": { "used_percent": 10, "limit_window_seconds": 604800 } },
            "rate_limit_reset_credits": {
                "available_count": "3",
                "credits": [{
                    "id": "reset-1",
                    "reset_type": "codex_rate_limits",
                    "status": "available",
                    "title": "Full reset",
                    "expires_at": "2030-08-01T00:00:00Z"
                }]
            }
        })).expect("valid reset fixture");
        let snapshot = normalize(body).expect("normalized response");
        let resets = snapshot.reset_credits.expect("reset credits");
        assert_eq!(resets.available_count, 3);
        assert_eq!(resets.credits.len(), 1);
        assert_eq!(resets.credits[0].expires_at, Some(1_911_772_800));
    }

    #[test]
    fn parses_wrapped_reset_credit_details() {
        let resets = parse_reset_credits_payload(serde_json::json!({
            "data": {
                "availableCount": 2,
                "resetCredits": [{
                    "id": "reset-1",
                    "title": "Full reset",
                    "expires_at": 2_000_000_000
                }]
            }
        }))
        .expect("wrapped reset credits");
        assert_eq!(resets.available_count, Some(serde_json::json!(2)));
        assert_eq!(resets.credits.len(), 1);
    }

    #[test]
    fn parses_bare_reset_credit_array() {
        let resets = parse_reset_credits_payload(serde_json::json!([{
            "id": "reset-1",
            "title": "Full reset"
        }]))
        .expect("reset credit array");
        assert_eq!(resets.available_count, Some(serde_json::json!(1)));
        assert_eq!(resets.credits.len(), 1);
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
