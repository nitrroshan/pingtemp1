# Approval System — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)
**ID:** A9

---

## Branch
- `feature/approval-system` (branches from `dev`)

## Scope

Two-axis control system: **dispatch policy** (task-level) + **tool policy** (tool-level), using AI SDK v6's native `needsApproval`. Wire both through Socket.IO to the frontend. Integrate with existing GoalManager, ChatAgent, WorkerPool, and SocketServerV2.

**What AI SDK v6 gives us (no custom code needed):**
- Pre-execution approval gate (`needsApproval: true | async (args) => bool`)
- `tool-approval-request` / `tool-approval-response` message parts
- Two-call flow: first call returns approval request, second call executes or denies

**What we build on top:**
- **Axis 1 — Dispatch policy** (auto/supervised/manual) on ChatAgent controlling task dispatch
- **Axis 2 — Tool policy** (auto/supervised/acceptEdits/manual) on AiSdkAgent controlling tool approval
- Task type filtering: per-agent `autoDispatchTypes` / `requireApprovalTypes` using existing task `type` field
- Per-tool rules: `allow/ask/deny` patterns (Claude Code pattern)
- Sticky decisions per-goal (cleared when GoalContext resets)
- `ApprovalPolicy` per team (destructiveTools / safeTools classification)
- Frontend: ApprovalCard, TaskDispatchCard, AgentPolicySelector

**Integration points with existing code:**
- `ChatAgent.handleTask()` — already has `mode: 'auto' | 'review' | 'manual'` + dispatch logic. Replace with `DispatchPolicy` + task type filtering
- `GoalManager` — stores `AgentControlConfig` per agent per goal, clears sticky decisions on goal completion
- `WorkerPool.runTask()` — catches `tool-approval-request` parts in stream loop (extends existing `onStream` callback pattern)
- `AiSdkAgent.toAiSdkTool()` — injection point for `needsApproval` wrapper
- `SocketServerV2.handleAction()` — extends existing switch for `approve-plan` to handle `approval:decided`, `set-dispatch-policy`, `set-tool-policy`

---

## Files

### New Files

| File | Package | Purpose |
|------|---------|---------|
| `agent/types/AgentControl.ts` | `@ping/agent-manager` | `DispatchPolicy`, `ToolPolicy`, `DispatchConfig`, `ToolPolicyConfig`, `AgentControlConfig`, presets |
| `orchestrator/types/approvalTypes.ts` | `@ping/agent-manager` | `ApprovalRequest`, `ApprovalOption`, `ApprovalDecision`, `ApprovalPolicy`, `StickyDecision` |
| `orchestrator/ApprovalSystem.ts` | `@ping/agent-manager` | `needsToolApproval()`, `shouldAutoDispatch()`, sticky decisions |
| `orchestrator/__tests__/approvalSystem.test.ts` | `@ping/agent-manager` | Unit tests |
| `components/ApprovalCard.tsx` | `@ping/frontend` | Tool approval UI in message stream |
| `components/TaskDispatchCard.tsx` | `@ping/frontend` | Queued task approval UI (dispatch policy) |
| `components/AgentPolicySelector.tsx` | `@ping/frontend` | Two dropdowns: dispatch + tool policy |

### Modified Files

