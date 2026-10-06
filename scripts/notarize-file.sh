#!/bin/bash
# No tracing, credential dumps, notary JSON output or ordinary diagnostic files.
set -euo pipefail
FILE="${1:?File required}"
if [[ -n "${APPLE_NOTARY_KEYCHAIN_PROFILE:-}" ]]; then
  xcrun notarytool submit "$FILE" --keychain-profile "$APPLE_NOTARY_KEYCHAIN_PROFILE" --wait >/dev/null
elif [[ -n "${APPLE_API_KEY_PATH:-}" && -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_ISSUER:-}" ]]; then
  xcrun notarytool submit "$FILE" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait >/dev/null
else
  echo 'Notarization requires a keychain profile or App Store Connect API credentials' >&2
  exit 1
fi
