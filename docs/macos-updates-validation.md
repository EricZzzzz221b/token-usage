# macOS Updater 验证记录

日期：2026-10-06（Asia/Shanghai）。适用源代码：本次未提交工作区；初始验证应用版本为 1.2.7；按用户最新发布要求，当前发布准备版本为 1.2.8。**这不是实际安装 N → N+1 升级完成记录。**

## 三个独立结论

| 层次             | 状态   | 限定                                                                                        |
| ---------------- | ------ | ------------------------------------------------------------------------------------------- |
| 单元／Mock 验证  | 通过   | 前端、服务状态机、真实加密验签、官方 Updater 下载 API 和发布脚本 Mock                       |
| 正式发布配置就绪 | 未就绪 | 正式 Tauri 更新密钥已在本地生成并验证，未配置 GitHub／构建；CI Environment 和线上渠道未验证 |
| 真实安装 N → N+1 | 未执行 | 未安装测试／正式更新包，未验证真实重启和权限保留                                            |

普通构建的更新服务为 disabled；没有注册官方更新插件或运行自动检查。正式配置模板公钥为空，测试公钥位于明确标记 `testOnly` 的 fixture 且只从 `#[cfg(test)]` 代码使用。测试临时私钥只存在测试进程内存，不持久化或用于正式发布。

## 执行结果

- `npm run check`：通过，包含 Prettier、ESLint、TypeScript、Vitest、发布测试、Rustfmt、Cargo test、Clippy `-D warnings`。
- Vitest：**43 / 43**（其中更新 UI 6 个；现有 App 27 个；现有表面／对比度 10 个）。
- Rust：**49 / 49**（包括已有凭据／用量／任务／窗口回归和更新模块）。
- 发布脚本：**7 / 7**；其中一个端到端 Mock 测试分支包含上传失败、下载失败、内容篡改、缺包、缺授权和成功。
- `npm run build`：通过。
- `CARGO_TARGET_DIR=/tmp/token-usage-updater-build npm run tauri:build`：通过，release 可执行文件在 `/tmp/token-usage-updater-build/release/token-usage`，未打正式包、未运行／安装应用。
- `git diff --check`：通过。
- shell／Node 发布脚本语法检查：通过。
- `npm run tauri -- build --debug --no-bundle`：通过，输出为 `src-tauri/target/debug/token-usage`；未运行应用。
- release 文件架构核验：Mach-O arm64；生产二进制未包含测试公钥 fixture。

构建过程中发现并修复了两个此前被 debug/dev 依赖覆盖的问题：Tauri Rust 2.12 要求前端 API 同步到 2.12；生产 Tokio 必须启用 macros 才能使用 `select!`。另针对本机 release proc-macro 加载问题，采用 build-override `strip = "none"`，只影响构建期工具，保留最终应用 `strip = "symbols"`。没有清理已有项目构建缓存；独立目录构建通过。

## 覆盖与证据边界

| 场景                                         | 验证方式                                            | 结果                                     |
| -------------------------------------------- | --------------------------------------------------- | ---------------------------------------- |
| 无更新／新 stable 版本                       | Rust service Mock + 前端展示                        | 通过                                     |
| 相同／较低／预发行／build metadata／非法版本 | Rust SemVer 策略 + 发布门禁                         | 通过，不提供更新                         |
| 后台网络失败保持安静、主动失败有明确结果     | Rust Mock + UI 文案                                 | 通过                                     |
| 检查超时                                     | Tokio 虚拟时钟推进真实服务 timeout                  | 通过                                     |
| 清单不是 JSON、缺当前平台                    | 官方 Tauri Updater + 本机 HTTP Mock                 | 通过                                     |
| 包被篡改、损坏签名、签名版本不同             | 官方 `Update.download` 真实加密验签（测试 payload） | 通过，未调用 install                     |
| 错误公钥、authenticated comment 被改写       | Node 真实 Ed25519／BLAKE2b 验签                     | 通过                                     |
| 重复检查、主动检查加入后台检查               | 服务操作锁 Mock                                     | 通过，网络 check 一次                    |
| 重复安装、下载期间后台／主动检查             | 服务 Mock                                           | 通过，download/install/restart 不重复    |
| 用户取消确认                                 | 服务 Mock                                           | 通过，不下载／安装                       |
| 下载失败后继续使用旧版本                     | 状态／调用计数 Mock + 现有核心测试                  | 通过；尚非真实已安装 App 的实测          |
| DMG、Translocation、非 Applications          | 路径策略单元测试 + 服务 preflight Mock              | 通过；尚非实际 DMG 运行实测              |
| 目录不可写                                   | preflight 错误 Mock；生产使用 access 和两次预检     | 通过策略验证；真实 ACL／安装权限未实测   |
| 安装失败不重启                               | 服务 Mock                                           | 通过；不保证官方安装器一定回滚           |
| 启动 30 秒、后续 12 小时                     | Tokio 虚拟时钟                                      | 通过                                     |
| 不安全 TLS／降级／关闭版本绑定配置           | Rust 配置门禁                                       | 通过，服务不启用                         |
| 发布上传／下载失败、缺文件、不匹配签名       | Mock gh/fetch + 实际本地 hash／加密验证             | 通过，不创建／推进渠道清单               |
| 发布成功最后推进 stable                      | Mock gh/fetch                                       | 通过，全部资产下载验证后才调用渠道写 API |
| 正式 DMG 签名失败不降级                      | Mock codesign/hdiutil/xattr                         | 通过，无 ad-hoc 或属性删除               |
| 更新包 root／Unicode／symlink／文件不覆盖    | 实际 tarfile 归档和解包检查                         | 通过                                     |

