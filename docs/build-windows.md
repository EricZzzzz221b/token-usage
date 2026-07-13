# Windows 构建说明

## 环境

- Windows 11 x64 或 Windows 10 22H2 x64
- Node.js 22 LTS
- Rust stable，目标 `x86_64-pc-windows-msvc`
- Visual Studio 2022 Build Tools（Desktop development with C++）
- WebView2 Runtime（开发机通常已安装）

## 检查与构建

```powershell
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
cargo clippy --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --all-targets -- -D warnings
npm run tauri -- build --target x86_64-pc-windows-msvc --bundles msi,nsis
```

安装包生成在：

- `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/`
- `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`

`tauri.windows.conf.json` 会在 Windows 目标上自动与主配置合并，把应用版本覆盖为 1.0.0 并把 bundle 目标改为 MSI 和 NSIS。主配置和 Cargo/package 版本继续保持 macOS v1.1.3。

Tauri 要求 `macOSPrivateApi` 配置与其 Cargo feature 在主 manifest 中一致；该 feature 自身由 Tauri 在 Windows 上条件编译为空。项目自己的 Objective-C、AppKit、QuartzCore、`ns_view` 和 Liquid Glass 调用仍全部受 `target_os = "macos"` 保护，Windows 构建脚本不会读取或编译 `native/liquid_glass.m`。

## CI 与发布

- `CI / windows-x64` 在每个 PR 和 main push 上运行完整前端、Rust、Clippy 和安装器构建。
- 构建产物统一重命名为 `TokenUsage_Windows_1.0.0_x64.msi` 与 `TokenUsage_Windows_1.0.0_x64-setup.exe`，同时生成 SHA-256 artifact。
- `Release Windows` 是手动工作流，默认创建 `windows-v1.0.0` GitHub Release 并上传两个安装器和校验文件。

不要在 macOS 上把 `cargo check` 当作 Windows 构建成功；正式结论只以 `windows-latest` Actions 结果为准。
