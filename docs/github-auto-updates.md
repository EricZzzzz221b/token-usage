# GitHub 自动更新：不要求 Apple 证书

日期：2026-10-06。当前选择：macOS Apple Silicon、stable，使用 `github-ad-hoc` 发行模式。

## 最终用户流程

应用启动 30 秒后检查 GitHub 的独立 macOS stable 清单，此后每 12 小时检查。发现新版本后提示；用户点击“更新并重启”，在系统对话框明确确认后，由**官方 Tauri Updater** 下载、验证更新签名、安装并重启。

不新增服务器，不读取 Codex 凭据，不使用自写 shell 安装器，不关闭签名或 HTTPS 验证。

## 现在不需要什么

- 不要求 Apple Developer 付费账号、Developer ID Application 证书或 Apple 公证凭据。
- 不要求自己的服务器、数据库或更新业务后端。

**仍然必须有 Tauri 更新签名密钥。** 它与 Apple 证书不同，可用官方 CLI 在本机生成；公钥编入 App，私钥只用于发布签名，必须长期保留及安全备份。私钥不进仓库、不进日志、不发到用量接口。

2026-10-06 已经用户明确授权，用官方 Tauri CLI 2.12.1 生成正式密钥并验证。密钥位于仓库外受限目录，尚未上传 GitHub 或编入更新构建；不会使用测试公钥启用正式更新。

## 已生成的本地正式密钥

受限目录：`/Users/zhangguangyu/.config/token-usage/keys/macos-stable`（`0700`）。

| 文件绝对路径                                                                      | 用途                                                 | 权限   |
| --------------------------------------------------------------------------------- | ---------------------------------------------------- | ------ |
| `/Users/zhangguangyu/.config/token-usage/keys/macos-stable/macos-stable.key`      | 用随机密码加密的正式 Tauri 更新私钥，绝不提交／公开  | `0600` |
| `/Users/zhangguangyu/.config/token-usage/keys/macos-stable/macos-stable.key.pub`  | 正式更新公钥；未来配置 GitHub variable 与 App 验证用 | `0600` |
| `/Users/zhangguangyu/.config/token-usage/keys/macos-stable/macos-stable.password` | 私钥密码；与私钥一样敏感，不提交／打印               | `0600` |
| `/Users/zhangguangyu/.config/token-usage/keys/macos-stable/key-info.json`         | 不含秘密的生成信息、公钥指纹与验证结果               | `0600` |

公开指纹（对 decoded minisign 公钥字节取 SHA-256）：

```text
e6f3caa2a068d853fa47f85c41b950d69cb159a7c2eae58b27c430407f2e47ad
```

验证通过：官方 CLI 用正确密码签名、错误密码拒绝、实际 Ed25519／BLAKE2b 验签、内容篡改拒绝、签名版本不匹配拒绝。只签了标为 self-test 的临时文本，未签任何正式安装包；临时文本和签名已删除。

**安全备份尚未完成。** 在首次启用更新前，把加密私钥和密码备份到用户掌控的加密离线介质或密码管理器，保留公钥。不要认为本机同目录存放就是灾备；私钥和密码丢失会使现有用户无法接收后续签名更新。私钥与密码分别保存为文件，但位于同一个受限目录：若当前用户／设备被攻破，文件权限和密码加密不能独立防御全部风险。

后续配置 GitHub 是另一个明确操作：把正式公钥设置为 `TOKEN_USAGE_UPDATER_PUBLIC_KEY` variable，把加密私钥及密码分别设置为 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret。此次只获授权本地生成，没有执行远端配置、Release 或自动更新启用。

## GitHub 配置

在受保护的 `macos-stable` GitHub Environment 中设置：

| 名称                                 | 类型     | 用途                                       |
| ------------------------------------ | -------- | ------------------------------------------ |
| `TOKEN_USAGE_UPDATER_PUBLIC_KEY`     | variable | 正式 Tauri `.pub` 内容的完整 base64 字符串 |
| `TAURI_SIGNING_PRIVATE_KEY`          | secret   | 正式 Tauri 更新私钥                        |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret   | 私钥密码；按实际密钥设置                   |

workflow 使用 GitHub 自带的 `GITHUB_TOKEN` 上传 Release 资产和推进专用渠道分支；需要仓库 `contents:write` 权限。建议 Environment required reviewers。这里不需要任何 Apple secret。

## 发布入口

手动触发 `Release macOS stable`：

1. 使用用户已提交并创建的**新 stable tag**，不要重新发布已有 1.2.7。
2. `mode` 选择 `github-ad-hoc`。
3. 勾选 `acknowledge_unnotarized`，确认 macOS 启动／权限限制。
4. `confirm` 填 `yes`，明确授权发布。

