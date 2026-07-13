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
use window::WindowPreferences;

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

#[tauri::command]
fn backdrop_is_dark(app: tauri::AppHandle) -> Result<bool, UsageErrorPayload> {
    window::backdrop_is_dark(&app).map_err(UsageErrorPayload::from)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let window_state = tauri_plugin_window_state::Builder::default()
        .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
        .build();
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
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
            coordinator.start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            credential_status,
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
            start_window_drag,
            resize_window_for_view,
            backdrop_is_dark
        ])
        .run(tauri::generate_context!())
        .expect("error while running Token Usage");
}
