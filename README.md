# Token用量 / Token Usage

Token用量是一款面向 Codex 官方订阅用户的跨平台桌面用量工具。它只读本机 Codex OAuth 登录态，向 `chatgpt.com` 官方用量接口查询数据，并以倒扣方式展示 5 小时和 7 天窗口的剩余额度与重置时间（满额 100%，用尽 0%）。

当前发布线：Windows v1.0.0；macOS v1.1.3。两个平台使用独立 Tauri 配置，Windows 版本号不会覆盖 macOS 发布线。

## Windows v1.0.0

- [下载 MSI（Windows x64）](outputs/TokenUsage_Windows_1.0.0_x64.msi)
- [下载 EXE/NSIS 安装器（Windows x64）](outputs/TokenUsage_Windows_1.0.0_x64-setup.exe)
- [查看 Windows v1.0.0 更新说明](docs/release-notes-windows-v1.0.0.md)
- [查看 SHA-256](outputs/SHA256SUMS-Windows-1.0.0.txt)

支持 Windows 11 x64 和 Windows 10 22H2 x64。v1.0.0 暂不发布 ARM64：当前发布流程只在 GitHub Actions 的 Windows x64 运行器上完成真实安装包验证，ARM64 将在具备对应运行环境后再启用。

安装：

1. 优先下载并运行 `.msi`；也可以使用 `-setup.exe`。
2. 本版本没有商业代码签名证书。若 Microsoft Defender SmartScreen 显示警告，请核对本页 SHA-256，然后选择“更多信息”→“仍要运行”。不要在哈希不一致时继续。
3. 安装器内嵌 Microsoft WebView2 Bootstrapper。如果系统没有 WebView2 Runtime，安装器会明确启动 Microsoft 安装流程，因此首次安装可能需要联网；Windows 10 22H2 和 Windows 11 通常已包含 WebView2。
4. 启动 Codex CLI 或客户端并使用 ChatGPT OAuth 登录。应用支持默认 `%USERPROFILE%\.codex\auth.json` 和 `CODEX_HOME\auth.json`。

卸载：打开“设置”→“应用”→“已安装的应用”，找到“Token用量”并选择“卸载”。安装器提供开始菜单入口、覆盖升级和标准卸载项。

## macOS v1.1.3

- [下载 macOS DMG（Apple Silicon）](outputs/TokenUsage_1.1.3_arm64.dmg)
- [查看 v1.1.3 更新说明](outputs/TokenUsage_1.1.3_ReleaseNotes.md)
- SHA-256：`3c3bc199fadf9fb965e7675ed7cf0c4e12dedc0507c661b172dc54fae7411d0e`

要求 Apple Silicon Mac 和 macOS 13 或更高版本。DMG 采用 ad-hoc 签名，首次启动请在 Finder 中右键应用并选择“打开”。macOS v1.1.3 的 Liquid Glass、壁纸明暗对比度检测和既有功能保持不变。

## 功能

- 标准/紧凑浮窗与快捷切换
- 5 小时、7 天剩余额度和重置时间
- 立即刷新、自动刷新间隔、阈值与重置通知
- 托盘显示周期选择、显示浮窗、切换模式、刷新和退出
- 开机启动、始终置顶、锁定位置、鼠标穿透和窗口拖动
- 中文和英文界面
- Windows 11 Mica、Windows 10 Acrylic 与稳定纯色降级
- 深色/浅色主题自动适配和 Windows 高对比度模式基础支持

## 安全与隐私

- OAuth 凭据只在本机内存中读取，不持久化、不记录、不上传 Access Token、Refresh Token、Account ID、邮箱或原始认证内容。
- 凭据只用于请求 `https://chatgpt.com/backend-api/wham/usage`。
- Windows v1.0.0 不读取 Windows Credential Manager；目前没有经过验证的 Codex 凭据格式，因此不会猜测实现。
- 本地历史只保存标准化后的用量窗口，设置和缓存使用 Tauri 提供的系统标准目录（Windows 为 AppData）。

## 开发与文档

要求 Node.js 22 LTS 和 Rust stable。

```bash
npm ci
npm run check
npm run tauri:dev
```

- [Windows 构建说明](docs/build-windows.md)
- [Windows 与 macOS 差异及已知限制](docs/windows-platform-notes.md)
- [技术架构](docs/architecture.md)
- [贡献指南](CONTRIBUTING.md)

Windows 安装包由 `windows-latest` GitHub Actions 运行器实际构建。`Release Windows` 手动工作流使用独立标签 `windows-v1.0.0`，不会影响 macOS v1.1.3 标签和版本配置。
