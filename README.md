<p align="center">
  <img src="assets/app-icon.png" width="112" alt="Token用量图标">
</p>

<h1 align="center">Token用量</h1>

<p align="center"><strong>不用切回 Codex，也能随时知道额度还剩多少、任务做到哪了。</strong></p>

<p align="center">一款常驻 Windows 系统托盘与 macOS 状态栏的 Codex 用量和任务监控工具。</p>

<p align="center">
  <a href="https://github.com/EricZzzzz221b/token-usage/releases/latest"><img src="https://img.shields.io/github/v/release/EricZzzzz221b/token-usage?label=latest&amp;cacheSeconds=300" alt="最新版本"></a>
  <a href="https://github.com/EricZzzzz221b/token-usage/releases/tag/v1.2.1"><img src="https://img.shields.io/badge/macOS-v1.2.1-111111?logo=apple" alt="macOS v1.2.1"></a>
  <a href="https://github.com/EricZzzzz221b/token-usage/releases/tag/windows-v1.1.5"><img src="https://img.shields.io/badge/Windows-v1.1.5-0078D4?logo=windows11" alt="Windows v1.1.5"></a>
</p>

<p align="center">
  <a href="#下载与安装"><strong>下载</strong></a>
  · <a href="CHANGELOG.md">更新记录</a>
  · <a href="README_EN.md">English</a>
</p>

Token用量把 Codex 最常被打断查看的两件事放进一个小浮窗：**额度还有多少，以及正在运行的任务有没有完成**。你可以切到浏览器、设计软件或其他项目继续工作，通过状态栏就能看到任务处于思考、执行还是等待操作；任务完成后还会收到系统通知，并可从最近完成列表一键返回对应的 Codex 会话。

应用会自动识别当前官方账号的使用模式。订阅账号显示套餐和 5 小时、7 天用量窗口；API 模式则按官方返回结果展示 Credits。所有凭据、用量和任务判断都在本机处理，不需要把 Access Token 或会话内容交给第三方服务。

## 你可以用它做什么

### 离开 Codex，也不会错过任务进度

- 分开显示每个进行中的任务，不把多个任务合并成一条模糊状态
- 区分思考中、执行中、需要操作、已完成、失败和已中断
- 在状态栏显示任务状态、运行时间、活动任务数与剩余额度
- 进行中任务和最近 5 个已完成任务均可点击，直接回到对应 Codex 会话
- 任务完成时发送本机系统通知

### 更直观地安排额度

- 以“满额 100%，用尽 0%”显示剩余额度
- 展示 5 小时、7 天以及官方未来可能返回的其他用量窗口
- 7 天窗口使用明确日期显示重置时间
- 展示官方返回的使用限额重置机会、可用次数和到期信息
- 可设置低余额、额度用尽及额度恢复通知

### 常驻，但尽量不打扰

- 详细模式同时查看用量、任务和最近完成记录
- 紧凑模式只保留任务状态、运行时间与额度
- 支持置顶、锁定位置、鼠标穿透、登录时启动
- macOS 可选择是否在 Dock 显示图标
- 状态栏可选择显示 5 小时或 7 天窗口

## 功能一览

- 以“满额 100%，用尽 0%”的方式显示剩余额度
- 自动识别订阅或 API 模式；API 模式下展示 Credits 余额与官方返回的到期时间
- 展示官方返回的使用限额重置机会，并支持默认折叠
- 系统托盘/状态栏可选择显示 5 小时或 7 天窗口
- 详细和紧凑两种浮窗，可从浮窗或托盘快速切换
- 立即刷新、自动刷新间隔、余额阈值和额度重置通知
- 实时识别本机 Codex 任务，分别显示进行中任务、运行时长、最近 5 条完成记录和完成通知
- 进行中任务与最近完成记录均可一键打开对应 Codex 会话
- 菜单栏在任务运行时同时显示活动任务数与剩余额度
- 始终置顶、锁定位置、鼠标穿透、窗口拖动和登录时启动
- 清晰稳定的标准外观，并提供 Windows 11 Mica、Windows 10 Acrylic 回退适配
- Windows 高对比度基础支持
- 简体中文和英文界面