| File | Package | Change |
|------|---------|--------|
| `agent/internal/AiSdkAgent.ts` | `@ping/agent-manager` | Add `wrapToolWithApproval()`. Apply in `setTools()` when tool policy ≠ auto |
| `services/WorkerPool.ts` | `@ping/agent-manager` | Detect `tool-approval-request` in stream loop → emit `onApprovalRequest` callback → deferred promise wait |
| `orchestrator/GoalManager.ts` | `@ping/agent-manager` | Store `AgentControlConfig` per agent per goal. Clear sticky decisions on goal done |
| `orchestrator/OrchestratorService.ts` | `@ping/agent-manager` | Expose `setDispatchPolicy()`, `setToolPolicy()`. Pass configs through to ChatAgent + WorkerPool |
| `orchestrator/types.ts` | `@ping/agent-manager` | Add `agentControls?: Map<string, AgentControlConfig>` to `GoalContext` |
| `chatAgent/ChatAgent.ts` | `@ping/agent-manager` | Replace `'auto' \| 'review' \| 'manual'` with `DispatchConfig`. Add task type filtering in `handleTask()` |
| `api/SocketServerV2.ts` | `@ping/backend` | Add `approval:decided`, `set-dispatch-policy`, `set-tool-policy` action handlers. Emit `approval:requested` |
| `types.ts` | `@ping/frontend` | Add `DispatchPolicy`, `ToolPolicy`, `ApprovalRequest`, `ApprovalDecision` |
| `hooks/useChat.ts` | `@ping/frontend` | Handle `approval-request` and `task-dispatch-request` stream parts |
| `components/StreamMessage.tsx` | `@ping/frontend` | Render ApprovalCard and TaskDispatchCard |

---

## Implementation Steps

### Step 1: Control Types + Configuration
**Deps:** None

- [ ] Create `agent/types/AgentControl.ts`:
  - `DispatchPolicy = 'auto' | 'supervised' | 'manual'`
  - `ToolPolicy = 'auto' | 'supervised' | 'acceptEdits' | 'manual'`
  - `DispatchConfig`: `{ policy, autoDispatchTypes?, requireApprovalTypes? }`
  - `ToolPolicyConfig`: `{ policy, rules?: { allow?, ask?, deny? } }`
  - `AgentControlConfig`: `{ dispatch: DispatchConfig, tools: ToolPolicyConfig }`
  - `PRESETS`: autonomous, balanced, careful, locked-down
- [ ] Export from barrel `agent/types/index.ts`

**Exit:** Types compile

### Step 2: Approval Types + ApprovalSystem Core
**Deps:** Step 1

- [ ] Create `orchestrator/types/approvalTypes.ts` — `ApprovalRequest` (5 types: plan/replan/tool/artifact/task-dispatch), `ApprovalDecision`, `ApprovalPolicy`, `StickyDecision`
- [ ] Create `orchestrator/ApprovalSystem.ts`:
  - `shouldAutoDispatch(task, dispatchConfig)` — dispatch policy + task type filtering
  - `needsToolApproval(toolName, args, toolConfig, teamPolicy, sticky)` — tool policy + per-tool rules
  - `StickyDecisionStore` — per-goal in-memory store
  - `ApprovalPolicy` defaults: `{ destructiveTools: ['delete_file', 'run_command', ...], safeTools: ['read_file', ...] }`
- [ ] Add `agentControls?: Map<string, AgentControlConfig>` to `GoalContext` in `orchestrator/types.ts`

**Exit:** Both resolution functions return correct booleans for all policy × tool/task combinations

### Step 3: ChatAgent Dispatch Policy (Axis 1)
**Deps:** Steps 1-2

- [ ] Replace `private mode: 'auto' | 'review' | 'manual'` with `private dispatchConfig: DispatchConfig`
- [ ] Map old `review` → new `supervised`
- [ ] Rewrite `handleTask()` to use `shouldAutoDispatch(task, this.dispatchConfig)`:
  - If false → queue + emit task-dispatch approval request
  - If true → check concurrency → dispatch
- [ ] Add `setDispatchConfig(config: DispatchConfig)` setter
- [ ] Add `setToolPolicyConfig(config: ToolPolicyConfig)` setter (forwarded to worker)

**Exit:** ChatAgent dispatches tasks based on dispatch policy + task type filtering

### Step 4: AiSdkAgent Tool Policy (Axis 2)
**Deps:** Steps 1-2

- [ ] Add `toolPolicyConfig: ToolPolicyConfig | null` property to `AiSdkAgent`
- [ ] Add `wrapToolWithApproval(sdkTool, toolName)` — returns tool with policy-aware `needsApproval`
- [ ] Modify `setTools()`: when `toolPolicyConfig.policy !== 'auto'`, wrap each tool
- [ ] AI SDK handles the rest: `streamText()` returns `tool-approval-request` parts

