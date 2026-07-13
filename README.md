<p align="center">
  <img src="assets/app-icon.png" width="112" alt="Token用量图标">
</p>

<h1 align="center">Token用量</h1>

<p align="center">在 macOS 状态栏和桌面浮窗中查看 Codex 订阅剩余额度。</p>

<p align="center">
  <a href="https://github.com/EricZzzzz221b/token-usage/releases/latest"><img src="https://img.shields.io/github/v/release/EricZzzzz221b/token-usage?label=最新版" alt="最新版本"></a>
  <img src="https://img.shields.io/badge/macOS-13%2B-111111?logo=apple" alt="macOS 13+"><br>
  <img src="https://img.shields.io/badge/Apple%20Silicon-M1%20及以上-555555" alt="Apple Silicon">
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2">
</p>

<p align="center">
  <a href="https://github.com/EricZzzzz221b/token-usage/releases/latest"><strong>下载最新版</strong></a>
  · <a href="CHANGELOG.md">更新记录</a>
  · <a href="README_EN.md">English</a>
</p>

Token用量是一款轻量的 macOS 小工具。它读取本机 Codex 的登录状态，显示 5 小时和 7 天窗口的剩余额度、重置时间，并可在额度较低时发送通知。

## 功能

- 以“满额 100%，用尽 0%”的方式显示剩余额度
- 在状态栏选择显示 5 小时或 7 天窗口
- 标准和紧凑两种桌面浮窗
- 快速刷新、自定义刷新间隔和余额提醒
- 始终置顶、锁定位置、鼠标穿透和登录时启动
- 根据桌面背景自动切换文字明暗
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

| 平台                   | 状态   | 版本   |
| ---------------------- | ------ | ------ |
| macOS（Apple Silicon） | 可下载 | v1.1.3 |
| Windows                | 开发中 | v1.0.0 |

macOS 版本要求 macOS 13 或更高版本，并需要已经通过 ChatGPT OAuth 登录 Codex 客户端或 CLI。

1. 前往 [Releases](https://github.com/EricZzzzz221b/token-usage/releases/latest) 下载最新的 `.dmg`。
2. 打开 DMG，将 `Token用量.app` 拖入 `Applications`。
3. 当前安装包尚未经过 Apple 公证。首次启动时，请在 Finder 中右键应用，选择“打开”，然后再次确认。

Windows v1.0.0 正在开发，完成后也会在 Releases 页面提供下载。

## 使用

- 点击状态栏图标显示或隐藏浮窗。
- 在浮窗右上角快速切换标准和紧凑模式。
- 在设置中选择状态栏显示 5 小时还是 7 天剩余额度。
- 如果开启了鼠标穿透，可通过状态栏菜单关闭。

## 隐私

- OAuth 凭据只在本机读取。
- 凭据只用于请求 Codex 官方用量接口。
- 应用不会保存、记录或上传 Access Token、Refresh Token、邮箱或账号 ID。
- 应用不包含遥测和行为追踪。

## 当前范围

- macOS 版本目前仅支持 Apple Silicon。
- 仅支持 Codex 官方 ChatGPT OAuth 订阅。
- 不支持 API Key 余额、第三方中转或多账号切换。

## 本地开发

需要 Node.js 22、Rust stable 和 Xcode Command Line Tools。

```bash
npm install
npm run tauri:dev
```

完整检查：

```bash
npm run check
```

## 反馈

如果遇到问题或有功能建议，可以提交 [Issue](https://github.com/EricZzzzz221b/token-usage/issues)。

这是一个个人项目，与 OpenAI 没有官方关联。