## 预览

<table align="center">
  <tr>
    <td align="center"><img src="assets/screenshot-detailed.png" width="360" alt="Token用量用量页面"><br><sub>用量、重置日期与重置机会</sub></td>
    <td align="center"><img src="assets/screenshot-tasks.png" width="360" alt="Token用量任务页面"><br><sub>进行中任务与最近完成</sub></td>
  </tr>
</table>

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
| macOS 13+ Apple Silicon          | 可下载 | [v1.2.1](https://github.com/EricZzzzz221b/token-usage/releases/tag/v1.2.1) · [DMG](https://github.com/EricZzzzz221b/token-usage/releases/download/v1.2.1/TokenUsage_1.2.1_arm64.dmg) · [SHA-256](https://github.com/EricZzzzz221b/token-usage/releases/download/v1.2.1/SHA256SUMS-1.2.1.txt)                                                                                                                                                                     |
| Windows 11 / Windows 10 22H2 x64 | 可下载 | [v1.1.5](https://github.com/EricZzzzz221b/token-usage/releases/tag/windows-v1.1.5) · [MSI](https://github.com/EricZzzzz221b/token-usage/releases/download/windows-v1.1.5/TokenUsage_Windows_1.1.5_x64.msi) · [EXE](https://github.com/EricZzzzz221b/token-usage/releases/download/windows-v1.1.5/TokenUsage_Windows_1.1.5_x64-setup.exe) · [SHA-256](https://github.com/EricZzzzz221b/token-usage/releases/download/windows-v1.1.5/SHA256SUMS-Windows-1.1.5.txt) |

### macOS v1.2.1

下载 [DMG](https://github.com/EricZzzzz221b/token-usage/releases/download/v1.2.1/TokenUsage_1.2.1_arm64.dmg) 后，将 `Token用量.app` 拖入 `Applications`。当前包采用 ad-hoc 签名；首次启动请在 Finder 中右键应用并选择“打开”。v1.2.1 增加进行中任务跳转，修复最近完成偶发消失、重置机会短暂缺失及折叠箭头跳动问题。

安装前建议退出旧版；遇到任务状态或额度显示异常时，请在 [Issues](https://github.com/EricZzzzz221b/token-usage/issues) 中附上应用版本和复现步骤，但不要上传 `auth.json` 或完整 Codex 会话日志。

### Windows v1.1.5

Windows 目前仅提供 x64；ARM64 尚未经过真实 Windows ARM64 构建与运行验证。

1. 优先下载并运行 `.msi`，也可以使用 `-setup.exe`。
2. 本版本没有商业代码签名证书。若 SmartScreen 显示警告，请先核对 [SHA-256](https://github.com/EricZzzzz221b/token-usage/releases/download/windows-v1.1.5/SHA256SUMS-Windows-1.1.5.txt)，再选择“更多信息”→“仍要运行”。哈希不一致时不要继续。
3. 安装器内嵌 WebView2 Bootstrapper。系统缺少 Runtime 时会启动 Microsoft 安装流程，因此首次安装可能需要联网；Windows 10 22H2 和 Windows 11 通常已包含 WebView2。
4. 使用 ChatGPT OAuth 登录 Codex CLI 或客户端。应用支持 `%USERPROFILE%\.codex\auth.json` 与 `CODEX_HOME\auth.json`。

卸载：打开“设置”→“应用”→“已安装的应用”，找到“Token用量”并选择“卸载”。完整说明见 [Windows v1.1.5 Release](https://github.com/EricZzzzz221b/token-usage/releases/tag/windows-v1.1.5)。

## 隐私

- OAuth 凭据只在本机内存中读取，只用于请求 `https://chatgpt.com/backend-api/wham/usage`。
- 任务状态只增量读取本机 Codex 会话生命周期事件；不上传或另行保存完整提示词、回答、命令输出和文件内容。
- 不保存、记录或上传 Access Token、Refresh Token、邮箱、Account ID 或原始认证内容。
- Windows 不读取 Credential Manager：目前没有经过验证的 Codex 凭据格式，因此不会猜测实现。
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
