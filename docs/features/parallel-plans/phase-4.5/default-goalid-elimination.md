# Default GoalId Elimination

> **Status:** Design review  
> **Severity:** Critical — root cause of ChatAgent failures, planner context leaks, and goal-scoped event misrouting  
> **Principle:** Nothing exists without a real goalId. No "default" fallbacks.

## Problem

8 critical locations use `|| "default"` as a goalId fallback. This creates orphan resources (planners, ChatAgents, goal contexts) under a phantom `"default"` goalId that:

1. **ChatAgent lookup mismatches** — agents created under `"default"`, looked up under real goalId → null → no response
2. **Double ChatAgent creation** — created at startup for `"default"`, then again on plan approval for real goalId
3. **Planner context leaks** — NotificationQueue/notifyPlanner can execute planner turns under `"default"` goalId
4. **CollaborationPlugin uses `"default"` until plan approval** — collab tools operate on wrong goal

## Root Cause

`enableChatAgents()` is called at server startup (AgentManagerRegistry) BEFORE any user message. At that point `getCurrentGoalId()` is null → falls back to `"default"`. This creates a ghost GoalContext that persists and causes mismatches when the real goalId arrives.

## Locations to Fix

### 🔴 CRITICAL — Phantom Resource Creation (5)

| # | File | Line | Current Code | Fix |
|---|------|------|-------------|-----|
| 1 | `AgentManagerV2.ts` | 422-423 | `getCurrentGoalId() \|\| "default"` + `enableChatAgentsForGoal(goalId, roles)` | **Delete** — don't create agents at startup. `approvePlan()` creates them with real goalId. |
| 2 | `AgentManagerV2.ts` | 247-248 | NotificationQueue: `getCurrentGoalId() \|\| "default"` | `getCurrentGoalId()` — if null, skip. No goal = no planner to notify. |
| 3 | `AgentManagerV2.ts` | 430 | ChatAgent dispatch: `task?.goalId \|\| getCurrentGoalId() \|\| "default"` | `task.goalId` only — tasks always have goalId. If missing, bug. |
| 4 | `GoalManager.ts` | 276 | `activeGoalId \|\| toGoalId(plan.goal \|\| plan.planId \|\| "default")` | Remove `\|\| "default"` — plan always has goal or planId. |
| 5 | `OrchestratorService.ts` | 295-301 | Derives goalId from `toGoalId(content)` when missing | Require `clientGoalId`. No goalId = throw error. |

### 🟠 HIGH — Silent Mismatches (6)

| # | File | Line | Current Code | Fix |
|---|------|------|-------------|-----|
| 6 | `OrchestratorService.ts` | 637 | `getGoalId() \|\| "default"` | `getGoalId()` — if null, skip notification. |
| 7 | `GoalManager.ts` | 305 | `goal.goalId \|\| toGoalId(plan.goal \|\| planId)` in approvePlan | Assert `goal.goalId` is non-null. |
| 8 | `SocketServerV2.ts` | 495 | Assistant message: `manager.getCurrentGoalId() \|\| undefined` | Pass `streamGoalId` from callback, not `getCurrentGoalId()`. |
| 9 | `SocketServerV2.ts` | 939 | User message: `clientGoalId \|\| manager.getCurrentGoalId() \|\| undefined` | Use `clientGoalId` only — frontend always sends it. |
| 10 | `SocketServerV2.ts` | 1091 | ChatAgent finish: `manager.getCurrentGoalId() \|\| undefined` | Lookup goalId from ChatAgent context, not manager state. |
| 11 | `CollaborationPlugin.ts` | 49 | `private goalId: string = "default"` | `private goalId: string \| null = null` — guard callers, throw if called before `setGoalId()`. |

### 🟡 MEDIUM — Silent State Loss (4)

