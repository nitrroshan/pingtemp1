#!/usr/bin/env bash
# dep-audit — Check dependencies for known vulnerabilities
set -euo pipefail

if [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
  echo "=== Bun Audit ==="
  bun audit 2>&1 || true
elif [ -f "package-lock.json" ]; then
  echo "=== NPM Audit ==="
  npm audit --omit=dev 2>&1
elif [ -f "yarn.lock" ]; then
  echo "=== Yarn Audit ==="
  yarn audit --level moderate 2>&1
else
  echo "No lockfile found. Run your package manager's install first." >&2
  exit 1
fi
