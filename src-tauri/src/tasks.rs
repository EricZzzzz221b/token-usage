use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Thinking,
    Executing,
    Waiting,
    Completed,
    Failed,
    Interrupted,
    Unknown,
}

const ACTIVE_STALE_AFTER_MILLIS: i64 = 12 * 60 * 60 * 1_000;
const WAITING_STALE_AFTER_MILLIS: i64 = 72 * 60 * 60 * 1_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexTask {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub project: String,
    pub status: TaskStatus,
    pub started_at: i64,
    pub updated_at: i64,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSnapshot {
    pub tasks: Vec<CodexTask>,
    pub queried_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FileFingerprint {
    len: u64,
    modified: Option<SystemTime>,
}

impl FileFingerprint {
    fn from_metadata(metadata: &fs::Metadata) -> Self {
        Self {
            len: metadata.len(),
            modified: metadata.modified().ok(),
        }
    }
}

#[derive(Clone)]
struct CachedRollout {
    fingerprint: FileFingerprint,
    parser: RolloutParser,
}

#[derive(Clone)]
struct RolloutParser {
    offset: u64,
    title: String,
    project: String,
    turn_id: String,
    started_at: i64,
    updated_at: i64,
    completed_at: Option<i64>,
    status: TaskStatus,
    is_subagent: bool,
    session_id: String,
}

impl Default for RolloutParser {
    fn default() -> Self {
        Self {
            offset: 0,
            title: String::new(),
            project: String::new(),
            turn_id: String::new(),
            started_at: 0,
            updated_at: 0,
            completed_at: None,
            status: TaskStatus::Unknown,
            is_subagent: false,
            session_id: String::new(),
        }
    }
}

#[derive(Default)]
struct TitleCache {
    fingerprint: Option<FileFingerprint>,
    titles: HashMap<String, String>,
}

#[derive(Default)]
struct SessionScanner {
    rollouts: HashMap<PathBuf, CachedRollout>,
    sidebar_titles: TitleCache,
    database_titles: TitleCache,
    last_database_refresh: Option<Instant>,
    #[cfg(test)]
    parse_count: usize,
}

#[derive(Clone)]
pub struct TaskMonitor {
    snapshot: Arc<RwLock<TaskSnapshot>>,
    scanner: Arc<Mutex<SessionScanner>>,
}

impl Default for TaskMonitor {
    fn default() -> Self {
        Self {
            snapshot: Arc::new(RwLock::new(TaskSnapshot::default())),
            scanner: Arc::new(Mutex::new(SessionScanner::default())),
        }
    }
}

impl TaskMonitor {
    pub fn snapshot(&self) -> TaskSnapshot {
        self.snapshot
            .read()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_default()
    }

    pub fn start(&self, app: AppHandle) {
        let monitor = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut previous = monitor.scan();
            monitor.store_snapshot(previous.clone());
            let _ = app.emit("tasks://updated", &previous);
            let mut last_tray_refresh = Instant::now();
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                let current = monitor.scan();
                notify_completions(&app, &previous, &current);
                let tasks_changed = current.tasks != previous.tasks;
                monitor.store_snapshot(current.clone());
                if tasks_changed {
                    let _ = app.emit("tasks://updated", &current);
                }
                previous = current;
                if tasks_changed || last_tray_refresh.elapsed() >= Duration::from_secs(30) {
                    let coordinator = app.state::<crate::refresh::RefreshCoordinator>();
                    let settings = coordinator.settings().await;
                    crate::tray::update(&app, &coordinator.view().await, settings.tray_window);
                    last_tray_refresh = Instant::now();
                }
            }
        });
    }

    fn scan(&self) -> TaskSnapshot {
        self.scanner
            .lock()
            .map(|mut scanner| scanner.scan(&codex_home()))
            .unwrap_or_else(|_| self.snapshot())
    }

    fn store_snapshot(&self, next: TaskSnapshot) {
        if let Ok(mut snapshot) = self.snapshot.write() {
            *snapshot = next;
        }
    }
}