| # | File | Line | Current Code | Fix |
|---|------|------|-------------|-----|
| 12 | `requestTaskTool.ts` | 99, 191 | `ctx.planId \|\| "default"` | `ctx.planId!` — agent always runs inside a plan. |
| 13 | `GoalManager.ts` | 737 | Merge conflict resolution task created without goalId | Inherit parent task's goalId. |
| 14 | `WorkerPool.ts` | 135 | `services.goalId \|\| null` | Assert `services.goalId` is provided. |
| 15 | `OrchestratorService.ts` | 297 | `toGoalId(content)` derivation as fallback | Delete — client always sends goalId. |

### 🔴 ALSO CRITICAL — Non-goalId Fallbacks Hiding Bugs (3)

| # | File | Line | Current Code | Fix |
|---|------|------|-------------|-----|
| 16 | `SocketServerV2.ts` | 5 places | `sessionId \|\| "default"` | Generate `crypto.randomUUID()` if missing. Multiple clients omitting sessionId get collapsed into one "default" session — corrupts session isolation. |
| 17 | `MongoChatService.ts` | 77 | `userId ?? sessionId ?? "default"` | Throw if `userId` missing — this is an auth bypass. Anonymous messages stored with userId="default" destroys audit trail. |
| 18 | `MongoGoalService.ts` | 35 | `userId ?? sessionId ?? "default"` | Same — throw if `userId` missing. |

### 🟡 MEDIUM — Bad Error Reporting (1)

| # | File | Line | Current Code | Fix |
|---|------|------|-------------|-----|
| 19 | `ModelProvider.ts` | 235 | `config.model \|\| "default"` | Throw `"model required for openai-compatible"`. SDK will 404 with model="default" — confusing. |

### ✅ ACTUALLY SAFE (keep as-is)

| Location | Pattern | Why |
|----------|---------|-----|
| `HttpServer.ts:391` | `requestedGoalId \|\| null` | Explicit nullable type, correct |
| `GoalManager.ts:869,879` | `stored.metadata.goalId \|\| null` | DB read, null is valid state |
| `WorkerPool.ts:134` | `services.planId \|\| null` | Optional worker context |
| `Frontend App.tsx:334` | `restoreGoalId \|\| undefined` | No-op, delete (just pass `activePlanGoalId` directly) |

### ⚠️ TOGOALID() ELIMINATION

After this fix, `toGoalId()` should only be called in ONE place: **frontend `lib/planId.ts`**. All backend derivations are removed — the backend receives goalId from the client and never derives its own.

| Current Location | Action |
|-----------------|--------|
| `Frontend lib/planId.ts:17` | **KEEP** — single source of truth |
| `OrchestratorService.ts:297` | **DELETE** — use clientGoalId |
| `GoalManager.ts:277` | **DELETE** — use activeGoalId |
| `GoalManager.ts:305` | **DELETE** — use goal.goalId |
| `submitPlan.ts:87` | **KEEP** — uses `octx.currentGoalId` (from client), `toGoalId` only as last resort |

## What Changes

### AgentManagerV2.enableChatAgents() — Stop creating agents at startup

```typescript
// BEFORE:
enableChatAgents(roles, loadConversation) {
  this.chatAgentsEnabled = true;
  this.orchestrator?.setChatAgentsEnabled(true);
  const goalId = this.orchestrator?.getCurrentGoalId() || "default"; // ❌
  this.orchestrator?.getGoalManager().enableChatAgentsForGoal(goalId, roles); // ❌
  // ...wire dispatch
}

// AFTER:
enableChatAgents(roles, loadConversation) {
  this.chatAgentsEnabled = true;
  this.loadConversationFn = loadConversation ?? null;
  this.orchestrator?.setChatAgentsEnabled(true);
  // NO agent creation here — GoalManager.approvePlan() creates them with real goalId
  // ...wire dispatch
}
```

### AgentManagerV2 NotificationQueue — Skip when no goal

