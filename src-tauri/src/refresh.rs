use std::{fs, path::PathBuf, sync::Arc, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Mutex;

use crate::{credentials, error::UsageError, model::UsageSnapshot, tray, usage::UsageClient};

const DEFAULT_INTERVAL_MINUTES: u64 = 5;
const MIN_INTERVAL_MINUTES: u64 = 1;
const MAX_INTERVAL_MINUTES: u64 = 1_440;
const LAST_GOOD_GRACE_MILLIS: i64 = 30 * 60 * 1_000;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrayWindow {
    #[default]
    FiveHour,
    SevenDay,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshSettings {
    pub interval_minutes: u64,
    #[serde(default)]
    pub usage_enabled: bool,
    #[serde(default)]
    pub tray_window: TrayWindow,
    #[serde(default)]
    pub notify_seventy: bool,
    #[serde(default = "default_true")]
    pub notify_ninety: bool,
    #[serde(default = "default_true")]
    pub notify_hundred: bool,
    #[serde(default)]
    pub notify_reset: bool,
}

impl Default for RefreshSettings {
    fn default() -> Self {
        Self {
            interval_minutes: DEFAULT_INTERVAL_MINUTES,
            usage_enabled: false,
            tray_window: TrayWindow::FiveHour,
            notify_seventy: false,
            notify_ninety: true,
            notify_hundred: true,
            notify_reset: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum UsageView {
    Loading,
    Ready {
        snapshot: UsageSnapshot,
        stale: bool,
        last_error: Option<String>,
    },
    Error {
        code: String,
        message: String,
    },
}

#[derive(Default)]
struct CoordinatorState {
    settings: RefreshSettings,
    last_good: Option<UsageSnapshot>,
    last_error: Option<String>,
    refreshing: bool,
    transient_failures: u32,
    notified: std::collections::HashSet<String>,
}

#[derive(Clone)]
pub struct RefreshCoordinator {
    state: Arc<Mutex<CoordinatorState>>,
    settings_path: PathBuf,
}

impl RefreshCoordinator {
    pub fn load(app: &AppHandle) -> Self {
        let settings_path = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("settings.json");
        let settings = fs::read_to_string(&settings_path)
            .ok()
            .and_then(|value| serde_json::from_str(&value).ok())
            .filter(valid_settings)
            .unwrap_or_default();
        Self {
            state: Arc::new(Mutex::new(CoordinatorState {
                settings,
                ..Default::default()
            })),
            settings_path,
        }
    }

    pub fn start(&self, app: AppHandle) {
        let coordinator = self.clone();
        tauri::async_runtime::spawn(async move {
            if coordinator.settings().await.usage_enabled {
                coordinator.refresh(&app).await;
            }
            loop {
                let state = coordinator.state.lock().await;
                let seconds =
                    retry_delay_seconds(&state).unwrap_or(state.settings.interval_minutes * 60);
                drop(state);
                tokio::time::sleep(Duration::from_secs(seconds)).await;
                if coordinator.settings().await.usage_enabled {
                    coordinator.refresh(&app).await;
                }
            }
        });
    }

    pub async fn settings(&self) -> RefreshSettings {
        self.state.lock().await.settings
    }

    pub async fn set_interval(&self, minutes: u64) -> Result<RefreshSettings, UsageError> {
        let mut settings = self.settings().await;
        settings.interval_minutes = minutes;
        self.save_settings(settings).await
    }

    pub async fn set_settings(
        &self,
        settings: RefreshSettings,
    ) -> Result<RefreshSettings, UsageError> {
        self.save_settings(settings).await
    }

    async fn save_settings(
        &self,
        settings: RefreshSettings,
    ) -> Result<RefreshSettings, UsageError> {
        if !valid_settings(&settings) {
            return Err(UsageError::InvalidSettings);
        }
        if let Some(parent) = self.settings_path.parent() {
            fs::create_dir_all(parent).map_err(|_| UsageError::SettingsUnavailable)?;
        }
        let encoded =
            serde_json::to_vec_pretty(&settings).map_err(|_| UsageError::SettingsUnavailable)?;
        fs::write(&self.settings_path, encoded).map_err(|_| UsageError::SettingsUnavailable)?;
        self.state.lock().await.settings = settings;
        Ok(settings)
    }

    pub async fn view(&self) -> UsageView {
        let state = self.state.lock().await;
        view_from_state(&state, now_millis())
    }

    pub async fn refresh(&self, app: &AppHandle) -> UsageView {
        {
            let mut state = self.state.lock().await;
            if state.refreshing {
                return view_from_state(&state, now_millis());
            }
            state.refreshing = true;
        }

        let result = match credentials::read_credentials() {
            Ok(credentials) => UsageClient::official().fetch(&credentials).await,
            Err(error) => Err(error),
        };
        let view = {
            let mut state = self.state.lock().await;
            state.refreshing = false;
            match result {
                Ok(snapshot) => {
                    if state.settings.notify_reset {
                        if let Some(previous) = &state.last_good {
                            for current in &snapshot.windows {
                                if let Some(old) = previous
                                    .windows
                                    .iter()
                                    .find(|window| window.id == current.id)
                                {
                                    if old.used_percent > current.used_percent
                                        && old.reset_at != current.reset_at
                                    {
                                        let _ = app
                                            .notification()
                                            .builder()
                                            .title("Token用量")
                                            .body(format!("{} 已重置", current.label))
                                            .show();
                                    }
                                }
                            }
                        }
                    }
                    process_notifications(app, &mut state, &snapshot);
                    append_snapshot(app, &snapshot);
                    state.last_good = Some(snapshot);
                    state.last_error = None;
                    state.transient_failures = 0;
                }
                Err(error) => {
                    if error.is_transient() {
                        state.transient_failures = state.transient_failures.saturating_add(1);
                    } else {
                        state.last_good = None;
                        state.transient_failures = 0;
                    }
                    state.last_error = Some(error.code().to_owned());
                }
            }
            view_from_state(&state, now_millis())
        };
        let _ = app.emit("usage://updated", &view);
        tray::update(app, &view, self.settings().await.tray_window);
        view
    }
}

fn retry_delay_seconds(state: &CoordinatorState) -> Option<u64> {
    let attempt = state.transient_failures.saturating_sub(1).min(5);
    match state.last_error.as_deref()? {
        "rate_limited" => Some((60_u64.saturating_mul(1 << attempt)).min(1_800)),
        "network_unavailable" | "server_unavailable" => {
            Some((30_u64.saturating_mul(1 << attempt)).min(300))
        }
        _ => None,
    }
}

fn default_true() -> bool {
    true
}

fn process_notifications(app: &AppHandle, state: &mut CoordinatorState, snapshot: &UsageSnapshot) {
    for window in &snapshot.windows {
        for (threshold, enabled) in [
            (70, state.settings.notify_seventy),
            (90, state.settings.notify_ninety),
            (100, state.settings.notify_hundred),
        ] {
            let key = format!(
                "{}:{}:{}",
                window.id,
                window.reset_at.unwrap_or_default(),
                threshold
            );
            if enabled && window.used_percent >= threshold as f64 && state.notified.insert(key) {
                let _ = app
                    .notification()
                    .builder()
                    .title("Token用量")
                    .body(format!(
                        "{} 剩余 {:.0}%",
                        window.label,
                        (100.0 - window.used_percent).clamp(0.0, 100.0)
                    ))
                    .show();
            }
        }
    }
    state.notified.retain(|key| {
        snapshot.windows.iter().any(|window| {
            key.starts_with(&format!(
                "{}:{}:",
                window.id,
                window.reset_at.unwrap_or_default()
            ))
        })
    });
}

fn append_snapshot(app: &AppHandle, snapshot: &UsageSnapshot) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("usage-history.jsonl");
    let cutoff = now_millis() - 30 * 24 * 60 * 60 * 1_000;
    let history = fs::read_to_string(&path).unwrap_or_default();
    let mut retained = history
        .lines()
        .filter_map(|line| serde_json::from_str::<UsageSnapshot>(line).ok())
        .filter(|item| item.queried_at >= cutoff)
        .collect::<Vec<_>>();
    retained.push(snapshot.clone());
    if retained.len() > 8_640 {
        retained.drain(..retained.len() - 8_640);
    }
    let mut output = Vec::new();
    for item in retained {
        if let Ok(mut line) = serde_json::to_vec(&item) {
            line.push(b'\n');
            output.extend(line);
        }
    }
    let _ = fs::write(path, output);
}

fn valid_settings(settings: &RefreshSettings) -> bool {
    (MIN_INTERVAL_MINUTES..=MAX_INTERVAL_MINUTES).contains(&settings.interval_minutes)
}

fn view_from_state(state: &CoordinatorState, now: i64) -> UsageView {
    if let Some(snapshot) = state.last_good.clone() {
        let stale = now.saturating_sub(snapshot.queried_at) > LAST_GOOD_GRACE_MILLIS;
        return UsageView::Ready {
            snapshot,
            stale,
            last_error: state.last_error.clone(),
        };
    }
    if let Some(code) = &state.last_error {
        return UsageView::Error {
            code: code.clone(),
            message: code.replace('_', " "),
        };
    }
    UsageView::Loading
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::UsageWindow;

    #[test]
    fn validates_refresh_interval_bounds() {
        assert!(!valid_settings(&RefreshSettings {
            interval_minutes: 0,
            ..RefreshSettings::default()
        }));
        assert!(valid_settings(&RefreshSettings {
            interval_minutes: 5,
            ..RefreshSettings::default()
        }));
        assert!(!valid_settings(&RefreshSettings {
            interval_minutes: 1_441,
            ..RefreshSettings::default()
        }));
    }

    #[test]
    fn defaults_existing_settings_to_five_hour_tray_window() {
        let settings: RefreshSettings = serde_json::from_str(
            r#"{
                "intervalMinutes": 5,
                "usageEnabled": true,
                "notifySeventy": false,
                "notifyNinety": true,
                "notifyHundred": true,
                "notifyReset": false
            }"#,
        )
        .expect("legacy settings should remain readable");

        assert_eq!(settings.tray_window, TrayWindow::FiveHour);
    }

    #[test]
    fn preserves_last_good_after_transient_error() {
        let state = CoordinatorState {
            settings: RefreshSettings::default(),
            last_good: Some(UsageSnapshot {
                source: "codex_oauth".into(),
                windows: vec![UsageWindow {
                    id: "five_hour".into(),
                    label: "5 hours".into(),
                    duration_seconds: Some(18_000),
                    used_percent: 42.0,
                    reset_at: None,
                }],
                queried_at: 1_000,
            }),
            last_error: Some("network_unavailable".into()),
            refreshing: false,
            transient_failures: 1,
            notified: Default::default(),
        };
        match view_from_state(&state, 2_000) {
            UsageView::Ready { last_error, .. } => {
                assert_eq!(last_error.as_deref(), Some("network_unavailable"));
            }
            _ => panic!("last good snapshot should remain visible"),
        }
    }

    #[test]
    fn deterministic_error_has_no_last_good_view() {
        let state = CoordinatorState {
            settings: RefreshSettings::default(),
            last_good: None,
            last_error: Some("authentication_expired".into()),
            refreshing: false,
            transient_failures: 0,
            notified: Default::default(),
        };
        match view_from_state(&state, 2_000) {
            UsageView::Error { code, .. } => assert_eq!(code, "authentication_expired"),
            _ => panic!("authentication errors must be visible immediately"),
        }
    }

    #[test]
    fn backs_off_rate_limits_and_caps_the_delay() {
        let mut state = CoordinatorState {
            last_error: Some("rate_limited".into()),
            transient_failures: 1,
            ..Default::default()
        };
        assert_eq!(retry_delay_seconds(&state), Some(60));
        state.transient_failures = 3;
        assert_eq!(retry_delay_seconds(&state), Some(240));
        state.transient_failures = 20;
        assert_eq!(retry_delay_seconds(&state), Some(1_800));
    }
}
