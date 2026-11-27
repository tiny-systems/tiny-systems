#!/usr/bin/env bash
# Sparkle (https://sparkle-project.org) installs updates for the app.
#
#   scripts/fetch-sparkle.sh app "build/bin/Tiny Systems.app"
#       puts Sparkle.framework in <app>/Contents/Frameworks; the app loads
#       it at startup when it's there (a development build has none and
#       falls back to the "new version" notice)
#   scripts/fetch-sparkle.sh tools <dir>
#       puts Sparkle's sign_update in <dir>, for signing the release feed
#
# The tarball is pinned by SHA-256. To move to a new Sparkle release, update
# SPARKLE_VERSION and the sum (GitHub shows each asset's digest).
set -euo pipefail
SPARKLE_VERSION=2.10.1
SUM=1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27

mode="${1:?usage: fetch-sparkle.sh app <path to .app> | tools <dir>}"
dest="${2:?usage: fetch-sparkle.sh app <path to .app> | tools <dir>}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

txz="$work/sparkle.tar.xz"
curl -fsSL -o "$txz" "https://github.com/sparkle-project/Sparkle/releases/download/${SPARKLE_VERSION}/Sparkle-${SPARKLE_VERSION}.tar.xz"
echo "$SUM  $txz" | shasum -a 256 -c - >/dev/null

case "$mode" in
app)
  [ -d "$dest/Contents" ] || { echo "not an app: $dest" >&2; exit 2; }
  tar -C "$work" -xf "$txz" Sparkle.framework
  mkdir -p "$dest/Contents/Frameworks"
  rm -rf "$dest/Contents/Frameworks/Sparkle.framework"
  # ditto keeps the framework's symlinks (Versions/Current and friends).
  ditto "$work/Sparkle.framework" "$dest/Contents/Frameworks/Sparkle.framework"
  ;;
tools)
  tar -C "$work" -xf "$txz" bin/sign_update
  mkdir -p "$dest"
  cp "$work/bin/sign_update" "$dest/"
  ;;
*) echo "unknown mode: $mode" >&2; exit 2 ;;
esac
