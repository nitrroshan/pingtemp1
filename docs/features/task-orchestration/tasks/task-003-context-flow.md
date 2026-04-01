# Task 003: Context Flow (Lazy Injection)

**Status:** `not-started`
**Assignee:**
**Estimated:** 2 days
**Branch:** `feature/planner-as-agent`

## Description
Build the lazy context injection system. Workers get 1-line summaries of upstream task outputs in their prompt. Full details available via tool calls — agent decides what to load.

## Acceptance Criteria
- [ ] `orchestrator/ContextBuilder.ts` — build worker prompts with 1-line upstream summaries
- [ ] `orchestrator/tools/contextTools.ts` — `get_task_context(taskId)`, `get_task_artifacts(taskId)` worker tools
- [ ] Summary in prompt (~500 tokens), full details via tool call
- [ ] Prompt stays < 1K tokens of injected context
- [ ] All knowledge sources follow same pattern (summary in prompt, tool for full content)

## Context Sources
| Source | In prompt (summary) | Tool for full content |
|---|---|---|
| Prior task outputs | 1-line per task | `get_task_context(taskId)` |
| Task artifacts | Count + names | `get_task_artifacts(taskId)` |
| L2 shared docs | "3 docs available" | `collab` tool |
| Plan context | Goal + strategy | `get_status()` |

## Dependencies
- A6 Task 001 (TaskStore — reads task outputs)

## Testing
- Unit: summary generation, tool returns full content, missing upstream handled gracefully
