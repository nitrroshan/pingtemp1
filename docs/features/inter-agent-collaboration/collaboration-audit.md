# Collaboration System — Audit & Gap Analysis

**Date:** April 17, 2026  
**Scope:** Full audit of discussion/collaboration features: what works, what doesn't, what to fix/remove/add

---

## How It SHOULD Work (Target Architecture)

### The 3-Layer Model (from MASTER-ARCHITECTURE)

```
L1: Planner (persistent, one per team)
    → decomposes goals into tasks

L2: Chat Agent (PERSISTENT, one per role — ALWAYS ALIVE)
    → owns the role's conversation, memory, and collaboration
    → spawns/manages L3 workers for actual task execution
    → handles collaboration with other Chat Agents directly

L3: Worker (transient, one per task — thread of Chat Agent)
    → executes specific task work (code, content, research)
    → dies after task completion
    → escalates to Chat Agent when it needs collaboration
```

### Collaboration Flow (Target)

```
1. Worker (task-1, backend role) discovers it needs frontend input:
   → Escalates to its Chat Agent: "I need to align on schema format"
   → Worker CONTINUES working on non-blocked parts of its task
   
2. Backend Chat Agent (ALWAYS ALIVE) handles the collaboration:
   → Creates collaboration task via request_task({ type: "collaboration" })
   → Posts question to CRDT discussion Y.Array
   → WAITS for response (Chat Agent is persistent — waiting costs nothing)

3. Frontend Chat Agent (ALWAYS ALIVE) receives the collaboration task:
   → Picks it up immediately (it's always running)
   → Reads the discussion
   → Posts response to CRDT
   → Records decision via discuss decide

4. Both Chat Agents are alive simultaneously:
   → Back-and-forth discussion on CRDT
   → Multiple rounds until decision reached
   → No polling, no blocking — both agents are persistent event-driven loops
   
5. Decision reached:
   → Backend Chat Agent feeds decision to its Worker (context injection)
   → Worker continues task-1 with clarity
   → Frontend Chat Agent's collaboration task completes

6. Frontend (for humans):
   → Both Chat Agents' conversation visible in real-time
   → User can join and participate at any point
   → User decisions override agent decisions
```

### Why This Works

| Concern | Workers (current, broken) | Chat Agents (target) |
|---------|--------------------------|---------------------|
| **Alive?** | Transient — dies after task | Persistent — always running |
| **Can wait?** | No — execution loop is linear | Yes — event-driven, zero cost while idle |
| **Multi-turn?** | No — single task execution | Yes — ongoing conversation |
| **Concurrent?** | Only if dispatched simultaneously | Always concurrent (both always alive) |
| **Resources while waiting** | Wastes LLM tokens polling | Zero tokens — suspends until event |

### Current Reality (No Chat Agents Yet)

Today's architecture:
```
Planner → OrchestratorService → WorkerPool → AiSdkAgent (transient)
                                              ↑ dies after task
                                              ↑ no persistent layer
```

**Chat Agents don't exist yet.** They're Phase 6 in the roadmap. Building real collaboration before Chat Agents means either:
1. Building temporary hacks (polling, blocking tools) that get thrown away
2. Building the minimum Chat Agent infrastructure needed for collaboration

### What to Build NOW vs LATER

| Feature | Now (stepping stone) | Later (Chat Agent era) |
|---------|---------------------|----------------------|
| **Collaboration discussion CRDT** | ✅ Already built | ✅ Same infrastructure |
| **discuss post/read/decide tools** | ✅ Already built | ✅ Same tools, used by Chat Agents |
| **Frontend discussion UI** | ✅ Already built | ✅ Same components |
| **`waitForResponse` in discuss tool** | ✅ Build now — permanent primitive | ✅ Chat Agents use same tool |
| **`onMentionedRoles` callback** | ✅ Build now — spawns worker | ✅ Same interface, wakes Chat Agent instead |
| **Collaboration prompt** | ✅ Build now — reusable | ✅ Evolves to Chat Agent behavior |
| **Priority mention spawn** | ✅ Build now — immediate worker spawn | ✅ Replaced by Chat Agent wake |

