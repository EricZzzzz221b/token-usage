#!/bin/bash
set -euo pipefail
APP="${1:?App bundle required}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/macos-release-policy.sh"
MODE="$(macos_release_mode)"
if [[ "$MODE" == github-ad-hoc ]]; then
  validate_macos_release_policy
else
  : "${APPLE_TEAM_ID:?Apple Team ID required}"
fi
# In both modes a failed signature is fatal; this verifier never signs or mutates.
codesign --verify --deep --strict "$APP"
VERSION="$(node "$ROOT/scripts/stable-release.mjs" version)"
PLIST="$APP/Contents/Info.plist"
[[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$PLIST")" == 'app.tokenusage.desktop' ]] || { echo 'Unexpected application identifier' >&2; exit 1; }
[[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$PLIST")" == "$VERSION" ]] || { echo 'App version differs from release' >&2; exit 1; }
EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$PLIST")"
[[ "$EXECUTABLE" != */* && "$EXECUTABLE" != '..' ]] || { echo 'Invalid app executable' >&2; exit 1; }
[[ "$(lipo -archs "$APP/Contents/MacOS/$EXECUTABLE")" == 'arm64' ]] || { echo 'Stable requires Apple Silicon only' >&2; exit 1; }
DETAILS="$(codesign -dv --verbose=4 "$APP" 2>&1)"
if [[ "$MODE" == github-ad-hoc ]]; then
  grep -Fxq 'Signature=adhoc' <<< "$DETAILS" || { echo 'Explicit GitHub ad-hoc mode requires an ad-hoc signed app' >&2; exit 1; }
  # No fake claim of Gatekeeper acceptance or Apple notarization.
else
  grep -q '^Authority=Developer ID Application:' <<< "$DETAILS" || { echo 'Developer ID signature required; ad-hoc is not allowed' >&2; exit 1; }
  grep -Fxq "TeamIdentifier=$APPLE_TEAM_ID" <<< "$DETAILS" || { echo 'Unexpected Apple signing team' >&2; exit 1; }
  grep -q 'flags=.*runtime' <<< "$DETAILS" || { echo 'Hardened runtime required' >&2; exit 1; }
  xcrun stapler validate "$APP"
  spctl --assess --type execute "$APP"
fi
