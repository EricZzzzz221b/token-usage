use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::error::UsageError;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WindowMode {
    Compact,
    Detailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GlassStrength {
    Clear,
    Standard,
    Rich,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPreferences {
    pub mode: WindowMode,
    pub always_on_top: bool,
    pub locked: bool,
    pub click_through: bool,
    pub opacity: f64,
    pub glass_strength: GlassStrength,
}

impl Default for WindowPreferences {
    fn default() -> Self {
        Self {
            mode: WindowMode::Detailed,
            always_on_top: true,
            locked: false,
            click_through: false,
            opacity: 0.86,
            glass_strength: GlassStrength::Standard,
        }
    }
}

pub fn main_window(app: &AppHandle) -> Result<WebviewWindow, UsageError> {
    app.get_webview_window("main")
        .ok_or(UsageError::WindowUnavailable)
}

pub fn load_preferences(app: &AppHandle) -> WindowPreferences {
    fs::read_to_string(preferences_path(app))
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
        .filter(valid_preferences)
        .unwrap_or_default()
}

pub fn save_preferences(
    app: &AppHandle,
    preferences: &WindowPreferences,
) -> Result<(), UsageError> {
    if !valid_preferences(preferences) {
        return Err(UsageError::InvalidSettings);
    }
    let path = preferences_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| UsageError::WindowSettingsUnavailable)?;
    }
    let bytes = serde_json::to_vec_pretty(preferences)
        .map_err(|_| UsageError::WindowSettingsUnavailable)?;
    fs::write(path, bytes).map_err(|_| UsageError::WindowSettingsUnavailable)
}

pub fn apply_preferences(
    app: &AppHandle,
    preferences: &WindowPreferences,
) -> Result<(), UsageError> {
    if !valid_preferences(preferences) {
        return Err(UsageError::InvalidSettings);
    }
    let window = main_window(app)?;
    window
        .set_always_on_top(preferences.always_on_top)
        .map_err(|_| UsageError::WindowUnavailable)?;
    window
        .set_ignore_cursor_events(preferences.click_through)
        .map_err(|_| UsageError::WindowUnavailable)?;
    let (width, height) = match preferences.mode {
        WindowMode::Compact => (360.0, 260.0),
        WindowMode::Detailed => (440.0, 560.0),
    };
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|_| UsageError::WindowUnavailable)?;
    apply_glass(app, preferences.glass_strength)
}

pub fn apply_glass(app: &AppHandle, strength: GlassStrength) -> Result<(), UsageError> {
    let window = main_window(app)?;
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{
            apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
        };
        let _ = clear_vibrancy(&window);
        let material = match strength {
            GlassStrength::Clear => NSVisualEffectMaterial::UnderWindowBackground,
            GlassStrength::Standard => NSVisualEffectMaterial::HudWindow,
            GlassStrength::Rich => NSVisualEffectMaterial::Popover,
        };
        apply_vibrancy(
            &window,
            material,
            Some(NSVisualEffectState::Active),
            Some(22.0),
        )
        .map_err(|_| UsageError::WindowUnavailable)?;
    }
    Ok(())
}

pub fn disable_click_through(app: &AppHandle) {
    let mut preferences = load_preferences(app);
    preferences.click_through = false;
    let _ = apply_preferences(app, &preferences);
    let _ = save_preferences(app, &preferences);
    let _ = app.emit("window://preferences", &preferences);
}

fn valid_preferences(preferences: &WindowPreferences) -> bool {
    (0.55..=1.0).contains(&preferences.opacity)
}

fn preferences_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("window-preferences.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_opacity_range() {
        assert!(valid_preferences(&WindowPreferences::default()));
        assert!(!valid_preferences(&WindowPreferences {
            opacity: 0.2,
            ..WindowPreferences::default()
        }));
    }

    #[test]
    fn preferences_round_trip() {
        let preferences = WindowPreferences {
            mode: WindowMode::Compact,
            locked: true,
            glass_strength: GlassStrength::Rich,
            ..WindowPreferences::default()
        };
        let encoded = serde_json::to_string(&preferences).expect("serialize");
        let decoded: WindowPreferences = serde_json::from_str(&encoded).expect("deserialize");
        assert_eq!(decoded, preferences);
    }
}
