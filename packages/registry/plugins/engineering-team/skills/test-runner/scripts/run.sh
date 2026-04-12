#!/usr/bin/env bash
# test-runner — Run project tests
# Usage: ./run.sh [test-file] [--coverage]
set -euo pipefail

ARGS="${*}"

# Detect test framework
if [ -f "vitest.config.ts" ] || [ -f "vitest.config.js" ]; then
  echo "=== Vitest ==="
  if command -v bunx &>/dev/null; then
    bunx vitest run $ARGS 2>&1
  else
    npx vitest run $ARGS 2>&1
  fi
elif [ -f "jest.config.ts" ] || [ -f "jest.config.js" ] || grep -q '"jest"' package.json 2>/dev/null; then
  echo "=== Jest ==="
  npx jest $ARGS 2>&1
elif grep -q '"test"' package.json 2>/dev/null; then
  echo "=== npm test ==="
  npm test -- $ARGS 2>&1
else
  echo "No test framework detected." >&2
  exit 1
fi
