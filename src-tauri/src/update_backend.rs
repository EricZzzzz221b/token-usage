//! Official Tauri transport/installer adapter. Intentionally has no credential imports.
use crate::updates::{
    stable_newer, Backend, Metadata, Progress, Snapshot, Task, UpdateError, UpdateService,
    STABLE_ENDPOINT,
};
use base64::Engine;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};
use tauri_plugin_window_state::AppHandleExt;

pub type Service = Arc<UpdateService<TauriBackend>>;
pub struct TauriBackend {
    app: tauri::AppHandle,
}
pub fn configured() -> bool {
    cfg!(all(
        target_os = "macos",
        target_arch = "aarch64",
        not(debug_assertions)
    )) && option_env!("TOKEN_USAGE_UPDATER_ENABLED") == Some("1")
        && option_env!("TOKEN_USAGE_UPDATER_PUBLIC_KEY").is_some_and(valid_public_key)
}
pub fn valid_public_key(key: &str) -> bool {
    base64::engine::general_purpose::STANDARD
        .decode(key)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .is_some_and(|text| minisign_verify::PublicKey::decode(&text).is_ok())
}
fn secure_configuration(config: Option<&serde_json::Value>) -> bool {
    let Some(config) = config else {
        return false;
    };
    config
        .get("requireSignedVersion")
        .and_then(serde_json::Value::as_bool)
        == Some(true)
        && [
            "allowDowngrades",
            "allow-downgrades",
            "dangerousInsecureTransportProtocol",
            "dangerous-insecure-transport-protocol",
            "dangerousAcceptInvalidCerts",
            "dangerous-accept-invalid-certs",
            "dangerousAcceptInvalidHostnames",
            "dangerous-accept-invalid-hostnames",
        ]
        .iter()
        .all(|key| {
            config
                .get(*key)
                .is_none_or(|value| value.as_bool() == Some(false))
        })
}
pub fn service(app: tauri::AppHandle) -> Service {
    let disabled = if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some(UpdateError::UnsupportedPlatform)
    } else if !configured() || !secure_configuration(app.config().plugins.0.get("updater")) {
        Some(UpdateError::NotConfigured)
    } else {
        // A broken optional updater must not fail the application's setup/run.
        app.plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(option_env!("TOKEN_USAGE_UPDATER_PUBLIC_KEY").unwrap_or_default())
                .build(),
        )
        .err()
        .map(|_| UpdateError::NotConfigured)
    };
    UpdateService::new(
        TauriBackend { app: app.clone() },
        app.package_info().version.to_string(),
        disabled,
    )
}

fn map_error(error: tauri_plugin_updater::Error, downloading: bool) -> UpdateError {
    use tauri_plugin_updater::Error as E;
    match error {
        E::Reqwest(e) if e.is_timeout() => UpdateError::Timeout,
        E::Reqwest(e) if e.is_decode() => UpdateError::Manifest,
        E::Reqwest(_) | E::Network(_) => {
            if downloading {
                UpdateError::Download
            } else {
                UpdateError::Network
            }
        }
        E::TargetNotFound(_) | E::TargetsNotFound(_) => UpdateError::MissingPlatform,
        E::Minisign(_)
        | E::Base64(_)
        | E::SignatureUtf8(_)
        | E::SignedVersionMismatch { .. }
        | E::MissingSignedVersion => UpdateError::Signature,
        E::Io(e) if e.kind() == std::io::ErrorKind::PermissionDenied => UpdateError::NotWritable,
        _ => {
            if downloading {
                UpdateError::Download
            } else {
                UpdateError::Manifest
            }
        }
    }
}

pub fn valid_download_url(version: &str, url: &url::Url) -> bool {
    url.as_str() == format!("https://github.com/EricZzzzz221b/token-usage/releases/download/v{version}/TokenUsage_{version}_arm64.app.tar.gz")
}