fn codex_home() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|path| path.join(".codex")))
        .unwrap_or_else(|| PathBuf::from(".codex"))
}

impl SessionScanner {
    fn scan(&mut self, home: &Path) -> TaskSnapshot {
        refresh_title_cache(
            &mut self.sidebar_titles,
            &home.join("session_index.jsonl"),
            || load_sidebar_titles(home),
        );
        let database_path = database_path(home);
        let database_refresh_due = self
            .last_database_refresh
            .is_none_or(|last| last.elapsed() >= Duration::from_secs(30));
        if database_refresh_due {
            refresh_optional_title_cache(
                &mut self.database_titles,
                database_path.as_deref(),
                database_path.as_deref().and_then(database_fingerprint),
                || load_database_titles(home),
            );
            self.last_database_refresh = Some(Instant::now());
        }

        let mut files = Vec::new();
        collect_jsonl(&home.join("sessions"), 0, &mut files);
        let mut files = files
            .into_iter()
            .filter_map(|path| {
                let metadata = fs::metadata(&path).ok()?;
                let fingerprint = FileFingerprint::from_metadata(&metadata);
                Some((path, fingerprint))
            })
            .collect::<Vec<_>>();
        files.sort_by_key(|(_, fingerprint)| fingerprint.modified);
        files.reverse();
        files.truncate(40);

        let retained = files
            .iter()
            .map(|(path, _)| path.clone())
            .collect::<std::collections::HashSet<_>>();
        self.rollouts.retain(|path, _| retained.contains(path));

        let mut tasks = files
            .into_iter()
            .filter_map(|(path, fingerprint)| {
                let needs_parse = self
                    .rollouts
                    .get(&path)
                    .is_none_or(|cached| cached.fingerprint != fingerprint);
                if needs_parse {
                    #[cfg(test)]
                    {
                        self.parse_count += 1;
                    }
                    let parser = self.rollouts.remove(&path).map(|cached| cached.parser);
                    let parser =
                        update_rollout_parser(&path, parser, fingerprint.len).unwrap_or_default();
                    self.rollouts.insert(
                        path.clone(),
                        CachedRollout {
                            fingerprint,
                            parser,
                        },
                    );
                }
                self.rollouts
                    .get(&path)
                    .and_then(|cached| {
                        task_from_parser(
                            &path,
                            &cached.parser,
                            &self.sidebar_titles.titles,
                            &self.database_titles.titles,
                        )
                    })
                    .map(refresh_stale_status)
            })
            .collect::<Vec<_>>();
        tasks.sort_by_key(|task| std::cmp::Reverse(task.updated_at));
        tasks.truncate(20);
        TaskSnapshot {
            tasks,
            queried_at: now_millis(),
        }
    }
}

fn refresh_title_cache<F>(cache: &mut TitleCache, path: &Path, load: F) -> bool
where
    F: FnOnce() -> HashMap<String, String>,
{
    let fingerprint = fs::metadata(path)
        .ok()
        .map(|metadata| FileFingerprint::from_metadata(&metadata));
    if cache.fingerprint == fingerprint {
        return false;
    }
    cache.fingerprint = fingerprint;
    cache.titles = load();
    true
}

fn refresh_optional_title_cache<F>(
    cache: &mut TitleCache,
    path: Option<&Path>,
    fingerprint: Option<FileFingerprint>,
    load: F,
) -> bool
where
    F: FnOnce() -> HashMap<String, String>,
{
    match path {
        Some(_) if cache.fingerprint == fingerprint => false,
        Some(_) => {
            cache.fingerprint = fingerprint;
            cache.titles = load();
            true
        }
        None if cache.fingerprint.is_some() || !cache.titles.is_empty() => {
            cache.fingerprint = None;
            cache.titles.clear();
            true
        }
        None => false,
    }
}

fn collect_jsonl(directory: &Path, depth: usize, output: &mut Vec<PathBuf>) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl(&path, depth + 1, output);
        } else if path.extension().is_some_and(|value| value == "jsonl") {
            output.push(path);
        }
    }
}

