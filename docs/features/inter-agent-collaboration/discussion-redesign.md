# Discussion System Redesign — Feature Architecture

**Date:** April 20, 2026  
**Status:** Implementation-ready  
**Principle:** Fix what's broken. Don't add features. Leave room to extend.

---

## What's Broken (4 issues, 4 fixes)

| # | Issue | Impact | Fix |
|---|-------|--------|-----|
| 1 | **No mention validation** | Silent failure → 120s timeout | Validate role exists before spawning |
| 2 | **Collab worker is context-blind** | Worker doesn't know what was asked | Include question excerpt + source role in prompt |
| 3 | **`complete_task` crashes on collab workers** | Server error (ghost taskId) | Skip TaskStore completion for collab workers |
| 4 | **`waitForResponse` blocks agent for 120s** | Wastes dispatch slot, potential deadlock | Replace with non-blocking post-and-read pattern |

## What's Already Fixed (Phase 1 — done April 20)

- ✅ `read`/`list` on `/discussion` docs → returns discussion blocks, not config
- ✅ `write-block` blocked on `/discussion` docs → error directs to `discuss post`
- ✅ Auto-append `/discussion` suffix → agents can say `task-5` instead of `task-5/discussion`
- ✅ Discussion task prompt has exact tool call syntax
- ✅ `type: "discussion"` added to submit_plan + add_tasks schemas
- ✅ Planner prompt explains when to create discussion tasks
- ✅ E2E tests (14/14 pass)

---

## Fix 1: Mention Validation (SRP — validation belongs in the tool, not the orchestrator)

**Where:** `packages/collaboration/src/L2/tools/index.ts` — discuss post handler  
**Before firing `onMentionedRoles`:**

```typescript
// Validate mentions against team roles (injected via createCollabTool)
const validMentions = block.mentions.filter(role => teamRoles.includes(role.toLowerCase()));
const invalidMentions = block.mentions.filter(role => !teamRoles.includes(role.toLowerCase()));
const selfMentions = validMentions.filter(role => role.toLowerCase() === agentRole.toLowerCase());
const effectiveMentions = validMentions.filter(role => role.toLowerCase() !== agentRole.toLowerCase());

if (invalidMentions.length > 0) {
  // Warn but don't block — post still succeeds
  warning += ` Unknown roles ignored: ${invalidMentions.join(", ")}.`;
}
if (effectiveMentions.length > 0) {
  callbacks.onMentionedRoles(effectiveMentions, taskId, docName);
}
```

**Change needed:** Pass `teamRoles` to `createCollabTool()`. It's already available in the wiring chain:  
`OrchestratorService.teamRoles` → `CollaborationPlugin.setCollabCallbacks` → `CollabMcpServer` → `createCollabTool`.

---

## Fix 2: Collab Worker Context (SRP — prompt assembly belongs in OrchestratorService)

**Where:** `OrchestratorService.ts` — `onMentionedRoles` handler  
**Current prompt (broken):**
```
You were mentioned in a discussion.
Discussion doc: task-003/discussion
1. Read the discussion: `collab discuss read`
```

**New prompt:**
```typescript
const collabMessage = [
  `## You were mentioned by ${sourceRole} in a discussion`,
  ``,
  `### What they said:`,
  `> ${postContent.slice(0, 500)}`,
  ``,
  `### Your task:`,
  `1. Read: \`collab({ action: "discuss", docName: "${docName}", key: "read" })\``,
  `2. Post your response: \`collab({ action: "discuss", docName: "${docName}", key: "post", value: { content: "..." } })\``,
  `3. Complete: \`complete_task({ summary: "Responded to ${sourceRole}" })\``,
  ``,
  `If you have no expertise on this topic, call \`bounce_task()\`.`,
].join("\n");
```

**Change needed:** `onMentionedRoles` callback must receive the post content + source role (currently only gets `roles`, `taskId`, `docName`).

---

## Fix 3: Collab Worker `complete_task` Crash (OCP — don't special-case, use existing patterns)

**Where:** `OrchestratorService.ts` — `onWorkerDone`  
**Problem:** Collab worker ID `collab-task-5-discussion-frontend` doesn't exist in TaskStore.  
**Fix:** In `onWorkerDone`, if `taskStore.get(taskId)` returns undefined AND the taskId starts with `collab-`, skip TaskStore operations entirely. The worker cleanup (`.finally(() => dispose())`) already handles resource cleanup.

```typescript
// In onWorkerDone:
if (!currentTask && data.taskId.startsWith("collab-")) {
  log.debug(`Collab worker ${data.taskId} completed — no TaskStore entry (expected)`);
  return; // Cleanup handled by .finally() in the spawn site
}
```

---

## Fix 4: Non-Blocking Mentions (ISP — agents shouldn't wait, they should read)

**Where:** `packages/collaboration/src/L2/tools/index.ts` — discuss post `waitForResponse` section  
**Current:** 120s polling loop blocks the agent's tool execution.  
**New:** Remove `waitForResponse` entirely. Replace with immediate return + guidance.

```typescript
// REMOVE the polling loop. Replace with:
if (parsed.waitForResponse) {
  return [
    `Posted discussion block. ${effectiveMentions.join(", ")} notified.`,
    `Round ${myRounds + 1}/${maxRounds}, tokens ${newTotal}/${maxTokens}.`,
    ``,
    `Their response will appear in the discussion.`,
    `Read it with: collab({ action: "discuss", docName: "${docName}", key: "read" })`,
  ].join("\n");
}
```

The agent posts, gets immediate confirmation, then calls `discuss read` to check for responses. The responder worker is spawned by `onMentionedRoles` — it reads and replies independently.

---

## What NOT to Build Now (Defer)

_Nothing deferred. All features planned below._

---

## Phase 2: Quorum-Verified Decisions

**Problem:** Any agent can record a decision with self-reported `agreedBy`. No verification.

### Design
When `discuss decide` is called:
1. Read all posts from Y.Array("discussion") → extract unique poster roles
2. Compare `agreedBy` list against actual posters
3. If a role in `agreedBy` never posted → reject: "Cannot include {role} — they haven't contributed"
4. Store `verifiedAgreedBy` (roles that actually posted) alongside the decision
5. If all mentioned roles have posted, allow the decision

### Implementation
**File:** `packages/collaboration/src/L2/tools/index.ts` — discuss `decide` handler (~line 870)

```typescript
// Before recording decision:
const allBlocks = doc.getArray("discussion").toJSON();
const posterRoles = new Set(allBlocks.map((b: any) => b.role));

