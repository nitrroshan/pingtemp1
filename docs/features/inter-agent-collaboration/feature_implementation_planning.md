# Inter-Agent Collaboration — Implementation Planning v3

**Architecture:** [discussion-redesign.md](discussion-redesign.md)  
**Date:** April 20, 2026

---

## Phase 1: Core Fixes ✅ DONE

- [x] `read`/`list` on discussion docs returns blocks
- [x] `write-block` blocked on discussion docs
- [x] Auto-append `/discussion` suffix
- [x] Discussion task prompt with exact tool syntax
- [x] `type: "discussion"` in schemas + planner prompt
- [x] Mention validation in `spawnCollabWorkers()`
- [x] Context-aware collab worker prompt
- [x] `onWorkerDone` guard for collab workers
- [x] Non-blocking mentions (removed 120s polling)
- [x] E2E tests 14/14

---

## Phase 2: Quorum-Verified Decisions

### What
Validate that `agreedBy` roles actually posted before recording a decision.

### Code — discuss `decide` handler
**File:** `packages/collaboration/src/L2/tools/index.ts` ~line 850

```typescript
// BEFORE (current — no validation):
decisions.set(parsed.key || "decision", {
  decision: parsed.decision,
  decidedBy: agentRole,
  agreedBy: parsed.agreedBy || [agentRole],
  timestamp: new Date().toISOString(),
});

// AFTER (quorum-verified):
const allBlocks = doc.getArray("discussion").toJSON();
const posterRoles = new Set<string>(allBlocks.map((b: any) => b.role));
const requested = parsed.agreedBy || [agentRole];
const verified = requested.filter((r: string) => posterRoles.has(r));
const missing = requested.filter((r: string) => !posterRoles.has(r));

if (missing.length > 0) {
  return `Cannot include ${missing.join(", ")} in agreedBy — they haven't posted. ` +
    `Roles that posted: ${[...posterRoles].join(", ")}`;
}

decisions.set(parsed.key || "decision", {
  decision: parsed.decision,
  decidedBy: agentRole,
  agreedBy: verified,
  posterCount: posterRoles.size,
  timestamp: new Date().toISOString(),
});
```

### Code — Frontend quorum display
**File:** `packages/frontend/components/DecisionPanel/DecisionPanel.tsx` line 22

```tsx
// BEFORE:
quorumRequired = 1

// AFTER:
const quorum = decision.posterCount || decision.agreedBy.length;
```

### E2E Test
```typescript
// Post from backend + frontend, then try decide with agreedBy including "qa" (never posted)
const result = await invokeTool(tool, {
  action: "discuss", docName: "task-X/discussion", key: "decide",
  value: { key: "api", decision: "REST", agreedBy: ["backend", "frontend", "qa"] }
});
assertIncludes(result, "Cannot include qa", "rejects non-poster in agreedBy");
```

- [ ] Step 1: Validate agreedBy in decide handler
- [ ] Step 2: Frontend quorum display
- [ ] Step 3: E2E test

---

## Phase 3: Discussion Agenda

### What
Parse numbered items from task description, store in CRDT config, auto-resolve on decide.

### Code — Store agenda in initCollabDocs
**File:** `packages/collaboration/src/L2/collaboration/CrdtTaskSync.ts` ~line 387

```typescript
async initCollabDocs(taskId: string, collabConfig?: Record<string, any>): Promise<void> {
  // ... existing config ...
  
  // NEW: Store agenda items
  const agenda = collabConfig?.agenda || [];
  if (agenda.length > 0) {
    configMap.set("agenda", agenda.map((item: string, i: number) => ({
      id: `item-${i + 1}`,
      text: item,
      resolved: false,
    })));
  }
}
```

### Code — Extract agenda from task description in OrchestratorService
**File:** `packages/agent-manager/src/orchestrator/OrchestratorService.ts` — dispatchTask

```typescript
// In the discussion task section, before calling initCollabDocs:
const agendaLines = task.description
  .split("\n")
  .filter(l => /^\d+\./.test(l.trim()))
  .map(l => l.trim().replace(/^\d+\.\s*/, ""));

await crdtTaskSync.initCollabDocs(taskId, { ...collabConfig, agenda: agendaLines });

