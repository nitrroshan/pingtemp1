---
applyTo: docs/features/**/feature_implementation_planning.md
---

# Feature Implementation Planning Documentation

Break down the feature into actionable implementation steps.

## File Location

- Simple features: `docs/features/<feature-name>/feature_implementation_planning.md`
- Versioned features: `docs/features/<feature-name>/v1.0/feature_implementation_planning.md`

## Content Guidelines (max 1000 words)

- **Branch strategy** - Feature/version branch name
- **This version scope** - What's included in this version
- Step-by-step implementation plan
- Task breakdown with dependencies
- Files to create/modify
- Migration steps (if applicable)
- Testing strategy
- Rollback plan
- Estimated complexity/time per step

## Incremental Delivery Guidelines

- **v1.0 (MVP)**: Core functionality, minimal viable feature
- **v1.x (Enhancements)**: Incremental improvements, non-breaking changes
- **v2.0 (Major)**: Breaking changes or significant architectural shifts

## Example Structure (for v1.0/feature_implementation_planning.md)

```markdown
## Version 1.0 - Basic Authentication (MVP)

## Branch
- `feature/user-authentication-v1.0`

## Scope
Core login/logout functionality with JWT tokens.

## Implementation Steps
- [ ] Step 1: Add User model and database schema
- [ ] Step 2: Create login endpoint
- [ ] Step 3: Implement JWT token generation
- [ ] Step 4: Add authentication middleware

## Testing
- Unit tests for auth middleware
- Integration tests for login flow
```

## Rules

- Numbered steps with clear entry/exit criteria
- Reference specific files and line numbers where possible
- **Each version folder has its own planning doc** (no duplication across versions)
- Each version should be independently deployable and testable
- **Update as implementation progresses** - mark completed steps, adjust remaining ones
- **Remove or consolidate steps** that become irrelevant
- Link to parent feature_architecture.md for context
