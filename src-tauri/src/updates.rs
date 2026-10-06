//! Isolated update coordinator. No credentials, usage providers, or diagnostic exports.
use serde::Serialize;
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    time::Duration,
};

pub const START_DELAY: Duration = Duration::from_secs(30);
pub const CHECK_INTERVAL: Duration = Duration::from_secs(12 * 60 * 60);
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
pub const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);
pub const STABLE_ENDPOINT: &str =
    "https://raw.githubusercontent.com/EricZzzzz221b/token-usage/macos-stable/updates/macos/stable.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateError {
    NotConfigured,
    UnsupportedPlatform,
    Network,
    Timeout,
    Manifest,
    MissingPlatform,
    Signature,
    Download,
    Install,
    DmgLocation,
    Translocated,
    InstallLocation,
    NotWritable,
    StaleSelection,
    Confirmation,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Disabled,
    Idle,
    Checking,
    Available,
    UpToDate,
    Confirming,
    Downloading,
    Installing,
    Restarting,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub version: String,
    pub notes: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub current_version: String,
    pub enabled: bool,
    pub phase: Phase,
    pub update: Option<Metadata>,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub error: Option<UpdateError>,
    /// Only successful background discoveries or explicit user actions become notices.
    pub visible: bool,
    pub revision: u64,
}

pub type Task<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
pub type Progress = Arc<dyn Fn(usize, Option<u64>) + Send + Sync>;
pub type CheckResult<P> = Result<Option<(Metadata, P)>, UpdateError>;
pub trait Backend: Send + Sync + 'static {
    type Package: Clone + Send + Sync;
    fn check(&self) -> Task<'_, CheckResult<Self::Package>>;
    fn preflight(&self) -> Result<(), UpdateError>;
    fn confirm(&self, version: &str) -> Task<'_, Result<bool, UpdateError>>;
    /// Must return only signature-verified bytes; production delegates to Tauri.
    fn download(
        &self,
        package: Self::Package,
        progress: Progress,
    ) -> Task<'_, Result<Vec<u8>, UpdateError>>;
    fn install(&self, package: Self::Package, bytes: Vec<u8>) -> Task<'_, Result<(), UpdateError>>;
    fn restart(&self) -> Result<(), UpdateError>;
    fn emit(&self, snapshot: &Snapshot);
}

struct Inner<P> {
    snapshot: Snapshot,
    package: Option<P>,
}
pub struct UpdateService<B: Backend> {
    backend: B,
    inner: Mutex<Inner<B::Package>>,
    operation: tokio::sync::Mutex<()>,
    started: std::sync::atomic::AtomicBool,
}

