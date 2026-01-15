---
applyTo: docs/features/**/bugs/**/*
---

# Bug Fix Documentation

Both **short-term patches** and **long-term fixes** should be documented as **100-200 word notes**.

## Bug Documentation Format

Create bug notes at: `docs/features/<feature-name>/bugs/<bug-id>.md`

### Required Content

Every bug fix note must include:

- **Bug ID/Title**: Brief description
- **Symptom**: What broke and how it manifested
- **Root Cause**: Why it happened
- **Related Feature**: Link to the feature implementation that introduced it
- **Fix Type**: `patch` (temporary workaround) or `fix` (permanent solution)
- **Changes Made**: File paths and brief description
- **Verification**: How to confirm it's fixed

### Example Bug Note

```markdown
# Bug: Chat messages not routing to correct agent

**Feature:** `multi-agent-chat` (see `docs/features/multi-agent-chat/`)

**Symptom:** Messages sent via ChatArea appear in all agent conversations instead of the targeted agent.

**Root Cause:** ChatArea.tsx line 58-69 compared `agent.role` instead of `agent.name`. Workers are keyed by lowercase role, but UI tracks by name.

**Fix Type:** `fix` (permanent)

**Changes:** Updated `ChatArea.tsx` lines 59, 75, 83 to use `agent.name?.toLowerCase()` instead of `agent.role?.toLowerCase()`.

**Verification:** Send message to specific agent, confirm it only appears in that agent's chat.
```

## Rules

- **100-200 words max** - be concise
- Always reference the **feature that introduced the bug**
- Clearly mark **patch vs fix** so patches can be revisited later
- Store in `docs/features/<feature-name>/bugs/` folder
- Link from the feature's `feature_implementation.md`

## Patch vs Fix

**Patch (temporary workaround):**
- Quick fix to unblock users
- May have limitations or edge cases
- Should be revisited for proper fix
- Example: Adding null checks without addressing root cause

**Fix (permanent solution):**
- Addresses the root cause
- No known limitations
- Can be considered complete
- Example: Correcting the comparison logic

## Workflow

1. When a bug is discovered, identify which feature introduced it
2. Create a bug note in that feature's `bugs/` folder
3. Implement the fix (patch or permanent)
4. Document the changes in the bug note
5. Link the bug note from `feature_implementation.md`
6. If it's a patch, add a TODO for the permanent fix
