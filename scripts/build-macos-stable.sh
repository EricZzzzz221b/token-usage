#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source "$ROOT/scripts/macos-release-policy.sh"
export MACOS_RELEASE_MODE="$(macos_release_mode)"
validate_macos_release_policy
: "${TOKEN_USAGE_UPDATER_PUBLIC_KEY:?Real updater public key required}"
: "${TAURI_SIGNING_PRIVATE_KEY:?Updater signing private key or protected key path required}"
VERSION="$(node scripts/stable-release.mjs version)"
OUT_DIR="${OUTPUT_DIR:-$ROOT/outputs/stable/$VERSION}"
[[ ! -e "$OUT_DIR" ]] || { echo 'Refusing to reuse a release output directory' >&2; exit 1; }
# Tests come first; failed tests must not produce signed release artifacts.
npm run check
mkdir -p "$OUT_DIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
if [[ "$MACOS_RELEASE_MODE" == github-ad-hoc ]]; then
  # This is a deliberate non-notarized mode, NOT a fallback after signing fails.
  echo 'EXPLICIT GITHUB AD-HOC RELEASE: no Apple notarization; macOS launch/permission restrictions may apply' >&2
  export APPLE_SIGNING_IDENTITY='-'
  unset APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_API_KEY APPLE_API_KEY_PATH
  unset APPLE_API_ISSUER APPLE_API_PRIVATE_KEY APPLE_ID APPLE_PASSWORD APPLE_NOTARY_KEYCHAIN_PROFILE
fi
node scripts/stable-release.mjs config "$WORK/release.json"
export TOKEN_USAGE_ENABLE_UPDATER=1
export TOKEN_USAGE_UPDATER_RELEASE_MODE="$MACOS_RELEASE_MODE"
# Tauri signs the app. Generate updater bytes only after every app mutation finishes.
npm run tauri -- build --target aarch64-apple-darwin --bundles app --config "$WORK/release.json"
APP="$ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Token用量.app"
codesign --verify --deep --strict "$APP"
if [[ "$MACOS_RELEASE_MODE" == notarized ]]; then
  APP_ZIP="$WORK/app.zip"
  ditto -c -k --keepParent "$APP" "$APP_ZIP"
  ./scripts/notarize-file.sh "$APP_ZIP"
  xcrun stapler staple "$APP"
fi
./scripts/verify-macos-app.sh "$APP"
if [[ "$MACOS_RELEASE_MODE" == notarized ]]; then DMG_MODE=release; else DMG_MODE=github-ad-hoc; fi
BUILD_MODE="$DMG_MODE" APP_BUNDLE="$APP" OUTPUT_DIR="$OUT_DIR" ./scripts/build-dmg.sh
ARCHIVE="$OUT_DIR/TokenUsage_${VERSION}_arm64.app.tar.gz"
python3 scripts/package-macos-update.py "$APP" "$ARCHIVE"
mkdir "$WORK/unpacked"
tar -xzf "$ARCHIVE" -C "$WORK/unpacked"
# Check the actual portable archive, not just the original app.
./scripts/verify-macos-app.sh "$WORK/unpacked/Token用量.app"
npm run tauri -- signer sign --app-version "$VERSION" "$ARCHIVE" >/dev/null
node scripts/stable-release.mjs manifest "$OUT_DIR"
node scripts/stable-release.mjs verify-signature "$OUT_DIR/stable.json" "$ARCHIVE"
echo "Stable artifacts prepared ($MACOS_RELEASE_MODE), not uploaded: $OUT_DIR"
