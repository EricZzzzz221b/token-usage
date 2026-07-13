# Token用量 v1.1.4

发布日期：2026-07-13

## 本次更新

- 修复 macOS 液态玻璃浮窗在不同 App 和界面底色上配色切换不准确的问题。
- 按照 Apple 官方 `NSGlassEffectView.contentView` 结构嵌入 Tauri WebView，让文字、卡片和控件跟随玻璃材质的局部外观自动调整。
- 不读取桌面壁纸，不截取屏幕或其他 App 内容，不需要屏幕录制权限。
- 增加连续采样抗抖动，移动浮窗或切换后方界面时配色更稳定。

## 安装

1. 下载并打开 `TokenUsage_1.1.4_arm64.dmg`。
2. 将 `Token用量.app` 拖入 `Applications`。
3. 首次打开时，在 Finder 中右键应用并选择“打开”，然后再次确认。

系统要求：Apple Silicon Mac，macOS 13 或更高版本。Liquid Glass 局部自适应效果在 macOS 26 上启用，较早系统使用原生 vibrancy 回退。

## 隐私

本版本不包含 ScreenCaptureKit、`CGWindowListCreateImage` 或其他屏幕捕获实现，也不会请求屏幕录制权限。

## 文件校验

`TokenUsage_1.1.4_arm64.dmg`

SHA-256：`e6bb05ec589f0b42a84af03b702918fa81b490dd7da2bf30919ae6223983a4a0`
