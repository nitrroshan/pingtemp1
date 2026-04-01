# Task 002: User Interaction System

**Status:** `not-started`
**Assignee:**
**Estimated:** 2-3 days
**Branch:** `feature/planner-as-agent`

## Description
Build the communication bridge between agent tool calls and Socket.IO frontend. `ask_user`, `tell_user`, `discuss_approach` — shared by planner and workers. Same `Map<id, resolver>` bridge, different Socket.IO events, different scopes.

**Note:** Approval system (structured requests, auto-approve rules, audit trail) is a separate feature — see [A9 Approval System](../../approval-system/feature_architecture.md).

## Acceptance Criteria

### Communication Bridge (shared by planner + workers)
- [ ] `UserInteractionManager` — `Map<questionId, resolver>` using `Promise.withResolvers()`. `resolveQuestion(id, answer)` for Socket handler. Timeout via `AbortSignal.timeout(300_000)`.
- [ ] **Planner tools:** `ask_user`, `tell_user` (categories: `finding|progress|warning|status`), `discuss_approach` (blocks until user selects from options)
- [ ] **Worker tools:** `worker_ask_user`, `worker_tell_user`, `worker_discuss_approach` — same bridge, scoped to task thread, different Socket.IO event prefix (`worker:ask`/`worker:tell`/`worker:respond`)
- [ ] Worker heartbeat → `WAITING` mode when `ask_user`/`discuss_approach` is pending (watchdog backs off)
- [ ] Planner notified via `worker_waiting` notification when worker is waiting for user
- [ ] Timeout fallback: auto-resolve after 5min so agent doesn't hang
- [ ] Disconnect handling: cleanup pending questions if WebSocket drops
- [ ] Ping Team workers get `tell_user` only (findings/warnings stream to UI) — NOT `ask_user`/`discuss_approach`

### Socket.IO Events
- [ ] `planner:ask_user` / `planner:user_response` — planner ↔ user
- [ ] `planner:tell_user` — planner → user (fire-and-forget)
- [ ] `worker:ask` / `worker:respond` — worker ↔ user (scoped to task thread)
- [ ] `worker:tell` — worker → user (fire-and-forget, scoped to task thread)

## Implementation Notes
- No external packages — `Promise.withResolvers()` and `AbortSignal.timeout()` built into Bun/Node 22+
- `tell_user` wraps existing Socket.IO `io.to(room).emit()` — already works
- `ask_user`/`discuss_approach` share the same `Map<id, resolver>` (~30 lines)

## Dependencies
- Task 001 (types/schemas — `UserQuestion`, `UserChoice` types)

## Testing
- Unit: resolve/timeout/disconnect for both planner and worker tools
- Integration: Socket.IO round-trip (planner asks → user answers → planner resumes)
- Integration: Worker asks → `worker:ask` → user responds → `worker:respond` → worker resumes
