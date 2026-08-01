# Token用量 v1.2.5-beta.1：Claude Desktop 兼容产品方案

状态：已实现并完成发布验证<br>
目标分支：`codex/1.2.5-beta.1-claude-desktop`<br>
基线版本：v1.2.1<br>
计划版本：v1.2.5-beta.1

## 1. 版本目标

让同时使用 Codex 与 Claude Desktop 的用户，在同一个菜单栏工具里完成三件事：

1. 选择当前关注的 AI 产品，并看到可获得的用量信息；
2. 离开 Claude Desktop 后，仍能知道 Claude Code 任务是在运行、等待操作还是已结束；
3. 任务结束或需要用户介入时收到系统通知，并能返回对应 Claude 页面。

本版本是 provider 多平台化的第一个 beta，不以覆盖 Claude Desktop 的所有会话形态为目标。首要目标是验证数据源是否稳定、提示是否可信、Codex 既有体验是否不回退。

## 2. 产品定位

产品从“Codex 用量与任务监控器”升级为“本地 AI 工作状态中心”。v1.2.5-beta.1 支持：

- Codex：维持现有用量、任务、通知和会话跳转能力；
- Claude：新增账号/用量数据源与 Claude Code 任务数据源；
- 多产品：可手动选择 Codex 或 Claude。

名称暂时保持“Token用量 / Token Usage”，不在 beta 阶段进行品牌重命名。

## 3. 官方能力与现实边界

### 3.1 已确认事实

- Claude Web、Claude Desktop 与 Claude Code 共用同一订阅用量池，因此界面应表达“Claude 共享额度”，不能暗示额度只属于 Desktop。
- Claude Desktop 当前包含普通聊天、Cowork 和 Claude Code 等不同工作形态。
- Claude Desktop 支持 `claude://` 深链，可打开新聊天或进入支持的 Claude 页面。
- Claude Code 提供可恢复的 session id、结构化输出和本地会话能力，适合优先建立任务兼容层。

### 3.2 beta1 不做的承诺

- 不承诺监控 Claude Desktop 普通聊天的实时生成状态；
- 不承诺完整监控 Cowork/Dispatch 的内部子任务；
- 不把非公开接口描述为 Anthropic 官方开放 API；
- 不通过屏幕截图、辅助功能抓取或 UI 自动化读取额度；
- 不复制浏览器 Cookie，不导出或长期保存 Claude 凭据；
- 不把本地 token 消耗估算伪装成官方剩余额度百分比。

若技术验证无法以只读、可撤销且不暴露凭据的方式获得 Claude 订阅额度，beta1 应降级为展示“重置时间/限制状态/本地消耗估算”，并明确标记“估算”或“暂不可用”，不能伪造百分比。

## 4. 目标用户与场景

### 核心用户

- 同时使用 Codex App/CLI 与 Claude Desktop 的个人开发者；
- 在 Claude Desktop 内使用 Claude Code，任务运行时会切换到其他应用；
- 使用 Claude Pro、Max、Team 或 Enterprise 席位，关心共享使用限制；
- 希望一个轻量常驻工具统一查看多个 AI 工具状态。

### 核心场景

1. 用户正在 Claude Desktop 内运行 Claude Code，切到浏览器后从菜单栏查看任务是否仍在执行。
2. Claude 等待权限确认或用户输入时，用户收到通知并返回 Claude Desktop。
3. 用户同时运行 Codex 与 Claude 任务，在详细模式分别查看，不混淆来源。
4. Claude 数据源失效时，用户仍能看到最后成功数据、来源与失效原因，Codex 功能不受影响。

## 5. beta1 功能范围

### P0：必须交付

#### 5.1 产品来源切换

- 顶部来源切换：`Codex` / `Claude`；
- 设置中提供默认来源：Codex、Claude；
- 所有进度条、任务卡片和通知必须带来源，不允许把 Claude 数据显示成 Codex 数据。

#### 5.2 Claude 环境检测

