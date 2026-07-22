use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub source: String,
    pub windows: Vec<UsageWindow>,
    pub queried_at: i64,
    pub plan_type: Option<String>,
    pub credits: Option<CreditBalance>,
    pub reset_credits: Option<RateLimitResetCredits>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitResetCredits {
    pub available_count: u32,
    pub credits: Vec<RateLimitResetCredit>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitResetCredit {
    pub id: Option<String>,
    pub reset_type: Option<String>,
    pub status: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub expires_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditBalance {
    pub has_credits: bool,
    pub unlimited: bool,
    pub balance: Option<String>,
    pub expires_at: Option<i64>,
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
    pub plan_type: Option<String>,
    pub credits: Option<CodexCredits>,
    pub rate_limit_reset_credits: Option<CodexResetCredits>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CodexResetCredits {
    #[serde(alias = "availableCount", alias = "count")]
    pub available_count: Option<serde_json::Value>,
    #[serde(default, alias = "reset_credits", alias = "resetCredits")]
    pub credits: Vec<CodexResetCredit>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CodexResetCredit {
    pub id: Option<String>,
    pub reset_type: Option<String>,
    pub status: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub expires_at: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CodexCredits {
    #[serde(default)]
    pub has_credits: bool,
    #[serde(default)]
    pub unlimited: bool,
    pub balance: Option<serde_json::Value>,
    pub expires_at: Option<i64>,
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
