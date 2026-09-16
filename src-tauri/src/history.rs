use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{error::UsageError, model::UsageSnapshot};

const DAY_MILLIS: i64 = 24 * 60 * 60 * 1_000;
const MAX_CHART_POINTS: usize = 180;
const MAX_HISTORY_SNAPSHOTS: usize = 8_640;
const COMPACT_EVERY_APPENDS: usize = 256;
const MAX_HISTORY_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HistoryRange {
    OneDay,
    SevenDays,
    ThirtyDays,
}

impl HistoryRange {
    fn duration_millis(self) -> i64 {
        match self {
            Self::OneDay => DAY_MILLIS,
            Self::SevenDays => 7 * DAY_MILLIS,
            Self::ThirtyDays => 30 * DAY_MILLIS,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageHistoryPoint {
    pub queried_at: i64,
    pub remaining_percent: f64,
    pub reset: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageHistorySeries {
    pub range: HistoryRange,
    pub window_id: String,
    pub points: Vec<UsageHistoryPoint>,
    pub sample_count: usize,
    pub current_remaining: Option<f64>,
    pub minimum_remaining: Option<f64>,
    pub maximum_remaining: Option<f64>,
    pub consumption_per_hour: Option<f64>,
    pub projected_exhaustion_at: Option<i64>,
}

pub fn read_series(
    app: &AppHandle,
    range: HistoryRange,
    window_id: &str,
) -> Result<UsageHistorySeries, UsageError> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| UsageError::SettingsUnavailable)?;
    Ok(read_series_from_path(
        &directory.join("usage-history.jsonl"),
        range,
        window_id,
        now_millis(),
    ))
}

pub fn export_csv(
    app: &AppHandle,
    range: HistoryRange,
    window_id: &str,
) -> Result<String, UsageError> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| UsageError::SettingsUnavailable)?;
    let series = read_series_from_path(
        &directory.join("usage-history.jsonl"),
        range,
        window_id,
        now_millis(),
    );
    let mut csv = String::from("queried_at,remaining_percent,reset\n");
    for point in series.points {
        csv.push_str(&format!(
            "{},{:.2},{}\n",
            point.queried_at, point.remaining_percent, point.reset
        ));
    }
    Ok(csv)
}

pub fn clear(app: &AppHandle) -> Result<(), UsageError> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| UsageError::SettingsUnavailable)?;
    match fs::remove_file(directory.join("usage-history.jsonl")) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(UsageError::SettingsUnavailable),
    }
}

pub fn append_snapshot(
    app: &AppHandle,
    snapshot: &UsageSnapshot,
    appends_since_compaction: &mut usize,
) {
    let Ok(directory) = app.path().app_data_dir() else {
        return;
    };
    let _ = append_snapshot_to_path(
        &directory.join("usage-history.jsonl"),
        snapshot,
        appends_since_compaction,
        now_millis(),
    );
}

fn append_snapshot_to_path(
    path: &Path,
    snapshot: &UsageSnapshot,
    appends_since_compaction: &mut usize,
    now: i64,
) -> Result<(), UsageError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| UsageError::SettingsUnavailable)?;
    }
    let mut line = serde_json::to_vec(snapshot).map_err(|_| UsageError::SettingsUnavailable)?;
    line.push(b'\n');
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut file| file.write_all(&line))
        .map_err(|_| UsageError::SettingsUnavailable)?;

    *appends_since_compaction = appends_since_compaction.saturating_add(1);
    let oversized = fs::metadata(path).is_ok_and(|metadata| metadata.len() > MAX_HISTORY_BYTES);
    if *appends_since_compaction >= COMPACT_EVERY_APPENDS || oversized {
        compact_snapshot_file(path, now)?;
        *appends_since_compaction = 0;
    }
    Ok(())
}

fn compact_snapshot_file(path: &Path, now: i64) -> Result<(), UsageError> {
    let cutoff = now.saturating_sub(30 * DAY_MILLIS);
    let history = fs::read_to_string(path).unwrap_or_default();
    let mut retained = history
        .lines()
        .filter_map(|line| serde_json::from_str::<UsageSnapshot>(line).ok())
        .filter(|snapshot| snapshot.queried_at >= cutoff)
        .collect::<Vec<_>>();
    retained.sort_by_key(|snapshot| snapshot.queried_at);
    if retained.len() > MAX_HISTORY_SNAPSHOTS {
        retained.drain(..retained.len() - MAX_HISTORY_SNAPSHOTS);
    }
    let mut output = Vec::new();
    for snapshot in retained {
        if let Ok(mut line) = serde_json::to_vec(&snapshot) {
            line.push(b'\n');
            output.extend(line);
        }
    }
    fs::write(path, output).map_err(|_| UsageError::SettingsUnavailable)
}

