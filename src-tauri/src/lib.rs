mod credentials;
mod error;
mod model;
mod refresh;
mod tray;
mod usage;

use credentials::CredentialReport;
use error::UsageErrorPayload;
use refresh::{RefreshCoordinator, RefreshSettings, UsageView};
use tauri::{Manager, State};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let coordinator = RefreshCoordinator::load(app.handle());
            app.manage(coordinator.clone());
            tray::setup(app, coordinator.clone())?;
            coordinator.start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            credential_status,
            get_usage,
            refresh_usage,
            get_refresh_settings,
            set_refresh_interval
        ])
        .run(tauri::generate_context!())
        .expect("error while running Token Usage");
}
