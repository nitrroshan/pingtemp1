---
name: dep-audit
description: Audit project dependencies for known vulnerabilities. Use before releases or when reviewing security.
tags: [security, audit, dependencies, vulnerabilities]
---

## Dependency Audit

Scans package dependencies for known security vulnerabilities using the package manager's built-in audit command.

### Output
- Lists vulnerable packages with severity (low/moderate/high/critical)
- Shows affected version ranges and fix recommendations
- Returns exit code 0 if no vulnerabilities, 1 if issues found
