# Windows 与 macOS 平台差异

| 能力           | Windows v1.0.0                                           | macOS v1.1.3                                                        |
| -------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| 原生窗口效果   | Windows 11 Mica；Windows 10 Acrylic；纯色回退            | macOS 26 Liquid Glass；macOS 13–15 vibrancy                         |
| 自动文字对比度 | 跟随系统深色/浅色和高对比度主题                          | 检测当前桌面壁纸明暗                                                |
| 认证文件       | `%USERPROFILE%\.codex\auth.json`、`CODEX_HOME\auth.json` | Keychain `Codex Auth`、`CODEX_HOME/auth.json`、`~/.codex/auth.json` |
| 托盘余额       | 提示和菜单摘要                                           | 菜单栏标题、提示和菜单摘要                                          |
| 安装格式       | MSI、NSIS EXE                                            | DMG/App                                                             |
| 当前架构       | x64                                                      | Apple Silicon arm64                                                 |

所有 AppKit、QuartzCore、Objective-C 与 `NSWindow` 调用均只在 `target_os = "macos"` 编译；Windows 构建不会编译 `native/liquid_glass.m`，也不会链接 Apple framework。Windows 使用独立图标、WebView2 引导和安装器设置。

## Windows QA 清单

- Windows 10 22H2 / Windows 11，深色和浅色主题。
- 100%、125%、150%、175%、200% 缩放。
- 双显示器和不同 DPI 显示器之间移动。
- 标准、紧凑和设置窗口，无裁切或模糊。
- 托盘菜单、关闭后驻留、退出、开机启动和通知。
- 置顶、锁定、鼠标穿透、拖动和恢复交互。
- 中文用户名、中文 `CODEX_HOME`、空格和非 ASCII 路径。
- WebView2 已安装与缺失两种安装路径。
- Windows 高对比度主题和纯键盘操作。
