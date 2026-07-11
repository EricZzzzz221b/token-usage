mod credentials;
mod error;
mod model;
mod usage;

use credentials::CredentialReport;
use error::UsageErrorPayload;
use model::UsageSnapshot;

#[tauri::command]
fn credential_status() -> CredentialReport {
    credentials::inspect_credentials()
}

#[tauri::command]
async fn fetch_usage() -> Result<UsageSnapshot, UsageErrorPayload> {
    let credentials = credentials::read_credentials().map_err(UsageErrorPayload::from)?;
    usage::UsageClient::official()
        .fetch(&credentials)
        .await
        .map_err(UsageErrorPayload::from)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![credential_status, fetch_usage])
        .run(tauri::generate_context!())
        .expect("error while running Token Usage");
}