fn release_mode_allowed(remote: Option<&str>, installed_mode: Option<&str>) -> bool {
    match remote.unwrap_or("notarized") {
        "notarized" => true,
        "github-ad-hoc" => installed_mode == Some("github-ad-hoc"),
        _ => false,
    }
}
fn confirmation_message(version: &str, mode: Option<&str>) -> String {
    let mut message = format!("下载并安装 Token用量 {version}？安装完成后应用会立即重新启动。正在监控的 Codex 任务不会被停止。\n\nDownload and install {version}? This app will restart after installation. Codex tasks will keep running.");
    if mode == Some("github-ad-hoc") {
        message.push_str("\n\n本应用使用未经 Apple 公证的 GitHub 发行模式。macOS 可能阻止更新后的启动，或要求重新批准系统权限；遇到阻止请使用 DMG 和系统批准流程，不要删除安全属性。\nThis app uses a non-notarized GitHub release mode. macOS may block launch or require permission approval after updating. Use the DMG and system approval flow if needed; do not remove security attributes.");
    }
    message
}

/// This comment is authenticated by Tauri's minisign verification during download.
pub fn signature_version(signature: &str, version: &str) -> Result<(), UpdateError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(signature)
        .map_err(|_| UpdateError::Signature)?;
    let text = std::str::from_utf8(&bytes).map_err(|_| UpdateError::Signature)?;
    let sig = minisign_verify::Signature::decode(text).map_err(|_| UpdateError::Signature)?;
    let fields: Vec<_> = sig
        .trusted_comment()
        .split('\t')
        .filter_map(|field| field.strip_prefix("version:"))
        .collect();
    if fields == [version] {
        Ok(())
    } else {
        Err(UpdateError::Signature)
    }
}