本机 HTTP 只出现在 debug tests，Tauri 允许 debug loopback。没有配置危险 HTTP／证书绕过 flags；生产客户端强制 HTTPS。测试没有执行 macOS installer、原生确认窗口、真实 Apple 公证或真实 Relaunch。

## 保留已有工作

开始时已有 Codex-only、历史模块移除、任务监控和原生玻璃／视觉简化相关改动及 QA 输出；本任务没有回退、删除或清理它们。沿用现有工作区状态测试。未改变用量 `RefreshCoordinator`、任务解析或窗口偏好逻辑。仅新增更新服务并在 App／Tauri／托盘设置入口做最小接入。

本任务未创建 commit、tag、Release，也未上传正式安装包或更新线上 stable。历史 Release workflow 的 `--clobber` 也已移除，避免另一条 macOS 链路覆盖正式包。

## 现有依赖风险

`npm audit --json` 查询当前和原始 HEAD 锁文件，结果相同：**10 项，2 moderate、6 high、2 critical**。涉及 Vitest／tinypool 和现有构建工具依赖，不是新增 Updater 包。审计不等于它们都可影响最终桌面应用，但正式发布前应独立评估与修复。本任务没有运行 `npm audit fix` 或进行不相关依赖重构。

## 仍需真实验收

按照 `docs/macos-updates.md` 的 N → N+1 checklist 验证版本变化、新进程、用户设置、窗口位置／模式、用量刷新、任务监控、通知／屏幕录制／辅助功能权限，以及 DMG／只读目录／空间不足等失败恢复。使用相同 bundle ID、正式更新签名密钥及明确的发行模式；`notarized` 模式还要求同一 Developer ID。

若签名／下载失败，安装尚未开始，旧应用未替换。若安装过程中失败，不能声称已可靠自动回滚：不自动重启，退出后通过相同 bundle ID／发行模式的 DMG 手动恢复；公证模式还应保持 Team ID；不得删除系统安全属性。

## 后续调整：GitHub-only 自动更新

用户已选择 `github-ad-hoc` 路线。新增模式确认门禁、独立无 Apple secrets 的 workflow 分支、未公证风险告知、模式一致性校验及对应测试。`notarized` 模式仍严格校验证书、公证且无降级兜底。正式 Tauri 密钥仍未生成或启用，未执行真实升级。
本轮复验：

- `npm run check` 通过：前端 43 / 43，Rust 50 / 50，发布脚本 10 / 10。
- GitHub-only 公共配置模板的本地 `.app` 构建通过；`TOKEN_USAGE_ENABLE_UPDATER=0`，未注入任何正式或测试更新公钥。
- 本地 Tauri bundle 明确使用 `APPLE_SIGNING_IDENTITY=-`，没有 Apple 公证凭据；验证 `.app` 的 codesign、arm64 架构、bundle ID 和版本通过。
- 实际生成 portable 更新 tar.gz、解包并再次运行相同只读签名／结构验证，通过。测试归档位于临时目录，未作正式更新签名、未上传。
- `spctl --assess --type execute` 只读评估返回 **rejected**（退出码 3）。这是未公证构建的真实系统限制，不是完整升级通过；没有申请绕过、启动测试 App、删除属性或关闭 Gatekeeper。
- shell／Node 语法检查和 `git diff --check` 通过。
- 未生成正式 Tauri 私钥；普通构建及本地检查包仍不启用自动更新。

因此本轮完成的是 GitHub 自动下载／签名校验／安装路线的代码和发行模式配置，不是 Gatekeeper 信任、公证或真实 N → N+1 安装验收。

## 后续授权：本地正式更新密钥生成

2026-10-06 用户明确允许生成并在仓库外受限目录保存正式更新密钥。通过官方 Tauri CLI 2.12.1 的 NAPI 入口生成加密私钥：随机密码只在工作进程内存和受限密码文件存在，不进入 OS 命令行、聊天、CLI 输出或普通诊断文件；CLI stdout／stderr 被丢弃，无明文私钥输出。生成过程没有使用 `--force`，没有覆盖已有文件。

- 目录：`/Users/zhangguangyu/.config/token-usage/keys/macos-stable`；目录链为 `0700`，四个文件为 `0600`，无额外 ACL，无符号链接，归当前用户所有。
- 私钥用随机密码加密，密码单独写入同目录的受限文件；安全备份尚未完成。
- 官方 CLI 正确密码签名／错误密码拒绝：通过。
- 实际验签、内容篡改拒绝和签名版本不匹配拒绝：通过。
- 只签署临时 self-test 文本，未签署正式安装包；self-test 文件与签名已删除。
- 公钥指纹和路径说明见 `docs/github-auto-updates.md`；仓库没有密钥或密码内容。
- App 配置公钥仍为空、endpoints 仍为空；没有启用自动更新。
- 没有上传 GitHub secrets／variables、推送、commit／tag／Release 或执行真实 N → N+1。

本轮仅改进文档状态，不修改业务代码；保留此前完整测试记录。文档格式和 `git diff --check` 另行验证。
