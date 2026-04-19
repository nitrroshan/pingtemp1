# Inter-Agent Collaboration — Implementation Planning

**Architecture:** [collaboration-audit.md](collaboration-audit.md)  
**Parent:** [Collaboration Toolkit](../collaboration-toolkit/feature_architecture.md)

---

## Branch
`feature/inter-agent-collab`

## Scope
Enable real-time agent-to-agent collaboration via the discuss-as-priority-interrupt model. Agent-1 posts a question with @mention → system spawns agent-2 immediately → both discuss on CRDT → agent-1 gets response in the same execution loop.

---

## Current State (What Exists vs What's Broken)

### Backend — Working
- `discuss post/read/decide` handler in `packages/collaboration/src/L2/tools/index.ts:663-780` ✅
- Guard rails (maxRounds, maxTokens, status) ✅  
- Y.Array push + cursor tracking ✅
- `HocuspocusServer.emitDiscussionChange` → Socket.IO `discussion:activity`/`discussion:mention` ✅
- `initCollabDocs()` initializes Y.Array, Y.Map(decisions/config/cursors) ✅

### Backend — Broken/Missing
- `createCollabTool()` receives NO callbacks — mentions parsed but isolated (line 303)
- `WorkerCallbacks` has no `onMentionedRoles` callback
- No `waitForResponse` — discuss post returns immediately, agent can't wait
- No `runCollaborationWorker()` method on WorkerPool
- No collaboration-specific prompt for `type: "collaboration"` tasks in `dispatchTask()`
- `task.context.type` not set in `approvePlan()` path

### Frontend — Working
- `useDiscussion` hook creates HocuspocusProvider, subscribes Y.Array/Y.Map ✅
- `DiscussionThread` component renders blocks with role badges, decisions ✅
- `DiscussionComposer` with @mention autocomplete, type selector ✅
- `DecisionPanel` renders Y.Map decisions ✅
- `DetailPanel` has "Discussions" tab with `DiscussionListPanel` ✅
- `Sidebar` has "Discussions" nav item ✅
- `App.tsx` has `ActiveDiscussionView`, `discussionThreads` state, Socket.IO listener ✅

### Frontend — Broken/Missing
- Hocuspocus URL hardcoded to `ws://localhost:1234` — works if collab server is running on same host
- No sidebar badge for unread discussion count
- `discussionThreads` stays empty because no agents create collaboration tasks
- No `VITE_HOCUSPOCUS_URL` env var for configurable WebSocket URL

---

## Implementation Steps

### Step 1: Add `onMentionedRoles` callback to collab tool chain

**Files to modify:**
- `packages/collaboration/src/L2/tools/index.ts` — add callback param to `createCollabTool()`
- `packages/backend/agentManager/plugins/CollaborationPlugin.ts` — pass callback through `CollabMcpServer`
- `packages/agent-manager/src/services/WorkerPool.ts` — add `onMentionedRoles` to `WorkerCallbacks`

**What changes:**

```typescript
// 1. Extend createCollabTool signature:
export function createCollabTool(
  space: CollaborationSpace,
  agentRole: string,
  l2: IL2CollaborationPlugin,
  repoPath: string,
  callbacks?: {
    onMentionedRoles?: (roles: string[], sourceTaskId: string, docName: string) => void;
  },
)

// 2. In discuss post handler, after pushing block:
if (block.mentions.length > 0) {
  callbacks?.onMentionedRoles?.(block.mentions, taskId, docName);
}

// 3. CollabMcpServer stores and passes callback:
class CollabMcpServer {
  private onMentionedRoles?: (...) => void;
  setOnMentionedRoles(cb) { this.onMentionedRoles = cb; }
  getTools(context) {
    return [createCollabTool(space, context.role, this.l2, this.repoPath, {
      onMentionedRoles: this.onMentionedRoles,
    })];
  }
}

// 4. WorkerCallbacks gets new field:
onMentionedRoles?: (data: { roles: string[]; sourceTaskId: string; docName: string }) => void;
```

**Challenge:** The `taskId` is not available inside the collab tool — it only knows `agentRole`. Need to pass `taskId` via `ToolContext` when creating the tool.

**Depends on:** Nothing  
**Effort:** 0.5 day

---

### Step 2: `waitForResponse` in discuss post tool

**Files to modify:**
- `packages/collaboration/src/L2/tools/index.ts` — discuss post handler

**What changes:**

In the discuss post handler (after pushing block to Y.Array), if `waitForResponse: true` AND mentions exist:

