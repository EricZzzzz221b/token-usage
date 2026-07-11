use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Emitter, Manager,
};

use crate::refresh::{RefreshCoordinator, UsageView};

const TRAY_ID: &str = "token-usage";
const SUMMARY_ID: &str = "usage-summary";
const SHOW_ID: &str = "show-window";
const REFRESH_ID: &str = "refresh-usage";
const MODE_ID: &str = "toggle-window-mode";
const INTERACTION_ID: &str = "restore-interaction";
const QUIT_ID: &str = "quit";

pub fn setup(app: &mut App, coordinator: RefreshCoordinator) -> tauri::Result<()> {
    let menu = build_menu(app, "正在读取用量…")?;

    let icon = app.default_window_icon().cloned();
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Token用量")
        .title("--%")
        .icon_as_template(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            SHOW_ID => show_window(app),
            REFRESH_ID => {
                let coordinator = coordinator.clone();
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    coordinator.refresh(&app).await;
                });
            }
            MODE_ID => {
                let mut preferences = crate::window::load_preferences(app);
                preferences.mode = match preferences.mode {
                    crate::window::WindowMode::Compact => crate::window::WindowMode::Detailed,
                    crate::window::WindowMode::Detailed => crate::window::WindowMode::Compact,
                };
                let _ = crate::window::apply_preferences(app, &preferences);
                let _ = crate::window::save_preferences(app, &preferences);
                let _ = app.emit("window://preferences", &preferences);
                show_window(app);
            }
            INTERACTION_ID => crate::window::disable_click_through(app),
            QUIT_ID => app.exit(0),
            _ => {}
        });
    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

pub fn update(app: &AppHandle, view: &UsageView) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let (title, tooltip, summary) = tray_text(view);
    let _ = tray.set_title(Some(title));
    let _ = tray.set_tooltip(Some(tooltip));
    if let Ok(menu) = build_menu(app, &summary) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_menu<R: tauri::Runtime, M: Manager<R>>(
    manager: &M,
    summary_text: &str,
) -> tauri::Result<Menu<R>> {
    let summary = MenuItem::with_id(manager, SUMMARY_ID, summary_text, false, None::<&str>)?;
    let show = MenuItem::with_id(manager, SHOW_ID, "显示 Token用量", true, None::<&str>)?;
    let refresh = MenuItem::with_id(manager, REFRESH_ID, "立即刷新", true, None::<&str>)?;
    let mode = MenuItem::with_id(manager, MODE_ID, "切换紧凑/详细模式", true, None::<&str>)?;
    let interaction =
        MenuItem::with_id(manager, INTERACTION_ID, "恢复浮窗交互", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(manager)?;
    let quit = MenuItem::with_id(manager, QUIT_ID, "退出", true, None::<&str>)?;
    Menu::with_items(
        manager,
        &[
            &summary,
            &show,
            &refresh,
            &mode,
            &interaction,
            &separator,
            &quit,
        ],
    )
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn tray_text(view: &UsageView) -> (String, String, String) {
    match view {
        UsageView::Loading => (
            "--%".into(),
            "Token用量 · 正在读取".into(),
            "正在读取用量…".into(),
        ),
        UsageView::Error { .. } => (
            "!".into(),
            "Token用量 · 查询失败".into(),
            "用量查询失败".into(),
        ),
        UsageView::Ready {
            snapshot, stale, ..
        } => {
            let max = snapshot
                .windows
                .iter()
                .map(|window| window.used_percent.round() as i64)
                .max()
                .unwrap_or(0);
            let title = if *stale {
                format!("~{max}%")
            } else {
                format!("{max}%")
            };
            let details = snapshot
                .windows
                .iter()
                .map(|window| format!("{} {:.0}%", window.label, window.used_percent))
                .collect::<Vec<_>>()
                .join(" · ");
            (title, format!("Token用量 · {details}"), details)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{UsageSnapshot, UsageWindow};

    #[test]
    fn highest_window_drives_tray_title() {
        let view = UsageView::Ready {
            snapshot: UsageSnapshot {
                source: "codex_oauth",
                queried_at: 1,
                windows: vec![
                    UsageWindow {
                        id: "five_hour".into(),
                        label: "5 hours".into(),
                        duration_seconds: None,
                        used_percent: 42.0,
                        reset_at: None,
                    },
                    UsageWindow {
                        id: "seven_day".into(),
                        label: "7 days".into(),
                        duration_seconds: None,
                        used_percent: 68.0,
                        reset_at: None,
                    },
                ],
            },
            stale: false,
            last_error: None,
        };
        assert_eq!(tray_text(&view).0, "68%");
    }
}
