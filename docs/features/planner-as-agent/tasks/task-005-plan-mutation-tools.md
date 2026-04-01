# Task 005: Plan Mutation Tools

**Status:** `not-started`
**Assignee:**
**Estimated:** 2 days
**Branch:** `feature/planner-as-agent`

## Description
Implement 6 plan mutation tools that let the planner modify the plan mid-flight. Each mutation re-validates the DAG and emits Socket.IO events.

## Acceptance Criteria
- [ ] `update_task` — modify task description, priority, role assignment
- [ ] `add_tasks` — add new tasks with dependencies (DAG validated)
- [ ] `remove_task` — remove task + cascade-remove orphaned dependents
- [ ] `reprioritize` — change task priority
- [ ] `reassign_task` — change assigned role (must exist in team)
- [ ] `replan` — log reason to L2, requires approval if `plan.metadata.requiresApproval`
- [ ] All mutations delegate to DependencyResolver for DAG re-resolution
- [ ] All mutations emit Socket.IO events (`plan:task_updated`, `plan:tasks_added`, etc.)

## Guard Rails (all enforced)
- Cannot mutate `in_progress`/`completed` tasks (must `cancel_task` first)
- Cannot create dependency cycles (returns cycle path)
- Cannot assign to nonexistent roles (error includes available roles)

## Implementation Notes
- Files: `packages/backend/orchestrator/tools/planMutationTools.ts`, modify `OrchestratorService.ts`
- See [architecture doc](../feature_architecture.md#plan-mutation-tools) for full semantics

## Dependencies
- Task 004 (DAG resolver)

## Testing
- Unit: each mutation + guard rail rejection + Socket.IO event emission
