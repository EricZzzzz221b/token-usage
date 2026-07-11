use std::{fs, path::PathBuf, sync::Arc, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

use crate::{credentials, error::UsageError, model::UsageSnapshot, tray, usage::UsageClient};

const DEFAULT_INTERVAL_MINUTES: u64 = 5;
const MIN_INTERVAL_MINUTES: u64 = 1;
const MAX_INTERVAL_MINUTES: u64 = 1_440;
const LAST_GOOD_GRACE_MILLIS: i64 = 30 * 60 * 1_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshSettings {
    pub interval_minutes: u64,
}

impl Default for RefreshSettings {
    fn default() -> Self {
        Self {
            interval_minutes: DEFAULT_INTERVAL_MINUTES,
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
            coordinator.refresh(&app).await;
            loop {
                let minutes = coordinator.settings().await.interval_minutes;
                tokio::time::sleep(Duration::from_secs(minutes * 60)).await;
                coordinator.refresh(&app).await;
            }
        });
    }

    pub async fn settings(&self) -> RefreshSettings {
        self.state.lock().await.settings
    }

    pub async fn set_interval(&self, minutes: u64) -> Result<RefreshSettings, UsageError> {
        let settings = RefreshSettings {
            interval_minutes: minutes,
        };
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
                    state.last_good = Some(snapshot);
                    state.last_error = None;
                }
                Err(error) => {
                    if !error.is_transient() {
                        state.last_good = None;
                    }
                    state.last_error = Some(error.code().to_owned());
                }
            }
            view_from_state(&state, now_millis())
        };
        let _ = app.emit("usage://updated", &view);
        tray::update(app, &view);
        view
    }
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
            interval_minutes: 0
        }));
        assert!(valid_settings(&RefreshSettings {
            interval_minutes: 5
        }));
        assert!(!valid_settings(&RefreshSettings {
            interval_minutes: 1_441
        }));
    }

    #[test]
    fn preserves_last_good_after_transient_error() {
        let state = CoordinatorState {
            settings: RefreshSettings::default(),
            last_good: Some(UsageSnapshot {
                source: "codex_oauth",
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
        };
        match view_from_state(&state, 2_000) {
            UsageView::Error { code, .. } => assert_eq!(code, "authentication_expired"),
            _ => panic!("authentication errors must be visible immediately"),
        }
    }
}
