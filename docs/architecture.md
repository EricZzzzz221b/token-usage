# 技术设计

## 1. 总体架构

```text
macOS Keychain / ~/.codex/auth.json
                 │
                 ▼
        CredentialProvider
                 │
                 ▼
          CodexOAuthClient
                 │
                 ▼
       UsageSnapshotNormalizer
                 │
        ┌────────┼────────┐
        ▼        ▼        ▼
    Menu Bar  Floating UI  Notifications
                 │
                 ▼
           Local Snapshot Store
```

任务状态中心从 `$CODEX_HOME/sessions`（默认 `~/.codex/sessions`）读取本机会话生命周期事件，标准化为运行中、完成和失败状态。前端只接收任务标题摘要、项目末级名称、状态和时间；原始会话内容不会复制到应用存储。扫描器每 2 秒增量刷新最近会话，并通过 Tauri 事件同步浮窗、菜单栏和完成通知。会话事件属于兼容层，未来可在稳定的 Codex Hooks/app-server 客户端可用时替换，UI 状态模型无需改变。

应用采用 Tauri 2。Rust 负责凭据读取、网络请求、快照存储、调度和系统能力；React/TypeScript 负责菜单弹层、浮窗和设置界面。

## 2. 模块边界

### CredentialProvider

职责：只读发现 Codex ChatGPT OAuth 凭据。

macOS 查找顺序：

1. Keychain service `Codex Auth`
2. `$CODEX_HOME/auth.json`
3. `~/.codex/auth.json`

只接受 `auth_mode == "chatgpt"`。模块仅返回请求所需的临时凭据对象，不向数据库或日志输出 token。

### UsageProvider

定义与具体数据来源无关的接口，MVP 只实现 `DirectOAuthUsageProvider`。未来可以增加 app-server 数据源而不修改 UI。

建议接口：

```rust
#[async_trait]
pub trait UsageProvider {
    async fn fetch(&self) -> Result<UsageSnapshot, UsageError>;
}
```

### DirectOAuthUsageProvider

参考 CC Switch 已验证的实现，请求：

```http
GET https://chatgpt.com/backend-api/wham/usage
Authorization: Bearer <access_token>
ChatGPT-Account-Id: <account_id>
User-Agent: codex-cli
Accept: application/json
```

端点必须编译期固定，不提供用户自定义入口。HTTP 客户端日志不得包含请求头或原始 token。

### UsageSnapshotNormalizer

将上游响应转换为稳定的内部模型，UI 不直接依赖原始 JSON。

```ts
interface UsageSnapshot {
  source: "codex_oauth";
  accountIdHash?: string;
  windows: UsageWindow[];
  planType?: string;
  credits?: {
    hasCredits: boolean;
    unlimited: boolean;
    balance?: string;
    expiresAt?: number;
  };
  queriedAt: number;
}

interface UsageWindow {
  id: string;
  durationSeconds?: number;
  usedPercent: number;
  resetAt?: number;
  label: string;
}
```

周期映射：

- 18000 秒：5 小时
- 604800 秒：7 天
- 2592000 秒：30 天
- 其他周期：动态生成小时或天标签

### RefreshCoordinator

负责自动刷新、手动刷新合并、睡眠恢复、网络恢复、超时和重试。调度器不持有长期明文凭据，每次查询按需读取。

### SnapshotStore

只保存用量快照、更新时间、通知阈值状态和非敏感设置。MVP 虽不展示历史曲线，但从首版开始保存有限快照，为后续图表能力准备数据。

保留建议：最近 30 天，每个额度窗口每 5 分钟最多一个点；定期压缩或清理。

## 3. 错误模型

```rust
pub enum UsageError {
    NotLoggedIn,
    UnsupportedAuthMode,
    CredentialUnreadable,
    CredentialMalformed,
    AuthenticationExpired,
    NetworkUnavailable,
    RateLimited,
    ServerUnavailable,
    ResponseIncompatible,
}
```

确定性错误立即覆盖旧状态；网络、429 和 5xx 等瞬时错误使用 last-good 策略。

## 4. 安全要求

- 禁止持久化 Access Token、Refresh Token 和原始 `auth.json`
- 禁止在 panic、tracing、网络调试或崩溃报告中输出 Authorization
- Account ID 仅在请求时使用；如需本地身份隔离，只保存带应用盐的哈希
- 诊断导出采用字段白名单，不对日志做事后正则脱敏
- 更新服务、遥测和第三方 SDK不得访问凭据对象
- CI 测试使用虚构 token 和本地 mock server

## 5. macOS 系统集成

- Menu Bar：Tauri tray API 加原生扩展处理动态标题和模板图标
- 浮窗外观：标准面板、无边框、可拖动、可置顶，不提供通透强度调节
- Dock：macOS 可在设置中切换 Dock 图标显示状态
- 登录项：使用 macOS ServiceManagement 能力
- 通知：使用系统 UserNotifications
- 睡眠恢复：监听 workspace wake notification

所有原生扩展必须封装在平台模块中，避免 UI 层依赖 AppKit 细节。

## 6. 测试策略

### 单元测试

- 凭据 JSON 解析
- 周期映射
- 响应标准化
- 错误分类
- last-good 状态机
- 通知去重和周期重置

### 集成测试

- Mock HTTP 成功、401、403、429、5xx、超时和畸形响应
- Keychain 不可用时文件回退
- `CODEX_HOME` 自定义路径
- 文件更新期间的安全读取
- JSONL 追加内容只从上次字节位置继续解析
- 会话文件截断或替换后的解析状态重建
- 标题变化不使任务事件缓存失效

### UI 测试

- 标准外观、高对比度和减少动态效果
- 紧凑与详细模式
- 长中文、英文和动态周期标签
- 多显示器位置恢复

### 长稳测试

- 连续运行 7 天
- 多次睡眠与唤醒
- 网络断开和恢复
- Codex 刷新凭据时保持可用

## 7. 发布约束

- Apple Silicon 优先
- Release 构建必须签名并 notarize
- 发布物包含隐私说明和第三方许可证
- 自动更新在签名与回滚流程验证完成后启用
