#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h:h}"
APP="$ROOT/src-tauri/target/release/bundle/macos/Token用量.app"
VERSION="$(node -p "require('$ROOT/src-tauri/tauri.conf.json').version")"
OUT_DIR="${OUTPUT_DIR:-$ROOT/outputs}"
OUT="$OUT_DIR/TokenUsage_${VERSION}_arm64.dmg"
[ -d "$APP" ] || { echo "Missing app bundle: $APP" >&2; exit 1; }
mkdir -p "$OUT_DIR"
# Finder metadata can invalidate ad-hoc signing on locally generated bundles.
xattr -cr "$APP" 2>/dev/null || true
if ! codesign --verify --deep --strict "$APP" >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP"
fi
codesign --verify --deep --strict "$APP"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
cat > "$STAGE/安装说明.txt" <<EOF
Token用量 ${VERSION} 安装说明

1. 将“Token用量.app”拖入 Applications 文件夹。
2. 首次打开时，如果 macOS 提示无法验证开发者：
   - 在 Finder 中右键“Token用量.app”；
   - 选择“打开”；
   - 在确认窗口中再次选择“打开”。
3. 本版本适用于 Apple Silicon（M1/M2/M3/M4/M5）Mac，要求 macOS 13 或更高版本。
4. Codex 用量查询只读取本机 Codex/ChatGPT OAuth 登录状态，不会上传或保存凭据。
5. Claude 集成默认关闭；启用后只读取本机 Claude Code 会话状态，不读取 Claude Desktop Cookie、内部数据库或完整对话。
6. 当前版本暂不显示 Claude 订阅额度百分比，避免用估算数据冒充官方额度。
EOF
rm -f "$OUT"
hdiutil create -volname "Token Usage" -srcfolder "$STAGE" -ov -format UDZO "$OUT"
echo "$OUT"
