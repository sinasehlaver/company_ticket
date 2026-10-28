#!/bin/bash
# Copies the live ../../_look (the shared look package) into web/vendor/look, for builds where _look is absent (Render).
# Keeps only what the build needs: tokens.css, kit.css, look.js, vite.js (lookPlugin), kit/ (minus tests), package.json.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=../../_look
[[ -d "$SRC" ]] || { echo "vendor-look: $SRC not found" >&2; exit 1; }
mkdir -p vendor/look
rsync -a --delete \
  --include='/tokens.css' --include='/kit.css' --include='/look.js' --include='/vite.js' --include='/package.json' --include='/README.md' \
  --include='/kit/' --exclude='/kit/*.test.js' --include='/kit/**' \
  --exclude='*' "$SRC/" vendor/look/
echo "vendored $(find vendor/look -type f | wc -l | tr -d ' ') files from _look -> vendor/look"
