#!/usr/bin/env bash
# One-time setup: turns the Developer ID certificate into a .p12 and stores
# it, with the notary key, as secrets on the `release` environment.
# Run it yourself; it never prints a secret.
#
#   scripts/signing-secrets.sh <developerID_application.cer> <AuthKey_XXXX.p8> <issuer-id>
#
# The private key is ~/.tiny-signing/developer-id.key, made with the
# certificate signing request you uploaded to Apple.
set -euo pipefail
cer="${1:?certificate .cer from developer.apple.com}"
p8="${2:?App Store Connect API key .p8}"
issuer="${3:?App Store Connect issuer ID}"
key="$HOME/.tiny-signing/developer-id.key"
repo="tiny-systems/tiny-systems"
dir="$HOME/.tiny-signing"

keyid=$(basename "$p8" .p8); keyid="${keyid#AuthKey_}"
openssl x509 -inform DER -in "$cer" -out "$dir/developer-id.pem"
openssl x509 -in "$dir/developer-id.pem" -noout -subject
pw=$(openssl rand -hex 24)
openssl pkcs12 -export -legacy -inkey "$key" -in "$dir/developer-id.pem" \
  -name "Developer ID Application: Tiny Systems Limited (74JHK2JWS7)" \
  -out "$dir/developer-id.p12" -passout "pass:$pw"
chmod 600 "$dir/developer-id.p12"

gh api -X PUT "repos/$repo/environments/release" >/dev/null  # make sure it exists
base64 -i "$dir/developer-id.p12" | gh secret set MACOS_CERT_P12 -R "$repo" --env release
printf %s "$pw" | gh secret set MACOS_CERT_PASSWORD -R "$repo" --env release
base64 -i "$p8" | gh secret set NOTARY_KEY_P8 -R "$repo" --env release
printf %s "$keyid" | gh secret set NOTARY_KEY_ID -R "$repo" --env release
printf %s "$issuer" | gh secret set NOTARY_ISSUER -R "$repo" --env release

# Also into this Mac's keychain, so local builds can sign.
security import "$dir/developer-id.p12" -k ~/Library/Keychains/login.keychain-db -P "$pw" -T /usr/bin/codesign
cp "$p8" "$dir/" && chmod 600 "$dir/$(basename "$p8")"
echo "Done: 5 secrets set on $repo, identity imported into the login keychain."
