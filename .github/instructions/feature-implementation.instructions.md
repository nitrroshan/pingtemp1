---
applyTo: docs/features/**/feature_implementation.md
---

# Feature Implementation Documentation

Track actual implementation progress and deviations from the plan.

## File Location

- Simple features: `docs/features/<feature-name>/feature_implementation.md`
- Versioned features: `docs/features/<feature-name>/v1.0/feature_implementation.md`

## Content Guidelines (max 1000 words)

- **Git branch** - Active branch for this version
- Implementation log (what was actually done)
- Code changes summary with file paths
- Deviations from the plan (and why)
- Blockers encountered and solutions
- Testing results
- Deployment notes
- Known issues or TODOs
- **PR/Merge status** - Track when this version was merged

## Rules

- **Living document** - update as you code, don't wait until the end
- **Consolidate and summarize** - don't let it grow beyond 1000 words
- Remove implementation details that worked as expected (keep only notable items)
- Link PRs, commits, or line numbers where relevant
- Track which version is currently in development
- Document why versions were merged or abandoned

## What to Include

**Keep:**
- Unexpected challenges and how they were solved
- Deviations from the plan with rationale
- Performance issues and optimizations
- Breaking changes or migrations
- Links to related PRs/commits

**Remove:**
- Routine implementation that went as planned
- Verbose step-by-step logs
- Duplicate information from planning doc
- Outdated TODOs that were resolved

## Example Structure

```markdown
## Version 1.0 - Implementation Log

### Branch
- `feature/user-authentication-v1.0`
- PR: #123 (merged 2026-01-14)

### Key Changes
- Added User model ([src/models/User.ts](src/models/User.ts))
- Implemented JWT middleware ([src/middleware/auth.ts](src/middleware/auth.ts))

### Deviations
Changed from bcrypt to argon2 for password hashing due to better security properties.

### Blockers
Database migration failed initially - fixed by adding migration rollback script.

### Testing
- ✅ All unit tests passing
- ✅ Integration tests for login flow
- ⚠️ Load testing pending

### Status
Merged to main on 2026-01-14
```