fn read_series_from_path(
    path: &Path,
    range: HistoryRange,
    window_id: &str,
    now: i64,
) -> UsageHistorySeries {
    let cutoff = now.saturating_sub(range.duration_millis());
    let history = fs::read_to_string(path).unwrap_or_default();
    let mut snapshots = history
        .lines()
        .filter_map(|line| serde_json::from_str::<UsageSnapshot>(line).ok())
        .filter(|snapshot| snapshot.queried_at >= cutoff && snapshot.queried_at <= now)
        .collect::<Vec<_>>();
    snapshots.sort_by_key(|snapshot| snapshot.queried_at);

    let mut previous_reset_at = None;
    let all_points = snapshots
        .iter()
        .filter_map(|snapshot| {
            snapshot
                .windows
                .iter()
                .find(|window| window.id == window_id)
                .map(|window| {
                    let reset = previous_reset_at.is_some_and(|previous| {
                        window.reset_at.is_some() && window.reset_at != Some(previous)
                    });
                    previous_reset_at = window.reset_at;
                    UsageHistoryPoint {
                        queried_at: snapshot.queried_at,
                        remaining_percent: (100.0 - window.used_percent).clamp(0.0, 100.0),
                        reset,
                    }
                })
        })
        .collect::<Vec<_>>();

    let sample_count = all_points.len();
    let current_remaining = all_points.last().map(|point| point.remaining_percent);
    let minimum_remaining = all_points
        .iter()
        .map(|point| point.remaining_percent)
        .reduce(f64::min);
    let maximum_remaining = all_points
        .iter()
        .map(|point| point.remaining_percent)
        .reduce(f64::max);
    let points = downsample(&all_points, MAX_CHART_POINTS);
    let (consumption_per_hour, projected_exhaustion_at) = consumption_projection(&all_points);

    UsageHistorySeries {
        range,
        window_id: window_id.to_owned(),
        points,
        sample_count,
        current_remaining,
        minimum_remaining,
        maximum_remaining,
        consumption_per_hour,
        projected_exhaustion_at,
    }
}

fn consumption_projection(points: &[UsageHistoryPoint]) -> (Option<f64>, Option<i64>) {
    let segment_start = points.iter().rposition(|point| point.reset).unwrap_or(0);
    let segment = &points[segment_start..];
    let (Some(first), Some(last)) = (segment.first(), segment.last()) else {
        return (None, None);
    };
    let elapsed_hours = (last.queried_at - first.queried_at) as f64 / 3_600_000.0;
    let consumed = first.remaining_percent - last.remaining_percent;
    if segment.len() < 3 || elapsed_hours < 0.5 || consumed <= 0.0 {
        return (None, None);
    }
    let rate = consumed / elapsed_hours;
    if !rate.is_finite() || rate < 0.1 {
        return (None, None);
    }
    let remaining_hours = last.remaining_percent / rate;
    if !remaining_hours.is_finite() || !(0.0..=30.0 * 24.0).contains(&remaining_hours) {
        return (Some(rate), None);
    }
    let projected = last
        .queried_at
        .saturating_add((remaining_hours * 3_600_000.0).round() as i64);
    (Some(rate), Some(projected))
}

