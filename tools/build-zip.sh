#!/usr/bin/env bash
#
# Build the extension zip from src/, reproducibly.
#
#   tools/build-zip.sh [output.zip]
#
# The same commit always gives a byte-identical zip: files are added in
# sorted order, timestamps are set to the commit time, and no extra file
# attributes are stored. So anyone can check out a release tag, run this,
# and compare the SHA-256 with the one published on the GitHub Release.
#
# The zip contains src/ and nothing else — no tests, no tools, no docs.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/src/manifest.json" | head -1)"
OUT="${1:-$ROOT/phone-free-2fa-v${VERSION}.zip}"
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT" ;; esac

# Work on a clean export of the committed src/, so stray local files
# (.DS_Store, editor backups, uncommitted changes) can never end up in a release.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
git -C "$ROOT" archive --format=tar HEAD src | tar -x -C "$STAGE"

COMMIT_TIME="$(git -C "$ROOT" log -1 --format=%ct)"
STAMP="$(TZ=UTC date -r "$COMMIT_TIME" +%Y%m%d%H%M.%S 2>/dev/null || TZ=UTC date -d "@$COMMIT_TIME" +%Y%m%d%H%M.%S)"
find "$STAGE/src" -exec env TZ=UTC touch -t "$STAMP" {} +

rm -f "$OUT"
# -0: store without compressing, so the bytes do not depend on the zlib version.
( cd "$STAGE/src" && find . -type f | LC_ALL=C sort | TZ=UTC zip -0 -X -q -@ "$OUT" )

if command -v sha256sum >/dev/null 2>&1; then SUM="$(sha256sum "$OUT" | cut -d' ' -f1)"
else SUM="$(shasum -a 256 "$OUT" | cut -d' ' -f1)"; fi
echo "$OUT"
echo "sha256: $SUM"