### Recommended Path: Discuss-as-Priority-Interrupt

**Collaboration is NOT a task. It's an interrupt.** When an agent mentions another role in a discussion, the system immediately spawns that role's worker — no task queue, no waiting.

```
Agent-1 (task-1, backend, working):
  → Needs frontend input on schema format
  → calls: collab discuss post({ 
      content: "What schema format does the UI need?", 
      mentions: ["frontend-dev"],
      waitForResponse: true    ← tool BLOCKS until response
    })

System (immediate, priority):
  → Detects mentions in discuss post
  → Checks: is frontend-dev worker alive? 
     NO → IMMEDIATELY spawns frontend-dev worker with collab prompt
     YES → worker already alive, will read discussion via cursor
  → Both agents now active on same CRDT discussion

Agent-2 (frontend-dev, spawned by mention):
  Prompt: "You were mentioned in a discussion by backend-dev.
  Read the thread, contribute your expertise, then exit."
  → collab discuss read → sees question
  → collab discuss post → responds with answer
  → exits (auto-complete or LLM decides)

Agent-1 (still in discuss post tool, waiting):
  → waitForResponse detects new block from frontend-dev
  → tool returns response text to Agent-1's LLM
  → Agent-1 gets another turn → responds or records decision
  → Multi-turn until resolved
  → Agent-1 continues task-1 with clarity

Frontend (real-time):
  → Discussion thread shows both agents posting back and forth
  → User can jump in via DiscussionComposer at any time
```

### Why This Is Better Than Task-Based Collaboration

| | Task-based (request_task) | Priority interrupt (discuss + mention) |
|---|---|---|
| **Speed** | Slow — task queued, waits for slot | Instant — worker spawned on mention |
| **Natural** | Agent creates a formal task to ask a question | Agent just posts a question with @mention |
| **Overhead** | Full task lifecycle (create, persist, dispatch, complete) | Lightweight worker, discuss-only tools |
| **Token cost** | Two full task dispatches with complete context | One lightweight worker + one blocked tool |
| **Throwaway code** | Participant dispatch logic, cancel logic | None — discuss tool + mention routing reusable |
| **Chat Agent compatible** | Replaced by Chat Agent dispatch | `waitForResponse` used by Chat Agents too |

### How It Works Technically

**`discuss post` with `waitForResponse: true`:**
```typescript
// Inside discuss post handler:
if (input.waitForResponse && input.mentions?.length > 0) {
  // 1. Push block to Y.Array (existing code)
  // 2. Notify system about mentions (NEW — priority callback)
  onMentionedRoles?.(input.mentions, taskId, docName);
  
  // 3. Poll Y.Array for response from mentioned roles
  const startTime = Date.now();
  while (Date.now() - startTime < COLLAB_TIMEOUT_MS) {
    const newBlocks = readNewBlocks(discussion, cursor);
    const response = newBlocks.find(b => 
      input.mentions.includes(b.role) || b.role.startsWith("user:")
    );
    if (response) {
      updateCursor(cursors, agentRole);
      return formatResponse(response); // Tool returns response text
    }
    await sleep(3000); // Poll every 3s
  }
  return "No response within timeout. Consider using request_task instead.";
}
```

**`onMentionedRoles` callback (OrchestratorService):**
```typescript
// New callback wired in WorkerPool.setCallbacks():
onMentionedRoles: (roles, sourceTaskId, docName) => {
  for (const role of roles) {
    // Skip if worker already alive for this role
    if (workerPool.hasActiveWorker(role)) continue;
    
    // Spawn lightweight collaboration worker IMMEDIATELY
    // Not through task queue — direct dispatch with priority
    workerPool.runCollaborationWorker({
      role,
      docName,        // which discussion to read
      sourceTaskId,   // who mentioned them
      prompt: `You were mentioned in a discussion. Read and respond.`,
      tools: [discussTool, completeTaskTool], // minimal tools
    });
  }
}
```

### What Survives to Chat Agent Era

