<p align="center">
  <img src="assets/app-icon.png" width="112" alt="Token用量图标">
</p>

<h1 align="center">Token用量</h1>

<p align="center">在 Windows 系统托盘、macOS 状态栏和桌面浮窗中查看 Codex 订阅剩余额度。</p>

<p align="center">
  <a href="https://github.com/EricZzzzz221b/token-usage/releases/latest"><img src="https://img.shields.io/github/v/release/EricZzzzz221b/token-usage?label=latest&amp;cacheSeconds=300" alt="最新版本"></a>
  <a href="https://github.com/EricZzzzz221b/token-usage/releases/tag/windows-v1.0.0"><img src="https://img.shields.io/badge/Windows-v1.0.0-0078D4?logo=windows11" alt="Windows v1.0.0"></a>
  <a href="https://github.com/EricZzzzz221b/token-usage/releases/tag/v1.1.5"><img src="https://img.shields.io/badge/macOS-v1.1.5-111111?logo=apple" alt="macOS v1.1.5"></a>
</p>

<p align="center">
  <a href="#下载与安装"><strong>下载</strong></a>
  · <a href="CHANGELOG.md">更新记录</a>
  · <a href="README_EN.md">English</a>
</p>

Token用量是一款轻量的跨平台桌面工具。它只读本机 Codex OAuth 登录态，显示 5 小时和 7 天窗口的剩余额度与重置时间，并可在余额较低时发送通知。Windows 和 macOS 安装包统一发布在 [Releases](https://github.com/EricZzzzz221b/token-usage/releases) 页面。

## 功能

- 以“满额 100%，用尽 0%”的方式显示剩余额度
- 系统托盘/状态栏可选择显示 5 小时或 7 天窗口
- 标准和紧凑两种浮窗，可从浮窗或托盘快速切换
- 立即刷新、自动刷新间隔、余额阈值和额度重置通知
- 始终置顶、锁定位置、鼠标穿透、窗口拖动和登录时启动
- Windows 11 Mica、Windows 10 Acrylic 与清晰的纯色回退
- 自动深色/浅色对比度、Windows 高对比度基础支持
- 简体中文和英文界面

## 预览

<p align="center">
  <img src="assets/screenshot-detailed.png" width="360" alt="Token用量标准模式">
</p>

<p align="center">
  <img src="assets/screenshot-compact.png" width="320" alt="Token用量紧凑模式">
</p>

<details>
  <summary>查看设置界面</summary>
  <p align="center"><img src="assets/screenshot-settings.png" width="420" alt="Token用量设置界面"></p>
</details>

## 下载与安装

| 平台                             | 状态   | 版本与下载                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 11 / Windows 10 22H2 x64 | 可下载 | [v1.0.0](https://github.com/EricZzzzz221b/token-usage/releases/tag/windows-v1.0.0) · [MSI](https://github.com/EricZzzzz221b/token-usage/releases/download/windows-v1.0.0/TokenUsage_Windows_1.0.0_x64.msi) · [EXE](https://github.com/EricZzzzz221b/token-usage/releases/download/windows-v1.0.0/TokenUsage_Windows_1.0.0_x64-setup.exe) · [SHA-256](https://github.com/EricZzzzz221b/token-usage/releases/download/windows-v1.0.0/SHA256SUMS-Windows-1.0.0.txt) |
| macOS 13+ Apple Silicon          | 可下载 | [v1.1.5](https://github.com/EricZzzzz221b/token-usage/releases/tag/v1.1.5) · [DMG](https://github.com/EricZzzzz221b/token-usage/releases/download/v1.1.5/TokenUsage_1.1.5_arm64.dmg)                                                                                                                                                                                                                                                                             |

### Windows v1.0.0

v1.0.0 首发仅提供 x64；ARM64 尚未经过真实 Windows ARM64 构建与运行验证。

1. 优先下载并运行 `.msi`，也可以使用 `-setup.exe`。
2. 本版本没有商业代码签名证书。若 SmartScreen 显示警告，请先核对 [SHA-256](https://github.com/EricZzzzz221b/token-usage/releases/download/windows-v1.0.0/SHA256SUMS-Windows-1.0.0.txt)，再选择“更多信息”→“仍要运行”。哈希不一致时不要继续。
3. 安装器内嵌 WebView2 Bootstrapper。系统缺少 Runtime 时会启动 Microsoft 安装流程，因此首次安装可能需要联网；Windows 10 22H2 和 Windows 11 通常已包含 WebView2。
4. 使用 ChatGPT OAuth 登录 Codex CLI 或客户端。应用支持 `%USERPROFILE%\.codex\auth.json` 与 `CODEX_HOME\auth.json`。

卸载：打开“设置”→“应用”→“已安装的应用”，找到“Token用量”并选择“卸载”。完整说明见 [Windows v1.0.0 Release](https://github.com/EricZzzzz221b/token-usage/releases/tag/windows-v1.0.0)。

### macOS v1.1.5

下载 [DMG](https://github.com/EricZzzzz221b/token-usage/releases/download/v1.1.5/TokenUsage_1.1.5_arm64.dmg) 后，将 `Token用量.app` 拖入 `Applications`。当前包采用 ad-hoc 签名；首次启动请在 Finder 中右键应用并选择“打开”。v1.1.5 加固了接口重试和设置保存，并保留不读取桌面壁纸、不截取屏幕、不需要屏幕录制权限的隐私边界。

## 隐私

- OAuth 凭据只在本机内存中读取，只用于请求 `https://chatgpt.com/backend-api/wham/usage`。
- 不保存、记录或上传 Access Token、Refresh Token、邮箱、Account ID 或原始认证内容。
- Windows v1.0.0 不读取 Credential Manager：目前没有经过验证的 Codex 凭据格式，因此不会猜测实现。
- 本地历史只包含标准化用量，设置和缓存使用 Tauri 系统目录（Windows 为 AppData）。
- 应用不包含遥测和行为追踪。

## 本地开发

需要 Node.js 22 和 Rust stable；macOS 另需 Xcode Command Line Tools，Windows 另需 Visual Studio 2022 Build Tools。

应用使用 Tauri 2、React 和 TypeScript 开发。Tauri 是一个使用网页技术制作轻量桌面应用的开源框架。

```bash
npm ci
npm run check
npm run tauri:dev
```

- [Windows 构建说明](docs/build-windows.md)
- [Windows 与 macOS 差异及已知限制](docs/windows-platform-notes.md)
- [技术架构](docs/architecture.md)
- [贡献指南](CONTRIBUTING.md)

## 反馈

如果遇到问题或有功能建议，可以提交 [Issue](https://github.com/EricZzzzz221b/token-usage/issues)。

这是一个个人项目，与 OpenAI 没有官方关联。
