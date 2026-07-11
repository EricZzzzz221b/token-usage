# 开发约定

## 基本要求

- 功能变更必须关联一个明确工作包或 issue
- 安全、凭据和网络相关变更必须包含测试
- 不在日志、截图、fixture 或 issue 中提交真实 OAuth 信息
- UI 行为变更同步更新产品规格或技术文档
- 保持提交范围单一，避免把重构与功能混在一个提交中

## 分支与提交

- 功能分支：`feat/<topic>`
- 修复分支：`fix/<topic>`
- 文档分支：`docs/<topic>`
- 提交信息使用简短祈使句，例如 `add OAuth credential parser`

## 合并检查

- Rust format、lint 和 test
- TypeScript format、lint 和 test
- Tauri debug build
- 敏感信息检查
- 涉及界面时附浅色和深色截图

## 安全红线

- 不提交真实 `auth.json`
- 不输出 Authorization header
- 不允许用户配置 OAuth 用量查询域名
- 不在前端长期保存 token
- 不使用包含真实账号数据的崩溃上报
