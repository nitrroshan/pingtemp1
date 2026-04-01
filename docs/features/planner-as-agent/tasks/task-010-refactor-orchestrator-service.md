# Task 010: Refactor OrchestratorService

**Status:** `not-started`
**Assignee:**
**Estimated:** 3-4 days
**Branch:** `feature/planner-as-agent`

## Description
Refactor OrchestratorService from an orchestrator that drives planning into a reactive runtime that the planner drives via tools. Wire all components from Tasks 001-009 together.

## Acceptance Criteria
- [ ] Remove `planBuilderAgent` (planner agent replaces it)
- [ ] `handleMessage()` routing: first message → start planner with goal; subsequent messages during `executing` → `onUserMessage()` (queue + wake)
- [ ] State machine simplified: `idle → executing` (planner manages its own states via tools)
- [ ] Becomes reactive runtime: stores tasks, resolves deps, spawns workers, emits notifications
- [ ] Owns `pendingUserMessages` queue + `onUserMessage()` handler
- [ ] Modify `orchestrator/tools/approvePlan.ts` — `request_approval` pauses planner, resumes on approval
- [ ] `api/SocketServerV2.ts` — handle `plan:approve`, `plan:reject` events
- [ ] Feature flag: `PLANNER_MODE=agent|legacy` for rollback

## Implementation Notes
- This is the integration step — all previous tasks feed into it
- A6 (Task Orchestration) contributes TaskStore + WorkerPool changes to this same refactor
- Graceful degradation: no frontend → `ask_user` auto-resolves, `tell_user` logs to console

## Dependencies
- Tasks 001-009 (all previous tasks)

## Testing
- Integration: full wiring — goal in → planner runs → tools work → workers dispatch → notifications flow