const requestedAgreedBy = parsed.agreedBy || [agentRole];
const verified = requestedAgreedBy.filter((r: string) => posterRoles.has(r));
const unverified = requestedAgreedBy.filter((r: string) => !posterRoles.has(r));

if (unverified.length > 0) {
  return `Cannot record decision — these roles haven't posted yet: ${unverified.join(", ")}. ` +
    `Only roles that contributed can be in agreedBy.`;
}
```

### Frontend
**File:** `packages/frontend/components/DecisionPanel/DecisionPanel.tsx`
- Change `quorumRequired` from hardcoded `1` to `posterRoles.size` (number of unique posters)
- Show "Agreed: 2/3 roles" instead of progress bar always at 100%

---

## Phase 3: Discussion Agenda

**Problem:** Discussions are freeform — agents don't know what to cover.

### Design
Each discussion task gets an agenda from the task description, stored in the discussion config Y.Map.

```
Agenda items stored in Y.Map("config"):
  agenda: [
    { id: "api-endpoints", text: "Agree on API endpoints", resolved: false },
    { id: "auth-format", text: "Define auth token format", resolved: false },
    { id: "error-codes", text: "Standardize error response codes", resolved: false }
  ]
```

When a decision is recorded with a matching `key`, the agenda item is marked `resolved: true`.

### Implementation

**Step 1: Store agenda at discussion init**
**File:** `packages/collaboration/src/L2/collaboration/CrdtTaskSync.ts` — `initCollabDocs()`
- When initializing a discussion doc, parse the task description for numbered items
- Store as `config.agenda` array

**Step 2: Display agenda in discussion prompt**  
**File:** `packages/agent-manager/src/orchestrator/OrchestratorService.ts` — discussion task prompt
- Add agenda items to the prompt so agents know what to address

**Step 3: Auto-resolve agenda on decide**
**File:** `packages/collaboration/src/L2/tools/index.ts` — discuss `decide` handler
- When decision is recorded, check if `key` matches an agenda item ID
- If so, mark that agenda item as `resolved: true`

### Frontend
**File:** `packages/frontend/components/DiscussionThread/DiscussionThread.tsx`
- Render agenda at top of thread as a checklist
- Each item shows ☐ (pending) or ☑ (resolved)
- Resolved items link to the decision that resolved them

```
┌─────────────────────────────────────┐
│ 📋 Agenda                           │
│ ☑ Agree on API endpoints            │
│ ☐ Define auth token format          │
│ ☐ Standardize error response codes  │
└─────────────────────────────────────┘
│ 🤖 backend: I propose REST with...  │
│ 🤖 frontend: Agreed, but we need... │
│ ✅ Decision: REST with /api/v1/...  │
└─────────────────────────────────────┘
```

---

## Phase 4: Discussion Lifecycle States

**Problem:** No explicit close. Discussion stays active until timeout or token limit.

### Design
```
active → all_posted → decided → closed
```

| State | Meaning | Trigger |
|-------|---------|---------|
| `active` | Discussion accepting posts | Created |
| `all_posted` | All participants contributed at least once | Auto-detected after each post |
| `decided` | Decision recorded with verified quorum | `discuss decide` with valid quorum |
| `closed` | Terminal. Task completes. | After `decided`, or timeout, or external close |

### Implementation

**Step 1: Track participants**
**File:** `packages/collaboration/src/L2/tools/index.ts` — discuss post handler
- After each post, check if all mentioned roles (from config.participants) have posted
- If yes, transition `config.status` to `all_posted`
- Notify the discussion initiator: "All participants have posted. Record a decision."

**Step 2: Auto-close on decide**
**File:** `packages/collaboration/src/L2/tools/index.ts` — discuss decide handler
- After recording a quorum-verified decision, set `config.status = "decided"`
- Then set `config.status = "closed"`

**Step 3: Store participants list**
**File:** `packages/agent-manager/src/orchestrator/OrchestratorService.ts` — discussion task dispatch
- When dispatching a discussion task, write `config.participants` to the CRDT doc
- Participants = all team roles mentioned in the task description, or explicitly listed

### Frontend
**File:** `packages/frontend/components/DiscussionThread/DiscussionThread.tsx` — StatusBar
- Show lifecycle state as badge: 🟢 Active → 🟡 Awaiting Decision → ✅ Decided → ⬛ Closed
- Show participant status: "backend ✅ | frontend ⏳ | qa ⏳"

---

## Phase 5: Frontend Redesign

### 5a: Inline Decisions (Remove DecisionPanel sidebar)

**Current:** Decisions in right-side panel with quorum bars.
**New:** Decisions render inline in the discussion thread.

```
┌──────────────────────────────────────────────┐
│ Discussion: task-5          🟢 Active        │
├──────────────────────────────────────────────┤
│ 📋 Agenda                                    │
│ ☑ API endpoints  ☐ Auth format  ☐ Errors    │
├──────────────────────────────────────────────┤
│ 🤖 backend (10:30)                           │
│ I propose REST endpoints:                    │
│ POST /auth/register, POST /auth/login...     │
│                          @frontend @qa       │
├──────────────────────────────────────────────┤
│ 🤖 frontend (10:31)                          │
│ Agreed. Add refresh token endpoint too.      │
├──────────────────────────────────────────────┤
│ ┌────────────────────────────────────────┐   │
│ │ ✅ Decision: api-endpoints             │   │
│ │ REST with POST /auth/register,         │   │
│ │ POST /auth/login, POST /auth/refresh   │   │
│ │ Decided by: backend                    │   │
│ │ Agreed by: backend, frontend  (2/3)    │   │
│ └────────────────────────────────────────┘   │
├──────────────────────────────────────────────┤
│ Participants: backend ✅ frontend ✅ qa ⏳   │
├──────────────────────────────────────────────┤
│ [Type your response... (@ to mention)]  [▶]  │
└──────────────────────────────────────────────┘
```

**Implementation:**

**File:** `packages/frontend/components/DiscussionThread/DiscussionThread.tsx`
- Add `InlineDecision` component — collapsed by default ("✅ Decision: {key}")
- Click to expand: full text, decidedBy, agreedBy, timestamp
- Render decisions in chronological order among discussion blocks
- Read decisions from Y.Map("decisions"), interleave with Y.Array blocks by timestamp

**File:** `packages/frontend/components/DecisionPanel/DecisionPanel.tsx`
- Remove from DetailPanel
- Keep component file for potential reuse but don't render in sidebar

### 5b: Simplify Composer

**File:** `packages/frontend/components/DiscussionComposer/DiscussionComposer.tsx`
- Remove Message/Question/Decision type selector buttons
- Single text input with @mention autocomplete
- Type auto-inferred: contains `?` → question, else message

### 5c: Participant Status Bar

**File:** `packages/frontend/components/DiscussionThread/DiscussionThread.tsx` — StatusBar
- Show each participant with status: ✅ (posted) or ⏳ (waiting)
- Derive from Y.Array blocks — which roles have posted

### 5d: Thread List Persistence

**File:** `packages/backend/api/HttpServer.ts` — new endpoint
- `GET /api/v2/teams/:teamId/discussions` → list active discussion docs from CRDT
- Frontend loads on mount instead of relying only on Socket.IO events

---

## Implementation Order & Dependencies

```
Phase 2 (Quorum)     ← independent, collab tool only
Phase 3 (Agenda)     ← independent, CRDT init + prompt + tool
Phase 4 (Lifecycle)  ← depends on Phase 2 (quorum triggers "decided")
Phase 5a (Inline)    ← depends on Phase 4 (needs lifecycle states for badges)  
Phase 5b (Composer)  ← independent
Phase 5c (Status)    ← depends on Phase 4 (needs participants list)
Phase 5d (Thread API)← independent
```

Recommended order: **2 → 3 → 5b → 4 → 5a → 5c → 5d**

---

## Files Changed Per Phase

| Phase | Backend Files | Frontend Files | Risk |
|-------|--------------|----------------|------|
| 2 | `collab tools/index.ts` | `DecisionPanel.tsx` | Low |
| 3 | `CrdtTaskSync.ts`, `OrchestratorService.ts`, `collab tools/index.ts` | `DiscussionThread.tsx` | Medium |
| 4 | `collab tools/index.ts`, `OrchestratorService.ts` | `DiscussionThread.tsx` | Medium |
| 5a | — | `DiscussionThread.tsx`, `DecisionPanel.tsx`, `DetailPanel.tsx` | Low |
| 5b | — | `DiscussionComposer.tsx` | Low |
| 5c | — | `DiscussionThread.tsx` | Low |
| 5d | `HttpServer.ts` | `App.tsx` or `useDiscussion.ts` | Low |
