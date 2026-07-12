# Token用量 / Token Usage

Token用量是一款面向 Codex 官方订阅用户的 macOS 状态栏工具。它复用本机 Codex OAuth 登录态，以倒扣方式展示多个订阅周期的剩余额度与重置时间（满额 100%，用尽 0%），并提供液态玻璃风格的桌面浮窗和系统通知。

> 当前状态：v1.1.0。核心功能、通知、系统集成和本地发布物均已完成；公开发布仍需 Apple Developer 签名与公证凭据。

## 下载与安装

### Token用量 v1.1.0

- [下载 macOS DMG（Apple Silicon）](outputs/TokenUsage_1.1.0_arm64.dmg)
- [查看 v1.1.0 更新说明](outputs/TokenUsage_1.1.0_ReleaseNotes.md)
- 文件大小：约 4.6 MB
- SHA-256：`f29e57ee6db092f225fc3197f99016501cee147a87abc458727dd56b9f0454eb`

系统要求：

- Apple Silicon Mac（M1、M2、M3、M4、M5）
- macOS 13 或更高版本
- 已使用 ChatGPT OAuth 登录 Codex 官方客户端或 CLI

安装步骤：

1. 下载并双击打开 DMG。
2. 将 `Token用量.app` 拖入 `Applications`。
3. 首次启动时，在 Finder 中右键 `Token用量.app` 并选择“打开”。
4. 在 macOS 确认窗口中再次选择“打开”。

当前下载包采用 ad-hoc 签名，尚未使用 Apple Developer ID 进行公证，因此首次启动不能直接双击。应用只读取本机 Codex/ChatGPT OAuth 登录状态，并仅向 `chatgpt.com` 官方用量接口发起请求。

### v1.1 额度显示规则

- 满额度显示为 100%。
- 使用后剩余额度逐步下降。
- 额度用尽显示为 0%，并使用红色风险状态。
- 剩余 30% 及以下显示黄色，剩余 10% 及以下显示红色。
- 浮窗、进度条、状态栏和通知全部使用相同的剩余额度逻辑。

## 产品范围

- 仅支持 macOS 首发版本
- 仅支持 Codex 官方 ChatGPT OAuth 订阅
- 状态栏常驻，桌面浮窗可选
- 支持多周期进度条、重置倒计时和阈值通知
- 默认每 5 分钟刷新，允许自定义刷新间隔
- 不支持 API Key 余额、第三方中转、多账号切换或请求代理

## 文档

- [产品规格](docs/product-spec.md)
- [技术设计](docs/architecture.md)
- [开发路线](docs/roadmap.md)
- [开发计划](docs/development-plan.md)
- [开发约定](CONTRIBUTING.md)

## 暂定技术栈

- Tauri 2
- Rust
- React + TypeScript
- macOS Menu Bar 与透明置顶窗口
- macOS Keychain 与 `~/.codex/auth.json` 只读凭据发现

## 本地开发

要求 Node.js 22 LTS、Rust stable 和 Xcode Command Line Tools。

```bash
npm install
npm run tauri:dev
```

常用检查：

```bash
npm run check
npm run tauri:build
```

生成本机可安装的 ad-hoc `.app` 与 `.dmg`：

```bash
npm run tauri -- build --bundles app
./scripts/build-dmg.sh
```

GitHub 的 `Release macOS` 手动工作流会创建草稿 Release。签名及公证需要在仓库 Secrets 中配置 `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD` 和 `APPLE_TEAM_ID`。

阶段 0 的架构决策记录位于 [`docs/adr`](docs/adr)。

## 安全原则

- OAuth 凭据只在本机读取
- 凭据只用于请求 `https://chatgpt.com/backend-api/wham/usage`
- 不持久化、不记录、不上传 Access Token 或 Refresh Token
- 日志和诊断信息必须经过敏感字段脱敏
- 本地历史仅保存标准化后的用量窗口，不包含 Token、Account ID、邮箱或原始响应
