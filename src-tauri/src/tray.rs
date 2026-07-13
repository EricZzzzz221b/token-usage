use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Emitter, Manager,
};

use crate::refresh::{RefreshCoordinator, TrayWindow, UsageView};

const TRAY_ID: &str = "token-usage";
const SUMMARY_ID: &str = "usage-summary";
const SHOW_ID: &str = "show-window";
const REFRESH_ID: &str = "refresh-usage";
const MODE_ID: &str = "toggle-window-mode";
const INTERACTION_ID: &str = "restore-interaction";
const FIVE_HOUR_ID: &str = "tray-five-hour";
const SEVEN_DAY_ID: &str = "tray-seven-day";
const QUIT_ID: &str = "quit";

pub fn setup(app: &mut App, coordinator: RefreshCoordinator) -> tauri::Result<()> {
    let menu = build_menu(app, "正在读取用量…", TrayWindow::FiveHour)?;

    #[cfg(target_os = "windows")]
    let icon = Image::from_bytes(include_bytes!("../icons/tray-windows.png")).ok();
    #[cfg(not(target_os = "windows"))]
    let icon = Image::from_bytes(include_bytes!("../icons/status-bar.png")).ok();
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Token用量")
        .title("--%")
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
                let view = match preferences.mode {
                    crate::window::WindowMode::Compact => "compact",
                    crate::window::WindowMode::Detailed => "detailed",
                };
                let _ = crate::window::apply_preferences(app, &preferences);
                let _ = crate::window::resize_for_view(app, view);
                let _ = crate::window::save_preferences(app, &preferences);
                let _ = app.emit("window://preferences", &preferences);
                let _ = app.emit("window://mode-changed", &preferences);
                show_window(app);
            }
            FIVE_HOUR_ID => select_tray_window(app, &coordinator, TrayWindow::FiveHour),
            SEVEN_DAY_ID => select_tray_window(app, &coordinator, TrayWindow::SevenDay),
            INTERACTION_ID => crate::window::disable_click_through(app),
            QUIT_ID => app.exit(0),
            _ => {}
        });
    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }
    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

pub fn update(app: &AppHandle, view: &UsageView, tray_window: TrayWindow) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let (title, tooltip, summary) = tray_text(view, tray_window);
    let _ = tray.set_title(Some(title));
    let _ = tray.set_tooltip(Some(tooltip));
    if let Ok(menu) = build_menu(app, &summary, tray_window) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_menu<R: tauri::Runtime, M: Manager<R>>(
    manager: &M,
    summary_text: &str,
    tray_window: TrayWindow,
) -> tauri::Result<Menu<R>> {
    let summary = MenuItem::with_id(manager, SUMMARY_ID, summary_text, false, None::<&str>)?;
    let show = MenuItem::with_id(manager, SHOW_ID, "显示 Token用量", true, None::<&str>)?;
    let refresh = MenuItem::with_id(manager, REFRESH_ID, "立即刷新", true, None::<&str>)?;
    let mode = MenuItem::with_id(manager, MODE_ID, "切换紧凑/详细模式", true, None::<&str>)?;
    let five_hour = CheckMenuItem::with_id(
        manager,
        FIVE_HOUR_ID,
        "托盘显示：5 小时",
        true,
        tray_window == TrayWindow::FiveHour,
        None::<&str>,
    )?;
    let seven_day = CheckMenuItem::with_id(
        manager,
        SEVEN_DAY_ID,
        "托盘显示：7 天",
        true,
        tray_window == TrayWindow::SevenDay,
        None::<&str>,
    )?;
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
            &five_hour,
            &seven_day,
            &interaction,
            &separator,
            &quit,
        ],
    )
}

fn select_tray_window(app: &AppHandle, coordinator: &RefreshCoordinator, tray_window: TrayWindow) {
    let app = app.clone();
    let coordinator = coordinator.clone();
    tauri::async_runtime::spawn(async move {
        let mut settings = coordinator.settings().await;
        settings.tray_window = tray_window;
        if coordinator.set_settings(settings).await.is_ok() {
            update(&app, &coordinator.view().await, tray_window);
            let _ = app.emit("usage://settings-changed", settings);
        }
    });
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn tray_text(view: &UsageView, tray_window: TrayWindow) -> (String, String, String) {
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
            let selected_id = match tray_window {
                TrayWindow::FiveHour => "five_hour",
                TrayWindow::SevenDay => "seven_day",
            };
            let remaining = snapshot
                .windows
                .iter()
                .find(|window| window.id == selected_id)
                .or_else(|| snapshot.windows.first())
                .map(|window| (100.0 - window.used_percent).clamp(0.0, 100.0).round() as i64)
                .unwrap_or(100);
            let title = if *stale {
                format!("~{remaining}%")
            } else {
                format!("{remaining}%")
            };
            let details = snapshot
                .windows
                .iter()
                .map(|window| {
                    let remaining = (100.0 - window.used_percent).clamp(0.0, 100.0);
                    format!("{} 剩余 {:.0}%", window.label, remaining)
                })
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
    fn selected_window_drives_tray_title() {
        let view = UsageView::Ready {
            snapshot: UsageSnapshot {
                source: "codex_oauth".into(),
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
        assert_eq!(tray_text(&view, TrayWindow::FiveHour).0, "58%");
        assert_eq!(tray_text(&view, TrayWindow::SevenDay).0, "32%");
    }
}
