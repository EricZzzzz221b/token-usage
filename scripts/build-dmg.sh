#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h:h}"
APP="$ROOT/src-tauri/target/release/bundle/macos/Token用量.app"
OUT="$ROOT/src-tauri/target/release/bundle/dmg/TokenUsage_0.1.0_aarch64.dmg"
[ -d "$APP" ] || { echo "Missing app bundle: $APP" >&2; exit 1; }
if ! codesign --verify --deep --strict "$APP" >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP"
fi
codesign --verify --deep --strict "$APP"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$OUT"
hdiutil create -volname "Token Usage" -srcfolder "$STAGE" -ov -format UDZO "$OUT"
echo "$OUT"
