#!/bin/sh
# Builds the app's frontend for the web and copies it into the website,
# where the home page embeds it. The demo data comes from demo.go, so the
# page always shows what the app shows.
#
#   scripts/web-demo.sh [path/to/website]
set -eu
cd "$(dirname "$0")/.."
site=${1:-../website}
WEB_DEMO_OUT=frontend/web/demo.json go test -count=1 -run TestWebDemoData . >/dev/null
(cd frontend && npm run --silent build:web >/dev/null)
rm -rf "$site/static/app-demo"
cp -R build/web "$site/static/app-demo"
echo "web demo -> $site/static/app-demo"
