---
applyTo: docs/features/**/feature_architecture.md
---

# Feature Architecture Documentation

Define how this feature fits into the overall system design.

## Content Guidelines (max 1000 words)

- High-level overview of the feature
- **Architecture options** - Present 2-3 design approaches with pros/cons
- Integration points with existing components (AgentManager, RoleManager, MemoryManager, etc.)
- Data flow diagram or explanation
- New types/interfaces needed
- Database schema changes (if applicable)
- API endpoints affected or added
- Impact on frontend components
- **Recommended approach** with justification

## Architecture Decision Process

1. Analyze the feature requirements
2. Research 2-3 viable architectural approaches
3. Document each option with:
   - Implementation approach
   - Pros (benefits, performance, maintainability)
   - Cons (risks, complexity, trade-offs)
   - Effort estimate
4. **Ask user**: "Which architecture approach should we use: Option A, B, or C?"
5. Wait for user decision before creating implementation plan
6. Document chosen approach and rationale

## Architecture Decision Template

```markdown
## Architecture Options

### Option A: [Approach Name]
**Implementation:** Brief description of how it works

**Pros:**
- Benefit 1
- Benefit 2
- Benefit 3

**Cons:**
- Risk/limitation 1
- Risk/limitation 2

**Effort:** Estimated time/complexity

### Option B: [Approach Name]
**Implementation:** Brief description of how it works

**Pros:**
- Benefit 1
- Benefit 2

**Cons:**
- Risk/limitation 1
- Risk/limitation 2

**Effort:** Estimated time/complexity

### Option C: [Approach Name]
**Implementation:** Brief description of how it works

**Pros:**
- Benefit 1
- Benefit 2

**Cons:**
- Risk/limitation 1
- Risk/limitation 2

**Effort:** Estimated time/complexity

## Recommendation
[Recommended option] because [key reasons]

**Decision Required:** Please choose Option A, B, or C.
```

## Rules

- Keep concise - if you can't fit in 1000 words, the feature is too large
- **Ask user to split into sub-features** rather than creating bloated documents
- **ALWAYS present architecture options** - don't make unilateral design decisions
- **Wait for user approval** before proceeding to implementation planning
- Architecture changes are costly - user must decide the approach
- Update this document when design evolves - **remove outdated sections**, don't just append
- This document stays at feature root and covers all planned versions
