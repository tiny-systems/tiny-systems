#!/bin/sh
# Everything CI's test workflow checks, in the same order, so a push that
# would fail there fails here first. CI runs this script too; keep the
# two in step by editing only this file.
#
#   scripts/check.sh          full run (about a minute)
#   scripts/check.sh --quick  gofmt, vet and Go tests only (needs a built frontend/dist)
set -eu
cd "$(dirname "$0")/.."
export GOTOOLCHAIN="${GOTOOLCHAIN:-go1.26.0}"

step() { printf '\n== %s\n' "$1"; }

step gofmt
bad=$(gofmt -l .)
[ -z "$bad" ] || { echo "not formatted (run gofmt -w):"; echo "$bad"; exit 1; }

# The Go build embeds frontend/dist, so the frontend comes first (a clean
# checkout has no dist; --quick reuses whatever is there).
if [ "${1:-}" != "--quick" ]; then
  step frontend
  (cd frontend && { [ -d node_modules ] || npm ci; } && npm run build >/dev/null)
  WEB_DEMO_OUT=frontend/web/demo.json go test -count=1 -run TestWebDemoData . >/dev/null
  (cd frontend && npm run build:web >/dev/null)
fi

step vet
go vet ./...
go vet -tags lima ./...
go vet -tags live ./...

step test
go test -race -count=1 ./...

if [ "${1:-}" != "--quick" ]; then
  step "UI click-through"
  (cd frontend && npx playwright test --reporter=line)
fi
printf '\nall checks passed\n'
