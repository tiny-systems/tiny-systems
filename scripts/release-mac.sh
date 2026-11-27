#!/usr/bin/env bash
# Builds Tiny Systems.app, then signs, notarizes and staples a dmg. The two
# stages run separately so the build (npm, wails) never sees signing keys.
#
#   scripts/release-mac.sh build 0.2.0   # unsigned app, no secrets needed
#   scripts/release-mac.sh sign  0.2.0   # signs build/bin/Tiny Systems.app
#
# sign needs in the environment (CI sets them from the release environment):
#   SIGN_IDENTITY      e.g. "Developer ID Application: Tiny Systems Limited (74JHK2JWS7)"
#   NOTARY_KEY_PATH    path to the App Store Connect API key (.p8)
#   NOTARY_KEY_ID      its key ID
#   NOTARY_ISSUER      its issuer ID
# The signing identity must already be in a keychain codesign can reach.
set -euo pipefail
stage="${1:?usage: release-mac.sh build|sign <version>}"
version="${2:?usage: release-mac.sh build|sign <version>}"
cd "$(dirname "$0")/.."

app="build/bin/Tiny Systems.app"
dmg="build/bin/Tiny-Systems-${version}.dmg"

if [ "$stage" = build ]; then
  tmp=$(mktemp)
  jq --arg v "$version" '.info.productVersion = $v' wails.json >"$tmp" && mv "$tmp" wails.json
  wails build -clean -platform darwin/universal -trimpath -ldflags "-s -w -X main.version=${version}"
  scripts/fetch-lima.sh "$app"
  scripts/fetch-sparkle.sh app "$app"
  echo "$app"
  exit 0
fi
[ "$stage" = sign ] || { echo "unknown stage: $stage" >&2; exit 2; }

# Inside out, and never --deep: that would re-sign limactl with the app's
# entitlements and drop the virtualization one Lima needs.
sign() { codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$@"; }
# Sparkle's helpers, then the framework (Sparkle's documented order; the
# Downloader keeps its own entitlements).
fw="$app/Contents/Frameworks/Sparkle.framework"
if [ -d "$fw" ]; then
  sign "$fw/Versions/B/XPCServices/Installer.xpc"
  sign --preserve-metadata=entitlements "$fw/Versions/B/XPCServices/Downloader.xpc"
  sign "$fw/Versions/B/Autoupdate"
  sign "$fw/Versions/B/Updater.app"
  sign "$fw"
fi
limactl="$app/Contents/Resources/lima/bin/limactl"
if [ -f "$limactl" ]; then
  codesign --force --options runtime --timestamp \
    --entitlements build/darwin/lima.entitlements \
    --sign "$SIGN_IDENTITY" "$limactl"
fi
codesign --force --options runtime --timestamp \
  --entitlements build/darwin/entitlements.plist \
  --sign "$SIGN_IDENTITY" "$app"
codesign --verify --deep --strict --verbose=2 "$app"

# The disk image: the app beside a link to /Applications, over the garden
# background (scripts/dmg-background.py draws it; dmg-settings.py places the
# icons). dmgbuild writes the window layout itself, no Finder scripting.
DMGBUILD="${DMGBUILD:-dmgbuild}"
rm -f "$dmg"
"$DMGBUILD" -s scripts/dmg-settings.py -D app="$app" \
  -D background=build/darwin/dmg-background.tiff "Tiny Systems" "$dmg"
codesign --force --timestamp --sign "$SIGN_IDENTITY" "$dmg"

xcrun notarytool submit "$dmg" \
  --key "$NOTARY_KEY_PATH" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER" \
  --wait --timeout 30m
xcrun stapler staple "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"

echo "$dmg"