```typescript
// BEFORE:
onFlush: (batchedMessage) => {
  const goalId = this.orchestrator?.getCurrentGoalId() || "default";
  this.orchestrator?.getGoalManager().executePlannerTurn(goalId, batchedMessage);
}

// AFTER:
onFlush: (batchedMessage) => {
  const goalId = this.orchestrator?.getCurrentGoalId();
  if (!goalId) return; // No active goal = nothing to notify
  this.orchestrator?.getGoalManager().executePlannerTurn(goalId, batchedMessage);
}
```

### AgentManagerV2 ChatAgent Dispatch — Use task.goalId directly

```typescript
// BEFORE:
const gid = task?.goalId || this.orchestrator?.getCurrentGoalId() || "default";

// AFTER:
// Tasks always have goalId (set by approvePlan). No fallback chain needed.
const gid = task?.goalId;
const chatAgent = gid ? this.getChatAgent(role, gid) : null;
```

### OrchestratorService.notifyPlanner — Skip when no goal

```typescript
// BEFORE:
const goalId = this.goalManager.getGoalId() || "default";

// AFTER:
const goalId = this.goalManager.getGoalId();
if (!goalId) return; // No active goal
```

### OrchestratorService._handleMessage — Client must provide goalId

```typescript
// BEFORE:
let goalId = clientGoalId || this.goalManager.getGoalId();
if (!goalId || goalId === "default") {
  goalId = toGoalId(content);
}
if (!this.goalManager.getGoalId() || this.goalManager.getGoalId() === "default") {

// AFTER:
// Client always sends goalId. No derivation, no fallback.
const goalId = clientGoalId || this.goalManager.getGoalId();
if (!goalId) {
  throw new Error("goalId is required — frontend must send it with the message");
}
if (!this.goalManager.getGoalId()) {
```

### GoalManager.setPendingPlan — Remove "default" from derivation

```typescript
// BEFORE:
const goalId = this.activeGoalId || toGoalId(plan.goal || plan.planId || "default");

// AFTER:  
const goalId = this.activeGoalId || toGoalId(plan.goal || plan.planId);
```

### CollaborationPlugin — Null instead of "default"

```typescript
// BEFORE:
private goalId: string = "default";

// AFTER:
private goalId: string | null = null;
```

## What Does NOT Change

- `sessionId || "default"` in SocketServerV2 — this is Socket.IO session tracking, not goalId
- `userId ?? "default"` in Mongo services — user identity fallback, not goalId
- `config.model || "default"` in ModelProvider — model name, not goalId

## Lifecycle After Fix

```
Server starts:
  AgentManagerRegistry.getForTeam()
    → initializeOrchestrator() → OrchestratorService + GoalManager created
    → enableChatAgents() → flag=true, dispatch wired, NO agents created
    → GoalManager.goals = empty Map

User submits "Build REST API":
  Frontend: goalId = toGoalId("Build REST API") = "build-rest-api"
  Frontend: sendToManager(content, goalId)
  Backend: _handleMessage(content, "build-rest-api")
    → GoalManager.getOrCreateGoalPublic("build-rest-api")
    → GoalContext created: { goalId: "build-rest-api", planner: null, chatAgents: empty }
    → executePlannerTurn("build-rest-api", content)
    → PlannerAgent created lazily for "build-rest-api"

Planner calls submit_plan:
  → approvePlan() with goalId "build-rest-api"
  → ChatAgents created: enableChatAgentsForGoal("build-rest-api", roles)
  → Tasks created with goalId "build-rest-api"
  → Everything scoped to real goalId ✅

User clicks sub-agent, types message:
  → getChatAgent("backend", "build-rest-api") → found ✅
```

## Testing

1. Submit goal → verify planner works, plan creates tasks ✅
2. Click sub-agent → type message → ChatAgent responds ✅  
3. Reload page → planner conversation restored ✅
4. Submit second goal (FF_PARALLEL_PLANS=true) → each goal has own agents ✅
5. No "default" goal in sidebar PLANS section ✅
