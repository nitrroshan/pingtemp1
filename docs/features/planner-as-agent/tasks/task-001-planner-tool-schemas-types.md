# Task 001: Planner Tool Schemas + Types

**Status:** `not-started`
**Assignee:**
**Estimated:** 2 days
**Branch:** `feature/planner-as-agent`

## Description
Define all TypeScript types and Zod schemas for the planner tool system. This is the foundation — every subsequent task imports from these types.

## Acceptance Criteria
- [ ] `orchestrator/types/plannerTypes.ts` — `Plan`, `PlanTask`, `PlannerNotification`, `UserQuestion`, `UserChoice`, `TaskPatch`, `TaskPriority`
- [ ] `orchestrator/tools/userTools.ts` — Zod schemas for `ask_user`, `tell_user`, `discuss_approach`
- [ ] `orchestrator/tools/knowledgeTools.ts` — Schemas for `research_domain`, `analyze_requirements`, `get_team_capabilities`
- [ ] `orchestrator/tools/planMutationTools.ts` — Schemas for `update_task`, `add_tasks`, `remove_task`, `reprioritize`, `reassign_task`, `replan`
- [ ] `orchestrator/tools/index.ts` — Register all new tools alongside existing ones
- [ ] All schemas compile with Zod validation
- [ ] `CancellationToken` type uses native `AbortSignal` (not custom)

## Implementation Notes
- Files: all under `packages/backend/orchestrator/`
- Use `zod` (already installed)
- Types consumed by A6 (Task Orchestration) — keep exports clean

## Dependencies
None — this is the foundation step.

## Testing
- Unit: Zod schemas validate correct input, reject malformed input
