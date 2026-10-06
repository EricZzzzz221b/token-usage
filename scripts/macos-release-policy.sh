#!/bin/bash
# Sourced by release entrypoints. A certificate failure never chooses another mode.
macos_release_mode() {
  case "${MACOS_RELEASE_MODE:-notarized}" in
    notarized|github-ad-hoc) printf '%s\n' "${MACOS_RELEASE_MODE:-notarized}" ;;
    *) echo 'Unknown macOS release mode' >&2; return 1 ;;
  esac
}
validate_macos_release_policy() {
  local mode
  mode="$(macos_release_mode)" || return 1
  if [[ "$mode" == github-ad-hoc ]]; then
    [[ "${ALLOW_UNNOTARIZED_RELEASE:-}" == yes ]] || {
      echo 'GitHub ad-hoc release requires explicit ALLOW_UNNOTARIZED_RELEASE=yes; macOS may block launch or require permissions again' >&2
      return 1
    }
  else
    [[ -n "${APPLE_SIGNING_IDENTITY:-}" && "${APPLE_SIGNING_IDENTITY:-}" != '-' ]] || {
      echo 'Notarized mode requires Developer ID Application; no ad-hoc fallback' >&2
      return 1
    }
    [[ -n "${APPLE_TEAM_ID:-}" ]] || { echo 'Apple Team ID required' >&2; return 1; }
    if [[ -n "${APPLE_CERTIFICATE:-}" && -z "${APPLE_CERTIFICATE_PASSWORD:-}" ]]; then
      echo 'Apple certificate password required' >&2; return 1
    fi
    [[ -n "${APPLE_NOTARY_KEYCHAIN_PROFILE:-}" || ( -n "${APPLE_API_KEY_PATH:-}" && -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_ISSUER:-}" ) ]] || {
      echo 'Notarization credentials required' >&2; return 1
    }
  fi
}
