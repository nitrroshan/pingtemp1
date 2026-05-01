# Server-Generated GoalId — Implementation Plan

> **Architecture:** [Option A — Server UUID via `goal:created`](./feature_architecture.md)
> **Branch:** `user/nitrroshan/fixplans` (current)
> **Scope:** Fix Issue 26 (duplicate goals collide) by making server the sole goalId generator

## Critical Constraint

**The first user message MUST be saved with the correct goalId.** Currently the backend saves the user message *before* resolving goalId. With server-generated UUIDs, we must ensure the user message is saved *with* the resolved goalId — not `undefined`.

## Current Flow (broken for duplicates)

```
Frontend:
  1. goalId = toGoalId(goal)           ← deterministic, collides
  2. savePlan(teamId, {goalId, ...})
  3. addMessage(chatKey, userMsg)       ← local Zustand store
  4. sendToManager(goal, goalId)        ← sends goalId to backend

Backend (SocketServerV2.handleMessage):
  5. Save user message to MongoDB with clientGoalId    ← uses client goalId
  6. handleOrchestratorMessage(content, clientGoalId)
  7. resolvedGoalId = clientGoalId || crypto.randomUUID()
  8. socket.emit("goal:created", {goalId: resolvedGoalId})
```

## Target Flow

```
Frontend:
  1. Show loading state on submit button
  2. sendToManager(goal)                ← NO goalId
  3. Wait for goal:created {goalId}     ← server returns UUID
  4. planId = makePlanId(teamId, goal, Date.now())
  5. savePlan(teamId, {goalId, planId, ...})
  6. addMessage(chatKey, userMsg)        ← correct chatKey from server goalId
  7. subscribeToGoal(teamId, goalId)
  8. pushRoute(/teams/.../p/planId)

Backend (SocketServerV2.handleMessage):
  1. handleOrchestratorMessage(content)  ← resolve goalId FIRST
  2. resolvedGoalId = crypto.randomUUID()
  3. Save user message to MongoDB with resolvedGoalId   ← correct goalId
  4. socket.emit("goal:created", {goalId: resolvedGoalId})
```

## Implementation Steps

### Step 1: Backend — Move user message save after goalId resolution

**File:** `packages/backend/api/SocketServerV2.ts`

Currently user message is saved at L964 *before* `handleOrchestratorMessage`. For orchestrator messages (`agentId === "manager"`), defer the save until after goalId is resolved.

```
BEFORE:
  saveUserMessage(clientGoalId)     // L964 — goalId could be undefined
  handleOrchestratorMessage(...)    // L988 — resolves goalId
  emit("goal:created", {goalId})   // L1056

AFTER:
  // For orchestrator messages: DON'T save here, let handleOrchestratorMessage save it
  if (agentId !== "manager" && agentId !== "orchestrator") {
    saveUserMessage(clientGoalId);
  }
  handleOrchestratorMessage(...)    // saves user message with resolved goalId
  emit("goal:created", {goalId})
```

Inside `handleOrchestratorMessage`, save user message after `orchestratorMessage()` returns `resolvedGoalId`:

```ts
const result = await manager.orchestratorMessage(content, goalId, repoUrl, repoBranch);
const resolvedGoalId = result.goalId;

// Save user message with server-resolved goalId
if (this.services) {
  this.services.chat.addMessage({
    teamId, userId: connection.userId, role: "user",
    agentId: "manager", goalId: resolvedGoalId,
    content, agentLayer: "planner",
    timestamp: new Date().toISOString(),
  }).catch(err => logger.warn("Failed to save user message:", err));
}

socket.emit("goal:created", { goalId: resolvedGoalId });
```

**Exit criteria:** User message always saved with resolved goalId in MongoDB. `getGoalMessages(teamId, goalId)` returns the user's first message.

---

### Step 2: Frontend — Add `sendToManagerAsync()` to AgentServiceV2

**File:** `packages/frontend/services/AgentServiceV2.ts`

Add a method that sends the message and returns a Promise resolving with the server goalId:

```ts
sendToManagerAsync(
  content: string,
  repoUrl?: string,
  repoBranch?: string,
  timeout = 10000,
): Promise<{ goalId: string }> {
  return new Promise((resolve, reject) => {
    if (!this.isReady()) {
      return reject(new Error("Not connected"));
    }

    const timer = setTimeout(() => {
      unsub();
      reject(new Error("Timeout waiting for goal:created"));
    }, timeout);

    const unsub = this.onGoalCreated((data) => {
      clearTimeout(timer);
      unsub();
      resolve(data);
    });

    this.socket!.emit("message", {
      teamId: this.teamId,
      agentId: "manager",
      sessionId: this.sessionId,
      content,
      // NO goalId — server generates it
      repoUrl,
      repoBranch,
    });
  });
}
```

