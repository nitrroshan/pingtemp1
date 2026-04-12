---
name: user-stories
description: User story writing patterns and templates. Use when defining requirements.
tags: [product, user-stories, requirements, agile]
---

## User Story Patterns

### Format
```
As a [role], I want to [action], so that [benefit].
```

### Acceptance Criteria (Given/When/Then)
```
Given [precondition]
When [action]
Then [expected result]
```

### Story Sizing
- **Small**: Single endpoint or component change (1-2 days)
- **Medium**: New feature with 2-3 components (3-5 days)
- **Large**: Cross-cutting feature — split into smaller stories

### INVEST Criteria
- **I**ndependent — Can be developed separately
- **N**egotiable — Details can change during implementation
- **V**aluable — Delivers user or business value
- **E**stimable — Team can estimate the effort
- **S**mall — Completable in one sprint
- **T**estable — Has clear acceptance criteria

### Edge Cases to Consider
- What happens with empty data?
- What if the user has no permissions?
- What if the network request fails?
- What if the input exceeds limits?
- What about concurrent access?