fn downsample(points: &[UsageHistoryPoint], limit: usize) -> Vec<UsageHistoryPoint> {
    if points.len() <= limit || limit < 2 {
        return points.to_vec();
    }

    let last_index = points.len() - 1;
    let mut selected = BTreeSet::from([0, last_index]);
    for (index, point) in points.iter().enumerate() {
        if point.reset {
            selected.insert(index);
        }
    }
    for index in 0..limit {
        if selected.len() >= limit {
            break;
        }
        selected.insert(index * last_index / (limit - 1));
    }
    selected
        .into_iter()
        .map(|index| points[index].clone())
        .collect()
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use crate::model::{UsageSnapshot, UsageWindow};

    use super::*;

    fn snapshot(queried_at: i64, used_percent: f64) -> UsageSnapshot {
        UsageSnapshot {
            source: "codex_oauth".into(),
            windows: vec![UsageWindow {
                id: "five_hour".into(),
                label: "5 hours".into(),
                duration_seconds: Some(18_000),
                used_percent,
                reset_at: None,
            }],
            queried_at,
            plan_type: None,
            credits: None,
            reset_credits: None,
        }
    }

    #[test]
    fn filters_history_by_range_and_computes_remaining_stats() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("usage-history.jsonl");
        let mut file = fs::File::create(&path).expect("history file");
        let now = 40 * DAY_MILLIS;
        for item in [
            snapshot(now - 2 * DAY_MILLIS, 20.0),
            snapshot(now - 60_000, 40.0),
            snapshot(now, 70.0),
        ] {
            writeln!(file, "{}", serde_json::to_string(&item).unwrap()).unwrap();
        }

        let series = read_series_from_path(&path, HistoryRange::OneDay, "five_hour", now);

        assert_eq!(series.sample_count, 2);
        assert_eq!(series.current_remaining, Some(30.0));
        assert_eq!(series.minimum_remaining, Some(30.0));
        assert_eq!(series.maximum_remaining, Some(60.0));
    }

    #[test]
    fn downsamples_large_series_and_preserves_endpoints() {
        let points = (0..500)
            .map(|index| UsageHistoryPoint {
                queried_at: index,
                remaining_percent: index as f64 / 5.0,
                reset: index == 251,
            })
            .collect::<Vec<_>>();

        let sampled = downsample(&points, 180);

        assert_eq!(sampled.len(), 180);
        assert_eq!(sampled.first(), points.first());
        assert_eq!(sampled.last(), points.last());
        assert!(sampled.iter().any(|point| point.reset));
    }

    #[test]
    fn marks_a_changed_reset_time_as_a_reset_event() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("usage-history.jsonl");
        let mut file = fs::File::create(&path).expect("history file");
        let mut first = snapshot(100, 80.0);
        first.windows[0].reset_at = Some(200);
        let mut second = snapshot(200, 40.0);
        second.windows[0].reset_at = Some(300);
        for item in [first, second] {
            writeln!(file, "{}", serde_json::to_string(&item).unwrap()).unwrap();
        }

        let series = read_series_from_path(&path, HistoryRange::OneDay, "five_hour", 1_000);

        assert_eq!(series.points.len(), 2);
        assert!(!series.points[0].reset);
        assert!(series.points[1].reset);
    }

    #[test]
    fn estimates_consumption_only_with_enough_declining_history() {
        let points = vec![
            UsageHistoryPoint {
                queried_at: 0,
                remaining_percent: 80.0,
                reset: false,
            },
            UsageHistoryPoint {
                queried_at: 1_800_000,
                remaining_percent: 70.0,
                reset: false,
            },
            UsageHistoryPoint {
                queried_at: 3_600_000,
                remaining_percent: 60.0,
                reset: false,
            },
        ];

        let (rate, projected) = consumption_projection(&points);

        assert_eq!(rate, Some(20.0));
        assert_eq!(projected, Some(14_400_000));
        assert_eq!(consumption_projection(&points[..2]), (None, None));
    }

    #[test]
    fn appends_snapshots_without_rewriting_existing_history() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("usage-history.jsonl");
        let mut appends = 0;

        append_snapshot_to_path(&path, &snapshot(100, 10.0), &mut appends, 200).unwrap();
        append_snapshot_to_path(&path, &snapshot(200, 20.0), &mut appends, 200).unwrap();

        let history = fs::read_to_string(path).unwrap();
        assert_eq!(history.lines().count(), 2);
        assert_eq!(appends, 2);
    }

    #[test]
    fn periodic_compaction_drops_expired_and_malformed_rows() {
        let directory = tempfile::tempdir().expect("temp directory");
        let path = directory.path().join("usage-history.jsonl");
        let now = 40 * DAY_MILLIS;
        let expired = snapshot(now - 31 * DAY_MILLIS, 10.0);
        let retained = snapshot(now - DAY_MILLIS, 20.0);
        fs::write(
            &path,
            format!(
                "{}\nnot-json\n{}\n",
                serde_json::to_string(&expired).unwrap(),
                serde_json::to_string(&retained).unwrap()
            ),
        )
        .unwrap();
        let mut appends = COMPACT_EVERY_APPENDS - 1;

        append_snapshot_to_path(&path, &snapshot(now, 30.0), &mut appends, now).unwrap();

        let snapshots = fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<UsageSnapshot>(line).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(snapshots.len(), 2);
        assert_eq!(snapshots[0].queried_at, retained.queried_at);
        assert_eq!(snapshots[1].queried_at, now);
        assert_eq!(appends, 0);
    }
}