fn load_sidebar_titles(home: &Path) -> HashMap<String, String> {
    let Ok(file) = fs::File::open(home.join("session_index.jsonl")) else {
        return HashMap::new();
    };
    let mut latest = HashMap::<String, (i64, String)>::new();
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(id) = value.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(title) = value.get("thread_name").and_then(Value::as_str) else {
            continue;
        };
        if title.trim().is_empty() {
            continue;
        }
        let updated_at = value
            .get("updated_at")
            .and_then(Value::as_str)
            .and_then(parse_timestamp)
            .unwrap_or_default();
        let entry = latest.entry(id.to_owned()).or_default();
        if updated_at >= entry.0 {
            *entry = (updated_at, title.trim().to_owned());
        }
    }
    latest
        .into_iter()
        .map(|(id, (_, title))| (id, title))
        .collect()
}

fn load_database_titles(home: &Path) -> HashMap<String, String> {
    let Some(database) = database_path(home) else {
        return HashMap::new();
    };
    let Ok(connection) = Connection::open_with_flags(
        database,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return HashMap::new();
    };
    let Ok(mut statement) = connection.prepare(
        "SELECT rollout_path, title FROM threads WHERE title <> '' AND rollout_path <> ''",
    ) else {
        return HashMap::new();
    };
    statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .collect()
}

