#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h:h}"
APP="${APP_BUNDLE:-$ROOT/src-tauri/target/release/bundle/macos/Token用量.app}"
VERSION="$(node -p "require('$ROOT/src-tauri/tauri.conf.json').version")"
MODE="${BUILD_MODE:-local}"
OUT_DIR="${OUTPUT_DIR:-$ROOT/outputs}"
OUT="$OUT_DIR/TokenUsage_${VERSION}_arm64.dmg"
[[ "$MODE" == local || "$MODE" == release || "$MODE" == github-ad-hoc ]] || { echo 'Invalid BUILD_MODE' >&2; exit 1; }
[ -d "$APP" ] || { echo "Missing app bundle: $APP" >&2; exit 1; }
[ ! -e "$OUT" ] || { echo 'Refusing to overwrite an existing DMG' >&2; exit 1; }
mkdir -p "$OUT_DIR"
if [[ "$MODE" == release || "$MODE" == github-ad-hoc ]]; then
  if [[ "$MODE" == release ]]; then export MACOS_RELEASE_MODE=notarized; else export MACOS_RELEASE_MODE=github-ad-hoc; fi
  # Read-only checks: no re-signing, xattr removal or fallback in production.
  "$ROOT/scripts/verify-macos-app.sh" "$APP"
else
  if ! codesign --verify --deep --strict "$APP" >/dev/null 2>&1; then
    echo 'LOCAL BUILD ONLY: applying an ad-hoc signature (not eligible for stable)' >&2
    codesign --force --deep --sign - "$APP"
  fi
  codesign --verify --deep --strict "$APP"
fi
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
# ditto preserves the signed/notarized app, including stapled tickets.
ditto "$APP" "$STAGE/${APP:t}"
ln -s /Applications "$STAGE/Applications"
cat > "$STAGE/安装说明.txt" <<NOTES
Token用量 ${VERSION} 安装说明

1. 退出旧版，将“Token用量.app”拖入 Applications，再从该位置启动。
2. 不要直接从 DMG 运行应用内更新。
3. 适用于 Apple Silicon Mac，要求 macOS 13 或更高版本。
4. 应用内更新不可用时，退出应用并用官方 DMG 手动替换。
5. 用量查询只读取本机 OAuth 登录状态；更新模块不读取或发送凭据。
NOTES
if [[ "$MODE" == github-ad-hoc ]]; then
  cat >> "$STAGE/安装说明.txt" <<'WARNING'

重要：此 GitHub 发行未经 Apple 公证（ad-hoc 签名）。
Tauri 更新签名只验证更新包来源与完整性，不代表 macOS 已信任此应用。
首次安装或更新后的启动可能被系统阻止，系统权限也可能需要重新批准。
请按照 macOS“隐私与安全性”的系统批准流程处理，不要删除安全属性或关闭 Gatekeeper。
WARNING
fi
hdiutil create -volname 'Token Usage' -srcfolder "$STAGE" -format UDZO "$OUT"
if [[ "$MODE" == release ]]; then
  : "${APPLE_SIGNING_IDENTITY:?Developer ID Application identity required}"
  : "${APPLE_TEAM_ID:?Apple Team ID required}"
  codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$OUT"
  "$ROOT/scripts/notarize-file.sh" "$OUT"
  xcrun stapler staple "$OUT"
  xcrun stapler validate "$OUT"
  codesign --verify --strict "$OUT"
  spctl --assess --type open --context context:primary-signature "$OUT"
fi
printf '%s\n' "$OUT"
