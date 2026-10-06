mod credentials;
mod error;
mod model;
mod refresh;
mod tasks;
mod tray;
mod update_backend;
mod updates;
mod usage;
mod window;

use credentials::{AccountModeReport, CredentialReport};
use error::UsageErrorPayload;
use refresh::{RefreshCoordinator, RefreshSettings, UsageView};
use tauri::{Manager, State};
use window::WindowPreferences;

#[tauri::command]
fn get_tasks(monitor: State<'_, tasks::TaskMonitor>) -> tasks::TaskSnapshot {
    monitor.snapshot()
}

#[tauri::command]
fn open_task(session_id: String) -> Result<(), UsageErrorPayload> {
    let url = codex_task_url(&session_id).map_err(UsageErrorPayload::from)?;
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();
    result
        .map(|_| ())
        .map_err(|_| UsageErrorPayload::from(error::UsageError::WindowUnavailable))
}

fn codex_task_url(session_id: &str) -> Result<String, error::UsageError> {
    if session_id.is_empty()
        || session_id.len() > 64
        || !session_id
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
    {
        return Err(error::UsageError::InvalidSettings);
    }
    Ok(format!("codex://threads/{session_id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_valid_codex_thread_links() {
        let id = "019f0000-0000-7000-8000-000000000099";
        assert_eq!(codex_task_url(id).unwrap(), format!("codex://threads/{id}"));
        for invalid in ["", "../../thread", "abc?redirect=other", "abc;open-other"] {
            assert!(codex_task_url(invalid).is_err());
        }
        assert!(codex_task_url(&"a".repeat(65)).is_err());
    }
}

#[tauri::command]
fn credential_status() -> CredentialReport {
    credentials::inspect_credentials()
}

#[tauri::command]
fn account_mode() -> AccountModeReport {
    credentials::inspect_account_mode()
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
async fn set_refresh_settings(
    app: tauri::AppHandle,
    coordinator: State<'_, RefreshCoordinator>,
    settings: RefreshSettings,
) -> Result<RefreshSettings, UsageErrorPayload> {
    let saved = coordinator
        .set_settings(settings)
        .await
        .map_err(UsageErrorPayload::from)?;
    tray::update(&app, &coordinator.view().await, saved.tray_window);
    Ok(saved)
}

#[tauri::command]
async fn enable_usage(
    app: tauri::AppHandle,
    coordinator: State<'_, RefreshCoordinator>,
) -> Result<UsageView, UsageErrorPayload> {
    let mut settings = coordinator.settings().await;
    settings.usage_enabled = true;
    coordinator
        .set_settings(settings)
        .await
        .map_err(UsageErrorPayload::from)?;
    Ok(coordinator.refresh(&app).await)
}

#[tauri::command]
fn get_autostart(app: tauri::AppHandle) -> Result<bool, UsageErrorPayload> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
        .is_enabled()
        .map_err(|_| UsageErrorPayload::from(error::UsageError::SettingsUnavailable))
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<bool, UsageErrorPayload> {
    use tauri_plugin_autostart::ManagerExt;
    if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    }
    .map_err(|_| UsageErrorPayload::from(error::UsageError::SettingsUnavailable))?;
    Ok(enabled)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticReport {
    app_version: String,
    os: String,
    credential: CredentialReport,
    usage_status: String,
    refresh_settings: RefreshSettings,
}

fn build_diagnostic_report(
    app: &tauri::AppHandle,
    view: UsageView,
    refresh_settings: RefreshSettings,
) -> DiagnosticReport {
    DiagnosticReport {
        app_version: app.package_info().version.to_string(),
        os: std::env::consts::OS.into(),
        credential: credentials::inspect_credentials(),
        usage_status: match view {
            UsageView::Loading => "loading",
            UsageView::Ready { .. } => "ready",
            UsageView::Error { .. } => "error",
        }
        .into(),
        refresh_settings,
    }
}

#[tauri::command]
async fn diagnostic_report(
    app: tauri::AppHandle,
    coordinator: State<'_, RefreshCoordinator>,
) -> Result<DiagnosticReport, UsageErrorPayload> {
    let view = coordinator.view().await;
    Ok(build_diagnostic_report(
        &app,
        view,
        coordinator.settings().await,
    ))
}

#[tauri::command]
async fn export_diagnostic_report(
    app: tauri::AppHandle,
    coordinator: State<'_, RefreshCoordinator>,
    path: String,
) -> Result<(), UsageErrorPayload> {
    let report =
        build_diagnostic_report(&app, coordinator.view().await, coordinator.settings().await);
    let encoded = serde_json::to_vec_pretty(&report)
        .map_err(|_| UsageErrorPayload::from(error::UsageError::SettingsUnavailable))?;
    std::fs::write(path, encoded)
        .map_err(|_| UsageErrorPayload::from(error::UsageError::SettingsUnavailable))
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
fn hide_main_window(app: tauri::AppHandle) -> Result<(), UsageErrorPayload> {
    window::main_window(&app)
        .map_err(UsageErrorPayload::from)?
        .hide()
        .map_err(|_| UsageErrorPayload::from(error::UsageError::WindowUnavailable))
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
fn resize_window_for_view(app: tauri::AppHandle, view: String) -> Result<(), UsageErrorPayload> {
    window::resize_for_view(&app, &view).map_err(UsageErrorPayload::from)
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn sync_surface_tone(app: tauri::AppHandle, dark: bool) -> Result<bool, UsageErrorPayload> {
    let window = window::main_window(&app).map_err(UsageErrorPayload::from)?;
    let ns_view = window
        .ns_view()
        .map_err(|_| UsageErrorPayload::from(error::UsageError::WindowUnavailable))?;
    unsafe extern "C" {
        fn token_usage_sync_surface_tone(view_pointer: *mut std::ffi::c_void, dark: bool) -> bool;
    }
    Ok(unsafe { token_usage_sync_surface_tone(ns_view, dark) })
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn sync_surface_tone(dark: bool) -> bool {
    let _ = dark;
    false
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn screen_capture_allowed() -> bool {
    unsafe extern "C" {
        fn token_usage_screen_capture_allowed() -> bool;
    }
    unsafe { token_usage_screen_capture_allowed() }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn screen_capture_allowed() -> bool {
    false
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn sample_backdrop_luminance(app: tauri::AppHandle) -> Result<f64, UsageErrorPayload> {
    let window = window::main_window(&app).map_err(UsageErrorPayload::from)?;
    let ns_view = window
        .ns_view()
        .map_err(|_| UsageErrorPayload::from(error::UsageError::WindowUnavailable))?;
    unsafe extern "C" {
        fn token_usage_sample_backdrop_luminance(view_pointer: *mut std::ffi::c_void) -> f64;
    }
    let luminance = unsafe { token_usage_sample_backdrop_luminance(ns_view) };
    if !luminance.is_finite() || !(0.0..=1.0).contains(&luminance) {
        return Err(UsageErrorPayload::from(
            error::UsageError::WindowUnavailable,
        ));
    }
    Ok(luminance.clamp(0.0, 1.0))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn sample_backdrop_luminance() -> Result<f64, UsageErrorPayload> {
    Err(UsageErrorPayload::from(
        error::UsageError::WindowUnavailable,
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let window_state = tauri_plugin_window_state::Builder::default()
        .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
        .build();
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Token用量")
                .build(),
        )
        .plugin(window_state)
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let coordinator = RefreshCoordinator::load(app.handle());
            app.manage(coordinator.clone());
            let task_monitor = tasks::TaskMonitor::default();
            app.manage(task_monitor.clone());
            tray::setup(app, coordinator.clone())?;
            let preferences = window::load_preferences(app.handle());
            let initial_view = match preferences.mode {
                window::WindowMode::Compact => "compact",
                window::WindowMode::Detailed => "detailed",
            };
            window::apply_preferences(app.handle(), &preferences)?;
            window::resize_for_view(app.handle(), initial_view)?;
            if let Some(main) = app.get_webview_window("main") {
                let window = main.clone();
                main.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                });
            }
            let updates = update_backend::service(app.handle().clone());
            app.manage(updates.clone());
            updates.start();
            coordinator.start(app.handle().clone());
            task_monitor.start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            update_backend::get_update_state,
            update_backend::check_for_updates,
            update_backend::install_update,
            credential_status,
            account_mode,
            get_tasks,
            open_task,
            get_usage,
            refresh_usage,
            get_refresh_settings,
            set_refresh_interval,
            set_refresh_settings,
            enable_usage,
            get_autostart,
            set_autostart,
            diagnostic_report,
            export_diagnostic_report,
            get_window_preferences,
            set_window_preferences,
            hide_main_window,
            start_window_drag,
            resize_window_for_view,
            sync_surface_tone,
            screen_capture_allowed,
            sample_backdrop_luminance,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Token Usage");
}
