#!/usr/bin/env bash
# git-summary — Quick repo status overview
set -euo pipefail

echo "=== Branch ==="
git branch --show-current

echo ""
echo "=== Recent Commits (last 5) ==="
git log --oneline -5 --decorate

echo ""
echo "=== Working Tree ==="
git status --short

echo ""
echo "=== Stash ==="
STASH_COUNT=$(git stash list 2>/dev/null | wc -l)
echo "$STASH_COUNT stashed entries"
