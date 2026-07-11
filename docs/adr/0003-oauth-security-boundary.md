# ADR 0003: OAuth 安全边界

- 状态：已接受
- 日期：2026-07-11

## 决策

OAuth access token 只存在于 Rust 内存中的私有凭据结构。前端、Tauri 命令返回值、日志、诊断信息和本地存储均不得接收 token。用量客户端只能请求编译期固定的 ChatGPT 官方端点，并禁止跟随 HTTP 重定向。

## 原因

- Access token 可以代表用户的 Codex 官方登录态，属于高敏感凭据
- 重定向可能把 Authorization header 带到非预期目标
- 前端 WebView 的可观察面大于 Rust 后端，不应持有凭据
- 字段白名单比事后日志脱敏更可靠

## 后果

- 所有网络请求必须在 Rust provider 中完成
- 错误载荷只能使用预定义错误代码和安全文案
- 测试只能使用虚构 token，并必须验证公共报告不包含 token 或账号 ID
- 未来新增数据源也必须遵守相同边界
