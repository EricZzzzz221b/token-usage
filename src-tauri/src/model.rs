use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub source: &'static str,
    pub windows: Vec<UsageWindow>,
    pub queried_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub id: String,
    pub label: String,
    pub duration_seconds: Option<i64>,
    pub used_percent: f64,
    pub reset_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CodexUsageResponse {
    pub rate_limit: Option<CodexRateLimit>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CodexRateLimit {
    pub primary_window: Option<CodexRateLimitWindow>,
    pub secondary_window: Option<CodexRateLimitWindow>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CodexRateLimitWindow {
    pub used_percent: Option<f64>,
    pub limit_window_seconds: Option<i64>,
    pub reset_at: Option<i64>,
}
