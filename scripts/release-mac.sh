#!/usr/bin/env bash
# Builds, signs, notarizes and staples Tiny Systems.dmg.
#
#   scripts/release-mac.sh 0.2.0
#
# Needs in the environment (CI sets them from repository secrets):
#   SIGN_IDENTITY      e.g. "Developer ID Application: Tiny Systems Limited (74JHK2JWS7)"
#   NOTARY_KEY_PATH    path to the App Store Connect API key (.p8)
#   NOTARY_KEY_ID      its key ID
#   NOTARY_ISSUER      its issuer ID
# The signing identity must already be in a keychain codesign can reach.
set -euo pipefail
version="${1:?usage: release-mac.sh <version>}"
cd "$(dirname "$0")/.."

app="build/bin/Tiny Systems.app"
dmg="build/bin/Tiny-Systems-${version}.dmg"

# Stamp the version into the bundle.
tmp=$(mktemp)
jq --arg v "$version" '.info.productVersion = $v' wails.json >"$tmp" && mv "$tmp" wails.json

wails build -clean -platform darwin/universal -trimpath -ldflags "-s -w -X main.version=${version}"

codesign --force --deep --options runtime --timestamp \
  --entitlements build/darwin/entitlements.plist \
  --sign "$SIGN_IDENTITY" "$app"
codesign --verify --strict --verbose=2 "$app"

# A plain dmg: the app and a link to /Applications.
stage=$(mktemp -d)
cp -R "$app" "$stage/"
ln -s /Applications "$stage/Applications"
rm -f "$dmg"
hdiutil create -volname "Tiny Systems" -srcfolder "$stage" -fs HFS+ -format UDZO "$dmg"
codesign --force --timestamp --sign "$SIGN_IDENTITY" "$dmg"

xcrun notarytool submit "$dmg" \
  --key "$NOTARY_KEY_PATH" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER" \
  --wait --timeout 30m
xcrun stapler staple "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"

echo "$dmg"
