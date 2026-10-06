# macOS stable 应用内更新

日期：2026-10-06。范围：macOS Apple Silicon、stable。Windows 和 Intel Mac 不启用更新，现有业务功能不迁移、不重构。

用户后续已选择不要求 Apple 证书的 GitHub 自动更新路线：见 [GitHub 自动更新配置](github-auto-updates.md)。以下 Apple 证书／公证要求只适用于 `notarized` 模式；`github-ad-hoc` 必须显式选择并确认风险，不能作为签名失败兜底。

## 当前交付状态

- **代码／Mock 验证：** 更新服务、前端意图适配、正式发布防护已实现。具体测试结果见 `docs/macos-updates-validation.md`。
- **正式发布配置：未就绪。** 正式 Tauri 更新密钥已于 2026-10-06 经授权在仓库外生成并验证，但尚未配置到 GitHub／App；所选 GitHub ad-hoc 路线不要求 Apple 证书或公证凭据。默认构建不注册 Updater、不发更新网络请求；手动检查显示“未配置”。
- **真实 N → N+1 升级：未验证。** 未创建 commit/tag/Release、未上传正式包、未替换本机安装应用。
- 现有 1.2.7 DMG 是此前的 ad-hoc 发行，不能因为新增代码而获得应用内更新。首次采用更新需要用户通过新的签名／公证 DMG 安装具备更新器的版本。

## 边界与状态机

`src-tauri/src/updates.rs` 是唯一的 `UpdateService`：应用启动创建一次、保存在 Tauri managed state；可选 Updater 注册失败只禁用更新，不使应用启动失败，独立于 `RefreshCoordinator` 和任务监控。

- 启动后等 30 秒；随后每次检查完成后等 12 小时。休眠恢复不补发一串请求。
- 手动和后台检查共用一个操作锁；主动检查加入正在进行的后台检查，而不是发第二个请求。
- 同一把锁覆盖原生确认、下载、安装和重启。重复点击不排队安装；确认取消不下载、不安装。
- `idle → checking → available / up_to_date / error`。
- `available → confirming → downloading → installing → restarting`；故障回到 error，保留可重试的元信息。
- 后台无更新和检查失败安静；手动检查展示确定结果；检查失败不清除已有更新提示。
- 检查最多 30 秒；下载最多 15 分钟。下载进度通过合并的最新快照传播，不建立无界队列。
- 快照使用递增 revision，前端不会被过期 IPC 结果覆盖。
- 发布说明只作为 React 文本渲染，不解释 HTML。

`src-tauri/src/update_backend.rs` 是官方 Updater 适配器。`check`、`download`（包含签名验证）和 `install` 全部委托 Tauri。安装在 blocking worker 中执行，成功才调用 Tauri restart。更新器不导入 credentials，不读取 Codex 登录文件，不接触用量 HTTP 客户端，不给请求附加 Codex headers，不进入凭据诊断导出。

前端 `src/updates.ts` 只封装三个意图命令和事件；`src/UpdatePanel.tsx` 展示状态、版本、进度和错误。设置页显示当前版本／检查更新／更新并重启；详细和紧凑浮窗显示进入更新设置的提示；托盘有独立更新入口和新版本文案。托盘只展示快照，不调度更新，不改用量标题或刷新策略。

JS capabilities **没有** updater check/download/install 权限。安装确认在 Rust 原生系统对话框进行，不能靠前端传 `confirmed: true` 绕过。确认同时明确授权安装和立即重启；后台检查绝不安装或重启。

## 渠道与网络

唯一编译期端点：

```text
https://raw.githubusercontent.com/EricZzzzz221b/token-usage/macos-stable/updates/macos/stable.json
```

这是独立的 `macos-stable` 分支静态清单，和 Windows 发布及仓库 `releases/latest` 无关。该分支尚未在本任务中创建。无需新增服务／后端；正式发布前需确认仓库公开、端点可从目标网络访问。

清单只有 `darwin-aarch64`。下载地址必须完全匹配：

```text
https://github.com/EricZzzzz221b/token-usage/releases/download/v<VERSION>/TokenUsage_<VERSION>_arm64.app.tar.gz
```

仅接受严格更高的稳定 SemVer；相同、较低、预发行和 build metadata 版本不更新。所有初始地址和重定向保持 HTTPS，拒绝带用户名／密码的地址；正常跟随 GitHub 到 HTTPS CDN 的最多五次重定向。不关闭 TLS 证书或 hostname 校验。

`requireSignedVersion: true` 要求签名的 authenticated trusted comment 含正确版本。即使旧包的签名有效，清单也不能把它标成更高版本。清单 JSON 本身不签名；HTTPS、固定渠道地址、固定版本地址和签名中的版本绑定共同限定它的作用。

## 实际依赖与限制

