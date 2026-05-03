# PR4: Document-First Plan Session — Implementation Plan

**Branch:** `user/nitrroshan/fixplans`
**Architecture:** [crdt-first-architecture](../feature_architecture.md)
**Depends on:** PR1-3 (DB safety, CRDT restore, DocumentRef + BlockNote) — all done
**Build check:** `bun run build:backend` + `bun run --filter @ping/agent-manager typecheck` + `cd packages/frontend && npx vite build`
**Last verified:** May 4, 2026 — all builds pass

---

## Problem (What's Broken Today)

1. **Plans are JSON, not documents** — planner produces `submit_plan({ tasks: [...] })`, stored as JSON in GoalContext. Users never see the planner's reasoning.
2. **Auto-approve** — plan executes immediately. No user review step.
3. **No collab doc during execution** — agents aren't instructed to write progress/findings to CRDT. The only output is `complete_task({ summary })`.
4. **Completion report written AFTER dependants unblock** — CRDT report is written via event bus after `taskStore.completeTask()` cascades dependants. A fast downstream agent could read an empty doc.
5. **Agents don't write to their task doc** — the enriched description says "read from collab read {taskId}/task" but never says "write your findings to it."

---

## 5 Changes — Status

### Change 1: Agent Writes Completion Report to CRDT BEFORE calling complete_task ✅ DONE

**What was done:**
- `SKILL.md` — 4-step completion protocol: commit → `collab write-block {taskId}/report` → record-decision → complete_task
- `system.xml` — `<finish-properly>` requires full completion protocol before `complete_task`
- `CrdtTaskSync.ts` — `syncStatus()` no longer generates system report (comment: "agent writes the real report")
- `completeTaskTool.ts` — schema accepts `producedDocs` + `decisions` (optional, backward-compat)
- `TaskStore.ts` — `enrichDependantContext()` auto-generates `crdt:{taskId}/report` ref for downstream

**Design decision:** Agent writes to `{taskId}/report` (separate doc), not `{taskId}/task`. Task doc keeps the original description clean. Report doc is the full handoff.

### Change 2: Planner Writes Plan Document to CRDT ✅ DONE

**What was done:**
- `planner/system.xml` — Planning Protocol: analyze → `collab write-block "plan"` → THEN `submit_plan`
- `GoalEvents.ts` — added `PlanProposed` event type
- `GoalManager.ts` — `setPendingPlan()` emits `plan_proposed` event
- `CrdtProjectionHandler.ts` — subscribes to `plan_proposed`, calls `resolveForGoal()` + `createPlanDoc()`
- `CrdtTaskSync.ts` — `persistPlan()` writes `status: "pending"` (was `"executing"`) + XmlFragment content

**Design decision:** Plan lives in BOTH `pendingPlan` JSON (for approval logic) AND CRDT (for user review). `PlanStore` kept as backup. CRDT write happens at proposal time (before approval), not just at approval time.

### Change 3: Remove Auto-Approve — Add Awaiting Approval State ✅ DONE

**What was done:**
- `submitPlan.ts` — `octx.setState("awaiting_approval")`
- `AgentManagerV2.ts` — `onPlanProposed` callback: "No auto-approve — user reviews plan"
- Auto-approve APIs kept as opt-in (`setAutoApproveForRole`, `setAutoApproveAllRoles`)
- Frontend: `PlanApproval.tsx` with "Approve & Execute" button, rendered on `awaiting_approval`

### Change 4: Write Task Description to Y.XmlFragment on Creation ✅ DONE

**What was done:**
- `CrdtTaskSync.ts` `persistTask()` — builds markdown from title/role/priority/description, converts via ServerBlockNoteEditor, writes to `doc.getXmlFragment("content")`

### Change 5: Document Pane Frontend ❌ DEFERRED

**Not implemented.** Separate feature with its own plan at `docs/features/document-pane/`.

**What IS implemented:** `PlanApproval.tsx` (task-list modal with approve button). `CollaborativeEditor.tsx` (full BlockNote + Hocuspocus component, used by DevCollabButton only).

**What's missing:** DocumentPane layout, document list, auto-open on awaiting_approval, plan doc viewer with approve/replan buttons.

### Additional Gap: Replan Button ✅ DONE

**What was done:**
- `PlanApproval.tsx` — added "Request Changes" button with feedback textarea and "Send & Replan" submit
- `AgentServiceV2.ts` — added `rejectPlan(goalId, feedback)` method, `"reject-plan"` action type
- `goalSessionStore.ts` — added `rejectPlan(feedback)` action: emits reject-plan, sets state to planning
- `socket-types.ts` — added `"reject-plan"` to action enum + `feedback` field on payload
- `SocketActionHandler.ts` — `handleRejectPlan()`: clears pendingPlan, sets state to "planning", routes feedback to planner via `orchestratorMessage()`
- `AgentManagerV2.ts` — `rejectPlan(goalId)`: clears pendingPlan, sets goal state to `"gathering"`

**Flow:** User clicks "Request Changes" → enters feedback → "Send & Replan" → dialog closes → state back to gathering → feedback sent to planner → planner revises → new `awaiting_approval`

---

## Verification Checklist

| # | Check | Status |
|---|-------|--------|
| 1 | Planner writes plan rationale to CRDT before calling submit_plan | ✅ Prompt instructs it |
| 2 | Plan doc written to CRDT at proposal time (via `plan_proposed` event) | ✅ CrdtProjectionHandler |
| 3 | `sessionState === "awaiting_approval"` after plan proposed (NOT executing) | ✅ submitPlan.ts |
| 4 | Auto-approve removed from AgentManagerV2.onPlanProposed | ✅ Comment confirms |
| 5 | "Approve Plan" button in frontend triggers approvePlan() | ✅ PlanApproval.tsx |
| 6 | "Request Changes" button sends feedback to planner | ✅ PlanApproval.tsx + SocketActionHandler |
| 7 | Task CRDT docs have description in Y.XmlFragment("content") on creation | ✅ persistTask() |
| 8 | Agent writes completion report to CRDT BEFORE calling complete_task | ✅ Prompt + SKILL.md |
| 9 | System completion report doesn't overwrite agent's writing | ✅ Removed from syncStatus |
| 10 | Downstream agent can `collab read-block {upstreamId}/report` and see the report | ✅ enrichDependantContext |

---

## Remaining Work

### Document Pane (~1 week)
Separate feature. See [`docs/features/document-pane/feature_implementation_planning.md`](../../document-pane/feature_implementation_planning.md).

All PR4 backend + frontend changes are complete. The Document Pane is the only remaining gap — it replaces DetailPanel with a CRDT doc viewer so users can read plan docs, completion reports, and workspace files inline.

---

## Migration Notes

- **Backward compat:** Plans already in `pending` state still work. `approvePlan()` API unchanged.
- **Auto-approve:** Kept as opt-in API surface (`setAutoApproveForRole`, `setAutoApproveAllRoles`). Default is always `awaiting_approval`.
- **PlanStore:** Kept for now as JSON backup. Removed in a future cleanup once CRDT plan docs are proven stable.
- **Report doc pattern:** Agents write to `{taskId}/report` (not `{taskId}/task`). Task doc keeps original description. Report doc is the full handoff.