- 检测 Claude Desktop 是否安装、是否正在运行；
- 检测本机是否存在可用的 Claude Code 环境；
- 返回状态：可用、未安装、未登录/无权限、版本不兼容、数据源不可用；
- 不因未安装 Claude 而影响 Codex 页面和后台刷新。

#### 5.3 Claude 共享用量

优先目标是展示与 Claude 官方界面一致的使用窗口、已用百分比和重置时间。实现必须通过独立的 `ClaudeUsageProvider`，原始响应不进入 UI。

产品规则：

- 标题使用“Claude 共享额度”；
- 数据来源旁显示“Beta”；
- 显示最后成功更新时间；
- 超过 10 分钟未更新显示“未更新”，超过 30 分钟显示“数据已过期”；
- 若只能取得限制状态或重置时间，采用降级卡片，不反推百分比；
- 若只能计算本地 Claude Code token，则单独显示“本地消耗”，不与订阅额度合并；
- 认证失败只影响 Claude provider，不清空 Codex last-good 数据。

#### 5.4 Claude Code 任务状态

beta1 只把可可靠识别的 Claude Code 会话定义为“Claude 任务”。标准状态沿用现有模型：

| 内部状态      | 用户文案 | 判定含义                         |
| ------------- | -------- | -------------------------------- |
| `thinking`    | 思考中   | 已发起模型请求，尚未进入工具执行 |
| `executing`   | 执行中   | 正在调用工具或执行本地操作       |
| `waiting`     | 等待操作 | 等待权限、选择或用户输入         |
| `completed`   | 已完成   | 正常结束并产生最终结果           |
| `failed`      | 失败     | 会话以错误结束                   |
| `interrupted` | 已中断   | 用户取消、进程退出或会话异常消失 |

每条任务展示：Claude 标识、标题、项目名、状态、运行时长和最近更新时间。标题不可用时回退到项目名或“Claude 任务”，不读取并展示完整提示词。

#### 5.5 通知与返回

- Claude 任务完成、失败、等待操作时可通知；
- 同一 session、同一状态只通知一次；
- 点击通知优先通过官方 `claude://` 深链返回；
- 无可用会话深链时只打开 Claude Desktop，不构造未经验证的 URL；
- 用量阈值通知与 Codex 分开去重。

#### 5.6 隐私授权

首次启用 Claude 时单独授权，说明：

- 会读取哪些本地状态或凭据元信息；
- 会访问的固定 Anthropic 域名（若用量 provider 需要联网）；
- 不保存或上传 token、Cookie、完整对话与工具输出；
- 可随时在设置中关闭 Claude 集成并停止扫描。

### P1：beta1 可选

- 同时展示 Codex 与 Claude 的合并任务列表；
- 菜单栏显示最近活跃产品的小型来源标识；
- Claude 本地 token/成本统计（必须标为本地统计）；
- Claude 订阅计划名称与额外用量余额；
- Claude 数据源诊断导出。

### 不纳入 beta1

- 监控普通 Claude 聊天的逐 token 生成状态；
- Cowork/Dispatch 全生命周期和子任务树；
- 修改 Claude Desktop 配置或自动安装 hooks；
- 多 Claude 账号切换；
- API、Bedrock、Vertex、Foundry 的统一账单；
- 代替 Claude Desktop 发消息或审批权限；
- Windows Claude 兼容（先完成 macOS 技术验证）。

## 6. 信息架构与交互

### 6.1 紧凑模式

单行结构保持不变：

`[来源图标] [任务状态 · 时长] [主额度剩余/状态]`

- 存在活动任务时优先显示任务状态；
- 无活动任务时显示当前来源的主额度；
- 数据为估算时必须出现“估算”标签，不能只靠 tooltip 说明。

### 6.2 详细模式

保持“用量 / 任务”两个标签，新增来源切换，不为 Claude 新建第三套页面。

用量页：

- 当前来源与 Beta 状态；
- 用量窗口或降级状态卡片；
- 数据来源、更新时间与错误说明；
- Claude 数据不可用时提供“检查 Claude Desktop”和“查看诊断”。

