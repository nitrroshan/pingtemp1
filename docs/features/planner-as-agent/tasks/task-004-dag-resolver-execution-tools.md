# Task 004: DAG Resolver + Execution Tools

**Status:** `not-started`
**Assignee:**
**Estimated:** 2-3 days
**Branch:** `feature/planner-as-agent`

## Description
Build the DependencyResolver — DAG validation, topological sort, and ready-task resolution. Also create execution tools the planner uses to manage running tasks. This is shared with A6 (Task Orchestration).

## Acceptance Criteria
- [ ] `orchestrator/DependencyResolver.ts` — cycle detection, topological sort, `getReady()`, `getBlocked()`, `getCriticalPath()`
- [ ] Re-resolves after every mutation (called by mutation tools)
- [ ] Rename `orchestrator/tools/createPlan.ts` → `submitPlan.ts` — validate DAG via resolver, store tasks
- [ ] Modify `orchestrator/tools/getStatus.ts` — return task states + pending notifications
- [ ] `orchestrator/tools/executionTools.ts` — `cancel_task`, `get_blocked`, `get_critical_path`, `search_agents`
- [ ] DAG rejects cycles and returns cycle path to planner (not a generic error)
- [ ] `getReady()` / `getBlocked()` return correct task sets

## Implementation Notes
- No package needed — `graphlib` is 6 years unmaintained. Our DAGs have 10-50 nodes. Topo sort + cycle detection is ~50 lines.
- A6 uses this — keep `DependencyResolver` API clean and generic
- Cycle detection: Kahn's algorithm or DFS with visited set

## Dependencies
- Task 001 (types)

## Testing
- Unit: cycle detection (single cycle, multi-cycle), topological order, getReady with partial completions, getCriticalPath
