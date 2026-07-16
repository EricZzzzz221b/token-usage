<p align="center">
  <img src="assets/app-icon.png" width="112" alt="Token Usage icon">
</p>

<h1 align="center">Token Usage</h1>

<p align="center">Check your remaining Codex subscription quota from the Windows system tray, macOS menu bar, and a small desktop widget.</p>

<p align="center">
  <a href="https://github.com/EricZzzzz221b/token-usage/releases/latest"><img src="https://img.shields.io/github/v/release/EricZzzzz221b/token-usage?label=latest&amp;cacheSeconds=300" alt="Latest release"></a>
  <a href="https://github.com/EricZzzzz221b/token-usage/releases/tag/windows-v1.0.0"><img src="https://img.shields.io/badge/Windows-v1.0.0-0078D4?logo=windows11" alt="Windows v1.0.0"></a>
  <a href="https://github.com/EricZzzzz221b/token-usage/releases/tag/v1.1.5"><img src="https://img.shields.io/badge/macOS-v1.1.5-111111?logo=apple" alt="macOS v1.1.5"></a>
</p>

<p align="center">
  <a href="#download-and-install"><strong>Download</strong></a>
  · <a href="CHANGELOG.md">Changelog</a>
  · <a href="README.md">中文</a>
</p>

Token Usage is a lightweight cross-platform utility that reads your local Codex sign-in, shows the remaining quota and reset time for the 5-hour and 7-day windows, and can notify you when quota is running low. Windows and macOS installers are published together on the [Releases](https://github.com/EricZzzzz221b/token-usage/releases) page.

## Features

- Remaining quota shown as 100% when full and 0% when exhausted
- Choose the 5-hour or 7-day window in the system tray or menu bar
- Detailed and compact widgets with quick switching from the widget or tray
- Manual refresh, configurable refresh interval, and quota alerts
- Always on top, position lock, click-through, and launch at login
- Windows 11 Mica, Windows 10 Acrylic, and a readable solid-color fallback
- Automatic light/dark contrast and basic Windows high-contrast support
- Simplified Chinese and English interface

## Preview

<p align="center">
  <img src="assets/screenshot-detailed.png" width="360" alt="Detailed mode">
</p>

<p align="center">
  <img src="assets/screenshot-compact.png" width="320" alt="Compact mode">
</p>

<details>
  <summary>View settings</summary>
  <p align="center"><img src="assets/screenshot-settings.png" width="420" alt="Settings"></p>
</details>

## Download and install

| Platform                         | Status    | Version and download                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows 11 / Windows 10 22H2 x64 | Available | [v1.0.0](https://github.com/EricZzzzz221b/token-usage/releases/tag/windows-v1.0.0) · [MSI](https://github.com/EricZzzzz221b/token-usage/releases/download/windows-v1.0.0/TokenUsage_Windows_1.0.0_x64.msi) · [EXE](https://github.com/EricZzzzz221b/token-usage/releases/download/windows-v1.0.0/TokenUsage_Windows_1.0.0_x64-setup.exe) · [SHA-256](https://github.com/EricZzzzz221b/token-usage/releases/download/windows-v1.0.0/SHA256SUMS-Windows-1.0.0.txt) |
| macOS 13+ Apple Silicon          | Available | [v1.1.5](https://github.com/EricZzzzz221b/token-usage/releases/tag/v1.1.5) · [DMG](https://github.com/EricZzzzz221b/token-usage/releases/download/v1.1.5/TokenUsage_1.1.5_arm64.dmg)                                                                                                                                                                                                                                                                             |

### Windows v1.0.0

The first Windows release supports x64 only. Prefer the MSI, or use the NSIS setup EXE. The installers are unsigned, so verify the published SHA-256 before using **More info → Run anyway** in SmartScreen. The embedded WebView2 bootstrapper starts Microsoft's installation flow if the runtime is missing. Uninstall from **Settings → Apps → Installed apps**. See the [Windows v1.0.0 Release](https://github.com/EricZzzzz221b/token-usage/releases/tag/windows-v1.0.0) for details.

### macOS v1.1.5

Download the [DMG](https://github.com/EricZzzzz221b/token-usage/releases/download/v1.1.5/TokenUsage_1.1.5_arm64.dmg), open it, and drag `Token用量.app` into `Applications`. v1.1.5 hardens API retries and settings persistence while preserving the privacy boundary: it does not read the wallpaper, capture the screen, or request Screen Recording permission. The current build is not Apple-notarized; on first launch, right-click the app in Finder, choose **Open**, and confirm once more.

## Privacy

- OAuth credentials are read into local memory only and used solely for the official Codex usage endpoint.
- The app does not store, log, or upload access tokens, refresh tokens, email addresses, account IDs, or raw authentication data.
- Windows reads `%USERPROFILE%\.codex\auth.json` or `CODEX_HOME\auth.json`; it does not guess or read unverified Credential Manager formats.
- Settings and cache use Tauri system directories, including AppData on Windows.
- No telemetry or behavior tracking is included.

## Development

Node.js 22 and Rust stable are required. macOS also needs Xcode Command Line Tools; Windows needs Visual Studio 2022 Build Tools.

The app is built with Tauri 2, React, and TypeScript. Tauri is an open-source framework for building lightweight desktop apps with web technologies.

```bash
npm ci
npm run tauri:dev
```

Run all checks with:

```bash
npm run check
```

## Feedback

Bug reports and suggestions are welcome in [Issues](https://github.com/EricZzzzz221b/token-usage/issues).

This is a personal project and is not affiliated with OpenAI.