任务页：

- 默认按“进行中 / 最近完成”分组；
- 多来源同时展示时，每张卡片带来源图标；
- 过滤项为“全部 / Codex / Claude”。

### 6.3 设置

新增“AI 产品”区域：

- 默认显示来源；
- 启用/停用 Claude 集成；
- Claude 环境与数据源状态；
- Claude 完成、失败、等待通知开关；
- 重新检测与导出诊断。

## 7. 技术产品架构

现有 UI、托盘、通知和刷新协调器应继续复用，新增 provider 与统一领域模型。

```text
CodexCredentialProvider ─┐
CodexUsageProvider ──────┤
CodexTaskProvider ───────┤
                         ├─> Unified Snapshot ─> Tray / Window / Notifications
ClaudeEnvironmentProbe ──┤
ClaudeUsageProvider ─────┤
ClaudeCodeTaskProvider ──┘
```

统一模型至少增加：

```ts
type ProductSource = "codex" | "claude";
type DataConfidence = "official" | "observed" | "estimated";

interface UnifiedUsageSnapshot {
  product: ProductSource;
  sourceId: string;
  confidence: DataConfidence;
  windows: UsageWindow[];
  queriedAt: number;
}

interface UnifiedTask {
  product: ProductSource;
  sessionId: string;
  status: TaskStatus;
  title?: string;
  projectName?: string;
  startedAt: number;
  updatedAt: number;
}
```

设计约束：

- Claude 与 Codex 的错误、缓存、刷新锁、通知去重键必须隔离；
- provider 失败不能拖垮统一快照；
- UI 不依赖 Claude 原始字段和本地目录结构；
- 本地扫描器采用增量读取和文件变更监听，不周期性全盘扫描；
- 所有来源必须携带置信度，避免未来增加估算数据后产生误导。

## 8. 技术验证闸门

编码前先完成 3 个只读 spike，每个 spike 都要产出 fixture、兼容结论与停止条件。

### Spike A：Claude 用量来源

验证内容：

- 是否存在可重复、只读的个人订阅用量响应；
- 是否能在不复制 Cookie、不持久化 token 的前提下认证；
- Pro、Max 至少两个账号样本的窗口和重置时间是否一致；
- 401、403、429、离线与响应变化能否稳定分类。

停止条件：需要注入 Claude 进程、抓包绕过 TLS、自动化 UI、复制浏览器 Cookie 或修改 Claude 数据库。触发任一条件即不实现百分比 provider，使用降级展示。

### Spike B：Claude Code 任务来源

验证内容：

- Desktop 内 Claude Code 与终端 Claude Code 是否产生可区分 session id；
- 思考、工具执行、权限等待、正常完成、失败、中断是否有稳定事件；
- 是否能取得安全的会话标题、项目名和更新时间；
- 1 秒或 2 秒增量扫描下的 CPU、I/O 与事件延迟。

停止条件：只能通过持续截图、辅助功能读取聊天文本或注入进程判断状态。此时 beta1 只支持用户主动配置的 Claude Code hooks。

### Spike C：返回 Claude Desktop

验证内容：

- 官方 `claude://` 深链能否打开 Desktop；
- Code session 是否存在稳定、公开的定向链接；
- macOS 冷启动与已运行状态下行为是否一致。

停止条件：必须依赖未公开路由或拼接内部数据库主键。此时仅实现“打开 Claude Desktop”。

## 9. 安全与隐私要求

- Claude 集成默认关闭，单独取得用户同意；
- 凭据只在 provider 调用栈内短暂存在，不进入状态仓库、日志、错误文本或诊断包；
- 只允许编译期白名单 Anthropic HTTPS 域名，禁止重定向到非白名单域名；
- 不保存完整对话、提示词、模型回复、工具参数或工具输出；
- 标题只在本地内存使用，历史列表最多保存必要摘要；
- 诊断导出使用字段白名单，并列出实际扫描路径但不包含用户名以上的完整路径；
- Claude 本地文件格式变化时 fail closed，不尝试宽松解析敏感未知字段。