**Exit:** In `supervised` tool policy, destructive tools trigger approval requests. In `auto`, nothing changes

### Step 5: WorkerPool Approval Handling
**Deps:** Step 4

- [ ] In `WorkerPool.runTask()` stream loop, detect `tool-approval-request` content parts
- [ ] Add `onApprovalRequest` to `WorkerCallbacks` interface
- [ ] `waitForApproval(approvalId)` — deferred promise in `Map<string, { resolve, reject }>`
- [ ] `resolveApproval(approvalId, decision)` — resolves the deferred
- [ ] When resolved: add `tool-approval-response` to messages, call `streamText()` again
- [ ] Pass `toolPolicyConfig` from GoalContext → AiSdkAgent via `runTask()`
- [ ] Handle timeout (auto-reject after configurable delay)

**Exit:** Tool approval requests flow from agent → WorkerPool → callback chain. Decisions flow back.

### Step 6: GoalManager + OrchestratorService Integration
**Deps:** Steps 3-5

- [ ] `GoalManager`: store `agentControls: Map<string, AgentControlConfig>` per GoalContext
- [ ] `GoalManager`: store `StickyDecisionStore` per goal, clear on goal done
- [ ] `OrchestratorService.setDispatchPolicy(goalId, agentId, policy)` → updates ChatAgent
- [ ] `OrchestratorService.setToolPolicy(goalId, agentId, policy)` → updates GoalContext
- [ ] Load `ApprovalPolicy` from plugin manifest `settings`

**Exit:** Policy changes persist per-goal per-agent, sticky decisions cleared on goal completion

### Step 7: Socket.IO Wiring
**Deps:** Step 6

- [ ] Extend `registerStreamCallbacks()` with `onApprovalRequest` callback → emit `approval:requested`
- [ ] Add `approval:decided` case to `handleAction()` → call `workerPool.resolveApproval()`
- [ ] Add `set-dispatch-policy` case → call `orchestrator.setDispatchPolicy()`
- [ ] Add `set-tool-policy` case → call `orchestrator.setToolPolicy()`
- [ ] ChatAgent task-dispatch approval: emit `approval:requested` with `type: 'task-dispatch'`

**Exit:** Full round-trip working in backend for both axes

### Step 8: Frontend Types + Components
**Deps:** Step 7

- [ ] Add `DispatchPolicy`, `ToolPolicy`, `ApprovalRequest`, `ApprovalDecision` to `frontend/types.ts`
- [ ] Add `approval-request` and `task-dispatch-request` to `StreamPart` union type
- [ ] `processStreamPart()` in `useChat.ts`: handle new part types → render cards
- [ ] Create `ApprovalCard.tsx`: shows tool name, args, approve/reject/always-approve buttons
- [ ] Create `TaskDispatchCard.tsx`: shows queued task with type badge, start/skip buttons
- [ ] Create `AgentPolicySelector.tsx`: two dropdowns (dispatch + tool), emits Socket.IO actions

**Exit:** Users can approve/reject tool calls, approve/skip queued tasks, switch both policies

### Step 9: Tests
**Deps:** Steps 1-8

- [ ] `shouldAutoDispatch()`: auto → true, manual → false, supervised + task type filters
- [ ] `needsToolApproval()`: auto → false, manual → true, supervised → destructive only, acceptEdits → file writes pass
- [ ] Per-tool rules: `allow` → false, `ask` → true, `deny` → blocked
- [ ] Sticky: "Always approve" → subsequent calls return false
- [ ] WorkerPool round-trip: tool triggers approval → deferred → resolve → continues
- [ ] ChatAgent dispatch: `decision` task type queued in supervised mode, `work` auto-dispatched
- [ ] Policy switch: runtime change updates GoalContext, affects next task/tool

**Exit:** All tests pass

---

## Complexity Estimate