- 原项目 lock 的 Tauri 2.11.5、CLI 2.11.4。
- 当前官方 Updater 固定 `=2.13.1`；它要求 Tauri 2.12，lock 为 2.12.1。
- 前端 `@tauri-apps/api` 同步固定 2.12.1，避免 Tauri CLI 的 major/minor 不匹配构建错误。
- CLI 固定 2.12.1，提供 `signer sign --app-version`。旧 CLI 没有该选项。
- release 的 build-override 仅对构建期 proc-macro／build-script 设置 `strip = "none"`，避免本机 release 动态宏加载错误；最终应用保留原 `strip = "symbols"`。
- 最低 Rust 从 1.85 提到 1.90。升级范围是更新器所需的 Tauri 依赖，不迁移业务 API。
- 更新器 `configure_client` 使用其实际 reqwest 0.13 类型；现有 OAuth 用量 reqwest 0.12 不变。
- **不得假定官方安装失败必定自动回滚。** 锁定版本会先把旧应用移入临时备份，然后换入新应用；其 macOS 失败／备份清理路径不能作为可靠恢复承诺。需在真实 N → N+1 验证后才正式启用。

## 安装位置与权限

下载前和安装前两次预检：

1. 从真实 executable 路径 canonicalize 定位 `.app`。
2. DMG `/Volumes` 与 App Translocation 明确拒绝，并告诉用户退出、复制到 Applications 后再打开。
3. 只允许 `/Applications` 或用户的 `~/Applications` 直属应用；其他目录／磁盘使用 DMG。
4. 父目录及应用目录树必须有写入／搜索权限；使用 `access` 而不是只检查 POSIX mode bits。
5. 安装目录必须和系统 temp 同一 filesystem，以免 rename 的 EXDEV 失败发生在旧应用移走之后。
6. 不提供自写 shell 安装器，不请求自定义管理员提权，不删除 quarantine／安全扩展属性。

预检不是 OS 事务，无法消除权限在预检后改变、磁盘耗尽、进程崩溃等 TOCTOU 风险；官方安装器仍可能在 race 中提示权限。出现安装失败不自动重启，使用正式 DMG 手动恢复。下载／签名失败发生在安装前，旧应用不会被替换。

## 待配置项（不要提交、打印秘密）

GitHub ad-hoc 模式只需前三项 Tauri 更新密钥配置；下列 Apple 项目仅 `notarized` 模式需要。在受保护的 `macos-stable` GitHub Environment 设置：

