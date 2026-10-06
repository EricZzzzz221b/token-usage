use super::*;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
#[derive(Default)]
struct Mock {
    remote: Mutex<Option<String>>,
    check_error: Mutex<Option<UpdateError>>,
    download_error: Mutex<Option<UpdateError>>,
    install_error: Mutex<Option<UpdateError>>,
    location_error: Mutex<Option<UpdateError>>,
    confirmed: AtomicBool,
    checks: AtomicUsize,
    downloads: AtomicUsize,
    installs: AtomicUsize,
    restarts: AtomicUsize,
    pause: AtomicBool,
    release: tokio::sync::Notify,
}
impl Backend for Arc<Mock> {
    type Package = ();
    fn check(&self) -> Task<'_, Result<Option<(Metadata, ())>, UpdateError>> {
        Box::pin(async move {
            self.checks.fetch_add(1, Ordering::SeqCst);
            if self.pause.load(Ordering::SeqCst) {
                self.release.notified().await;
            }
            if let Some(e) = *self.check_error.lock().unwrap() {
                return Err(e);
            }
            Ok(self.remote.lock().unwrap().clone().map(|version| {
                (
                    Metadata {
                        version,
                        notes: "safe notes".into(),
                    },
                    (),
                )
            }))
        })
    }
    fn preflight(&self) -> Result<(), UpdateError> {
        self.location_error.lock().unwrap().map_or(Ok(()), Err)
    }
    fn confirm(&self, _: &str) -> Task<'_, Result<bool, UpdateError>> {
        Box::pin(async { Ok(self.confirmed.load(Ordering::SeqCst)) })
    }
    fn download(&self, _: (), progress: Progress) -> Task<'_, Result<Vec<u8>, UpdateError>> {
        Box::pin(async move {
            self.downloads.fetch_add(1, Ordering::SeqCst);
            if self.pause.load(Ordering::SeqCst) {
                self.release.notified().await;
            }
            progress(3, Some(5));
            progress(2, Some(5));
            self.download_error
                .lock()
                .unwrap()
                .map_or(Ok(vec![0; 5]), Err)
        })
    }
    fn install(&self, _: (), _: Vec<u8>) -> Task<'_, Result<(), UpdateError>> {
        Box::pin(async move {
            self.installs.fetch_add(1, Ordering::SeqCst);
            self.install_error.lock().unwrap().map_or(Ok(()), Err)
        })
    }
    fn restart(&self) -> Result<(), UpdateError> {
        self.restarts.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn emit(&self, _: &Snapshot) {}
}
fn setup() -> (Arc<Mock>, Arc<UpdateService<Arc<Mock>>>) {
    let mock = Arc::new(Mock::default());
    mock.confirmed.store(true, Ordering::SeqCst);
    let service = UpdateService::new(mock.clone(), "1.2.7".into(), None);
    (mock, service)
}
#[tokio::test]
async fn stable_only_monotonic_versions_and_clear_results() {
    for remote in [
        None,
        Some("1.2.7"),
        Some("1.2.6"),
        Some("1.3.0-beta.1"),
        Some("1.3.0+build"),
        Some("bad"),
        Some("1.3.0"),
    ] {
        let (mock, service) = setup();
        *mock.remote.lock().unwrap() = remote.map(str::to_string);
        let state = service.check(true).await;
        assert!(state.visible);
        assert_eq!(
            state.phase,
            if remote == Some("1.3.0") {
                Phase::Available
            } else {
                Phase::UpToDate
            }
        );
    }
    assert!(!stable_newer("invalid", "1.3.0"));
}
#[tokio::test]
async fn automatic_failure_is_quiet_but_manual_failure_is_explicit() {
    for error in [
        UpdateError::Network,
        UpdateError::Timeout,
        UpdateError::Manifest,
        UpdateError::MissingPlatform,
    ] {
        let (mock, service) = setup();
        *mock.check_error.lock().unwrap() = Some(error);
        let state = service.check(false).await;
        assert_eq!(state.phase, Phase::Idle);
        assert!(!state.visible);
        assert_eq!(service.check(true).await.error, Some(error));
    }
    let (_, service) = setup();
    assert!(!service.check(false).await.visible);
}
#[tokio::test]
async fn failure_preserves_offer_and_never_installs_or_restarts() {
    for error in [
        UpdateError::Signature,
        UpdateError::Download,
        UpdateError::Timeout,
    ] {
        let (mock, service) = setup();
        *mock.remote.lock().unwrap() = Some("1.3.0".into());
        service.check(false).await;
        *mock.download_error.lock().unwrap() = Some(error);
        assert_eq!(service.install("1.3.0".into()).await.error, Some(error));
        assert_eq!(mock.installs.load(Ordering::SeqCst), 0);
        assert_eq!(mock.restarts.load(Ordering::SeqCst), 0);
        assert_eq!(service.snapshot().current_version, "1.2.7");
        *mock.download_error.lock().unwrap() = None;
        let success = service.install("1.3.0".into()).await;
        assert_eq!(success.phase, Phase::Restarting);
        assert_eq!(success.downloaded, 5);
        service.install("1.3.0".into()).await;
        assert_eq!(mock.installs.load(Ordering::SeqCst), 1);
        assert_eq!(mock.restarts.load(Ordering::SeqCst), 1);
    }
}
#[tokio::test]
async fn confirmation_and_locations_block_before_download() {
    for error in [
        UpdateError::DmgLocation,
        UpdateError::Translocated,
        UpdateError::NotWritable,
        UpdateError::InstallLocation,
    ] {
        let (mock, service) = setup();
        *mock.remote.lock().unwrap() = Some("1.3.0".into());
        service.check(true).await;
        *mock.location_error.lock().unwrap() = Some(error);
        assert_eq!(service.install("1.3.0".into()).await.error, Some(error));
        assert_eq!(mock.downloads.load(Ordering::SeqCst), 0);
    }
    let (mock, service) = setup();
    *mock.remote.lock().unwrap() = Some("1.3.0".into());
    service.check(true).await;
    mock.confirmed.store(false, Ordering::SeqCst);
    assert_eq!(
        service.install("1.3.0".into()).await.phase,
        Phase::Available
    );
    assert_eq!(mock.downloads.load(Ordering::SeqCst), 0);
    assert_eq!(
        service.install("1.4.0".into()).await.error,
        Some(UpdateError::StaleSelection)
    );
}
#[tokio::test]
async fn concurrent_manual_check_joins_background_and_install_is_not_queued() {
    let (mock, service) = setup();
    mock.pause.store(true, Ordering::SeqCst);
    *mock.check_error.lock().unwrap() = Some(UpdateError::Network);
    let first = {
        let s = service.clone();
        tokio::spawn(async move { s.check(false).await })
    };
    while mock.checks.load(Ordering::SeqCst) == 0 {
        tokio::task::yield_now().await;
    }
    let second = {
        let s = service.clone();
        tokio::spawn(async move { s.check(true).await })
    };
    while !service.snapshot().visible {
        tokio::task::yield_now().await;
    }
    assert_eq!(service.install("1.3.0".into()).await.phase, Phase::Checking);
    mock.release.notify_one();
    assert_eq!(first.await.unwrap().error, Some(UpdateError::Network));
    assert_eq!(second.await.unwrap().error, Some(UpdateError::Network));
    assert_eq!(mock.checks.load(Ordering::SeqCst), 1);
}
#[tokio::test(start_paused = true)]
async fn actual_timeout_is_bounded() {
    let (mock, service) = setup();
    mock.pause.store(true, Ordering::SeqCst);
    assert_eq!(service.check(true).await.error, Some(UpdateError::Timeout));
}
#[tokio::test]
async fn install_failure_does_not_restart() {
    let (mock, service) = setup();
    *mock.remote.lock().unwrap() = Some("1.3.0".into());
    service.check(true).await;
    *mock.install_error.lock().unwrap() = Some(UpdateError::Install);
    assert_eq!(
        service.install("1.3.0".into()).await.error,
        Some(UpdateError::Install)
    );
    assert_eq!(mock.restarts.load(Ordering::SeqCst), 0);
}
#[tokio::test(start_paused = true)]
async fn schedule_starts_at_30_seconds_then_every_12_hours_and_disabled_is_inert() {
    let (mock, service) = setup();
    let schedule = tokio::spawn(service.clone().schedule());
    tokio::task::yield_now().await;
    tokio::time::advance(Duration::from_secs(29)).await;
    tokio::task::yield_now().await;
    assert_eq!(mock.checks.load(Ordering::SeqCst), 0);
    tokio::time::advance(Duration::from_secs(1)).await;
    tokio::task::yield_now().await;
    assert_eq!(mock.checks.load(Ordering::SeqCst), 1);
    tokio::time::advance(CHECK_INTERVAL).await;
    tokio::task::yield_now().await;
    assert_eq!(mock.checks.load(Ordering::SeqCst), 2);
    schedule.abort();
    let disabled = UpdateService::new(
        mock.clone(),
        "1.2.7".into(),
        Some(UpdateError::NotConfigured),
    );
    disabled.start();
    assert_eq!(disabled.check(true).await.phase, Phase::Disabled);
    assert_eq!(mock.checks.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn duplicate_install_and_background_checks_never_overlap_download() {
    let (mock, service) = setup();
    *mock.remote.lock().unwrap() = Some("1.3.0".into());
    service.check(true).await;
    mock.pause.store(true, Ordering::SeqCst);
    let first = {
        let service = service.clone();
        tokio::spawn(async move { service.install("1.3.0".into()).await })
    };
    while mock.downloads.load(Ordering::SeqCst) == 0 {
        tokio::task::yield_now().await;
    }
    assert_eq!(
        service.install("1.3.0".into()).await.phase,
        Phase::Downloading
    );
    assert_eq!(service.check(false).await.phase, Phase::Downloading);
    assert_eq!(service.check(true).await.phase, Phase::Downloading);
    assert_eq!(mock.downloads.load(Ordering::SeqCst), 1);
    assert_eq!(mock.checks.load(Ordering::SeqCst), 1);
    mock.release.notify_one();
    assert_eq!(first.await.unwrap().phase, Phase::Restarting);
    assert_eq!(mock.installs.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn quiet_failure_never_regresses_event_revision() {
    let (mock, service) = setup();
    let previous = service.check(false).await.revision;
    *mock.check_error.lock().unwrap() = Some(UpdateError::Network);
    let failed = service.check(false).await;
    assert!(failed.revision > previous);
    assert!(!failed.visible);
}