fn database_path(home: &Path) -> Option<PathBuf> {
    [
        home.join("state_5.sqlite"),
        home.join("sqlite/state_5.sqlite"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

fn database_fingerprint(path: &Path) -> Option<FileFingerprint> {
    let metadata = fs::metadata(path).ok()?;
    let mut fingerprint = FileFingerprint::from_metadata(&metadata);
    let mut wal_path = path.as_os_str().to_os_string();
    wal_path.push("-wal");
    if let Ok(wal_metadata) = fs::metadata(PathBuf::from(wal_path)) {
        fingerprint.len = fingerprint.len.saturating_add(wal_metadata.len());
        if let Ok(wal_modified) = wal_metadata.modified() {
            fingerprint.modified = fingerprint.modified.max(Some(wal_modified));
        }
    }
    Some(fingerprint)
}

#[cfg(test)]
fn parse_rollout(
    path: &Path,
    sidebar_titles: &HashMap<String, String>,
    database_titles: &HashMap<String, String>,
) -> Option<CodexTask> {
    let len = fs::metadata(path).ok()?.len();
    let parser = update_rollout_parser(path, None, len)?;
    task_from_parser(path, &parser, sidebar_titles, database_titles).map(refresh_stale_status)
}

fn update_rollout_parser(
    path: &Path,
    previous: Option<RolloutParser>,
    file_len: u64,
) -> Option<RolloutParser> {
    let mut parser = previous.unwrap_or_default();
    if file_len < parser.offset {
        parser = RolloutParser::default();
    }
    let mut file = fs::File::open(path).ok()?;
    file.seek(SeekFrom::Start(parser.offset)).ok()?;
    let mut reader = BufReader::new(file);
    loop {
        let line_start = reader.stream_position().ok()?;
        let mut line = String::new();
        let read = reader.read_line(&mut line).ok()?;
        if read == 0 {
            break;
        }
        if !line.ends_with('\n') {
            parser.offset = line_start;
            break;
        }
        parser.offset = reader.stream_position().ok()?;
        let Ok(value) = serde_json::from_str::<Value>(line.trim_end()) else {
            continue;
        };
        parser.process(&value);
    }
    Some(parser)
}

impl RolloutParser {
    fn process(&mut self, value: &Value) {
        let timestamp = value
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_timestamp)
            .unwrap_or_default();
        self.updated_at = self.updated_at.max(timestamp);
        if value.get("type").and_then(Value::as_str) == Some("session_meta") {
            self.session_id = value
                .pointer("/payload/session_id")
                .or_else(|| value.pointer("/payload/id"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            self.is_subagent = value
                .pointer("/payload/source")
                .is_some_and(Value::is_object);
            if let Some(cwd) = value.pointer("/payload/cwd").and_then(Value::as_str) {
                self.project = Path::new(cwd)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(cwd)
                    .to_owned();
            }
        }
        if value.pointer("/payload/type").and_then(Value::as_str) == Some("user_message") {
            if let Some(message) = value.pointer("/payload/message").and_then(Value::as_str) {
                self.title = compact_title(message);
            }
        }
        match value.pointer("/payload/type").and_then(Value::as_str) {
            Some("task_started") => {
                self.turn_id = value
                    .pointer("/payload/turn_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                self.started_at = timestamp;
                self.completed_at = None;
                self.status = TaskStatus::Thinking;
            }
            Some("task_complete") => {
                self.completed_at = Some(timestamp);
                self.status = TaskStatus::Completed;
            }
            Some("turn_aborted") => {
                self.completed_at = Some(timestamp);
                self.status = TaskStatus::Failed;
            }
            _ => {}
        }
        if self.completed_at.is_some() {
            return;
        }
        match value.get("type").and_then(Value::as_str) {
            Some("response_item") => match value.pointer("/payload/type").and_then(Value::as_str) {
                Some("reasoning") => self.status = TaskStatus::Thinking,
                Some("custom_tool_call") => {
                    let input = value
                        .pointer("/payload/input")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    self.status = if input.contains("require_escalated")
                        || input.contains("request_user_input")
                    {
                        TaskStatus::Waiting
                    } else {
                        TaskStatus::Executing
                    };
                }
                Some("custom_tool_call_output") => self.status = TaskStatus::Thinking,
                _ => {}
            },
            Some("event_msg")
                if matches!(
                    value.pointer("/payload/type").and_then(Value::as_str),
                    Some("agent_reasoning")
                ) =>
            {
                self.status = TaskStatus::Thinking;
            }
            _ => {}
        }
    }
}

fn task_from_parser(
    path: &Path,
    parser: &RolloutParser,
    sidebar_titles: &HashMap<String, String>,
    database_titles: &HashMap<String, String>,
) -> Option<CodexTask> {
    if parser.started_at == 0 || parser.is_subagent {
        return None;
    }
    let title = if let Some(sidebar_title) = sidebar_titles.get(&parser.session_id) {
        compact_title(sidebar_title)
    } else if let Some(session_title) = database_titles.get(&path.to_string_lossy().into_owned()) {
        compact_title(session_title)
    } else if parser.title.is_empty() {
        "Codex 任务".into()
    } else {
        parser.title.clone()
    };
    let project = if parser.project.is_empty() {
        "Codex".into()
    } else {
        parser.project.clone()
    };
    Some(CodexTask {
        id: if parser.turn_id.is_empty() {
            path.file_stem()?.to_string_lossy().into_owned()
        } else {
            parser.turn_id.clone()
        },
        session_id: parser.session_id.clone(),
        title,
        project,
        status: parser.status.clone(),
        started_at: parser.started_at,
        updated_at: parser.updated_at,
        completed_at: parser.completed_at,
    })
}

fn refresh_stale_status(mut task: CodexTask) -> CodexTask {
    let stale_after = if task.status == TaskStatus::Waiting {
        WAITING_STALE_AFTER_MILLIS
    } else {
        ACTIVE_STALE_AFTER_MILLIS
    };
    if is_active(&task.status) && now_millis().saturating_sub(task.updated_at) > stale_after {
        task.status = TaskStatus::Interrupted;
        task.completed_at = Some(task.updated_at);
    }
    task
}

fn compact_title(message: &str) -> String {
    let line = message
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or(message);
    let mut chars = line.trim().chars();
    let title = chars.by_ref().take(44).collect::<String>();
    if chars.next().is_some() {
        format!("{title}…")
    } else {
        title
    }
}

fn parse_timestamp(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|time| time.timestamp_millis())
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn notify_completions(app: &AppHandle, previous: &TaskSnapshot, current: &TaskSnapshot) {
    for task in &current.tasks {
        let was_running = previous
            .tasks
            .iter()
            .find(|old| old.id == task.id)
            .is_some_and(|old| is_active(&old.status));
        if was_running && task.status == TaskStatus::Completed {
            let _ = app
                .notification()
                .builder()
                .title("Codex 已完成")
                .body(format!("{} · {}", task.project, task.title))
                .show();
        }
    }
}

pub fn is_active(status: &TaskStatus) -> bool {
    matches!(
        status,
        TaskStatus::Thinking | TaskStatus::Executing | TaskStatus::Waiting
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compacts_long_titles() {
        assert!(compact_title(&"好".repeat(60)).ends_with('…'));
        assert_eq!(compact_title("\n  short task\nmore"), "short task");
    }

    #[test]
    fn sidebar_title_overrides_database_and_user_message() {
        let path =
            std::env::temp_dir().join(format!("token-usage-title-{}.jsonl", std::process::id()));
        fs::write(
            &path,
            concat!(
                "{\"timestamp\":\"2026-07-22T00:00:00Z\",\"type\":\"session_meta\",\"payload\":{\"session_id\":\"session-title\",\"source\":\"vscode\",\"cwd\":\"/tmp/project\"}}\n",
                "{\"timestamp\":\"2026-07-22T00:00:01Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn-title\"}}\n",
                "{\"timestamp\":\"2026-07-22T00:00:02Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"最新用户消息\"}}\n",
                "{\"timestamp\":\"2026-07-22T00:00:03Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\"}}\n"
            ),
        )
        .expect("write titled rollout");
        let mut sidebar_titles = HashMap::new();
        sidebar_titles.insert("session-title".into(), "侧边栏会话标题".into());
        let mut database_titles = HashMap::new();
        database_titles.insert(path.to_string_lossy().into_owned(), "数据库原始标题".into());
        let task =
            parse_rollout(&path, &sidebar_titles, &database_titles).expect("parse titled rollout");
        let _ = fs::remove_file(path);
        assert_eq!(task.title, "侧边栏会话标题");
    }

    #[test]
    fn latest_sidebar_rename_wins() {
        let home =
            std::env::temp_dir().join(format!("token-usage-sidebar-titles-{}", std::process::id()));
        fs::create_dir_all(&home).expect("create title directory");
        fs::write(
            home.join("session_index.jsonl"),
            concat!(
                "{\"id\":\"session-1\",\"thread_name\":\"旧标题\",\"updated_at\":\"2026-07-22T00:00:00Z\"}\n",
                "{\"id\":\"session-1\",\"thread_name\":\"侧边栏最新标题\",\"updated_at\":\"2026-07-22T00:10:00Z\"}\n",
                "{\"id\":\"session-2\",\"thread_name\":\"其他标题\",\"updated_at\":\"2026-07-22T00:05:00Z\"}\n"
            ),
        )
        .expect("write session index");
        let titles = load_sidebar_titles(&home);
        let _ = fs::remove_dir_all(home);
        assert_eq!(
            titles.get("session-1").map(String::as_str),
            Some("侧边栏最新标题")
        );
    }

    #[test]
    fn stale_unfinished_rollout_is_interrupted() {
        let path = std::env::temp_dir().join(format!(
            "token-usage-stale-task-{}.jsonl",
            std::process::id()
        ));
        fs::write(
            &path,
            concat!(
                "{\"timestamp\":\"2020-01-01T00:00:00Z\",\"type\":\"session_meta\",\"payload\":{\"source\":\"vscode\",\"cwd\":\"/tmp/project\"}}\n",
                "{\"timestamp\":\"2020-01-01T00:00:01Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"stale task\"}}\n",
                "{\"timestamp\":\"2020-01-01T00:00:02Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn-1\"}}\n",
                "{\"timestamp\":\"2020-01-01T00:00:03Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"reasoning\"}}\n"
            ),
        )
        .expect("write stale rollout");
        let task =
            parse_rollout(&path, &HashMap::new(), &HashMap::new()).expect("parse stale rollout");
        let _ = fs::remove_file(path);
        assert_eq!(task.status, TaskStatus::Interrupted);
        assert_eq!(task.completed_at, Some(task.updated_at));
    }

    #[test]
    fn terminal_event_cannot_be_overwritten_by_later_noise() {
        let path = std::env::temp_dir().join(format!(
            "token-usage-terminal-task-{}.jsonl",
            std::process::id()
        ));
        fs::write(
            &path,
            concat!(
                "{\"timestamp\":\"2026-07-22T00:00:00Z\",\"type\":\"session_meta\",\"payload\":{\"source\":\"vscode\",\"cwd\":\"/tmp/project\"}}\n",
                "{\"timestamp\":\"2026-07-22T00:00:01Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn-2\"}}\n",
                "{\"timestamp\":\"2026-07-22T00:00:02Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\"}}\n",
                "{\"timestamp\":\"2026-07-22T00:00:03Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"reasoning\"}}\n"
            ),
        )
        .expect("write completed rollout");
        let task = parse_rollout(&path, &HashMap::new(), &HashMap::new())
            .expect("parse completed rollout");
        let _ = fs::remove_file(path);
        assert_eq!(task.status, TaskStatus::Completed);
    }

    #[test]
    fn completed_newer_turn_wins_over_unclosed_older_turn() {
        let path = std::env::temp_dir().join(format!(
            "token-usage-overlapping-turns-{}.jsonl",
            std::process::id()
        ));
        fs::write(
            &path,
            concat!(
                "{\"timestamp\":\"2026-07-22T00:00:00Z\",\"type\":\"session_meta\",\"payload\":{\"source\":\"vscode\",\"cwd\":\"/tmp/project\"}}\n",
                "{\"timestamp\":\"2026-07-22T00:00:01Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"older-unclosed\"}}\n",
                "{\"timestamp\":\"2026-07-22T00:00:02Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"newer\"}}\n",
                "{\"timestamp\":\"2026-07-22T00:00:03Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"newer\"}}\n"
            ),
        )
        .expect("write overlapping rollout");
        let task = parse_rollout(&path, &HashMap::new(), &HashMap::new())
            .expect("parse overlapping rollout");
        let _ = fs::remove_file(path);
        assert_eq!(task.status, TaskStatus::Completed);
    }

    #[test]
    fn scanner_reuses_unchanged_rollouts_and_reparses_changed_files() {
        let home = tempfile::tempdir().expect("create temporary Codex home");
        let sessions = home.path().join("sessions/2026/07/22");
        fs::create_dir_all(&sessions).expect("create sessions directory");
        let rollout = sessions.join("rollout-test.jsonl");
        fs::write(
            &rollout,
            concat!(
                "{\"timestamp\":\"2026-07-22T00:00:00Z\",\"type\":\"session_meta\",\"payload\":{\"session_id\":\"cache-test\",\"source\":\"vscode\",\"cwd\":\"/tmp/project\"}}\n",
                "{\"timestamp\":\"2026-07-22T00:00:01Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"cached-turn\"}}\n"
            ),
        )
        .expect("write rollout");

        let mut scanner = SessionScanner::default();
        let first = scanner.scan(home.path());
        let second = scanner.scan(home.path());
        assert_eq!(scanner.parse_count, 1);
        assert_eq!(first.tasks, second.tasks);

        use std::io::Write;
        writeln!(
            fs::OpenOptions::new()
                .append(true)
                .open(&rollout)
                .expect("open rollout"),
            "{{\"timestamp\":\"2026-07-22T00:00:02Z\",\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_complete\"}}}}"
        )
        .expect("append completion");
        let third = scanner.scan(home.path());
        assert_eq!(scanner.parse_count, 2);
        assert_eq!(third.tasks[0].status, TaskStatus::Completed);
    }

    #[test]
    fn title_changes_do_not_reparse_rollouts() {
        let home = tempfile::tempdir().expect("create temporary Codex home");
        let sessions = home.path().join("sessions/2026/07/22");
        fs::create_dir_all(&sessions).expect("create sessions directory");
        fs::write(
            sessions.join("rollout-title-cache.jsonl"),
            concat!(
                "{\"timestamp\":\"2026-07-22T00:00:00Z\",\"type\":\"session_meta\",\"payload\":{\"session_id\":\"title-cache\",\"source\":\"vscode\",\"cwd\":\"/tmp/project\"}}\n",
                "{\"timestamp\":\"2026-07-22T00:00:01Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"title-turn\"}}\n"
            ),
        )
        .expect("write rollout");
        let mut scanner = SessionScanner::default();
        scanner.scan(home.path());
        assert_eq!(scanner.parse_count, 1);

        fs::write(
            home.path().join("session_index.jsonl"),
            "{\"id\":\"title-cache\",\"thread_name\":\"更新后的标题\",\"updated_at\":\"2026-07-22T00:01:00Z\"}\n",
        )
        .expect("write title index");
        let updated = scanner.scan(home.path());
        assert_eq!(scanner.parse_count, 1);
        assert_eq!(updated.tasks[0].title, "更新后的标题");
    }

    #[test]
    fn incremental_parser_resumes_at_previous_byte_offset() {
        let home = tempfile::tempdir().expect("create temporary directory");
        let rollout = home.path().join("rollout-incremental.jsonl");
        fs::write(
            &rollout,
            concat!(
                "{\"timestamp\":\"2026-07-22T00:00:00Z\",\"type\":\"session_meta\",\"payload\":{\"session_id\":\"incremental\",\"source\":\"vscode\"}}\n",
                "{\"timestamp\":\"2026-07-22T00:00:01Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"incremental-turn\"}}\n"
            ),
        )
        .expect("write rollout");
        let initial_len = fs::metadata(&rollout).expect("rollout metadata").len();
        let parser = update_rollout_parser(&rollout, None, initial_len).expect("initial parse");
        assert_eq!(parser.offset, initial_len);

        use std::io::Write;
        writeln!(
            fs::OpenOptions::new()
                .append(true)
                .open(&rollout)
                .expect("open rollout"),
            "{{\"timestamp\":\"2026-07-22T00:00:02Z\",\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_complete\"}}}}"
        )
        .expect("append completion");
        let final_len = fs::metadata(&rollout).expect("rollout metadata").len();
        let parser =
            update_rollout_parser(&rollout, Some(parser), final_len).expect("incremental parse");
        assert_eq!(parser.offset, final_len);
        assert_eq!(parser.status, TaskStatus::Completed);
    }

    #[test]
    fn incremental_parser_rebuilds_after_file_truncation() {
        let home = tempfile::tempdir().expect("create temporary directory");
        let rollout = home.path().join("rollout-truncated.jsonl");
        fs::write(
            &rollout,
            concat!(
                "{\"timestamp\":\"2026-07-22T00:00:00Z\",\"type\":\"session_meta\",\"payload\":{\"session_id\":\"old-session-with-a-long-id\",\"source\":\"vscode\",\"cwd\":\"/tmp/a-long-project-name\"}}\n",
                "{\"timestamp\":\"2026-07-22T00:00:01Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"old-turn-with-a-long-id\"}}\n"
            ),
        )
        .expect("write initial rollout");
        let initial_len = fs::metadata(&rollout).expect("initial metadata").len();
        let parser = update_rollout_parser(&rollout, None, initial_len).expect("initial parse");

        fs::write(
            &rollout,
            "{\"timestamp\":\"2026-07-22T00:01:00Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"new\"}}\n",
        )
        .expect("replace rollout");
        let truncated_len = fs::metadata(&rollout).expect("truncated metadata").len();
        assert!(truncated_len < parser.offset);
        let parser = update_rollout_parser(&rollout, Some(parser), truncated_len)
            .expect("rebuild truncated rollout");
        assert_eq!(parser.turn_id, "new");
        assert!(parser.session_id.is_empty());
        assert_eq!(parser.offset, truncated_len);
    }
}