| Step | Estimate | Notes |
|------|----------|-------|
| Step 1: Control types | 0.5 day | Types + presets |
| Step 2: Approval types + core | 1 day | Two resolution functions, sticky store |
| Step 3: ChatAgent dispatch | 0.5 day | Rewrite handleTask() with type filtering |
| Step 4: AiSdkAgent tool policy | 0.5 day | Leverages AI SDK native `needsApproval` |
| Step 5: WorkerPool handling | 1 day | Deferred promise pattern in stream loop |
| Step 6: GoalManager integration | 0.5 day | Extends existing GoalContext |
| Step 7: Socket.IO wiring | 0.5 day | Extends existing `handleAction()` |
| Step 8: Frontend components | 1.5 days | ApprovalCard, TaskDispatchCard, PolicySelector |
| Step 9: Tests | 1 day | Both axes + round-trip |

**Total: ~7 days**

---

## Integration Map — Exact Code Locations

### Current Execution Flow (no approvals)

```
User message
  → SocketServerV2.handleMessage()                    [backend/api/SocketServerV2.ts:1012]
  → AgentManagerV2.orchestratorMessage()               [agent-manager/src/AgentManagerV2.ts:539]
  → OrchestratorService.handleMessage()                [agent-manager/src/orchestrator/OrchestratorService.ts:279]
  → GoalManager.executePlannerTurn()                   [agent-manager/src/orchestrator/GoalManager.ts]
  → Planner calls submit_plan tool
  → submitPlan.ts AUTO-APPROVES: setState("executing") [agent-manager/src/orchestrator/tools/submitPlan.ts:108]
  → GoalManager.approvePlan() creates tasks            [agent-manager/src/orchestrator/GoalManager.ts:320]
  → DAG marks tasks "ready" → TaskStore fires event
  → GoalManager.onTaskReady() calls onDispatchTask     [agent-manager/src/orchestrator/GoalManager.ts:530]
  → AgentManagerV2 callback → directDispatchTask()     [agent-manager/src/AgentManagerV2.ts:309]
  → DispatchManager.directDispatch()                   [agent-manager/src/orchestrator/DispatchManager.ts:110]
  → OrchestratorService.dispatchTask()                 [agent-manager/src/orchestrator/OrchestratorService.ts:536]
  → WorkerPool.runTask()                               [agent-manager/src/services/WorkerPool.ts:215]
  → AiSdkAgent.execute() → executeToolMode()           [agent-manager/src/agent/internal/AiSdkAgent.ts:311]
  → streamText() → for await fullStream                [agent-manager/src/agent/internal/AiSdkAgent.ts:383-520]
  → WorkerPool forwards stream_part via onStream       [agent-manager/src/services/WorkerPool.ts:414]
  → SocketServerV2 emits "stream" to frontend          [backend/api/SocketServerV2.ts:600]
```

### What's Already Built vs What's New

