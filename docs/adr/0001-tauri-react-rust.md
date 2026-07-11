# ADR 0001: Tauri、React 与 Rust

- 状态：已接受
- 日期：2026-07-11

## 决策

macOS 首发版本采用 Tauri 2、React、TypeScript 与 Rust。Rust 负责凭据、网络和系统集成，React 负责菜单弹层、浮窗和设置界面。

## 原因

- 常驻工具需要较低内存和空闲 CPU 占用
- Tauri 可以复用系统 WebView，并允许使用 AppKit 扩展原生行为
- Rust 适合处理 OAuth 凭据的生命周期与敏感信息边界
- React/TypeScript 便于快速构建和测试多状态界面

## 后果

- 需要同时维护 Rust 与 TypeScript 工具链
- 液态玻璃和菜单栏动态文字可能需要少量 macOS 原生扩展
- 将平台能力封装在 Rust 层，为未来 Windows 版本保留边界
