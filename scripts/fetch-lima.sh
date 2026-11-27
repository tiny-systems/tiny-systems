#!/usr/bin/env bash
# Puts Lima inside the app, so "this Mac" gardens need nothing installed:
#   <app>/Contents/Resources/lima/bin/limactl       universal (arm64 + x86_64)
#   <app>/Contents/Resources/lima/share/lima/...    Linux guest agents, templates
# limactl finds share/ next to its own bin/, so no paths are configured.
#
#   scripts/fetch-lima.sh "build/bin/Tiny Systems.app"
#
# The tarballs are pinned by SHA-256. To move to a new Lima release, update
# LIMA_VERSION and both sums from that release's SHA256SUMS.
set -euo pipefail
LIMA_VERSION=2.3.0
SUM_arm64=b7af444bd8f91d3c307477e562f2cf3bd7595d62b9429185e4fa841563578cfc
SUM_x86_64=d58bc7d6b8158d638720d8c8fdb17eb58527dfead6a29a5b60f48a35ee4a65a6

app="${1:?usage: fetch-lima.sh <path to .app>}"
[ -d "$app/Contents" ] || { echo "not an app: $app" >&2; exit 2; }
dest="$app/Contents/Resources/lima"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

for arch in arm64 x86_64; do
  tgz="$work/lima-$arch.tar.gz"
  curl -fsSL -o "$tgz" "https://github.com/lima-vm/lima/releases/download/v${LIMA_VERSION}/lima-${LIMA_VERSION}-Darwin-${arch}.tar.gz"
  want="SUM_$arch"
  echo "${!want}  $tgz" | shasum -a 256 -c - >/dev/null
  mkdir -p "$work/$arch"
  tar -C "$work/$arch" -xzf "$tgz" bin/limactl share/lima
done

rm -rf "$dest"
mkdir -p "$dest/bin" "$dest/share/lima"
lipo -create "$work/arm64/bin/limactl" "$work/x86_64/bin/limactl" -output "$dest/bin/limactl"
chmod 755 "$dest/bin/limactl"
cp "$work/arm64/share/lima/lima-guestagent.Linux-aarch64.gz" "$work/x86_64/share/lima/lima-guestagent.Linux-x86_64.gz" "$dest/share/lima/"
cp -R "$work/arm64/share/lima/templates" "$dest/share/lima/"
"$dest/bin/limactl" --version