| Component | File | Status | Change Needed |
|---|---|---|---|
| `awaiting_approval` state | `orchestrator/types.ts` | ✅ Exists | None — `OrchestratorState` already includes it |
| `handleAction("approve-plan")` | `backend/api/SocketServerV2.ts:1346` | ✅ Works | None — calls `manager.approveOrchestratorPlan()` |
| `GoalManager.approvePlan()` | `orchestrator/GoalManager.ts:320` | ✅ Works | None — creates tasks from pending plan |
| `ChatAgent.mode` property | `chatAgent/ChatAgent.ts:53` | ✅ Exists (`auto\|review\|manual`) | Replace type with `DispatchConfig` |
| `ChatAgent.handleTask()` | `chatAgent/ChatAgent.ts:339` | ⚠️ Only checks `manual` | Add `shouldAutoDispatch()` with task type filtering |
| `ChatAgent.queue` + `drainQueue()` | `chatAgent/ChatAgent.ts:56,376` | ✅ Exists | Reuse for dispatch-approval queuing |
| `submitPlan` auto-approve | `orchestrator/tools/submitPlan.ts:108` | ⚠️ Hardcoded | Add dispatch policy check (~5 lines) |
| `GoalManager.onTaskReady()` | `orchestrator/GoalManager.ts:530` | ⚠️ Always dispatches | Add `shouldAutoDispatch()` check (~10 lines) |
| `AiSdkAgent.setTools()` | `agent/internal/AiSdkAgent.ts:165` | ⚠️ No approval wrapping | Add `wrapToolWithApproval()` in `toAiSdkTool()` |
| `AiSdkAgent.executeToolMode()` | `agent/internal/AiSdkAgent.ts:311` | 🔴 Single streamText call | Multi-round approval loop (~40 lines) |
| `WorkerPool` stream loop | `services/WorkerPool.ts:414` | ⚠️ Forwards all parts | Add `approval_request` event handling |
| `ActionPayloadSchema` | `backend/api/SocketServerV2.ts:65` | ⚠️ Missing types | Add 3 new action types to enum |
| `WorkerCallbacks` interface | `services/WorkerPool.ts` | ⚠️ Missing callback | Add `onApprovalRequest` |
| `AgentControlConfig` storage | `orchestrator/types.ts` | 🔴 Doesn't exist | Add to `GoalContext` |
| Frontend approval components | — | 🔴 Don't exist | ApprovalCard, TaskDispatchCard, PolicySelector |

### Hook 1: Plan Approval — `submitPlan.ts:108`

The planner's `submit_plan` tool currently auto-approves. The `awaiting_approval` state and `approve-plan` action handler already exist.

```typescript
// CURRENT (submitPlan.ts line 108):
octx.setState("executing");
return `Plan submitted and approved with ${plan.tasks.length} task(s).`;

// CHANGE TO:
const agentControls = getAgentControlsForGoal(goalId);
const dispatchPolicy = agentControls?.dispatch?.policy ?? 'supervised';

if (dispatchPolicy === 'auto') {
  octx.setState("executing");
  return `Plan auto-approved with ${plan.tasks.length} task(s). Dispatching now.`;
} else {
  octx.setState("awaiting_approval");  // state already exists in OrchestratorState
  return `Plan submitted with ${plan.tasks.length} task(s). Waiting for user approval.`;
  // Frontend already shows "Approve Plan" button when state === "awaiting_approval"
  // User clicks → handleAction("approve-plan") → GoalManager.approvePlan() — already works
}
```

**Lines changed: ~5. No new infrastructure needed.**

### Hook 2: Task Dispatch — `GoalManager.onTaskReady():530`

Currently dispatches every ready task immediately. Add dispatch policy check before calling `onDispatchTask`.

```typescript
// CURRENT (GoalManager.ts line 524-533):
onTaskReady({ taskId, role }: { taskId: string; role: string }): void {
  log.info(`onTaskReady: ${taskId} (${role})`);
  this.callbacks.onTaskUpdate?.({ taskId, status: "ready", role, timestamp: Date.now() });
  this.callbacks.onDispatchTask(taskId, role);  // always dispatches
}

// CHANGE TO:
onTaskReady({ taskId, role }: { taskId: string; role: string }): void {
  log.info(`onTaskReady: ${taskId} (${role})`);
  const task = this.taskStore.get(taskId);
  const goal = this.getGoalForTask(taskId);
  const agentConfig = goal?.agentControls?.get(role);
  const dispatchConfig = agentConfig?.dispatch ?? { policy: 'supervised' as const };

  this.callbacks.onTaskUpdate?.({ taskId, status: "ready", role, timestamp: Date.now() });

  if (shouldAutoDispatch(task!, dispatchConfig)) {
    this.callbacks.onDispatchTask(taskId, role);
  } else {
    // Task stays "ready" but is NOT dispatched — frontend shows TaskDispatchCard
    log.info(`Task ${taskId} queued for dispatch approval (policy: ${dispatchConfig.policy}, type: ${task?.type})`);
    this.callbacks.onTaskUpdate?.({
      taskId, status: "ready", role, timestamp: Date.now(),
      // Frontend will render TaskDispatchCard for this task
    });
  }
}
// User approves → handleAction("approve-dispatch") → calls onDispatchTask(taskId, role)
```

