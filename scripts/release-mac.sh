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
  echo "$app"
  exit 0
fi
[ "$stage" = sign ] || { echo "unknown stage: $stage" >&2; exit 2; }

codesign --force --deep --options runtime --timestamp \
  --entitlements build/darwin/entitlements.plist \
  --sign "$SIGN_IDENTITY" "$app"
codesign --verify --strict --verbose=2 "$app"

# A plain dmg: the app and a link to /Applications.
stagedir=$(mktemp -d)
cp -R "$app" "$stagedir/"
ln -s /Applications "$stagedir/Applications"
rm -f "$dmg"
hdiutil create -volname "Tiny Systems" -srcfolder "$stagedir" -fs HFS+ -format UDZO "$dmg"
codesign --force --timestamp --sign "$SIGN_IDENTITY" "$dmg"

xcrun notarytool submit "$dmg" \
  --key "$NOTARY_KEY_PATH" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER" \
  --wait --timeout 30m
xcrun stapler staple "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"

echo "$dmg"
