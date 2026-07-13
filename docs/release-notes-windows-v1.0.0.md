# Token用量 Windows v1.0.0

首个 Windows 正式版本，支持 Windows 11 x64 和 Windows 10 22H2 x64。

## 功能

- 标准和紧凑浮窗，可从浮窗或系统托盘直接切换。
- 展示 5 小时和 7 天剩余额度、已用比例与重置时间；剩余 30%/10%/0% 使用分级风险提示。
- 系统托盘提供显示浮窗、立即刷新、模式切换、5 小时/7 天显示周期、恢复交互和退出。
- 支持自动刷新、余额阈值通知、重置通知、开机启动、始终置顶、锁定位置和鼠标穿透。
- Windows 11 使用跟随系统主题的 Mica；Windows 10 回退 Acrylic；DWM 效果不可用时使用可读的纯色表面。
- 使用 Tauri 逻辑像素尺寸，适配常见 DPI 缩放与不同 DPI 显示器。
- 支持中文、英文、键盘焦点、可访问名称和 Windows 高对比度基础样式。

## 安全与认证

- 读取 `%USERPROFILE%\.codex\auth.json` 或 `CODEX_HOME\auth.json` 中的 ChatGPT OAuth 登录态。
- 不记录、上传或持久化 Token、账号 ID、邮箱和原始认证文件。
- 没有验证 Windows Credential Manager 中 Codex 凭据的官方格式，因此本版本不读取 Credential Manager。
- 未登录、登录过期、网络不可用、限流和服务异常均显示可重试错误。

## 安装

提供 MSI 和 NSIS EXE 两种 x64 安装器。安装器内嵌 WebView2 Bootstrapper；缺少 Runtime 时会启动 Microsoft 安装流程。Windows 10 22H2 和 Windows 11 通常已包含 WebView2。

本版本没有商业代码签名证书，SmartScreen 可能提示“未知发布者”。请先核对 `SHA256SUMS-Windows-1.0.0.txt`，再通过“更多信息”→“仍要运行”继续。

## 已知限制

- v1.0.0 仅发布 x64；ARM64 尚未经过真实 Windows ARM64 构建和运行验证。
- Windows 系统托盘不支持 macOS 式常驻文字标题；当前余额显示在托盘提示和菜单摘要中。
- Windows 自动对比度跟随系统深色/浅色主题，不分析浮窗背后的桌面壁纸。
- 安装包未进行 Authenticode 商业签名。