**Lines changed: ~10. Existing `onDispatchTask` callback reused.**

### Hook 3: Tool Approval — `AiSdkAgent.executeToolMode():311`

This is the biggest change. Currently a single `streamText()` call. With approvals, it becomes a multi-round loop because AI SDK v6's `needsApproval` changes `result.content` to include `tool-approval-request` parts.

**Two sub-changes:**

**3a. Tool wrapping in `setTools()` / `toAiSdkTool()` (line 165-220):**

```typescript
// In setTools() — wrap each tool with policy-aware needsApproval
async setTools(tools: any[]): Promise<void> {
  this.loadedTools = {};
  for (const t of tools) {
    const name: string = t.name || t._name || "unknown";
    let sdkTool = this.toAiSdkTool(t);
    
    // NEW: wrap with approval if tool policy is not 'auto'
    if (this.toolPolicyConfig && this.toolPolicyConfig.policy !== 'auto') {
      sdkTool = this.wrapToolWithApproval(sdkTool, name);
    }
    
    this.loadedTools[name] = sdkTool;
  }
}

// NEW method:
private wrapToolWithApproval(sdkTool: any, toolName: string): any {
  const config = this.toolPolicyConfig!;
  const teamPolicy = this.approvalPolicy;
  const sticky = this.stickyDecisions;
  
  return { ...sdkTool, needsApproval: async (args: any) =>
    needsToolApproval(toolName, args, config, teamPolicy, sticky)
  };
}
```

**3b. Approval loop in `executeToolMode()` (line 311-520):**

```typescript
// CURRENT: single streamText() + for-await over fullStream
// CHANGE: outer loop that handles approval round-trips

private async *executeToolMode(input: AgentInput): AsyncGenerator<AgentEvent> {
  let messages = this.buildMessages();
  
  while (true) {  // ← NEW: approval retry loop
    const result = streamText({
      model: this.model,
      messages,
      tools: this.loadedTools,
      stopWhen: [...stopConditions],
      // ... existing config
    });

    // Existing stream forwarding (unchanged)
    for await (const part of result.fullStream) {
      // ... yield stream_part events (existing code, lines 383-520)
    }

    // NEW: after stream ends, check for approval requests
    const content = await result.response;
    const approvalParts = content.messages
      .flatMap(m => m.content)
      .filter(p => p.type === 'tool-approval-request');

    if (approvalParts.length === 0) break;  // no approvals needed → done

    // Yield approval events for WorkerPool to catch
    for (const req of approvalParts) {
      yield {
        type: "approval_request" as const,
        approvalId: req.approvalId,
        toolName: req.toolCall.toolName,
        args: req.toolCall.input,
      };
    }

    // Wait for decisions (resolved by WorkerPool via deferred promises)
    const decisions = await this.waitForApprovalDecisions(approvalParts);

    // Add response messages + approval responses, loop again
    messages = [...messages, ...content.messages, {
      role: 'tool' as const,
      content: decisions.map(d => ({
        type: 'tool-approval-response' as const,
        approvalId: d.approvalId,
        approved: d.approved,
        reason: d.reason,
      })),
    }];
  }  // loops back to streamText() with approval responses

  yield this.doneEvent(/* ... */);
}
```

**Lines changed: ~40 new, existing stream forwarding untouched.**

### Hook 4: WorkerPool Stream Handling — `WorkerPool.runTask():414`

Add detection for the new `approval_request` event type from AiSdkAgent.

