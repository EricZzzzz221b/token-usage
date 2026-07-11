# Token用量 / Token Usage

Token用量是一款面向 Codex 官方订阅用户的 macOS 状态栏工具。它复用本机 Codex OAuth 登录态，展示多个订阅用量周期的已用比例、剩余额度与重置时间，并提供液态玻璃风格的桌面浮窗和系统通知。

> 当前状态：阶段 1 已完成，准备进入阶段 2 的菜单栏 MVP。

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

阶段 0 的架构决策记录位于 [`docs/adr`](docs/adr)。

## 安全原则

- OAuth 凭据只在本机读取
- 凭据只用于请求 `https://chatgpt.com/backend-api/wham/usage`
- 不持久化、不记录、不上传 Access Token 或 Refresh Token
- 日志和诊断信息必须经过敏感字段脱敏
