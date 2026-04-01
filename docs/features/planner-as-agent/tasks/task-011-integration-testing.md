# Task 011: Integration Testing

**Status:** `not-started`
**Assignee:**
**Estimated:** 2-3 days
**Branch:** `feature/planner-as-agent`

## Description
End-to-end tests verifying the full planner-as-agent system works correctly. Each test covers a critical flow that spans multiple components.

## Acceptance Criteria
- [ ] Full loop: goal → clarify → research → discuss → plan → approve → execute → suspend → wake → complete
- [ ] User timeout: `ask_user` with no response → planner proceeds with assumptions
- [ ] DAG cycle rejection → planner fixes and resubmits
- [ ] Task failure → auto-retry (transient) or planner decision (non-transient)
- [ ] Plan mutation mid-flight: `add_tasks`/`remove_task`/`update_task` → DAG valid → execution continues
- [ ] Replan: task fails → planner asks user → user says replan → old tasks cancelled → new plan
- [ ] Worker cancellation: upstream fails → AbortSignal set → running worker aborts cleanly
- [ ] Watchdog: worker stops heartbeating → detected dead → planner notified → decides retry
- [ ] Mid-execution user message → planner wakes → processes message → resumes plan
- [ ] User message during LLM call → queued → injected after current turn
- [ ] All Socket.IO events reach frontend

## Implementation Notes
- Test infrastructure: mock LLM (deterministic responses), real Socket.IO, real DependencyResolver
- Use `PLANNER_MODE=agent` feature flag
- Each E2E test should be independently runnable

## Dependencies
- Task 010 (everything wired together)

## Testing
This IS the testing task.
