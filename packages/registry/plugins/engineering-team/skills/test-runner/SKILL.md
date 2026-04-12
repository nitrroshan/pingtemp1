---
name: test-runner
description: Run the project test suite and report results. Use when verifying changes or checking test coverage.
tags: [testing, vitest, jest, test-runner]
---

## Test Runner

Runs the project's test suite and reports pass/fail results with optional coverage.

### Usage
- Pass a test file path to run specific tests
- Pass `--coverage` to include coverage report
- Returns exit code 0 if all pass, 1 if failures
