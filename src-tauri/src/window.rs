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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPreferences {
    pub mode: WindowMode,
    pub always_on_top: bool,
    pub locked: bool,
    pub click_through: bool,
    #[serde(default = "default_glass_level")]
    pub glass_level: f64,
}

fn default_glass_level() -> f64 {
    0.5
}

impl Default for WindowPreferences {
    fn default() -> Self {
        Self {
            mode: WindowMode::Detailed,
            always_on_top: true,
            locked: false,
            click_through: false,
            glass_level: default_glass_level(),
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
    apply_glass(app, preferences.glass_level)
}

pub fn resize_for_view(app: &AppHandle, view: &str) -> Result<(), UsageError> {
    let (width, height, radius) = match view {
        "compact" => (320.0, 48.0, 17.0),
        "detailed" => (360.0, 237.0, 22.0),
        "settings" => (480.0, 680.0, 24.0),
        _ => return Err(UsageError::InvalidSettings),
    };
    main_window(app)?
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|_| UsageError::WindowUnavailable)?;
    let preferences = load_preferences(app);
    apply_glass_with_radius(app, preferences.glass_level, radius)
}

pub fn apply_glass(app: &AppHandle, glass_level: f64) -> Result<(), UsageError> {
    let window = main_window(app)?;
    let logical_size = window
        .inner_size()
        .map_err(|_| UsageError::WindowUnavailable)?
        .to_logical::<f64>(
            window
                .scale_factor()
                .map_err(|_| UsageError::WindowUnavailable)?,
        );
    let radius = if logical_size.height <= 80.0 {
        17.0
    } else if logical_size.width >= 440.0 {
        24.0
    } else {
        22.0
    };
    apply_glass_with_radius(app, glass_level, radius)
}

pub fn background_is_dark(app: &AppHandle) -> Result<bool, UsageError> {
    let window = main_window(app)?;
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" {
            fn token_usage_background_is_dark(view_pointer: *mut std::ffi::c_void) -> bool;
        }
        let ns_view = window
            .ns_view()
            .map_err(|_| UsageError::WindowUnavailable)?;
        Ok(unsafe { token_usage_background_is_dark(ns_view) })
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(false)
    }
}

fn apply_glass_with_radius(
    app: &AppHandle,
    glass_level: f64,
    radius: f64,
) -> Result<(), UsageError> {
    let window = main_window(app)?;
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" {
            fn token_usage_apply_liquid_glass(
                view_pointer: *mut std::ffi::c_void,
                corner_radius: f64,
                glass_level: f64,
            ) -> bool;
            fn token_usage_apply_fallback_tint(
                view_pointer: *mut std::ffi::c_void,
                glass_level: f64,
            );
        }

        use window_vibrancy::{
            apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
        };
        let ns_view = window
            .ns_view()
            .map_err(|_| UsageError::WindowUnavailable)?;
        if unsafe { token_usage_apply_liquid_glass(ns_view, radius, glass_level) } {
            return Ok(());
        }

        let _ = clear_vibrancy(&window);
        apply_vibrancy(
            &window,
            NSVisualEffectMaterial::UnderWindowBackground,
            Some(NSVisualEffectState::Active),
            Some(radius),
        )
        .map_err(|_| UsageError::WindowUnavailable)?;
        unsafe { token_usage_apply_fallback_tint(ns_view, glass_level) };
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
    (0.0..=1.0).contains(&preferences.glass_level)
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
    fn validates_glass_level_range() {
        assert!(valid_preferences(&WindowPreferences::default()));
        assert!(!valid_preferences(&WindowPreferences {
            glass_level: 1.2,
            ..WindowPreferences::default()
        }));
    }

    #[test]
    fn preferences_round_trip() {
        let preferences = WindowPreferences {
            mode: WindowMode::Compact,
            locked: true,
            glass_level: 0.25,
            ..WindowPreferences::default()
        };
        let encoded = serde_json::to_string(&preferences).expect("serialize");
        let decoded: WindowPreferences = serde_json::from_str(&encoded).expect("deserialize");
        assert_eq!(decoded, preferences);
    }

    #[test]
    fn migrates_legacy_glass_settings_to_center() {
        let decoded: WindowPreferences = serde_json::from_str(
            r#"{"mode":"detailed","alwaysOnTop":true,"locked":false,"clickThrough":false,"opacity":0.8,"glassStrength":"rich"}"#,
        )
        .expect("deserialize legacy preferences");
        assert_eq!(decoded.glass_level, 0.5);
    }
}