| 类型       | 名称                                    | 说明                                                                                |
| ---------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| variable   | `TOKEN_USAGE_UPDATER_PUBLIC_KEY`        | 完整 `.pub` 内容的 Tauri base64 公钥（不是仅内层 Ed25519 行）；必须来自用户正式密钥 |
| secret     | `TAURI_SIGNING_PRIVATE_KEY`             | Tauri 正式更新私钥内容，或本地受保护文件路径                                        |
| secret     | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`    | 正式私钥密码，按实际密钥设置                                                        |
| secret     | `APPLE_CERTIFICATE`                     | Developer ID Application `.p12` base64                                              |
| secret     | `APPLE_CERTIFICATE_PASSWORD`            | `.p12` 密码                                                                         |
| variable   | `APPLE_SIGNING_IDENTITY`                | 完整 Developer ID Application identity，不能为 `-`                                  |
| variable   | `APPLE_TEAM_ID`                         | 稳定 Apple Team ID                                                                  |
| secret     | `APPLE_API_KEY` / `APPLE_API_ISSUER`    | App Store Connect API key ID / issuer                                               |
| secret     | `APPLE_API_PRIVATE_KEY`                 | 公证 `.p8` 内容，仅写入权限 0600 的临时目录并及时删除                               |
| permission | Environment reviewer / `contents:write` | 显式发布审批，允许创建 Release 和更新 `macos-stable` 分支                           |

本机发布可改用现有钥匙串证书和 `APPLE_NOTARY_KEYCHAIN_PROFILE`；发布脚本不生成／替换正式密钥。用户已另行授权生成的正式 Tauri 更新密钥位置及备份要求见 [GitHub 更新说明](github-auto-updates.md)。`release/updater-config.example.json` 保持空公钥，是未启用模板，不是可发布配置。

`TOKEN_USAGE_ENABLE_UPDATER=1` 只由正式构建脚本设置，编译时嵌入真实公钥；debug 和普通构建始终不启用；服务还会拒绝关闭版本绑定、允许降级或放宽 TLS 的配置。公钥是公开验证材料；私钥、证书和公证凭据不进入 build.rs、快照、日志或普通诊断文件。

## Apple 公证模式发布流程（`notarized`）

**目前不要运行发布命令。** 先配置真实材料、选择未发行的新版本并完成升级验收。当前 1.2.7 不能覆盖重新发行。

1. 设置新 stable 版本（package / Cargo / Tauri 三处一致），写版本说明，用户自行审批／提交并创建对应 tag。
2. 显式触发 `Release macOS stable` workflow，指定已有 tag、`mode=notarized` 和 `confirm=yes`；Environment 应设 required reviewers，串行 concurrency 不 cancel 在途任务。
3. `scripts/build-macos-stable.sh`：检查真实密钥与 Apple 配置 → `npm run check` → Apple 签名 `.app` → 公证、staple、验证签名、Team ID、Gatekeeper。
4. `scripts/build-dmg.sh BUILD_MODE=release`：只读核验 app，不清除属性、不 ad-hoc 签名；生成并签名、公证、staple DMG。DMG 保留首次安装与手动恢复。
5. 使用标准 tarfile 生成单一 `.app` 根目录的 portable tar.gz（与 Tauri 官方 Rust tar 格式一致，无 AppleDouble；不修改源应用或其安全属性），解包后再次验证签名／公证／架构／bundle ID／版本，输出 `TokenUsage_<VERSION>_arm64.app.tar.gz`（官方 updater 格式）；Tauri `signer sign --app-version` 签名；在本机加密验证最终包、版本绑定和公钥对应关系。
6. 生成 `.sig`、`SHA256SUMS-<VERSION>.txt` 和待发布 `stable.json`。之后不得再修改 app/archive/signature；输出目录和 DMG 不覆盖。
7. `scripts/publish-macos-stable.mjs`：只有显式 `CONFIRM_STABLE_PUBLISH=yes` 才执行；先验证 tag／平台／签名／单调版本／未发布版本。
8. 创建 draft Release、上传具体版本四个资产，不使用 `--clobber`；发布 Release但不指定整个仓库 latest；通过具体 HTTPS URL 下载所有资产比对 hash，再加密验证更新包。
9. **最后**才写单一 stable 清单并以 `force:false` 原子推进渠道 ref。缺包、签名不符、上传／下载失败或并发冲突立即停止，不推进 stable。

专用分支不存在时由经过审批的发布流程从当前 source commit 初始化；存在时只替换 `updates/macos/stable.json`，保留其他树内容。服务器会为这一步生成渠道 Git commit，这是未来显式发布动作，不是本次实施的自动提交。

部分上传失败会留下 draft；已上传过资产的 draft 不允许自动重跑覆盖。发布人员先审查失败状态：可以清理尚未正式发布的 draft，或选择新版本；正式发布的资产绝不覆盖。若 Release 成功、验证失败，旧 stable 保持不变，修复后用新版本发布，不静默推广有问题的包。正式 stable 不做降级；回滚以 DMG 或更高补丁版本处理。

## 真实升级验收（必须另行完成）

在受控 Mac 上用同一 bundle identifier、正式更新密钥和选定的发行模式建立 N 和 N+1；只有 `notarized` 模式要求同一 Developer ID；可以用独立测试分支端点，但必须保留正式 HTTPS／签名校验，不能把测试密钥提交为正式公钥或推广测试版到 stable。

- 从对应模式的 DMG 安装 N 到 Applications，普通用户执行；GitHub ad-hoc 模式应实测系统批准流程，而不是假定 Gatekeeper 已接受。
- 检查后台 30 秒提示、设置主动检查、12 小时调度；隐藏窗口和紧凑模式也能进入更新设置。
- 点击更新，取消应保持旧版；再次点击并明确确认后下载、验证、安装、重启一次。
- 记录新进程 PID、CFBundleShortVersionString 和 UI 版本为 N+1。
- 检查登录启动、语言、置顶、位置锁定、鼠标穿透、Dock、通知阈值和用量授权设置不丢失。
- 窗口位置、compact/detailed 模式恢复；更新前保存 POSITION，不用新配置覆盖旧偏好。
- 用量刷新、API／订阅展示、任务实时状态、完成通知和 Codex deep link 正常；更新不结束 Codex 任务。
- 原有通知、屏幕录制、辅助功能权限是否保留／是否出现额外 macOS 提示；不得通过删除属性绕过。
- DMG、Translocation、只读 Applications、不同 volume、网络断开、下载损坏、签名错误分别检查清晰恢复路径。
- 安装中磁盘不足／权限变化可能破坏 app 目录，必须实际验证 DMG 恢复，不能声称“自动回滚已保证”。

## 官方依据

- [Tauri 2 Updater](https://v2.tauri.app/plugin/updater/)
- [Tauri macOS Code Signing / Notarization](https://v2.tauri.app/distribute/sign/macos/)
- [Updater 2.13.1 源码](https://github.com/tauri-apps/plugins-workspace/tree/updater-v2.13.1/plugins/updater)
- [Tauri CLI 签名源码](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/signer/sign.rs)

以实际锁定源码为准；不要把主分支上尚未进入锁定版本的安装回滚改进当作当前保证。
