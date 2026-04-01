# Task 007: Notification System + Suspend/Wake

**Status:** `not-started`
**Assignee:**
**Estimated:** 3-4 days
**Branch:** `feature/planner-as-agent`

## Description
Build the notification queue, transport layer, and planner suspend/wake mechanics. The planner suspends after dispatching tasks (zero tokens). Orchestrator wakes it by pushing notifications and resolving the wake signal. User messages are conversation (not notifications) and take priority.

## Acceptance Criteria
- [ ] `orchestrator/NotificationQueue.ts` — `PlannerNotification` discriminated union, severity levels, `push()`, `drain()`, `hasUrgent()`
- [ ] `orchestrator/NotificationTransport.ts` — `NotificationTransport` interface (`send()`, `ask()`, `discuss()`), `SocketIOTransport` (V1), `CompositeTransport` for fan-out
- [ ] `orchestrator/tools/notificationTools.ts` — `check_notifications` tool, enrich `get_status`
- [ ] Lifecycle events → queue push → `transport.send()` (not `io.emit` directly)
- [ ] `plannerWakeSignal` — suspend/resume with 100ms debounce for batching
- [ ] User messages injected as `addHumanMessage()` (NOT `addSystemMessage()`)
- [ ] User messages take priority over notifications — always
- [ ] Mid-execution user messages: queued if planner busy, injected on next turn

## Notification Types
`task_completed | task_failed | worker_stalled | worker_died | plan_blocked | execution_complete | sla_warning`
- User messages are NOT in this list — they are conversation

## Suspend/Wake Flow
1. Planner dispatches tasks → suspends (`await plannerWakeSignal`)
2. Workers execute (planner costs zero tokens)
3. Event occurs → orchestrator pushes notification → `scheduleWake()` (100ms debounce)
4. Planner wakes → checks user messages first → drains notifications → processes → suspends again

## Implementation Notes
- Install `emittery` — typed async events, replaces EventEmitter spaghetti
- Transport abstraction enables future OpenClaw Gateway integration (WhatsApp/Telegram/Slack)
- `CompositeTransport` will use `Promise.any()` for `ask()` — first channel where user responds wins

## Dependencies
- Task 004 (DAG resolver), Task 006 (planner agent)

## Testing
- Unit: NotificationQueue push/drain/hasUrgent, transport send/ask
- Integration: lifecycle event → queue → planner wakes, user message priority
