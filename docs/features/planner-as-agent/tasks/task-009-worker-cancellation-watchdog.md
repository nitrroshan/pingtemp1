# Task 009: Worker Cancellation + Watchdog

**Status:** `not-started`
**Assignee:**
**Estimated:** 2 days
**Branch:** `feature/planner-as-agent`

## Description
Implement cooperative worker cancellation using native `AbortController`/`AbortSignal` and a watchdog loop that detects dead/stalled workers using the AIMD patience algorithm.

## Acceptance Criteria
- [ ] One `AbortController` per worker — passed as `AbortSignal` at spawn
- [ ] `cancelWorker(reason)` calls `controller.abort(reason)`
- [ ] Cancel reasons: upstream failed, task cancelled, budget exceeded, plan replaced
- [ ] Workers check `signal.throwIfAborted()` at tool boundaries (between LLM turns)
- [ ] Watchdog loop (configurable interval, default 30s): heartbeat checks, dead/idle detection
- [ ] AIMD patience: additive increase on progress, multiplicative decrease on stall
- [ ] Dead worker → kill, mark failed, notify planner
- [ ] Stalled worker → notify planner at warning/urgent thresholds
- [ ] Manual mode (human-in-the-loop) → watchdog stall detection suspended

## Implementation Notes
- No package needed — `AbortController`/`AbortSignal` is native JS
- Maps 1:1 to our designed CancellationToken: `token.cancelled` → `signal.aborted`
- See [architecture doc](../feature_architecture.md#aimd-for-agent-monitoring) for AIMD constants

## Dependencies
- Task 008 (failure reporting — cancellation causes a failure report)

## Testing
- Unit: AbortSignal propagation, AIMD patience calculation, mode-based watchdog behavior
- Integration: cancel running worker → clean abort → failure report generated
