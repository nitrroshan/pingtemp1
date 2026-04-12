#!/usr/bin/env bash
# lint-check — Run ESLint on files
# Usage: ./run.sh [file-or-dir]
set -euo pipefail

TARGET="${1:-.}"

if command -v bunx &>/dev/null; then
  bunx eslint "$TARGET" --format compact 2>&1
elif command -v npx &>/dev/null; then
  npx eslint "$TARGET" --format compact 2>&1
else
  echo "ERROR: Neither bunx nor npx found. Install bun or node." >&2
  exit 1
fi