```typescript
// CURRENT (WorkerPool.ts line 411-450):
for await (const event of agent.execute(input)) {
  if (event.type === "stream_part") {
    this.callbacks.onStream?.({ taskId, agentId: roleKey, part: event.part, goalId: taskGoalId });
    // ... existing Channel B synthesis
    continue;
  }
  // ... existing done/error handling
}

// ADD after stream_part check:
if (event.type === "approval_request") {
  // Emit to SocketServerV2 via callback
  this.callbacks.onApprovalRequest?.({
    taskId,
    agentId: roleKey,
    goalId: taskGoalId,
    approvalId: event.approvalId,
    toolName: event.toolName,
    args: event.args,
  });
  // Agent is paused internally (waitForApprovalDecisions)
  // Decision flows back via resolveApproval() → resolves the deferred promise in AiSdkAgent
  continue;
}
```

**Lines changed: ~10. Follows existing callback pattern.**

### Hook 5: Socket.IO Actions — `SocketServerV2.handleAction():1323`

Add 3 new cases to the existing `switch(type)` and extend `ActionPayloadSchema`.

```typescript
// ActionPayloadSchema (line 65) — add to enum:
type: z.enum([
  "approve-plan", "start-task", "complete-task", "cancel-task",
  "modify-task", "auto-execute", "get-state",
  "approve-dispatch",     // NEW: user approves a queued task
  "approval:decided",     // NEW: user approves/rejects a tool call  
  "set-dispatch-policy",  // NEW: user changes dispatch policy
  "set-tool-policy",      // NEW: user changes tool policy
]),

// handleAction() switch (line 1346) — add cases:
case "approve-dispatch":
  // User approved a queued task → dispatch it
  const orchestrator = manager.getOrchestratorService();
  await orchestrator.directDispatchTask(data.taskId, data.role);
  break;

case "approval:decided":
  // User approved/rejected a tool call → resolve deferred promise
  const workerPool = manager.getWorkerPool();
  workerPool.resolveApproval(data.approvalId, {
    approved: data.decision === 'approved',
    reason: data.reason,
    sticky: data.sticky ?? false,
  });
  break;

case "set-dispatch-policy":
case "set-tool-policy":
  const orch = manager.getOrchestratorService();
  orch.setAgentPolicy(data.agentId, actionGoalId, data.policyType, data.policyValue);
  break;
```

**Lines changed: ~20. Follows existing switch/case pattern.**

### Communication Pattern: AiSdkAgent ↔ WorkerPool

The trickiest engineering is the deferred promise pattern between AiSdkAgent (which yields approval events and pauses) and WorkerPool (which receives decisions from Socket.IO and resolves them).

```
AiSdkAgent                         WorkerPool                      SocketServerV2
    │                                  │                                │
    │ yield approval_request ──────────→                                │
    │                                  │ callbacks.onApprovalRequest ──→│
    │                                  │                                │ emit "approval:requested"
    │                                  │                                │      → Frontend
    │                                  │                                │
    │    (agent paused — awaiting       │                                │ ← user clicks Approve
    │     deferred promise)             │                                │
    │                                  │ ←─── handleAction("approval:decided")
    │                                  │ resolveApproval(id, decision)   │
    │ ←── deferred promise resolved    │                                │
    │                                  │                                │
    │ adds tool-approval-response      │                                │
    │ calls streamText() again ────────→                                │
    │ yield stream_part events ────────→ callbacks.onStream ───────────→│
    │                                  │                                │ emit "stream"
```

**Implementation:**
```typescript
// In AiSdkAgent:
private pendingApprovals = new Map<string, { resolve: (decision: any) => void }>();

async waitForApprovalDecisions(requests: any[]): Promise<any[]> {
  return Promise.all(requests.map(req => new Promise(resolve => {
    this.pendingApprovals.set(req.approvalId, { resolve });
  })));
}

resolveApproval(approvalId: string, decision: any): void {
  this.pendingApprovals.get(approvalId)?.resolve(decision);
  this.pendingApprovals.delete(approvalId);
}

// In WorkerPool:
resolveApproval(approvalId: string, decision: any): void {
  // Find the agent that has this pending approval
  for (const [taskId, agent] of this.workers) {
    if (agent.hasPendingApproval(approvalId)) {
      agent.resolveApproval(approvalId, decision);
      return;
    }
  }
}
```