impl Backend for TauriBackend {
    type Package = Update;
    fn check(&self) -> Task<'_, Result<Option<(Metadata, Update)>, UpdateError>> {
        Box::pin(async move {
            let updater = self
                .app
                .updater_builder()
                .endpoints(vec![STABLE_ENDPOINT
                    .parse()
                    .map_err(|_| UpdateError::NotConfigured)?])
                .map_err(|_| UpdateError::NotConfigured)?
                .target("darwin-aarch64")
                .timeout(Duration::from_secs(30))
                .version_comparator(|current, remote| {
                    stable_newer(&current.to_string(), &remote.version.to_string())
                })
                .configure_client(|client| {
                    client
                        .https_only(true)
                        .redirect(updater_http::redirect::Policy::custom(|attempt| {
                            if attempt.previous().len() >= 5
                                || attempt.url().scheme() != "https"
                                || !attempt.url().username().is_empty()
                                || attempt.url().password().is_some()
                            {
                                attempt.error("update redirect rejected")
                            } else {
                                attempt.follow()
                            }
                        }))
                })
                .build()
                .map_err(|_| UpdateError::NotConfigured)?;
            let update = updater.check().await.map_err(|e| map_error(e, false))?;
            let Some(mut update) = update else {
                return Ok(None);
            };
            if !release_mode_allowed(
                update
                    .raw_json
                    .get("macos_signing")
                    .and_then(serde_json::Value::as_str),
                option_env!("TOKEN_USAGE_UPDATER_RELEASE_MODE"),
            ) {
                return Err(UpdateError::Manifest);
            }
            if !update
                .raw_json
                .get("platforms")
                .is_some_and(|p| p.get("darwin-aarch64").is_some())
            {
                return Err(UpdateError::MissingPlatform);
            }
            if !valid_download_url(&update.version, &update.download_url) {
                return Err(UpdateError::Manifest);
            }
            signature_version(&update.signature, &update.version)?;
            update.timeout = Some(Duration::from_secs(15 * 60));
            let metadata = Metadata {
                version: update.version.clone(),
                notes: update
                    .body
                    .clone()
                    .unwrap_or_default()
                    .chars()
                    .take(4000)
                    .collect(),
            };
            Ok(Some((metadata, update)))
        })
    }
    fn preflight(&self) -> Result<(), UpdateError> {
        let exe =
            tauri::utils::platform::current_exe().map_err(|_| UpdateError::InstallLocation)?;
        let exe = std::fs::canonicalize(exe).map_err(|_| UpdateError::InstallLocation)?;
        let bundle = exe
            .ancestors()
            .find(|p| p.extension().is_some_and(|e| e == "app"))
            .ok_or(UpdateError::InstallLocation)?;
        installation_location(bundle, dirs::home_dir().as_deref())?;
        #[cfg(target_os = "macos")]
        {
            use std::os::unix::{ffi::OsStrExt, fs::MetadataExt};
            let parent = bundle.parent().ok_or(UpdateError::InstallLocation)?;
            // The official installer uses renames through system temp; refuse a
            // different filesystem rather than risk an EXDEV after moving the old app.
            if std::fs::metadata(parent)
                .map_err(|_| UpdateError::NotWritable)?
                .dev()
                != std::fs::metadata(std::env::temp_dir())
                    .map_err(|_| UpdateError::NotWritable)?
                    .dev()
            {
                return Err(UpdateError::InstallLocation);
            }
            fn writable(path: &Path) -> bool {
                let Ok(path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
                    return false;
                };
                // access respects ACLs, unlike inspecting mode bits alone.
                unsafe { libc::access(path.as_ptr(), libc::W_OK | libc::X_OK) == 0 }
            }
            fn directories_writable(path: &Path) -> bool {
                if !writable(path) {
                    return false;
                }
                let Ok(mut entries) = std::fs::read_dir(path) else {
                    return false;
                };
                entries.all(|entry| {
                    entry.ok().is_some_and(|e| {
                        e.file_type()
                            .ok()
                            .is_some_and(|t| !t.is_dir() || directories_writable(&e.path()))
                    })
                })
            }
            if !writable(parent) || !directories_writable(bundle) {
                return Err(UpdateError::NotWritable);
            }
        }
        Ok(())
    }
    fn confirm(&self, version: &str) -> Task<'_, Result<bool, UpdateError>> {
        let message =
            confirmation_message(version, option_env!("TOKEN_USAGE_UPDATER_RELEASE_MODE"));
        Box::pin(async move {
            let (tx, rx) = tokio::sync::oneshot::channel();
            let mut dialog = self
                .app
                .dialog()
                .message(message)
                .title("确认更新 / Confirm update")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "更新并重启 / Update & restart".into(),
                    "取消 / Cancel".into(),
                ));
            if let Some(window) = self.app.get_webview_window("main") {
                dialog = dialog.parent(&window);
            }
            dialog.show(move |confirmed| {
                let _ = tx.send(confirmed);
            });
            rx.await.map_err(|_| UpdateError::Confirmation)
        })
    }
    fn download(
        &self,
        package: Update,
        progress: Progress,
    ) -> Task<'_, Result<Vec<u8>, UpdateError>> {
        Box::pin(async move {
            package
                .download(move |chunk, total| progress(chunk, total), || {})
                .await
                .map_err(|e| map_error(e, true))
        })
    }
    fn install(&self, package: Update, bytes: Vec<u8>) -> Task<'_, Result<(), UpdateError>> {
        Box::pin(async move {
            // Save before replacing the app. No settings are recreated or migrated.
            self.app
                .save_window_state(tauri_plugin_window_state::StateFlags::POSITION)
                .map_err(|_| UpdateError::Install)?;
            // Blocking extraction and installation must not occupy the async runtime.
            tauri::async_runtime::spawn_blocking(move || package.install(bytes))
                .await
                .map_err(|_| UpdateError::Install)?
                .map_err(|e| match e {
                    tauri_plugin_updater::Error::Io(io)
                        if io.kind() == std::io::ErrorKind::PermissionDenied =>
                    {
                        UpdateError::NotWritable
                    }
                    _ => UpdateError::Install,
                })
        })
    }
    fn restart(&self) -> Result<(), UpdateError> {
        self.app.restart();
    }
    fn emit(&self, snapshot: &Snapshot) {
        let _ = self.app.emit("updates://changed", snapshot);
        crate::tray::update_notice(&self.app, snapshot);
    }
}

