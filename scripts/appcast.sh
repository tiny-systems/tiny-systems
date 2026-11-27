#!/usr/bin/env bash
# Writes the Sparkle feed for one release: an appcast.xml naming the
# version's dmg, with the dmg's EdDSA signature, the release notes from
# CHANGELOG.md, and the whole feed signed too (Info.plist sets
# SURequireSignedFeed). It is uploaded to every release, so
# releases/latest/download/appcast.xml is always the newest.
#
#   scripts/appcast.sh <version> <dmg> <ed key file> <sign_update> > appcast.xml
set -euo pipefail
version="${1:?version}"; dmg="${2:?dmg}"; key="${3:?key file}"; sign_update="${4:?sign_update}"
cd "$(dirname "$0")/.."

url="https://github.com/tiny-systems/tiny-systems/releases/download/v${version}/Tiny-Systems-${version}.dmg"
enclosure=$("$sign_update" --ed-key-file "$key" "$dmg") # sparkle:edSignature="…" length="…"
[[ "$enclosure" =~ ^sparkle:edSignature=\"[A-Za-z0-9+/=]+\"\ length=\"[0-9]+\"$ ]] || { echo "unexpected sign_update output" >&2; exit 1; }

# The version's CHANGELOG section as a plain HTML list.
notes=$(awk -v v="## ${version}" '
  $0 == v { on = 1; next }
  on && /^## / { exit }
  on { print }' CHANGELOG.md | python3 -c '
import html, sys
items, cur = [], None
for line in sys.stdin.read().splitlines():
    if line.startswith("- "):
        cur = line[2:].strip(); items.append(cur)
    elif line.strip() and items:
        items[-1] += " " + line.strip()
print("<ul>" + "".join("<li>%s</li>" % html.escape(i) for i in items) + "</ul>" if items else "")
')

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
out="$tmp/appcast.xml" # sign_update knows a feed by its .xml name
cat >"$out" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Tiny Systems</title>
    <item>
      <title>Tiny Systems ${version}</title>
      <pubDate>$(LC_ALL=C date -u '+%a, %d %b %Y %H:%M:%S +0000')</pubDate>
      <sparkle:version>${version}</sparkle:version>
      <sparkle:shortVersionString>${version}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>
      <sparkle:fullReleaseNotesLink>https://github.com/tiny-systems/tiny-systems/releases/tag/v${version}</sparkle:fullReleaseNotesLink>
      <description><![CDATA[${notes}]]></description>
      <enclosure url="${url}" type="application/octet-stream" ${enclosure}/>
    </item>
  </channel>
</rss>
XML
"$sign_update" --ed-key-file "$key" "$out" >/dev/null
grep -q "sparkle-signatures" "$out" || { echo "feed was not signed" >&2; exit 1; }
cat "$out"
