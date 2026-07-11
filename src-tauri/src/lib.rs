mod credentials;
mod error;
mod model;
mod refresh;
mod tray;
mod usage;
mod window;

use credentials::CredentialReport;
use error::UsageErrorPayload;
use refresh::{RefreshCoordinator, RefreshSettings, UsageView};
use tauri::{Manager, State};
use window::{GlassStrength, WindowPreferences};

#[tauri::command]
fn credential_status() -> CredentialReport {
    credentials::inspect_credentials()
}

#[tauri::command]
async fn get_usage(
    coordinator: State<'_, RefreshCoordinator>,
) -> Result<UsageView, UsageErrorPayload> {
    Ok(coordinator.view().await)
}

#[tauri::command]
async fn refresh_usage(
    app: tauri::AppHandle,
    coordinator: State<'_, RefreshCoordinator>,
) -> Result<UsageView, UsageErrorPayload> {
    Ok(coordinator.refresh(&app).await)
}

#[tauri::command]
async fn get_refresh_settings(
    coordinator: State<'_, RefreshCoordinator>,
) -> Result<RefreshSettings, UsageErrorPayload> {
    Ok(coordinator.settings().await)
}

#[tauri::command]
async fn set_refresh_interval(
    coordinator: State<'_, RefreshCoordinator>,
    minutes: u64,
) -> Result<RefreshSettings, UsageErrorPayload> {
    coordinator
        .set_interval(minutes)
        .await
        .map_err(UsageErrorPayload::from)
}

#[tauri::command]
fn get_window_preferences(app: tauri::AppHandle) -> WindowPreferences {
    window::load_preferences(&app)
}

#[tauri::command]
fn set_window_preferences(
    app: tauri::AppHandle,
    preferences: WindowPreferences,
) -> Result<WindowPreferences, UsageErrorPayload> {
    window::apply_preferences(&app, &preferences).map_err(UsageErrorPayload::from)?;
    window::save_preferences(&app, &preferences).map_err(UsageErrorPayload::from)?;
    Ok(preferences)
}

#[tauri::command]
fn start_window_drag(app: tauri::AppHandle) -> Result<(), UsageErrorPayload> {
    let preferences = window::load_preferences(&app);
    if !preferences.locked && !preferences.click_through {
        window::main_window(&app)
            .map_err(UsageErrorPayload::from)?
            .start_dragging()
            .map_err(|_| UsageErrorPayload::from(error::UsageError::WindowUnavailable))?;
    }
    Ok(())
}

#[tauri::command]
fn set_glass_strength(
    app: tauri::AppHandle,
    strength: GlassStrength,
) -> Result<(), UsageErrorPayload> {
    window::apply_glass(&app, strength).map_err(UsageErrorPayload::from)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let window_state = tauri_plugin_window_state::Builder::default()
        .with_state_flags(
            tauri_plugin_window_state::StateFlags::POSITION
                | tauri_plugin_window_state::StateFlags::SIZE,
        )
        .build();
    tauri::Builder::default()
        .plugin(window_state)
        .setup(|app| {
            let coordinator = RefreshCoordinator::load(app.handle());
            app.manage(coordinator.clone());
            tray::setup(app, coordinator.clone())?;
            let preferences = window::load_preferences(app.handle());
            window::apply_preferences(app.handle(), &preferences)?;
            coordinator.start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            credential_status,
            get_usage,
            refresh_usage,
            get_refresh_settings,
            set_refresh_interval,
            get_window_preferences,
            set_window_preferences,
            start_window_drag,
            set_glass_strength
        ])
        .run(tauri::generate_context!())
        .expect("error while running Token Usage");
}