// Inject into prompt:
if (agendaLines.length > 0) {
  enrichedDescription += `\n\n### Agenda:\n${agendaLines.map((a, i) => `${i+1}. ${a}`).join("\n")}`;
}
```

### Code — Auto-resolve agenda on decide
**File:** `packages/collaboration/src/L2/tools/index.ts` — decide handler, after recording

```typescript
const agenda = configMap.get("agenda") as any[];
if (agenda) {
  const updated = agenda.map((item: any) =>
    (item.id === parsed.key || item.text.toLowerCase().includes((parsed.key || "").toLowerCase()))
      ? { ...item, resolved: true }
      : item
  );
  configMap.set("agenda", updated);
}
```

### Code — Frontend agenda checklist
**File:** `packages/frontend/components/DiscussionThread/DiscussionThread.tsx`

```tsx
function AgendaBar({ config }: { config: DiscussionConfig | null }) {
  const agenda = (config as any)?.agenda as Array<{id: string; text: string; resolved: boolean}>;
  if (!agenda?.length) return null;
  const resolved = agenda.filter(a => a.resolved).length;
  return (
    <div className="px-4 py-2 bg-muted/30 border-b border-border text-xs">
      <span className="text-[10px] font-semibold text-muted-foreground">📋 AGENDA ({resolved}/{agenda.length})</span>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
        {agenda.map(item => (
          <span key={item.id} className={item.resolved ? "line-through text-muted-foreground" : ""}>
            {item.resolved ? "☑" : "☐"} {item.text}
          </span>
        ))}
      </div>
    </div>
  );
}
// Insert between header and blocks in DiscussionThread render
```

- [ ] Step 1: Store agenda in initCollabDocs
- [ ] Step 2: Extract agenda from task description
- [ ] Step 3: Auto-resolve on decide
- [ ] Step 4: Frontend agenda checklist

---

## Phase 4: Discussion Lifecycle States

### What
Track `active → all_posted → decided → closed` with participant tracking.

### Code — Store participants
**File:** `packages/collaboration/src/L2/collaboration/CrdtTaskSync.ts`

```typescript
// In initCollabDocs:
configMap.set("participants", collabConfig?.participants || []);
```

**File:** `packages/agent-manager/src/orchestrator/OrchestratorService.ts` — discussion dispatch

```typescript
const participants = this.teamRoles.map(r => r.toLowerCase());
await crdtTaskSync.initCollabDocs(taskId, { ...collabConfig, participants });
```

### Code — Auto-detect all_posted
**File:** `packages/collaboration/src/L2/tools/index.ts` — discuss post, after pushing block

```typescript
const participants = configMap.get("participants") as string[] || [];
if (participants.length > 0) {
  const allBlocks = discussion.toJSON();
  const posters = new Set(allBlocks.map((b: any) => b.role));
  if (participants.every(p => posters.has(p)) && configMap.get("status") === "active") {
    configMap.set("status", "all_posted");
    warning += " All participants have posted. Record a decision when ready.";
  }
}
```

### Code — Auto-close on decide
**File:** `packages/collaboration/src/L2/tools/index.ts` — decide handler

```typescript
// After recording quorum-verified decision:
configMap.set("status", "closed");
```

### Code — Frontend lifecycle badge + participant status
**File:** `packages/frontend/components/DiscussionThread/DiscussionThread.tsx`

```tsx
const STATUS_BADGE: Record<string, string> = {
  active: "🟢 Active",
  all_posted: "🟡 Awaiting Decision",
  decided: "✅ Decided",
  closed: "⬛ Closed",
  escalated: "🔴 Escalated",
};

