# Task Backlog

All open tasks across features, grouped by priority.

## P0 — Must Fix (Correctness)

*All P0 items resolved on this branch.*

## P1 — Should Fix (Quality)

| ID | Task | Feature | Status |
|----|------|---------|--------|
| TO-001 | Team & Goal Ownership Model — add ownerId, members[], createdBy, approvedBy to schema. Access control for plan approval + goal creation. | [team-ownership](team-ownership/feature_architecture.md) | architecture — needs option selection |
| B-003 | decisions type mismatch — `Task.types.ts:124` uses `{decision, rationale}`, but `completeTaskTool.ts:43` and `WorkerPool.ts:35` use `string[]`. Runtime contract doesn't match schema. | [crdt-first-architecture](crdt-first-architecture/) | ~~not-started~~ resolved |
| B-006 | No concrete S3 blob provider — roadmap claims S3-backed collab, but `HocuspocusServer.ts:333` defaults to filesystem. Abstraction exists, no S3 implementation. | [collab-service](../packages/collab-service/) | not-started |
| B-007 | PlanStore on hot path — cross-plan refs now resolve via MongoDB (taskPersistence), PlanStore is fallback only. | [crdt-first-architecture](crdt-first-architecture/) | ~~not-started~~ resolved |
| DP-001 | [Resizable Document Pane](document-pane/tasks/task-001-resizable-pane.md) | [document-pane](document-pane/) | not-started |
| DP-002 | [Document Metadata Header](document-pane/tasks/task-002-doc-metadata-header.md) | [document-pane](document-pane/) | not-started |
| DP-003 | [Read-Only Mode for System Docs](document-pane/tasks/task-003-readonly-system-docs.md) | [document-pane](document-pane/) | not-started |
| DP-004 | [Task Report Docs in Document List](document-pane/tasks/task-004-task-report-visibility.md) | [document-pane](document-pane/) | not-started |
| DP-007 | [Verify CRDT Report Content Before Completion](document-pane/tasks/task-007-verify-crdt-content.md) | [document-pane](document-pane/) | not-started |

## P2 — Nice to Have (Polish)

| ID | Task | Feature | Status |
|----|------|---------|--------|
| DP-005 | [Syntax Highlighting for Workspace Files](document-pane/tasks/task-005-syntax-highlighting.md) | [document-pane](document-pane/) | not-started |
| DP-006 | [Auto-Refresh Document List](document-pane/tasks/task-006-auto-refresh-doc-list.md) | [document-pane](document-pane/) | not-started |
| B-004 | PlanStore removal — remove once CRDT plan docs + MongoDB proven stable. Blocked by B-007. | [crdt-first-architecture](crdt-first-architecture/) | not-started |
| B-005 | Collab persistence defaults to filesystem — wire S3/Azure for cloud deployment | [collab-service](../packages/collab-service/) | not-started |

## Completed (This Branch)

| ID | What | Feature |
|----|------|---------|
| PR1 | DB safety: unique index, async persist, GoalSchema | crdt-first-architecture |
| PR2 | CRDT standardize: meta maps, collab tool, event-driven projection | crdt-first-architecture |
| PR3 | DocumentRef + BlockNote + record-decision + write-block rewrite | crdt-first-architecture |
| PR4 | Plan approval, completion protocol, reject/replan, CRDT plan docs | crdt-first-architecture |
| DP-MVP | Document Pane: list, CRDT viewer, workspace files, approve/reject footer | document-pane |
| FIX | Planner gets collab tools (was missing L2 tools) | crdt-first-architecture |
| FIX | completeTaskTool enforces exact report URI | crdt-first-architecture |
| FIX | Stale request_approval removed from planner prompt | crdt-first-architecture |
| FIX | goal getMap("goal") → getMap("meta") in collab tool | crdt-first-architecture |
| FIX | DispatchManager async error path (no more swallowed promises) | crdt-first-architecture |
| FIX | requestTaskTool rollback through TaskStore (single writer) | crdt-first-architecture |
| FIX | persistPlan status "pending" not "executing" | crdt-first-architecture |
| FIX | plan_proposed event + CRDT projection at submit time | crdt-first-architecture |
| FIX | CrdtProjectionHandler resolveForGoal before isAvailable check | crdt-first-architecture |
| FIX | SocketEventBroadcaster onPlanProposed emits state event | crdt-first-architecture |
| B-001 | Atomic approval: upsert new tasks first, delete stale by planId. No crash window — MongoDB always has valid tasks. | crdt-first-architecture |
| B-002 | Planner conversation persist/restore: wired end-to-end with userId + agentLayer. Save after each turn, restore on planner creation. | conversation-persistence |
| B-003 | decisions type aligned: completeTaskTool, WorkerPool, GoalManager, types.ts all use `{decision, rationale?}` | crdt-first-architecture |
| B-007 | PlanStore removed from hot path: cross-plan refs resolve via MongoDB taskPersistence, PlanStore is fallback only | crdt-first-architecture |
| B-008 | User-scoped session restore: userId filter added to IChatService, MongoChatService, sessionRoutes. Planner LLM context stays team-scoped (intentional). | conversation-persistence |
| B-009 | Worker message persistence clarified: workers ARE persisted for UI session restore (agentLayer: "worker"), NOT for LLM context. Architecture doc updated. | conversation-persistence |