| Component | Now (Workers) | Later (Chat Agents) | Survives? |
|-----------|--------------|--------------------|-----------| 
| `waitForResponse` in discuss tool | Blocks in tool, polls Y.Array | Chat Agent subscribes to Y.Array events | ✅ Mechanism — Chat Agent uses same tool |
| `onMentionedRoles` callback | Spawns transient worker | Wakes persistent Chat Agent | ✅ Interface — callback stays, implementation changes |
| Collaboration prompt | Injected into spawned worker | Part of Chat Agent's identity | ✅ Content reusable |
| Auto-post initial message | Posted by discuss post | Same | ✅ Identical |
| CRDT discussion infrastructure | Same | Same | ✅ Identical |
| Frontend discussion UI | Same | Same | ✅ Identical |

**Zero throwaway code.** When Chat Agents arrive, `onMentionedRoles` changes from "spawn worker" to "wake Chat Agent" — one line of code. Everything else stays.

### What the USER sees in frontend

```
DetailPanel → Discussions tab:
  📌 Active
  ┌────────────────────────────────────────┐
  │ 🔴 Schema Format (task-N)        2 new │
  │    backend-dev ↔ frontend-dev          │
  │    [Open Thread]                       │
  └────────────────────────────────────────┘

Clicking "Open Thread" → Full discussion view:
  🤖 backend-dev: "Need to decide schema format..."
  🤖 frontend-dev: "ISO format with fields X, Y, Z"
  ✅ DECISION: "Use ISO-8601 dates, nested objects for addresses"
  
  [Composer] — user can type and participate
  Status bar: 2/10 rounds, 3k/50k tokens
```

---

## What ACTUALLY Works Today (Code Audit)

### ✅ Fully Working

| Component | Evidence |
|-----------|---------|
| CRDT discussion docs (Y.Array, Y.Map) | `CrdtTaskSync.initCollabDocs()` — initializes all 4 shared types |
| `discuss` tool (post/read/decide) | `tools/index.ts` lines 643-780 — full guard rails, cursor tracking |
| Discussion events (Hocuspocus → Socket.IO) | `HocuspocusServer.emitDiscussionChange` → `SocketServerV2.wireDiscussionEvents` |
| Frontend DiscussionThread component | Real component, renders Y.Array blocks via HocuspocusProvider |
| Frontend DecisionPanel component | Real component, renders Y.Map decisions |
| Frontend DiscussionComposer | Real component, @mention autocomplete, type selector |
| Frontend useDiscussion hook | Creates HocuspocusProvider, subscribes to Y.Array/Y.Map |
| DetailPanel "Discussions" tab | Real tab, shows thread list |
| Socket.IO `discussion:activity` / `discussion:mention` | Emitted correctly on CRDT changes |
| Collaboration task CRDT init | `dispatchTask()` detects `type: "collaboration"`, calls `initCollabDocs` |

### ❌ Not Working / Not Implemented

| What's Missing | Impact | Category |
|---------------|--------|----------|
| **No `waitForResponse` in discuss tool** | Agent posts a question but can't wait for a response. Discussion is fire-and-forget. | CORE |
| **No `onMentionedRoles` routing** | When agent mentions another role, no worker is spawned. The mentioned agent never comes online. | ORCHESTRATION |
| **No special prompt for collaboration** | Agent assigned to a collab task doesn't know to use discuss tools quickly. | PROMPT |
| **No lighter dispatch for collab workers** | Workers spawned for discussion get full workspace tools. Unnecessary overhead. | OPTIMIZATION |
| **Frontend discussions not discoverable** | No sidebar badge, no toast for @mentions. User must click Discussions tab. | FRONTEND |
| **Hocuspocus URL may not match** | Frontend `useDiscussion` hook WebSocket URL may not connect to actual server. | WIRING |

---

## Root Causes of Failure

### Why agents don't collaborate

1. **No `waitForResponse` primitive**: The discuss tool is fire-and-forget. Agent posts a question but the tool returns immediately. There's no way for the agent to wait for a response within the same execution loop.

