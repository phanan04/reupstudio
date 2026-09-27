#!/bin/sh
# Portable macOS entry point; no machine-specific runtime path is stored.
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1; then
  exec node scripts/start.mjs
elif [ -x tools/node/bin/node ]; then
  exec tools/node/bin/node scripts/start.mjs
else
  echo "Cần Node.js 24+ trong PATH (kèm npm), hoặc runtime native ở tools/node/bin/node."
  exit 1
fi
