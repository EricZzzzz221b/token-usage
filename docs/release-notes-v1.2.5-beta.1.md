# Token用量 v1.2.5-beta.1

这是 Claude Desktop 兼容方向的首个测试版本。

## 新增

- Codex 与 Claude 来源切换；
- 只读增量扫描本机 Claude Code 会话；
- Claude Code 任务来源、状态、项目和完成通知；
- Claude Desktop 与 Claude Code 环境检测；
- Claude 集成独立开关，默认关闭；
- Claude 任务可打开 Claude Desktop；
- Claude 共享额度降级页面。
- 顶部来源明确切换 Codex / Claude；Claude 未启用时仍可进入并查看开启指引。
- 任务列表严格按当前来源过滤，Codex 与 Claude 任务不会交叉显示。
- 修复来源切换后活动任务卡片无法打开的问题。
- 修复紧凑模式可能显示另一来源任务状态的问题。
- 修复 Claude“等待操作”通知每次扫描都可能重复发送的问题。
- Codex 与 Claude 各自保留最近任务，避免一个来源挤掉另一个来源的列表。

## 数据边界

Anthropic 当前没有为第三方桌面工具提供可安全读取的个人订阅剩余额度 API。本版本不会读取 Claude Desktop Cookie、IndexedDB 或内部数据库，也不会用本地 token 估算冒充官方额度百分比。

Claude 任务监控只读取 `~/.claude/projects` 下 Claude Code 已生成的本地 JSONL 事件。应用不保存完整提示词、回复、工具参数或工具输出。

## 测试范围

- macOS Apple Silicon；
- Claude Desktop 已安装；
- Claude Code 本地会话；
- Codex v1.2.1 功能回归。