2. **No mention routing**: When an agent mentions another role in a discussion, the system emits a Socket.IO event to the frontend but does NOT spawn a worker for the mentioned role. The mentioned agent never comes online.

3. **No collaboration prompt**: Agents dispatched for collaboration tasks get the same generic work prompt. They don't know to use `discuss read/post/decide` quickly.

4. **Discussion is one-shot without waitForResponse**: Agent-2 responds and completes. Agent-1's tool already returned — it can't see the response or do multi-turn.

### Why frontend doesn't show discussions

1. **Hocuspocus connection may not work**: The `useDiscussion` hook creates a HocuspocusProvider, but the WebSocket URL needs to match the running Hocuspocus server (port 1234). If the frontend isn't configured with the right URL, the CRDT connection fails silently.

2. **Discussion threads list depends on Socket.IO events**: `discussionThreads` in App.tsx state is populated from `discussion:activity` events. If no collaboration tasks are created (because agents don't create them), the list stays empty.

3. **No discussion without collaboration tasks**: The frontend can only show discussions that have CRDT docs. These are created by `initCollabDocs` which only fires for `type: "collaboration"` tasks. If no agent creates a collaboration task, there's nothing to show.

---

## What To Fix (Priority Order)

All fixes are documented in the Implementation Plan below. The "What To Fix" sections from earlier iterations have been consolidated into the final plan.

---

## Implementation Plan

### Phase 1: Fix Basics (Permanent improvements — 2 days)

#### Fix 1: Collaboration prompt in dispatchTask (0.5 day)
When dispatching a `type: "collaboration"` task, inject collaboration-specific instructions.

#### Fix 2: Task type flow-through (0.5 day)
Ensure `type` field flows from plan schema → task context → dispatch detection.

#### Fix 3: Verify frontend Hocuspocus URL (0.5 day)
Make sure `useDiscussion` hook connects to the right WebSocket server.

#### Fix 4: Sidebar discussion badge (0.5 day)
Wire `useDiscussionNotifications` into Sidebar for unread count.

### Phase 2: waitForResponse + Priority Mention Spawn (Core — 3 days)

#### Fix 5: `waitForResponse` in discuss post tool (1.5 days)
When agent calls `discuss post` with `waitForResponse: true`:
1. Push block to Y.Array (existing)
2. Fire `onMentionedRoles` callback with mentioned roles (new)
3. Poll Y.Array every 3s for response from mentioned roles
4. Return response text when detected, or timeout message

**Where:** `packages/collaboration/src/L2/tools/index.ts` — discuss post handler

#### Fix 6: `onMentionedRoles` callback → spawn collaboration worker (1 day)
When the discuss tool fires the mention callback:
1. OrchestratorService receives it via new `WorkerCallbacks.onMentionedRoles`
2. Checks if mentioned role already has an active worker
3. If not → spawns lightweight worker with discuss-only tools + collab prompt
4. Worker reads discussion, responds, exits when done

**Where:**
- `WorkerPool.ts` — new `runCollaborationWorker()` method (lighter than `runTask`)
- `OrchestratorService.ts` — wire `onMentionedRoles` callback
- Collab worker gets: `discuss` + `complete_task` tools only. No workspace.

#### Fix 7: Collab worker auto-cleanup (0.5 day)
When the waitForResponse tool gets its response and returns, the collaboration worker may still be running. Clean up when:
- The collab worker calls `complete_task` (natural exit)
- The requesting agent's tool has returned (no longer needed)
- Timeout reached

### Phase 3: Cleanup (0.5 day)
Remove over-engineered features (timeout escalation, quorum, manual mode).

**Total: ~5.5 days, zero throwaway code**

---

## Decision Required

1. **Proceed with discuss-as-interrupt approach?** `discuss post` with mentions directly spawns workers.
2. **Should `waitForResponse` be the default for posts with mentions?** Or explicit opt-in?
3. **Timeout value?** (Suggest 2 minutes — enough for LLM response, not so long it wastes resources)
4. **Should the collaboration worker get workspace tools?** (Recommend: no — discuss + complete_task only)