impl<B: Backend> UpdateService<B> {
    pub fn new(backend: B, current_version: String, disabled: Option<UpdateError>) -> Arc<Self> {
        Arc::new(Self {
            backend,
            operation: tokio::sync::Mutex::new(()),
            started: std::sync::atomic::AtomicBool::new(false),
            inner: Mutex::new(Inner {
                snapshot: Snapshot {
                    current_version,
                    enabled: disabled.is_none(),
                    phase: if disabled.is_some() {
                        Phase::Disabled
                    } else {
                        Phase::Idle
                    },
                    update: None,
                    downloaded: 0,
                    total: None,
                    error: disabled,
                    visible: false,
                    revision: 0,
                },
                package: None,
            }),
        })
    }
    pub fn snapshot(&self) -> Snapshot {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .snapshot
            .clone()
    }
    fn change(&self, f: impl FnOnce(&mut Inner<B::Package>)) -> Snapshot {
        let snapshot = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            let revision = inner.snapshot.revision;
            f(&mut inner);
            inner.snapshot.revision = revision + 1;
            inner.snapshot.clone()
        };
        self.backend.emit(&snapshot);
        snapshot
    }
    fn fail(&self, error: UpdateError) -> Snapshot {
        self.change(|i| {
            i.snapshot.phase = Phase::Error;
            i.snapshot.error = Some(error);
            i.snapshot.visible = true;
        })
    }
    pub fn start(self: &Arc<Self>) {
        if !self.snapshot().enabled || self.started.swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            return;
        }
        let service = self.clone();
        tauri::async_runtime::spawn(service.schedule());
    }
    async fn schedule(self: Arc<Self>) {
        tokio::time::sleep(START_DELAY).await;
        loop {
            self.check(false).await;
            // No burst of catch-up requests after suspension.
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    }
    pub async fn check(&self, manual: bool) -> Snapshot {
        let _guard = match self.operation.try_lock() {
            Ok(guard) => guard,
            Err(_) => {
                if manual && self.snapshot().phase == Phase::Checking {
                    self.change(|i| i.snapshot.visible = true);
                    // Join the in-flight operation, never queue a second request.
                    let _joined = self.operation.lock().await;
                }
                return self.snapshot();
            }
        };
        let before = self.snapshot();
        if !before.enabled {
            return if manual {
                self.change(|i| i.snapshot.visible = true)
            } else {
                before
            };
        }
        self.change(|i| {
            i.snapshot.phase = Phase::Checking;
            i.snapshot.error = None;
            i.snapshot.visible = manual;
        });
        let result = tokio::time::timeout(CHECK_TIMEOUT, self.backend.check())
            .await
            .unwrap_or(Err(UpdateError::Timeout));
        let explicit = manual || self.snapshot().visible;
        match result {
            Ok(Some((metadata, package)))
                if stable_newer(&before.current_version, &metadata.version) =>
            {
                self.change(|i| {
                    i.snapshot.phase = Phase::Available;
                    i.snapshot.update = Some(metadata);
                    i.package = Some(package);
                    i.snapshot.visible = true;
                })
            }
            Ok(_) => self.change(|i| {
                i.snapshot.phase = Phase::UpToDate;
                i.snapshot.update = None;
                i.package = None;
                i.snapshot.visible = explicit;
            }),
            Err(error) if explicit => self.fail(error),
            Err(_) => self.change(|i| {
                i.snapshot = before;
            }),
        }
    }
    pub async fn install(&self, expected_version: String) -> Snapshot {
        let Ok(_guard) = self.operation.try_lock() else {
            return self.snapshot();
        };
        if !self.snapshot().enabled {
            return self.change(|i| i.snapshot.visible = true);
        }
        if self.snapshot().phase == Phase::Restarting {
            return self.snapshot();
        }
        let package = {
            let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if inner.snapshot.update.as_ref().map(|u| &u.version) != Some(&expected_version) {
                drop(inner);
                return self.fail(UpdateError::StaleSelection);
            }
            inner.package.clone()
        };
        let Some(package) = package else {
            return self.fail(UpdateError::StaleSelection);
        };
        if let Err(error) = self.backend.preflight() {
            return self.fail(error);
        }
        self.change(|i| {
            i.snapshot.phase = Phase::Confirming;
            i.snapshot.error = None;
            i.snapshot.visible = true;
        });
        match self.backend.confirm(&expected_version).await {
            Ok(true) => (),
            Ok(false) => return self.change(|i| i.snapshot.phase = Phase::Available),
            Err(error) => return self.fail(error),
        }
        self.change(|i| {
            i.snapshot.phase = Phase::Downloading;
            i.snapshot.downloaded = 0;
            i.snapshot.total = None;
        });
        let result = self.download(package.clone()).await;
        let bytes = match result {
            Ok(bytes) => bytes,
            Err(error) => return self.fail(error),
        };
        if let Err(error) = self.backend.preflight() {
            return self.fail(error);
        }
        self.change(|i| i.snapshot.phase = Phase::Installing);
        if let Err(error) = self.backend.install(package, bytes).await {
            return self.fail(error);
        }
        self.change(|i| {
            i.snapshot.phase = Phase::Restarting;
            i.package = None;
        });
        if let Err(error) = self.backend.restart() {
            return self.fail(error);
        }
        self.snapshot()
    }
    async fn download(&self, package: B::Package) -> Result<Vec<u8>, UpdateError> {
        // Coalesced latest progress: bounded memory even when UI/event handling lags.
        let (tx, mut rx) = tokio::sync::watch::channel((0u64, None));
        let received = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let progress: Progress = Arc::new(move |chunk, total| {
            let downloaded = received.fetch_add(chunk as u64, std::sync::atomic::Ordering::Relaxed)
                + chunk as u64;
            tx.send_replace((downloaded, total));
        });
        let download =
            tokio::time::timeout(DOWNLOAD_TIMEOUT, self.backend.download(package, progress));
        tokio::pin!(download);
        loop {
            tokio::select! {
                result = &mut download => {
                    let (downloaded, total) = *rx.borrow_and_update();
                    self.progress(downloaded, total);
                    return result.unwrap_or(Err(UpdateError::Timeout));
                }
                Ok(()) = rx.changed() => {
                    let (downloaded, total) = *rx.borrow_and_update();
                    self.progress(downloaded, total);
                }
            }
        }
    }

    fn progress(&self, downloaded: u64, total: Option<u64>) {
        self.change(|i| {
            i.snapshot.downloaded = downloaded;
            i.snapshot.total = total;
        });
    }
}

pub fn stable_newer(current: &str, remote: &str) -> bool {
    match (
        semver::Version::parse(current),
        semver::Version::parse(remote),
    ) {
        (Ok(current), Ok(remote)) => {
            remote.pre.is_empty() && remote.build.is_empty() && remote > current
        }
        _ => false,
    }
}

#[cfg(test)]
#[path = "updates_tests.rs"]
mod tests;
