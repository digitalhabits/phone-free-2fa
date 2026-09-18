#!/usr/bin/env bash
# Print the CHANGELOG.md section for one version (without its heading).
#   tools/changelog-section.sh 2.9
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
awk -v ver="$1" '
  index($0, "## [" ver "]") == 1 { found=1; next }
  found && /^## \[/ { exit }
  found { print }
' "$ROOT/CHANGELOG.md"