function ParticipantBar({ config, blocks }: { config: any; blocks: DiscussionBlock[] }) {
  const participants = config?.participants as string[] || [];
  if (!participants.length) return null;
  const posters = new Set(blocks.map(b => b.role));
  return (
    <div className="px-4 py-1 text-[10px] text-muted-foreground flex gap-2 border-b border-border">
      {participants.map(p => (
        <span key={p}>{posters.has(p) ? "✅" : "⏳"} {p}</span>
      ))}
    </div>
  );
}
```

- [ ] Step 1: Store participants
- [ ] Step 2: Auto-detect all_posted
- [ ] Step 3: Auto-close on decide
- [ ] Step 4: Frontend lifecycle badge + participant status

---

## Phase 5: Frontend Minimalist Redesign

### 5a: Inline Decisions (remove sidebar DecisionPanel)

```tsx
// NEW component in DiscussionThread.tsx
function InlineDecision({ k, d }: { k: string; d: Decision }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-4 my-2 rounded border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20">
      <button onClick={() => setOpen(!open)} className="w-full text-left px-3 py-2 text-xs flex items-center gap-2">
        <span>✅</span>
        <span className="font-semibold">{k.replace(/-/g, " ")}</span>
        <span className="text-muted-foreground ml-auto text-[10px]">
          {d.agreedBy.length} agreed · {new Date(d.timestamp).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-2 text-xs border-t border-green-200 dark:border-green-800 pt-1 space-y-0.5">
          <p className="italic">"{d.decision}"</p>
          <p className="text-[10px] text-muted-foreground">by {d.decidedBy} · {d.agreedBy.map(r => `✓${r}`).join(" ")}</p>
        </div>
      )}
    </div>
  );
}
```

Remove `DecisionPanel` from `DetailPanel.tsx` sidebar.

### 5b: Simplify Composer

```tsx
// REMOVE from DiscussionComposer.tsx:
// - TYPE_OPTIONS array (lines 23-27)
// - Type selector buttons (lines 111-126)
// AUTO-INFER:
const type = content.includes("?") ? "question" : "message";
```

### 5c: Thread List REST Endpoint

**File:** `packages/backend/api/HttpServer.ts`

```typescript
app.get("/api/v2/teams/:teamId/discussions", async (req, res) => {
  const collabPlugin = pluginRegistry.get("collaboration");
  if (!collabPlugin) return res.json([]);
  const space = collabPlugin.getOrCreateSpace(currentGoalId);
  const docs = await space.listDocs();
  const threads = await Promise.all(
    docs.filter(d => d.endsWith("/discussion")).map(async docName => {
      const doc = await space.openDoc(docName);
      const blocks = doc.getArray("discussion").length;
      const config = doc.getMap("config").toJSON();
      return { taskId: docName.replace("/discussion",""), blockCount: blocks, status: config.status };
    })
  );
  res.json(threads);
});
```

Frontend: fetch on mount, replace event-driven thread discovery in App.tsx.

- [ ] 5a: Inline decisions
- [ ] 5b: Simplify composer  
- [ ] 5c: Thread list API

---

## Order: 2 → 3 → 5b → 4 → 5a → 5c

## Files Summary

| Phase | Backend | Frontend |
|-------|---------|----------|
| 2 | `collab tools/index.ts` | `DecisionPanel.tsx` |
| 3 | `CrdtTaskSync.ts`, `OrchestratorService.ts`, `collab tools/index.ts` | `DiscussionThread.tsx` |
| 4 | `collab tools/index.ts`, `OrchestratorService.ts`, `CrdtTaskSync.ts` | `DiscussionThread.tsx` |
| 5a | — | `DiscussionThread.tsx`, `DetailPanel.tsx` |
| 5b | — | `DiscussionComposer.tsx` |
| 5c | `HttpServer.ts` | `App.tsx` |
# Inter-Agent Collaboration — Implementation Planning v3

**Architecture:** [discussion-redesign.md](discussion-redesign.md)  
**Issues:** [issues-v1.md](../task-orchestration/markdown-tasks/issues-v1.md) (R11 section)  
**Date:** April 20, 2026

---

## Branch
`user/nitrroshan/tasksmd`

## Scope
Full discussion system: fixes + quorum + agenda + lifecycle + frontend redesign.

---

## Phase 1: Core Fixes ✅ DONE

All completed April 20, 2026.

- [x] Step 1: `read`/`list` on discussion docs → returns blocks, not config
- [x] Step 2: `write-block` blocked on discussion docs
- [x] Step 3: Auto-append `/discussion` suffix
- [x] Step 4: Discussion task prompt with exact tool syntax
- [x] Step 5: `type: "discussion"` in submit_plan + add_tasks schemas
- [x] Step 6: Planner prompt explains discussion tasks
- [x] Step 7: E2E tests (14/14 pass)
- [x] Fix 1: Mention validation in `spawnCollabWorkers()`
- [x] Fix 2: Context-aware collab worker prompt (excerpt + source role)
- [x] Fix 3: `onWorkerDone` guard for collab worker IDs
- [x] Fix 4: Removed 120s `waitForResponse` blocking → non-blocking

---

## Phase 2: Quorum-Verified Decisions

- [ ] Step 1: In discuss `decide` handler, read all posts and extract poster roles
- [ ] Step 2: Validate `agreedBy` — reject roles that never posted
- [ ] Step 3: Store `verifiedAgreedBy` on the decision
- [ ] Step 4: Frontend DecisionPanel — show actual quorum (posters/total) instead of hardcoded 1
- [ ] Step 5: E2E test — decision rejected when non-poster is in agreedBy

**Files:** `collab tools/index.ts`, `DecisionPanel.tsx`  
**Risk:** Low

---

## Phase 3: Discussion Agenda

- [ ] Step 1: In `CrdtTaskSync.initCollabDocs()`, parse task description for numbered items → store as `config.agenda`
- [ ] Step 2: In discussion task prompt, inject agenda items
- [ ] Step 3: In discuss `decide` handler, auto-resolve matching agenda item on decision
- [ ] Step 4: Frontend DiscussionThread — render agenda checklist at top
- [ ] Step 5: E2E test — agenda stored and resolved on decide

**Files:** `CrdtTaskSync.ts`, `OrchestratorService.ts`, `collab tools/index.ts`, `DiscussionThread.tsx`  
**Risk:** Medium

---

## Phase 4: Discussion Lifecycle States

- [ ] Step 1: Add `participants` list to discussion config (from task context or mentioned roles)
- [ ] Step 2: After each post, check if all participants have posted → transition to `all_posted`
- [ ] Step 3: After quorum-verified decide → transition to `decided` → auto-close
- [ ] Step 4: On timeout → `escalated` → notify planner
- [ ] Step 5: Frontend StatusBar — show lifecycle badge + participant status
- [ ] Step 6: E2E test — lifecycle transitions correctly

**Files:** `collab tools/index.ts`, `OrchestratorService.ts`, `DiscussionThread.tsx`  
**Risk:** Medium  
**Depends on:** Phase 2 (quorum triggers "decided")

---

## Phase 5: Frontend Redesign

### 5a: Inline Decisions
- [ ] Step 1: Create `InlineDecision` component — collapsed one-liner, click to expand
- [ ] Step 2: Interleave decisions with discussion blocks by timestamp in DiscussionThread
- [ ] Step 3: Remove DecisionPanel from DetailPanel sidebar

**Files:** `DiscussionThread.tsx`, `DecisionPanel.tsx`, `DetailPanel.tsx`

### 5b: Simplify Composer
- [ ] Step 1: Remove Message/Question/Decision type selector buttons
- [ ] Step 2: Auto-infer type (contains `?` → question, else message)

**Files:** `DiscussionComposer.tsx`

### 5c: Participant Status Bar
- [ ] Step 1: Read `config.participants` from CRDT
- [ ] Step 2: Show each participant with ✅ (posted) or ⏳ (waiting)

**Files:** `DiscussionThread.tsx`  
**Depends on:** Phase 4

### 5d: Thread List REST Endpoint
- [ ] Step 1: Add `GET /api/v2/teams/:teamId/discussions` endpoint
- [ ] Step 2: Frontend loads threads on mount instead of event-driven only

**Files:** `HttpServer.ts`, `App.tsx` or `useDiscussion.ts`

---

## Implementation Order

```
Phase 2 (Quorum)     ← independent
Phase 3 (Agenda)     ← independent
Phase 5b (Composer)  ← independent, smallest frontend change
Phase 4 (Lifecycle)  ← after Phase 2
Phase 5a (Inline)    ← after Phase 4
Phase 5c (Status)    ← after Phase 4
Phase 5d (Thread API)← independent
```

---

## Testing Strategy

- Backend: `bun run packages/collaboration/src/__tests__/collab-e2e.test.ts` (add tests per phase)
- Agent-manager: `npx tsc --build --force` (type check)
- Live test prompt: "Build a REST API for a todo list app. Backend and frontend must discuss API contract first."
- Frontend: manual visual verification
2. `write-block` on `/discussion` docs writes to BlockNote XmlFragment, not discussion Y.Array — agents use it instead of `discuss post`
3. `discuss` requires exact docName (`task-5/discussion`) — agents guess wrong names
4. Collaboration task prompt is too vague — doesn't tell agents which tool actions to use
5. Planner has no concept of `type: "discussion"` tasks — can't create multi-participant discussions
6. No `type` field on submit_plan or add_tasks task schemas

---

## Implementation Steps

### Step 1: Redirect `read`/`list` on discussion docs → discussion blocks
**Files:** `packages/collaboration/src/L2/tools/index.ts` (list action ~line 517, read action ~line 580)  
**Change:** Before the generic CRDT doc handler, check if `docName.endsWith("/discussion")`. If so, read `Y.Array("discussion")` and format as discussion blocks instead of reading the config Y.Map.

```
if (docName.endsWith("/discussion")) {
  const doc = await space.openDoc(docName);
  const discussion = doc.getArray("discussion").toJSON();
  // Format and return blocks
}
```

### Step 2: Block `write-block` on discussion docs
**Files:** `packages/collaboration/src/L2/tools/index.ts` (write-block action ~line 618)  
**Change:** Add guard: if `docName.endsWith("/discussion")`, return error directing agent to use `discuss post`.

### Step 3: Auto-append `/discussion` suffix for `discuss` action
**Files:** `packages/collaboration/src/L2/tools/index.ts` (discuss action ~line 660)  
**Change:** Remove the validation error for non-`/discussion` docNames. Instead, auto-append `/discussion` if missing. This lets agents say `discuss task-5` instead of requiring exact `task-5/discussion`.

### Step 4: Improve discussion task prompt
**Files:** `packages/agent-manager/src/orchestrator/OrchestratorService.ts` (~line 1036)  
**Change:** Replace the vague collaboration prompt with explicit discuss instructions including exact tool call syntax with the task's docName.

```
## ⚡ Discussion Task: {title}
Participants: {otherParticipants}