## 10. beta1 验收标准

### 功能

- Codex 所有 v1.2.1 核心能力无回退；
- 用户可独立启用、停用 Claude；
- 至少一种 Claude Code 运行形态能可靠识别六种任务状态中的运行、等待、结束三大类；
- 任务状态变化到 UI 的 P95 延迟不超过 3 秒；
- 完成和等待通知不重复；
- Claude 用量不可用时不显示虚假百分比，并给出可理解的降级状态；
- 点击 Claude 任务至少能可靠打开 Claude Desktop。

### 性能与稳定性

- Claude 未安装时常驻开销相对 v1.2.1 无可感知增加；
- 空闲扫描 CPU 平均低于 1%，不持续读取完整会话文件；
- 连续运行 24 小时无明显内存增长；
- Claude provider 故障不阻断 Codex 自动刷新。

### 安全

- 自动化测试确认日志、通知、事件 payload、诊断包不含 token、Cookie 和完整对话；
- 网络请求只访问批准的固定域名；
- 关闭 Claude 集成后 3 秒内停止相关扫描与刷新。

## 11. 发布与反馈策略

- 版本号统一设置为 `1.2.5-beta.1`，发布说明明确“Claude Desktop 兼容测试版”；
- 首批只发布 macOS Apple Silicon 测试包；
- 设置中提供一键复制匿名诊断信息；
- 重点收集：Claude 版本、登录类型、计划类型、任务漏报/误报、额度与官方 UI 差异；
- 不收集 token、账号 ID、会话正文、项目完整路径；
- 若用量数据对不上官方 UI，宁可在 beta.2 暂停该 provider，也不继续展示不可信数据。

## 12. 实施顺序

1. 完成三个只读 spike，决定 Claude 用量与任务 provider 的最终路径；
2. 抽象 `ProductSource`、统一 snapshot 和 provider registry；
3. 加入 Claude 环境检测与独立授权；
4. 实现 Claude Code 任务状态、通知和打开 Desktop；
5. 接入通过闸门的 Claude 用量 provider或降级卡片；
6. 完成来源切换、双来源任务列表和诊断；
7. 回归 Codex、做 24 小时长稳测试，发布 beta.1。

## 13. beta1 决策记录

| 决策                                  | 结论 | 原因                                       |
| ------------------------------------- | ---- | ------------------------------------------ |
| 是否重做 UI                           | 否   | 现有用量/任务/设置结构可扩展               |
| 是否直接把 `source` 字符串改成 Claude | 否   | 需要 provider registry 与明确来源模型      |
| 是否监控所有 Desktop 聊天             | 否   | 缺少稳定、公开的实时任务事件               |
| 是否优先支持 Claude Code              | 是   | 有 session、结构化事件和可恢复能力         |
| 是否展示估算百分比                    | 否   | 容易被误认作官方剩余额度                   |
| 是否沿用同一通知状态                  | 否   | 不同产品和窗口必须独立去重                 |
| 是否保留“自动”来源                    | 否   | 来源切换应由用户明确控制，避免界面自行跳转 |
| 是否 beta1 同步做 Windows             | 否   | 先验证 macOS 数据路径和 Desktop 行为       |

## 14. 外部依据（核验于 2026-07-23）

- [Anthropic Help Center：Claude 各产品界面共享使用限制](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)；
- [Anthropic Help Center：Claude Desktop 承载 Cowork 与 Claude Code](https://support.claude.com/en/articles/14128542-let-claude-use-your-computer-in-cowork)；
- [Anthropic Help Center：Claude Desktop 支持 `claude://` 深链](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link)；
- [Anthropic Claude Code 文档：CLI 支持 session resume 与结构化输出](https://docs.anthropic.com/en/docs/claude-code/cli-usage)。

外部能力可能随 Claude Desktop 更新而变化，实现时应保存测试版本矩阵，不能仅凭当前本地文件结构建立长期承诺。