pub fn installation_location(bundle: &Path, home: Option<&Path>) -> Result<(), UpdateError> {
    if bundle
        .components()
        .any(|c| c.as_os_str() == "AppTranslocation")
    {
        return Err(UpdateError::Translocated);
    }
    if bundle.starts_with("/Volumes") {
        return Err(UpdateError::DmgLocation);
    }
    let user_apps: Option<PathBuf> = home.map(|home| home.join("Applications"));
    if bundle.parent() != Some(Path::new("/Applications"))
        && bundle.parent() != user_apps.as_deref()
    {
        return Err(UpdateError::InstallLocation);
    }
    Ok(())
}

#[tauri::command]
pub fn get_update_state(service: tauri::State<'_, Service>) -> Snapshot {
    service.snapshot()
}
#[tauri::command]
pub async fn check_for_updates(service: tauri::State<'_, Service>) -> Result<Snapshot, ()> {
    Ok(service.check(true).await)
}
#[tauri::command]
pub async fn install_update(
    service: tauri::State<'_, Service>,
    version: String,
) -> Result<Snapshot, ()> {
    Ok(service.install(version).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;
    use tauri_plugin_updater::UpdaterExt;

    fn fixture() -> serde_json::Value {
        serde_json::from_str(include_str!("../test-fixtures/updater-test-only.json")).unwrap()
    }
    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert(
            "updater".into(),
            serde_json::json!({
                "pubkey": fixture()["publicEncoded"], "endpoints": [], "requireSignedVersion": true
            }),
        );
        tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap()
    }
    fn manifest(server: &MockServer) -> serde_json::Value {
        serde_json::json!({ "version": "1.3.0", "platforms": { "darwin-aarch64": {
            "url": server.url("/artifact"), "signature": fixture()["signature"]
        } } })
    }
    #[test]
    fn location_policy_and_real_public_key_encoding() {
        assert!(valid_public_key(
            fixture()["publicEncoded"].as_str().unwrap()
        ));
        assert!(!valid_public_key(""));
        assert!(!valid_public_key("fake-public-key"));
        assert!(installation_location(Path::new("/Applications/Test.app"), None).is_ok());
        assert!(installation_location(
            Path::new("/Users/test/Applications/Test.app"),
            Some(Path::new("/Users/test"))
        )
        .is_ok());
        assert_eq!(
            installation_location(Path::new("/Volumes/DMG/Test.app"), None),
            Err(UpdateError::DmgLocation)
        );
        assert_eq!(
            installation_location(Path::new("/private/var/AppTranslocation/x/Test.app"), None),
            Err(UpdateError::Translocated)
        );
        assert_eq!(
            installation_location(Path::new("/tmp/Test.app"), None),
            Err(UpdateError::InstallLocation)
        );
        let url = "https://github.com/EricZzzzz221b/token-usage/releases/download/v1.3.0/TokenUsage_1.3.0_arm64.app.tar.gz".parse().unwrap();
        assert!(valid_download_url("1.3.0", &url));
        assert!(!valid_download_url("1.4.0", &url));
        assert!(signature_version(fixture()["signature"].as_str().unwrap(), "1.3.0").is_ok());
        assert_eq!(
            signature_version(fixture()["signature"].as_str().unwrap(), "1.4.0"),
            Err(UpdateError::Signature)
        );
    }
    #[test]
    fn deliberate_ad_hoc_mode_is_disclosed_and_not_a_notarized_downgrade() {
        assert!(release_mode_allowed(
            Some("github-ad-hoc"),
            Some("github-ad-hoc")
        ));
        assert!(!release_mode_allowed(
            Some("github-ad-hoc"),
            Some("notarized")
        ));
        assert!(!release_mode_allowed(Some("github-ad-hoc"), None));
        assert!(release_mode_allowed(
            Some("notarized"),
            Some("github-ad-hoc")
        ));
        assert!(release_mode_allowed(None, None));
        assert!(!release_mode_allowed(
            Some("unknown"),
            Some("github-ad-hoc")
        ));
        assert!(confirmation_message("1.3.0", Some("github-ad-hoc")).contains("未经 Apple 公证"));
        assert!(!confirmation_message("1.3.0", Some("notarized")).contains("未经 Apple 公证"));
    }
    #[test]
    fn insecure_configuration_never_enables_service() {
        let config = serde_json::json!({ "requireSignedVersion": true });
        assert!(secure_configuration(Some(&config)));
        assert!(!secure_configuration(None));
        assert!(!secure_configuration(Some(
            &serde_json::json!({ "requireSignedVersion": false })
        )));
        for key in [
            "allowDowngrades",
            "dangerousAcceptInvalidCerts",
            "dangerous-accept-invalid-hostnames",
            "dangerousInsecureTransportProtocol",
        ] {
            let mut altered = config.clone();
            altered[key] = true.into();
            assert!(!secure_configuration(Some(&altered)));
        }
    }
    #[tokio::test]
    async fn official_plugin_rejects_malformed_and_missing_platform_manifests() {
        for (body, expected) in [
            ("not json".to_string(), UpdateError::Manifest),
            (
                "{\"version\":\"1.3.0\",\"platforms\":{}}".to_string(),
                UpdateError::MissingPlatform,
            ),
        ] {
            let server = MockServer::start_async().await;
            server.mock(|when, then| {
                when.method(GET).path("/manifest");
                then.status(200).body(body);
            });
            let app = mock_app();
            // Loopback HTTP is permitted by Tauri only in DEBUG test builds. No
            // insecure/certificate bypass flags are enabled here or in production.
            let updater = app
                .updater_builder()
                .target("darwin-aarch64")
                .endpoints(vec![server.url("/manifest").parse().unwrap()])
                .unwrap()
                .build()
                .unwrap();
            assert_eq!(
                map_error(updater.check().await.err().unwrap(), false),
                expected
            );
        }
    }
    #[tokio::test]
    async fn official_download_verifies_bytes_key_and_authenticated_version() {
        for case in [
            "good",
            "tampered",
            "wrong-signature",
            "wrong-version",
            "download-failed",
        ] {
            let server = MockServer::start_async().await;
            let mut response = manifest(&server);
            if case == "wrong-version" {
                response["version"] = "1.4.0".into();
            }
            if case == "wrong-signature" {
                response["platforms"]["darwin-aarch64"]["signature"] = "eA==".into();
            }
            server.mock(|when, then| {
                when.method(GET).path("/manifest");
                then.status(200).json_body(response);
            });
            server.mock(|when, then| {
                when.method(GET).path("/artifact");
                if case == "download-failed" {
                    then.status(503);
                } else {
                    then.status(200).body(if case == "tampered" {
                        "tampered".into()
                    } else {
                        fixture()["payload"].as_str().unwrap().to_string()
                    });
                }
            });
            let app = mock_app();
            let update = app
                .updater_builder()
                .target("darwin-aarch64")
                .endpoints(vec![server.url("/manifest").parse().unwrap()])
                .unwrap()
                .build()
                .unwrap()
                .check()
                .await
                .unwrap()
                .unwrap();
            let result = update.download(|_, _| {}, || {}).await;
            match case {
                "good" => assert_eq!(
                    result.unwrap(),
                    fixture()["payload"].as_str().unwrap().as_bytes()
                ),
                "download-failed" => assert_eq!(
                    map_error(result.err().unwrap(), true),
                    UpdateError::Download
                ),
                _ => assert_eq!(
                    map_error(result.err().unwrap(), true),
                    UpdateError::Signature
                ),
            }
        }
    }
}