在实际发布前要先完成真实 N → N+1 验收；本任务不会触发 workflow、创建 commit／tag／Release 或上传包。

构建与发布顺序：

```text
测试
→ 显式 ad-hoc 构建并校验 app（不做 Apple 公证）
→ 生成恢复 DMG、更新 tar.gz
→ 校验解包后的 app 签名、架构、bundle ID 和版本
→ Tauri 对最终 tar.gz 作版本绑定签名
→ 上传具体版本资产
→ 匿名 HTTPS 下载核验 hash 和更新签名
→ 最后推进 macos-stable 静态清单
```

所有重新签名／打包都在更新包签名前完成；之后不修改对应包。上传、下载、验签失败不推进清单，不覆盖正式资产。

固定渠道：

```text
https://raw.githubusercontent.com/EricZzzzz221b/token-usage/macos-stable/updates/macos/stable.json
```

具体版本资产：

```text
https://github.com/EricZzzzz221b/token-usage/releases/download/v<VERSION>/TokenUsage_<VERSION>_arm64.app.tar.gz
```

清单保留 `darwin-aarch64` 和 `requireSignedVersion`，并明确标记 `macos_signing: "github-ad-hoc"`。清单说明、GitHub Release 说明和 DMG 安装说明都告知未经 Apple 公证；更新的原生确认框也提醒相关风险。

## 本机脚本的显式模式

脚本默认仍为严格的 `notarized` 模式，**不会**因 Apple 证书缺失／签名失败静默切换。采用 GitHub-only 时必须明确设置：

```bash
MACOS_RELEASE_MODE=github-ad-hoc
ALLOW_UNNOTARIZED_RELEASE=yes
```

再配置正式 Tauri 更新公钥、私钥和必要密码，才可执行构建入口。模式配置不自动生成密钥。默认／普通构建仍关闭应用内更新；`release/updater-github-ad-hoc.example.json` 的公钥为空，只是模板。

未来购买 Apple 证书时可以选择 `notarized` 模式。已经编译为公证模式的 App 会拒绝清单明确标记的 ad-hoc 更新，避免默默降低发行要求。

## 不能承诺的事情

ad-hoc 签名与 Tauri 更新签名**不等于** Apple Developer ID 或 Apple 公证。首次安装、更新后重新启动可能被 macOS 拦截；通知、屏幕录制等权限也可能需要重新批准。

只允许按 macOS“隐私与安全性”的系统批准流程处理。不要删除 quarantine／扩展安全属性、关闭 Gatekeeper 或给安装器绕过检查。

已有版本没有更新器，因此第一次必须通过新的 DMG 手动安装具备更新器的版本；以后再从 GitHub 应用内更新。

真实升级要验证版本变化、新进程、用户设置、窗口模式／位置、用量刷新、任务监控及权限行为。下载／验签失败不开始安装；安装失败不保证可靠自动回滚，使用同 bundle ID 的 DMG 手动恢复。

## 当前状态

代码与配置支持该路线，完整检查通过（43 个前端、50 个 Rust、10 个发布测试）；本地 ad-hoc App 和实际归档解包后的签名／结构验证通过。Gatekeeper 的只读评估结果为 **rejected**，没有绕过。正式更新签名密钥已在本地生成并验证，GitHub secrets／variables 及 App 构建仍未配置；未启用正式自动更新，未完成真实 N → N+1 验证。不能仅凭 Mock 或本地 ad-hoc 构建成功宣布交付完成。

## 官方依据

- [Tauri 官方 Updater 与更新签名](https://v2.tauri.app/plugin/updater/)
- [Tauri macOS 签名与 ad-hoc 模式](https://v2.tauri.app/distribute/sign/macos/)

## v1.2.8 发布范围

用户明确要求发布整个当前最新版本：Codex-only、视觉简化和 GitHub 更新功能一起发行，不只发布更新模块、不回退到 v1.2.7 界面。v1.2.8 为首次带更新器的接入版本；既有 v1.2.7 用户仍需先通过 DMG 手动安装。发布采用本机签名和具体版本 GitHub 资产，私钥及密码不上传 GitHub；GitHub Actions 的 secret 尚未配置不阻碍本机发布，但不能声称已具备无人值守 CI 发行。

仓库级 GitHub Latest 标记仅用于用户导航，可在版本文件下载验证及 macOS stable 清单推进成功后标为最新；更新器本身始终不读取整个仓库 `releases/latest`。