### Protocol:
1. Read discussion: collab({ action: "discuss", docName: "{taskId}/discussion", key: "read" })
2. Post your input: collab({ action: "discuss", docName: "{taskId}/discussion", key: "post", value: { content: "...", mentions: [{roles}] } })
3. If you need a response, add waitForResponse: true
4. Record decision: collab({ action: "discuss", key: "decide", value: { key: "...", decision: "...", agreedBy: [...] } })
5. Complete: complete_task({ summary: "Decision: ..." })
```

### Step 5: Add `type` field to submit_plan and add_tasks schemas
**Files:** `packages/agent-manager/src/orchestrator/tools/submitPlan.ts` (schema ~line 30), `packages/agent-manager/src/orchestrator/tools/planMutationTools.ts` (AddTasksSchema ~line 46)  
**Change:** Add optional `type` field to task schema: `z.enum(["work", "discussion", "review", "research"]).default("work")`. Flow through to `Task.type` in normalizeAndAddTasks and approvePlan.

### Step 6: Add discussion guidance to planner prompt
**Files:** `packages/agent-manager/src/agent/prompts/planner/system.xml`  
**Change:** Add section telling planner WHEN to create discussion tasks:
- When task requires cross-role alignment (API contracts, data schemas)
- When multiple roles need to agree before proceeding
- Use `type: "discussion"` with dependencies so downstream tasks get the decision

### Step 7: Update collab E2E test
**Files:** `packages/collaboration/src/__tests__/collab-e2e.test.ts`  
**Change:** Add tests for:
- `read` on discussion doc returns blocks (not config)
- `list` on discussion doc returns blocks
- `write-block` on discussion doc is rejected
- Auto-append `/discussion` suffix

---

## Testing Strategy
- Run updated collab E2E tests: `bun run packages/collaboration/src/__tests__/collab-e2e.test.ts`
- `tsc --build --force` on agent-manager
- Live test with prompt: "Build auth API — backend and frontend must discuss API contract first"

## Dependencies Between Steps
```
Step 1 (read/list redirect) ← independent
Step 2 (block write-block)  ← independent  
Step 3 (auto-append suffix) ← independent
Step 4 (prompt)             ← depends on Step 3 (uses auto-append docName format)
Step 5 (schema type field)  ← independent
Step 6 (planner prompt)     ← depends on Step 5 (planner needs to know about type field)
Step 7 (tests)              ← depends on Steps 1-3
```

Steps 1-3 can be done in parallel. Step 4-6 after. Step 7 last.
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
