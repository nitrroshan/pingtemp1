---
applyTo: docs/developer-guide/**/*
---

# Developer Guide Documentation

Documentation to help developers understand code they didn't create.

## When This Is Needed

**Create developer guide docs when:**
- Feature has complex architecture that's not obvious from code
- Multiple components interact in non-obvious ways
- Setup requires specific steps or configuration
- Common pitfalls exist that aren't obvious

**Skip developer guide if:**
- Architecture doc is sufficient (well-documented feature design)
- Code is self-explanatory with good comments
- Feature is straightforward

## Folder Structure

```
docs/developer-guide/
  architecture-overview.md     (System-wide patterns)
  components/
    agent-manager.md           (One file per major component)
    role-manager.md
    memory-manager.md
  patterns/
    event-driven-execution.md  (Reusable patterns)
    database-persistence.md
  setup/
    development-environment.md
    debugging.md
```

## Content Guidelines (Max 800 words per doc)

### Component Guide
- **Purpose** - What this component does
- **Key concepts** - Important abstractions
- **Entry points** - Main classes/functions
- **Dependencies** - What it relies on
- **Common tasks** - How to extend/modify
- **Gotchas** - Non-obvious behaviors

### Pattern Guide
- **Problem** - What problem this pattern solves
- **Solution** - How the pattern works
- **Usage** - When to use it
- **Example** - Code example
- **Related patterns** - Links to similar patterns

## Rules

### ✅ DO:
- Explain **why** decisions were made, not just **what**
- Focus on non-obvious aspects
- Include code examples for complex patterns
- Link to architecture docs for more details
- Update when significant changes occur
- **Reference, don't duplicate** - link to architecture docs instead of repeating

### ❌ DON'T:
- Duplicate architecture documentation
- Explain every function (that's what code comments are for)
- Create guides for simple, self-explanatory code
- Let guides get stale - remove if outdated
- Write tutorials (that's for getting started guides)

## Relationship to Other Docs

**Architecture Docs (docs/features/)**: Design decisions for specific features
**Developer Guide**: Cross-cutting concerns and system-wide patterns
**Product Docs (docs/product/)**: User-facing capabilities

**Rule of thumb:**
- If it's specific to one feature → Architecture doc
- If it's a pattern used across features → Developer guide
- If it's user-facing → Product doc

## When to Update

1. **After major architectural changes** - Update affected component guides
2. **When new patterns emerge** - Document reusable patterns
3. **When onboarding reveals gaps** - Add guides for confusing areas
4. **Periodically review** - Remove outdated content, consolidate similar topics

## Template for Component Guide

```markdown
# [Component Name]

## Purpose
What this component does and why it exists (2-3 sentences).

## Key Concepts
- **Concept 1**: Brief explanation
- **Concept 2**: Brief explanation

## Main Entry Points
- `ClassName.method()` - What it does
- `anotherMethod()` - What it does

## Architecture
Brief overview of how it works (or link to architecture doc).

## Common Tasks

### Task 1: [e.g., "Adding a new agent type"]
```typescript
// Code example
```

### Task 2: [e.g., "Subscribing to events"]
```typescript
// Code example
```

## Dependencies
- Component A: How it's used
- Component B: How it's used

## Gotchas
- **Issue**: Non-obvious behavior
- **Solution**: How to handle it

## Related Docs
- [Architecture doc](../features/feature-name/feature_architecture.md)
- [Related component](./related-component.md)
```

## Consolidation Strategy

**Periodically review and consolidate:**
- Merge similar component guides
- Move stable patterns to main copilot-instructions.md
- Archive outdated guides
- Keep total developer guide under 10 files (aim for simplicity)
