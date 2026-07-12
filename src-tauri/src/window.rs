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
    #[serde(alias = "rich")]
    Standard,
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
    apply_glass(app, preferences.glass_strength, preferences.opacity)
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
    apply_glass_with_radius(app, preferences.glass_strength, preferences.opacity, radius)
}

pub fn apply_glass(
    app: &AppHandle,
    strength: GlassStrength,
    opacity: f64,
) -> Result<(), UsageError> {
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
    apply_glass_with_radius(app, strength, opacity, radius)
}

fn apply_glass_with_radius(
    app: &AppHandle,
    strength: GlassStrength,
    opacity: f64,
    radius: f64,
) -> Result<(), UsageError> {
    let window = main_window(app)?;
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" {
            fn token_usage_apply_liquid_glass(
                view_pointer: *mut std::ffi::c_void,
                style: i32,
                corner_radius: f64,
                opacity: f64,
            ) -> bool;
        }

        use window_vibrancy::{
            apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
        };
        let ns_view = window
            .ns_view()
            .map_err(|_| UsageError::WindowUnavailable)?;
        let style = match strength {
            GlassStrength::Clear => 0,
            GlassStrength::Standard => 1,
        };
        if unsafe { token_usage_apply_liquid_glass(ns_view, style, radius, opacity) } {
            return Ok(());
        }

        let _ = clear_vibrancy(&window);
        let material = match strength {
            GlassStrength::Clear => NSVisualEffectMaterial::UnderWindowBackground,
            GlassStrength::Standard => NSVisualEffectMaterial::HudWindow,
        };
        apply_vibrancy(
            &window,
            material,
            Some(NSVisualEffectState::Active),
            Some(radius),
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
            glass_strength: GlassStrength::Clear,
            ..WindowPreferences::default()
        };
        let encoded = serde_json::to_string(&preferences).expect("serialize");
        let decoded: WindowPreferences = serde_json::from_str(&encoded).expect("deserialize");
        assert_eq!(decoded, preferences);
    }

    #[test]
    fn migrates_legacy_rich_glass_to_standard() {
        let decoded: WindowPreferences = serde_json::from_str(
            r#"{"mode":"detailed","alwaysOnTop":true,"locked":false,"clickThrough":false,"opacity":0.8,"glassStrength":"rich"}"#,
        )
        .expect("deserialize legacy preferences");
        assert_eq!(decoded.glass_strength, GlassStrength::Standard);
    }
}
