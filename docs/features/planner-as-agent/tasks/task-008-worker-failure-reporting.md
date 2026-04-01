# Task 008: Worker Failure Reporting

**Status:** `not-started`
**Assignee:**
**Estimated:** 2 days
**Branch:** `feature/planner-as-agent`
**Package:** `cockatiel`

## Description
Replace bare-string error reporting with structured `WorkerFailureReport`. Orchestrator auto-retries transient errors via `cockatiel`. Non-transient failures notify the planner with structured data. Downstream tasks marked `blocked` (not cascade-failed).

## Acceptance Criteria
- [ ] `orchestrator/types/workerTypes.ts` — `WorkerFailureReport` (structured), `ErrorCategory` enum (10 categories)
- [ ] `OrchestratorService.onTaskFailed()` receives structured report
- [ ] Transient errors (`rate_limit`, `external_service`) auto-retry (max 2 attempts, exponential backoff)
- [ ] Circuit breaker for external services (3 consecutive failures → open for 30s)
- [ ] Non-transient errors → notify planner with structured data
- [ ] Downstream dependent tasks marked `blocked` (not cascade-failed)
- [ ] Workers report failure via `WorkerFailureReport`, not bare strings

## Error Categories
`llm_error | tool_error | external_service | rate_limit | timeout | validation_error | context_exceeded | permission_denied | cancelled | unknown`

## Implementation Notes
- Install `cockatiel`: `bun add cockatiel`
- Use `cockatiel` composable policies: `retry()`, `circuitBreaker()`, `wrap()`
- Retry from scratch (not resume) — tasks are small, partial state is fragile

## Dependencies
- Task 007 (notifications — failure pushes to notification queue)

## Testing
- Unit: error classification, retry logic, circuit breaker state transitions
- Integration: transient error → auto-retry succeeds, non-transient → planner notified
