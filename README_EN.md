<p align="center">
  <img src="assets/app-icon.png" width="112" alt="Token Usage icon">
</p>

<h1 align="center">Token Usage</h1>

<p align="center">Check your remaining Codex subscription quota from the macOS menu bar and a small desktop widget.</p>

<p align="center">
  <a href="https://github.com/EricZzzzz221b/token-usage/releases/latest"><img src="https://img.shields.io/github/v/release/EricZzzzz221b/token-usage?label=release" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/macOS-13%2B-111111?logo=apple" alt="macOS 13+"><br>
  <img src="https://img.shields.io/badge/Apple%20Silicon-M1%20or%20newer-555555" alt="Apple Silicon">
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2">
</p>

<p align="center">
  <a href="https://github.com/EricZzzzz221b/token-usage/releases/latest"><strong>Download</strong></a>
  · <a href="CHANGELOG.md">Changelog</a>
  · <a href="README.md">中文</a>
</p>

Token Usage is a lightweight macOS utility that reads your local Codex sign-in, shows the remaining quota and reset time for the 5-hour and 7-day windows, and can notify you when quota is running low.

## Features

- Remaining quota shown as 100% when full and 0% when exhausted
- Choose the 5-hour or 7-day window in the menu bar
- Detailed and compact desktop widgets
- Manual refresh, configurable refresh interval, and quota alerts
- Always on top, position lock, click-through, and launch at login
- Automatic foreground contrast based on the desktop background
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

| Platform              | Status         | Version |
| --------------------- | -------------- | ------- |
| macOS (Apple Silicon) | Available      | v1.1.3  |
| Windows               | In development | v1.0.0  |

The macOS build requires macOS 13 or later and a Codex client or CLI signed in with ChatGPT OAuth.

1. Download the latest `.dmg` from [Releases](https://github.com/EricZzzzz221b/token-usage/releases/latest).
2. Open the DMG and drag `Token用量.app` into `Applications`.
3. The current build is not Apple-notarized. On first launch, right-click the app in Finder, choose **Open**, and confirm once more.

Windows v1.0.0 is in development and will be published on the Releases page when ready.

## Privacy

- OAuth credentials are read locally.
- Credentials are only used to request the official Codex usage endpoint.
- The app does not store, log, or upload access tokens, refresh tokens, email addresses, or account IDs.
- No telemetry or behavior tracking is included.

## Current scope

- The macOS build currently supports Apple Silicon only.
- Only official Codex subscriptions using ChatGPT OAuth are supported.
- API key balance, third-party relays, and multiple accounts are not supported.

## Development

Node.js 22, Rust stable, and Xcode Command Line Tools are required.

```bash
npm install
npm run tauri:dev
```

Run all checks with:

```bash
npm run check
```

## Feedback

Bug reports and suggestions are welcome in [Issues](https://github.com/EricZzzzz221b/token-usage/issues).

This is a personal project and is not affiliated with OpenAI.
