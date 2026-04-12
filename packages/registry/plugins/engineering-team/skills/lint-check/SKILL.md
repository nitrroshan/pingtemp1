---
name: lint-check
description: Run ESLint on staged or specified files. Use when checking code quality before committing.
tags: [lint, eslint, quality, code-review]
---

## Lint Check

Runs ESLint on the specified files or the entire project to catch style and correctness issues.

### Usage
- Pass a file path to lint a specific file
- Pass no arguments to lint the entire project
- Returns exit code 0 if clean, 1 if issues found