```typescript
// After block push and callback fire:
if (parsed.waitForResponse && block.mentions.length > 0) {
  // Fire mention routing first
  callbacks?.onMentionedRoles?.(block.mentions, taskId, docName);
  
  // Now poll Y.Array for response
  const TIMEOUT = 120_000; // 2 minutes
  const POLL_INTERVAL = 3_000; // 3 seconds
  const startTime = Date.now();
  
  while (Date.now() - startTime < TIMEOUT) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    
    // Read new blocks since our post
    const allBlocks = discussion.toJSON();
    const newBlocks = allBlocks.filter((b: any) => 
      b.timestamp > block.timestamp && 
      b.role !== agentRole
    );
    
    // Check if any response from mentioned roles or user
    const response = newBlocks.find((b: any) => 
      block.mentions.includes(b.role) || b.role.startsWith("user:")
    );
    
    if (response) {
      // Update cursor
      cursors.set(agentRole, new Date().toISOString());
      // Return formatted response to agent's LLM
      return `Response from ${response.role}: ${response.content}`;
    }
  }
  
  return `No response within ${TIMEOUT/1000}s timeout. The mentioned role may not be available. Use request_task to create a formal task instead.`;
}
```

**Input schema change:** Add `waitForResponse: boolean` to the discuss post value schema. Update SKILL.md docs.

**Depends on:** Step 1 (callback wiring)  
**Effort:** 1 day

---

### Step 3: Spawn collaboration worker via existing `runTask()`

**Files to modify:**
- `packages/agent-manager/src/services/WorkerPool.ts` — add `hasActiveWorker()` helper only

**What changes:**

No new method needed. Use the existing `runTask(taskId, role, message)` overload to spawn a collab worker. The role already has a YAML definition registered — same agent, different message.

