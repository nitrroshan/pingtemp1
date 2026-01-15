---
applyTo: docs/**/*
---

# Document Maintenance Philosophy

All documentation in this codebase is treated as **living documents** that should be actively maintained.

## When Features Are Complete

Different documents require different maintenance approaches when a feature is completed:

### Implementation Documents → CLEANUP
**Action:** Remove unnecessary details, keep only what's valuable for reference

**Keep:**
- Significant deviations from plan and why
- Unexpected challenges and solutions
- Performance optimizations
- Breaking changes or migrations
- Links to PRs/commits

**Remove:**
- Step-by-step progress logs
- Routine implementation details
- Temporary blockers that were resolved
- In-progress status markers
- Duplicate information from planning doc

### Architecture Documents → UPDATE
**Action:** Refine and consolidate based on what was actually built

**Update:**
- Remove rejected architecture options
- Keep only the chosen approach with brief rationale
- Update integration points if they changed
- Add lessons learned (if significant)
- Consolidate to essential information

**Keep:**
- High-level design decisions
- Integration patterns
- Key trade-offs made
- References to related features

### Planning Documents → ARCHIVE OR REMOVE
**Action:** After successful completion, planning docs have limited value

**Options:**
1. **Delete entirely** - Plan served its purpose, implementation doc has the real story
2. **Minimal summary** - Keep brief "what was planned" for historical context
3. **Archive** - Move to `docs/archive/` if team wants history

### Product Documentation → UPDATE ONCE
**Action:** Update product docs only when feature is complete and tested

See `product-documentation.instructions.md` for details.

## Core Principles

### ❌ DON'T:
- Keep appending content indefinitely
- Duplicate information across documents
- Preserve outdated design decisions "for history"
- Write lengthy explanations for straightforward changes
- Let documents grow beyond their word limit

### ✅ DO:
- **Update and refine** - rewrite sections as understanding improves
- **Delete obsolete content** - remove abandoned approaches
- **Consolidate** - merge related sections
- **Cross-reference** - link to other docs instead of repeating
- **Keep it scannable** - use headings, bullets, code snippets

## How to Update Documents

### When Design Evolves
1. **Read the current document first**
2. **Identify outdated sections** - mark them for removal
3. **Rewrite changed sections** - don't append, replace
4. **Remove deprecated content** - delete what's no longer relevant
5. **Update cross-references** - ensure links are still valid

### When Implementation Progresses
1. **Mark completed steps** in implementation planning
2. **Remove unnecessary details** from implementation log
3. **Consolidate related items** to save space
4. **Update estimates** based on actual complexity

### When Requirements Change
1. **Revise architecture** to reflect new understanding
2. **Update or remove** affected implementation steps
3. **Document deviations** in implementation log (briefly)
4. **Keep all three docs in sync**

## Document Length Limits

All feature documents have **max 500 words**:

- `feature_architecture.md` - max 500 words
- `feature_implementation_planning.md` - max 500 words
- `feature_implementation.md` - max 500 words

Bug fix notes have **max 200 words**.

### When Approaching Limit

**If a document is nearing 500 words:**
1. Look for redundant content to remove
2. Consolidate similar sections
3. Move stable patterns to main copilot guide
4. Consider if feature should be split

**If already at 500 words and need to add content:**
1. Remove equal or greater amount of outdated content
2. If can't remove anything, feature is too large - split it

## Consolidation Examples

### ❌ Before (verbose):
```markdown
## Step 1: Update MemoryManager
First, we need to update the MemoryManager class. The MemoryManager is responsible for storing tasks. We will add a persist method that saves tasks to disk. This method will serialize the tasks Map to JSON format and write it to a file.

## Step 2: Update AgentManager
Next, we need to update the AgentManager class. The AgentManager orchestrates all the managers. We will add a rehydrate method that loads the MemoryManager state from disk.
```

### ✅ After (concise):
```markdown
## Phase 1: Add Persistence
1. **MemoryManager**: Add `persist()` method (serialize Map to JSON, save to disk)
2. **AgentManager**: Add `rehydrate()` method (load MemoryManager from disk)
```

## Cross-Referencing

Instead of duplicating content, link to other documents:

### ❌ Before (duplication):
```markdown
The AgentManager uses Azure OpenAI via @langchain/openai. You need to set AZURE_OPENAI_ENDPOINT_URL and AZURE_OPENAI_API_KEY in your environment variables...
```

### ✅ After (cross-reference):
```markdown
AgentManager uses Azure OpenAI (see main copilot guide for env setup).
```

## Migration to Main Guide

When a feature becomes stable and its patterns should be followed broadly:

1. **Identify reusable patterns** from feature docs
2. **Add them to main copilot-instructions.md** in appropriate section
3. **Remove redundant details** from feature docs
4. **Add cross-reference** from feature doc to main guide

Example:
- Feature doc: "Database persistence uses factory pattern (see main guide, Patterns section)"
- Main guide: "Database persistence: All managers use factory methods (fromDatabase, fromTaskDescription) with external DB layer"
