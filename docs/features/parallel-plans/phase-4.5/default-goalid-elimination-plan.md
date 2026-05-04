# Default GoalId Elimination — Implementation Plan

> **Parent:** [default-goalid-elimination.md](./default-goalid-elimination.md) (architecture/design review)  
> **Status:** Planning  
> **Branch:** `feature/no-default-goalid`  
> **Depends on:** Phase 4.5 refactoring (✅ complete)

## Scope

Eliminate ALL `|| "default"` fallbacks and unsafe fallback chains across 19 locations. After this change:
- Nothing exists without a real goalId
- No phantom planners, ChatAgents, or GoalContexts
- `toGoalId()` only called in frontend (single source of truth)
- No silent auth bypasses via `userId ?? "default"`
- No session corruption via `sessionId || "default"`

## Implementation Steps

### Step 1: AgentManagerV2 — Remove startup agent creation + fallback chains (fixes #1, #2, #3)

**Files:** `packages/agent-manager/src/AgentManagerV2.ts`

- [ ] **1a.** `enableChatAgents()` — delete `enableChatAgentsForGoal(goalId, roles)` call and the `goalId` variable. Keep only flag + dispatch wiring.
- [ ] **1b.** NotificationQueue `onFlush` — replace `getCurrentGoalId() || "default"` with `getCurrentGoalId()`. Add `if (!goalId) return;` guard.
- [ ] **1c.** ChatAgent dispatch — replace triple fallback `task?.goalId || getCurrentGoalId() || "default"` with `task?.goalId` only.

**Entry:** Build passes.  
**Exit:** No `"default"` in AgentManagerV2. ChatAgents only created by `approvePlan()`.

---

### Step 2: OrchestratorService — Require clientGoalId, remove derivation (fixes #5, #6, #15)

**Files:** `packages/agent-manager/src/orchestrator/OrchestratorService.ts`

- [ ] **2a.** `_handleMessage()` — change `clientGoalId` from optional to required. Remove `toGoalId(content)` fallback. Throw if missing.
- [ ] **2b.** `handleMessage()` — update signature: `handleMessage(content: string, goalId: string)`.
- [ ] **2c.** `notifyPlanner()` — replace `getGoalId() || "default"` with `getGoalId()`. Add `if (!goalId) return;` guard.
- [ ] **2d.** Remove `toGoalId` import if no longer used.

**Entry:** Step 1 complete.  
**Exit:** `_handleMessage` rejects messages without goalId. No `toGoalId()` calls in OrchestratorService.

---

### Step 3: GoalManager — Remove "default" from plan derivation + assert goalId (fixes #4, #7, #13)

**Files:** `packages/agent-manager/src/orchestrator/GoalManager.ts`

- [ ] **3a.** `setPendingPlan()` — remove `|| "default"` from `toGoalId(plan.goal || plan.planId || "default")`. Remove `toGoalId` call entirely — use `activeGoalId` (always set by `_handleMessage`).
- [ ] **3b.** `approvePlan()` — assert `goal.goalId` is non-null instead of fallback derivation. Remove `toGoalId` call.
- [ ] **3c.** Merge conflict resolution task (line ~737) — inherit parent task's `goalId`.
- [ ] **3d.** Remove `toGoalId` import if no longer used.

**Entry:** Step 2 complete.  
**Exit:** No `toGoalId()` calls in GoalManager. `approvePlan()` asserts goalId exists.

---

### Step 4: SocketServerV2 — Fix message persistence goalId + sessionId (fixes #8, #9, #10, #16)

**Files:** `packages/backend/api/SocketServerV2.ts`

- [ ] **4a.** Assistant message persistence (onStream finish) — use `streamGoalId` from callback data, not `getCurrentGoalId()`.
- [ ] **4b.** User message persistence — use `clientGoalId` only, not `getCurrentGoalId()` fallback.
- [ ] **4c.** ChatAgent finish persistence — lookup goalId from ChatAgent's goal context, not manager state.
- [ ] **4d.** `sessionId || "default"` (5 places) — generate `crypto.randomUUID()` when missing. Add to import.

**Entry:** Step 3 complete (goalId flows correctly from client through to persistence).  
**Exit:** All persisted messages have real goalId from source. No `"default"` sessionId.

---

