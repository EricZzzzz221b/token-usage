#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h:h}"
APP="$ROOT/src-tauri/target/release/bundle/macos/Token用量.app"
OUT="$ROOT/src-tauri/target/release/bundle/dmg/TokenUsage_1.1.4_arm64.dmg"
[ -d "$APP" ] || { echo "Missing app bundle: $APP" >&2; exit 1; }
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
cat > "$STAGE/安装说明.txt" <<'EOF'
Token用量 1.1.4 安装说明

1. 将“Token用量.app”拖入 Applications 文件夹。
2. 首次打开时，如果 macOS 提示无法验证开发者：
   - 在 Finder 中右键“Token用量.app”；
   - 选择“打开”；
   - 在确认窗口中再次选择“打开”。
3. 本版本适用于 Apple Silicon（M1/M2/M3/M4/M5）Mac，要求 macOS 13 或更高版本。
4. 本应用只读取本机 Codex/ChatGPT OAuth 登录状态来查询官方用量，不会上传或保存凭据。
EOF
rm -f "$OUT"
hdiutil create -volname "Token Usage" -srcfolder "$STAGE" -ov -format UDZO "$OUT"
echo "$OUT"
