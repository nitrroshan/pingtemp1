---
applyTo: docs/product/**/*
---

# Product Documentation

High-level, user-facing documentation that describes what the product is capable of.

## Purpose

Product documentation explains **what users can do** with the system, not **how it's implemented**. Updated only when features are complete and tested.

## Folder Structure

```
docs/product/
  README.md                    (Product overview)
  features/
    multi-agent-chat.md        (One file per feature)
    role-discovery.md
    workspace-management.md
  guides/
    getting-started.md
    configuration.md
  api/
    http-endpoints.md
    websocket-events.md
```

## Content Guidelines

### Product Overview (`README.md`)
- What the product does (2-3 paragraphs)
- Key capabilities (bullet list)
- Architecture diagram (high-level, no implementation details)
- Links to feature documentation

### Feature Documentation (`features/*.md`)
- **What it does** - User-facing description
- **Use cases** - When to use this feature
- **Capabilities** - What users can accomplish
- **Limitations** - What it doesn't do
- **Configuration** - User-configurable options
- **Examples** - Real-world usage scenarios

**Max 500 words per feature** - Keep it concise and scannable

### Guides (`guides/*.md`)
- Step-by-step tutorials
- Configuration examples
- Common workflows
- Troubleshooting

## Rules

### ✅ DO:
- **Update only when feature is complete and tested**
- Focus on capabilities, not implementation
- Use simple language (non-technical where possible)
- Include examples and use cases
- Keep each feature to one page/file
- Update when behavior changes
- Remove features that are deprecated

### ❌ DON'T:
- Document features in development
- Explain implementation details (that's for architecture docs)
- Duplicate content across files
- Include code implementation details
- Let docs get stale - remove outdated features

## When to Update

1. **After feature completion** - Update product docs when feature is merged to main
2. **After breaking changes** - Update immediately if user-facing behavior changes
3. **After deprecation** - Mark as deprecated, later remove
4. **Never during development** - Product docs reflect production capabilities

## Template for Feature Documentation

```markdown
# [Feature Name]

## What It Does
Brief description of the feature (2-3 sentences).

## Use Cases
- Use case 1
- Use case 2
- Use case 3

## Capabilities
- What users can do
- Key features
- Integration points (user perspective)

## Limitations
- What it doesn't do
- Known constraints
- Future enhancements (if planned)

## Configuration
```yaml
# Example configuration
setting: value
```

## Examples

### Example 1: [Scenario]
Description of how to use the feature for this scenario.

### Example 2: [Scenario]
Description of another common usage pattern.

## Related Features
- Link to related feature docs
- Link to API docs (if applicable)
```

## Integration with Feature Docs

**Feature docs (docs/features/)**: For developers, explains architecture and implementation
**Product docs (docs/product/)**: For users, explains capabilities and usage

Don't duplicate - cross-reference when needed.