### Step 5: Collaboration + Worker — Guard null goalId (fixes #11, #12, #14)

**Files:**
- `packages/backend/agentManager/plugins/CollaborationPlugin.ts`
- `packages/agent-manager/src/agent/internal/tools/requestTaskTool.ts`
- `packages/agent-manager/src/services/WorkerPool.ts`

- [ ] **5a.** CollaborationPlugin — change `goalId: string = "default"` to `goalId: string | null = null`. Add guard in methods that use `this.goalId`.
- [ ] **5b.** requestTaskTool — change `ctx.planId || "default"` to `ctx.planId!` (assert non-null).
- [ ] **5c.** WorkerPool — assert `services.goalId` is provided when `setTaskServices` is called.

**Entry:** Step 4 complete.  
**Exit:** No `"default"` in collaboration/worker layer.

---

### Step 6: Mongo services — Reject missing userId (fixes #17, #18)

**Files:**
- `packages/backend/services/mongo/MongoChatService.ts`
- `packages/backend/services/mongo/MongoGoalService.ts`

- [ ] **6a.** `toMessage()` — throw if `doc.userId` is missing instead of falling back to `"default"`.
- [ ] **6b.** `toGoal()` — same.

**Entry:** Independent of other steps.  
**Exit:** No anonymous `"default"` userId in DB reads.

---

### Step 7: ModelProvider — Require model name for openai-compatible (fix #19)

**Files:** `packages/agent-manager/src/agent/providers/ModelProvider.ts`

- [ ] **7a.** Throw `"model required for openai-compatible provider"` instead of falling back to `"default"`.

**Entry:** Independent.  
**Exit:** Configuration errors caught at init, not at first API call.

---

### Step 8: Frontend cleanup + submitPlan.ts (fix toGoalId elimination)

**Files:**
- `packages/frontend/App.tsx` — delete `restoreGoalId || undefined` no-op
- `packages/agent-manager/src/orchestrator/tools/submitPlan.ts` — verify `octx.currentGoalId` is used (not `toGoalId`)

- [ ] **8a.** Frontend — pass `activePlanGoalId` directly to `restoreFromServer`.
- [ ] **8b.** submitPlan — confirm `octx.currentGoalId` is the primary goalId source. Keep `toGoalId` only as assertion fallback, not silent override.

**Entry:** All backend steps complete.  
**Exit:** `toGoalId()` only exists in `frontend/lib/planId.ts`. Zero backend derivation.

---

## Dependencies

```
Step 1 (AgentManagerV2)
  → Step 2 (OrchestratorService) — requires goalId to be required
    → Step 3 (GoalManager) — requires no toGoalId derivation
      → Step 4 (SocketServerV2) — requires goalId flowing correctly
        → Step 5 (Collab/Worker) — requires goalId always set
          → Step 8 (Cleanup)

Step 6 (Mongo) — independent
Step 7 (ModelProvider) — independent
```

## Testing

| Test | Validates |
|------|-----------|
| Submit goal → plan creates, tasks have goalId | Steps 1-3 |
| Click sub-agent → ChatAgent responds (not created at startup) | Step 1 |
| Reload page → planner conversation restored | Step 4 |
| Two goals → each has isolated agents | Steps 1-3 |
| No "default" goal in sidebar PLANS section | Step 1 |
| Worker streams have goalId in payload | Step 4-5 |
| DB messages all have real userId (not "default") | Step 6 |
| openai-compatible without model throws at init | Step 7 |
| Backend logs show no "default" goalId | All steps |

## Rollback

Each step is independently revertable — add back the `|| "default"` fallback at the specific location. Feature flag `FF_PARALLEL_PLANS` is unrelated; this fix applies regardless.

## Estimated Effort

| Step | Effort | Risk |
|------|--------|------|
| 1. AgentManagerV2 | 0.5d | Low — removing code |
| 2. OrchestratorService | 0.5d | Medium — signature change |
| 3. GoalManager | 0.5d | Medium — assertion logic |
| 4. SocketServerV2 | 0.5d | Low — persistence wiring |
| 5. Collab/Worker | 0.5d | Low — guards |
| 6. Mongo services | 0.25d | Low — throw on null |
| 7. ModelProvider | 0.1d | Low — one throw |
| 8. Cleanup | 0.25d | Low — deletions |
| **Total** | **3 days** | |
