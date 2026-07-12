# ADR 0005: macOS 原生 Liquid Glass 浮窗

- 状态：已接受
- 日期：2026-07-11
- 更新：2026-07-12

## 决策

在 macOS 26 及以上，浮窗通过一个 Objective-C/AppKit 桥接层，将 Tauri 的原生内容视图嵌入 `NSGlassEffectView.contentView`。紧凑、详细和设置窗口分别同步 17、22 和 24 点圆角。

在 macOS 13–15，继续使用 `window-vibrancy` 和 `NSVisualEffectView` 作为兼容回退。前端不再使用 `backdrop-filter` 模拟系统玻璃。

玻璃设置只保留苹果公开提供的两个样式：

- 清透：`NSGlassEffectViewStyleClear`
- 标准：`NSGlassEffectViewStyleRegular`

透明度滑块映射到 `NSGlassEffectView.tintColor` 的色调强度，而不是改变整个 WebView 的透明度。

## 原因

- `NSVisualEffectView` 和 CSS blur 只能提供传统 vibrancy 毛玻璃，无法产生 macOS 26 Liquid Glass 的系统折射和动态响应。
- 苹果要求被玻璃处理的内容放入 `NSGlassEffectView.contentView`。
- 运行时通过 `NSClassFromString(@"NSGlassEffectView")` 探测能力，可以保持 macOS 13 的最低系统版本并安全回退。
- 原生层负责材质和圆角，React 层只负责内容、布局与状态，避免双重模糊和双重描边。

## 后果

- macOS 26 是 Liquid Glass 的主要验证环境。
- macOS 13–15 的外观是传统 vibrancy，不保证与 macOS 26 完全一致。
- “浓郁”旧值在读取时迁移为“标准”。
- 鼠标穿透后必须可通过菜单栏恢复交互。
- 紧凑模式必须可通过菜单栏切回详细模式。