```typescript
// In the onMentionedRoles handler (OrchestratorService or WorkerPool callback):
const collabWorkerId = `collab-${docName.replace(/\//g, "-")}-${role}`;

// Skip if already alive
if (workerPool.hasActiveWorker(collabWorkerId)) return;

// Use existing runTask — same YAML definition, same tools, different prompt
const collabMessage = 
  `You were mentioned in a discussion by ${sourceRole}.\n\n` +
  `Discussion doc: ${docName}\n\n` +
  `1. Read the discussion: \`collab discuss read\`\n` +
  `2. Contribute your expertise: \`collab discuss post\`\n` +
  `3. If a decision is needed, record it: \`collab discuss decide\`\n` +
  `4. When done, call \`complete_task\` with a brief summary.\n\n` +
  `Keep it brief — this is alignment, not work.`;

workerPool.runTask(collabWorkerId, role, collabMessage)
  .catch(err => logger.error(`Collab worker ${collabWorkerId} error: ${err}`))
  .finally(() => workerPool.dispose(collabWorkerId));
```

**Only new code needed:**

```typescript
// WorkerPool — simple check if a worker exists
hasActiveWorker(taskIdOrRole: string): boolean {
  return this.workers.has(taskIdOrRole);
}
```

**Why not a separate method:**
- `runTask(taskId, role, message)` already handles agent creation from YAML definitions, tool injection (including collab tools via PluginRegistry), SKILL.md injection, and execution
- The collab worker gets ALL tools (workspace included) — same as any worker. The agent just won't use workspace tools because the prompt says "discuss only"
- When Chat Agents arrive, this `runTask` call changes to "wake Chat Agent" — one line

**Key design decisions:**
- Worker key is `collab-{docName}-{role}` — unique per discussion per role
- Runs async (fire-and-forget) — the calling agent's `waitForResponse` polls for the response
- Auto-disposes in `.finally()` after execution ends
- Gets full tool set from PluginRegistry — no special handling needed

**Depends on:** Step 1 (callbacks)  
**Effort:** 1 day

---

### Step 4: Wire `onMentionedRoles` in OrchestratorService

**Files to modify:**
- `packages/agent-manager/src/orchestrator/OrchestratorService.ts` — `initialize()`
- `packages/backend/agentManager/plugins/CollaborationPlugin.ts` — wire callback

**What changes:**

In `OrchestratorService.initialize()`, add to `workerPool.setCallbacks()`:

```typescript
onMentionedRoles: (data) => {
  log.info(`Mention routing: ${data.roles.join(", ")} mentioned in ${data.docName}`);
  for (const role of data.roles) {
    const collabWorkerId = `collab-${data.docName.replace(/\//g, "-")}-${role}`;
    if (this.workerPool.hasActiveWorker(collabWorkerId)) continue;

    const collabMessage = 
      `You were mentioned in a discussion.\n\n` +
      `Discussion doc: ${data.docName}\n\n` +
      `1. Read the discussion: \`collab discuss read\`\n` +
      `2. Contribute your expertise: \`collab discuss post\`\n` +
      `3. If a decision is needed: \`collab discuss decide\`\n` +
      `4. When done: \`complete_task\`\n\n` +
      `Keep it brief — this is alignment, not work.`;

    // Fire-and-forget — waitForResponse polls for the result
    this.workerPool.runTask(collabWorkerId, role, collabMessage)
      .catch(err => log.error(`Collab worker ${collabWorkerId} error: ${err}`))
      .finally(() => this.workerPool.dispose(collabWorkerId));
  }
},
```

**Depends on:** Step 1  
**Effort:** 0.5 day

---

### Step 5: Collaboration prompt for `type: "collaboration"` tasks

**Files to modify:**
- `packages/agent-manager/src/orchestrator/OrchestratorService.ts` — `dispatchTask()`

**What changes:**

In `dispatchTask()`, after the CRDT refs section, add:

```typescript
const taskType = (task.context as any)?.type;
if (taskType === "collaboration") {
  enrichedDescription += `\n\n## ⚡ This is a Collaboration Task`;
  enrichedDescription += `\nAnother agent invited you to align on a decision.`;
  enrichedDescription += `\n1. Read the discussion: \`collab discuss read\``;
  enrichedDescription += `\n2. Post your expertise: \`collab discuss post\``;
  enrichedDescription += `\n3. Record the decision: \`collab discuss decide\``;
  enrichedDescription += `\n4. Complete immediately: \`complete_task\` with the decision summary`;
  enrichedDescription += `\nKeep it brief — this is alignment, not work.`;
}
```

**Depends on:** Nothing  
**Effort:** 0.5 day

---

### Step 6: Task type flow-through in approvePlan

**Files to modify:**
- `packages/agent-manager/src/orchestrator/OrchestratorService.ts` — `approvePlan()`

**What changes:**

In `approvePlan()`, when creating tasks, ensure `type` flows into context:

```typescript
context: {
  ...existingContext,
  type: task.type || (task as any).taskType || "work",
}
```

**Depends on:** Nothing  
**Effort:** 0.25 day

---

### Step 7: Frontend — Hocuspocus URL config + sidebar badge

**Files to modify:**
- `packages/frontend/hooks/useDiscussion.ts` — configurable URL
- `packages/frontend/components/Sidebar.tsx` — unread badge

**What changes:**

```typescript
// useDiscussion.ts — use env var with fallback
const defaultUrl = import.meta.env.VITE_HOCUSPOCUS_URL || "ws://localhost:1234";

// Sidebar.tsx — add badge
const { unreadCount } = useDiscussionNotifications(activeTeamId);
// In nav item render:
{item.id === 'discussions' && unreadCount > 0 && (
  <span className="...">{unreadCount}</span>
)}
```

**Depends on:** Nothing  
**Effort:** 0.5 day

---

### Step 8: Update SKILL.md with `waitForResponse` docs

**Files to modify:**
- `packages/agent-manager/skills/task-lifecycle/SKILL.md`

**What changes:**

Add to the "Inside a Collaboration Task" section:

```markdown
### Asking Another Role a Question (Real-Time)

When you need input from another role and want to wait for their response:

```
collab discuss post({
  content: "What schema format does the UI need? @frontend-dev",
  mentions: ["frontend-dev"],
  waitForResponse: true
})
```

This will:
1. Post your question to the discussion
2. Notify the mentioned role (they'll be brought online immediately)
3. WAIT for their response (up to 2 minutes)
4. Return their response text so you can process it

Use this when you need a quick answer to continue your work.
Don't use this for complex tasks — use `request_task` instead.
```

**Depends on:** Step 2  
**Effort:** 0.25 day

---

## Step Dependencies

```
Step 1 (callback wiring) ──→ Step 2 (waitForResponse)
                          ──→ Step 3 (collab worker via runTask)
                          ──→ Step 4 (OrchestratorService wiring)

Step 5 (collab prompt)    ──→ independent
Step 6 (type flow)        ──→ independent
Step 7 (frontend)         ──→ independent
Step 8 (SKILL.md)         ──→ Step 2
Steps 9-13 (CRDT fixes)  ──→ independent (can be done in parallel)
```

**Critical path:** Step 1 → Step 2 + Step 3 (parallel) → Step 4

---

## CRDT Bug Fixes (from crdt-audit.md — verified against code)

### Step 9: BUG-2 — maxTokens doesn't actually close discussion (0.25 day)

**File:** `packages/collaboration/src/L2/tools/index.ts` ~line 676

**What's wrong:** Returns "Discussion auto-closed" but never sets `configMap.set("status", "closed")`. Next post succeeds because status is still "active".

**Fix:**
```typescript
if (totalTokens >= maxTokens) {
  configMap.set("status", "closed");  // ← ADD THIS
  return `Token limit reached (${totalTokens}/${maxTokens}). Discussion closed.`;
}
```

### Step 10: BUG-1 — Plan CRDT never updated after archival/completion (0.5 day)

**Files:** 
- `packages/collaboration/src/L2/collaboration/CrdtTaskSync.ts` — add `syncPlanStatus()` method
- `packages/agent-manager/src/orchestrator/OrchestratorService.ts` — call it from `resetPlan()`, `interruptPlan()`, and `onTaskComplete()` when all tasks done

**What's wrong:** `persistPlan()` is called once in `approvePlan()`. Plan status never synced to CRDT again. Agents reading `collab read plan` see stale "executing" status forever.

**Fix:**
```typescript
// CrdtTaskSync — new method:
async syncPlanStatus(status: string): Promise<void> {
  const doc = await this._space.openDoc("plan");
  const map = doc.getMap("plan");
  map.set("status", status);
  map.set("updatedAt", new Date().toISOString());
}

// OrchestratorService.resetPlan() — add:
const crdtSync = this.crdtTaskSyncProxy?.get?.();
if (crdtSync) await crdtSync.syncPlanStatus("interrupted");

// OrchestratorService.onTaskComplete() — when all done, add:
if (crdtSync) await crdtSync.syncPlanStatus("completed");
```

### Step 11: ANTIPATTERN-5 — Remove frontend polling alongside Y.js events (0.25 day)

**File:** `packages/frontend/components/CollaborativeEditor.tsx` ~line 287

**What's wrong:** `setInterval(updateMapData, 2000)` runs alongside `doc.on("update")` — same function called by 3 triggers (redundant polling).

**Fix:** Remove the `setInterval`. Keep `doc.on("update")` and `provider.on("synced")`.

### Step 12: UNDERUTIL-1 — Auto-populate agent-statuses CRDT (0.5 day)

**Files:**
- `packages/agent-manager/src/orchestrator/OrchestratorService.ts` — `onTaskReady`, `onWorkerDone`, `onTaskFailed`

**What's wrong:** `agent-statuses` CRDT doc exists, agents are told to use it, but backend never writes to it. It's empty.

**Fix:** Write agent status on lifecycle events:
```typescript
// In onTaskReady (after dispatch):
const crdtSync = this.crdtTaskSyncProxy?.get?.();
if (crdtSync) {
  const statusDoc = await crdtSync.getSpace().openDoc("agent-statuses");
  statusDoc.getMap("agent-statuses").set(role, { 
    status: "busy", task: taskId, since: new Date().toISOString() 
  });
}

// In onWorkerDone:
statusDoc.getMap("agent-statuses").set(role, { 
  status: "idle", lastTask: taskId, since: new Date().toISOString() 
});
```

### Step 13: BUG-3 — timeoutMinutes check-on-access enforcement (0.25 day)

**File:** `packages/collaboration/src/L2/tools/index.ts` — discuss post/read handlers

**What's wrong:** `timeoutMinutes` is written to config but never read. Stalled discussions never auto-close.

**Fix:** Check-on-access pattern (simpler than background timer):
```typescript
// At the start of discuss post handler, after reading config:
const lastActivity = config.lastActivity ? new Date(config.lastActivity).getTime() : Date.now();
const timeoutMs = (config.timeoutMinutes || 15) * 60 * 1000;
if (Date.now() - lastActivity > timeoutMs && config.status === "active") {
  configMap.set("status", "escalated");
  return `Discussion timed out (no activity for ${config.timeoutMinutes}min). Status: escalated. Notify planner.`;
}
```

---

## Testing Strategy

1. **Unit:** `waitForResponse` polling logic — mock Y.Array, verify timeout and response detection
2. **Integration:** Agent-1 calls discuss post(waitForResponse) → system spawns agent-2 → agent-2 responds → agent-1 receives response
3. **Frontend:** Verify Hocuspocus connection → discussion blocks appear → DiscussionComposer works
4. **CRDT bugs:** maxTokens closes discussion, plan status syncs, timeout escalates

---

## Total Effort

| Step | Effort | Depends on |
|------|--------|-----------|
| 1. Callback wiring | 0.5 day | — |
| 2. waitForResponse | 1 day | Step 1 |
| 3. Collab worker via runTask | 0.25 day | Step 1 |
| 4. OrchestratorService wiring | 0.5 day | Step 1 |
| 5. Collaboration prompt | 0.5 day | — |
| 6. Type flow-through | 0.25 day | — |
| 7. Frontend fixes | 0.5 day | — |
| 8. SKILL.md update | 0.25 day | Step 2 |
| **Subtotal (collab)** | **3.75 days** | |
| 9. BUG-2: maxTokens close | 0.25 day | — |
| 10. BUG-1: Plan CRDT sync | 0.5 day | — |
| 11. Frontend polling removal | 0.25 day | — |
| 12. agent-statuses auto-populate | 0.5 day | — |
| 13. BUG-3: timeout enforcement | 0.25 day | — |
| **Subtotal (CRDT fixes)** | **1.75 days** | |
| **Grand Total** | **5.5 days** | |