**Exit criteria:** `sendToManagerAsync("Build a REST API")` returns `{ goalId: "a1b2c3d4-..." }` within ~100ms.

---

### Step 3: Frontend — Update `handleGoalScreenSubmit` and `handleGoalSubmit`

**File:** `packages/frontend/App.tsx`

Replace `toGoalId(goal)` with `await sendToManagerAsync(...)`:

```ts
const handleGoalScreenSubmit = useCallback(async (teamId, goal, repoUrl?, repoBranch?) => {
  if (selectedTeamId !== teamId) setSelectedTeamId(teamId);

  if (!agentServiceV2.isConnected()) {
    try { await agentServiceV2.connect(teamId); }
    catch (err) { showToast(`Connection failed: ${err.message}`, 'error'); return; }
  }

  // Server generates goalId — wait for it
  let serverGoalId: string;
  try {
    const result = await agentServiceV2.sendToManagerAsync(goal, repoUrl, repoBranch);
    serverGoalId = result.goalId;
  } catch (err: any) {
    showToast(`Failed to send goal: ${err.message}`, 'error');
    return;
  }

  const planId = makePlanId(teamId, goal, Date.now());
  savePlan(teamId, { planId, goal, goalId: serverGoalId, createdAt: Date.now(), status: 'active' });
  addMessage(`${teamId}:goal:${serverGoalId}`, {
    id: uuidv4(), role: 'user', content: goal, timestamp: Date.now(),
  });
  setActivePlanId(planId);
  pushRoute(`/teams/${encodeURIComponent(teamId)}/p/${encodeURIComponent(planId)}`);
}, [...]);
```

Same pattern for `handleGoalSubmit`.

**Exit criteria:** User message is stored under the server-generated goalId. Two identical prompts produce two different goalIds.

---

### Step 4: Frontend — Remove `toGoalId` from goal submission paths

**File:** `packages/frontend/lib/planId.ts`

Keep `toGoalId()` but mark as deprecated / display-only. Remove all imports from `App.tsx` goal submission paths. The function is still used by `makePlanId` display logic — leave it for now.

**File:** `packages/frontend/App.tsx`

Remove `import { toGoalId }` if no longer used after Step 3.

**Exit criteria:** No call to `toGoalId()` in any goal submission path. `toGoalId` only used for display slugs (if at all).

---

### Step 5: Verify `restoreFromServer` works with new goalIds

**File:** `packages/frontend/stores/chatStore.ts`

`restoreFromServer` calls `getGoalMessages(teamId, goalId)`. Since goalId is now a UUID stored in the plan, and user messages are saved with that UUID on the backend, restore should work.

Verify the plan's `goalId` field (in sessionStorage and backend) matches what was saved in MongoDB.

**Exit criteria:** Refresh page → chat history restored correctly for server-generated goalIds.

---

## Files Changed

| File | Layer | Change |
|------|-------|--------|
| `packages/backend/api/SocketServerV2.ts` | Backend | Defer user message save for orchestrator messages; save with resolved goalId |
| `packages/frontend/services/AgentServiceV2.ts` | Frontend | Add `sendToManagerAsync()` returning Promise with goalId |
| `packages/frontend/App.tsx` | Frontend | `handleGoalSubmit` + `handleGoalScreenSubmit` await server goalId |
| `packages/frontend/lib/planId.ts` | Frontend | Deprecate `toGoalId()` (optional removal) |

## Testing Strategy

1. **New goal submission** — Submit a goal, verify MongoDB has user message with UUID goalId
2. **Duplicate prompts** — Submit same text twice, verify different goalIds, separate chats
3. **Page refresh** — Submit goal, refresh, verify chat restores with correct messages
4. **Stream isolation** — Submit two goals, verify stream events go to correct chat only
5. **Plan list** — Both goals appear as separate plans in sidebar, clicking shows separate chats
6. **Disconnection** — If socket drops during submission, verify error toast (not silent failure)

## Rollback

If issues arise, revert to `toGoalId()` with timestamp suffix (Option C from architecture doc) — one-line change in `lib/planId.ts`. No backend changes needed for rollback since backend already accepts client-provided goalId.
