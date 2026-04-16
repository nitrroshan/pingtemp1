# Inter-Agent Collaboration — Feature Architecture

**Date:** April 14, 2026  
**Status:** Research phase — understanding collaboration patterns before designing  
**Related:** `collaboration-toolkit/`, `agent-collab-docs/`, `task-orchestration/markdown-tasks/`

---

## Part 1: How Humans Collaborate (Research)

Before designing agent collaboration, we need to understand human collaboration patterns. Agents should mirror how effective development teams work.

### When Humans Schedule Meetings (Synchronous Discussion)

| Trigger | Example | Why a meeting? |
|---------|---------|----------------|
| **Ambiguous requirements** | "What exactly should the API return?" | Multiple valid interpretations — need alignment |
| **Cross-domain decisions** | "Should auth be JWT or session-based?" | Impacts multiple teams, needs shared agreement |
| **Design review** | "Here's the schema — does this work for frontend?" | Feedback needed before building on top of it |
| **Conflict resolution** | "Backend says X, frontend says Y" | Disagreement that can't resolve async |
| **Handoff with complexity** | "Let me walk you through what I built" | Too much context for a ticket |
| **Blocked and unclear why** | "I can't proceed — let's figure out why" | Root cause needs collaborative debugging |

### When Humans DON'T Meet (They Just Do It)

| Trigger | Example | Why NOT a meeting? |
|---------|---------|-------------------|
| **Clear spec → create ticket** | "Build a REST endpoint for /users" | Spec is unambiguous. Just assign it. |
| **Bug report** | "Login returns 500 on empty email" | Clear reproduction steps. No discussion needed. |
| **Code review** | PR comment: "rename this variable" | Async feedback, no meeting. |
| **Status update** | "Schema is done, here are the files" | Inform, don't discuss. |
| **Delegating well-defined work** | "Run the test suite and report failures" | Clear input/output expectations. |

### The Spectrum of Human Coordination

```
No coordination          Light async         Structured async       Sync discussion
needed                   (Slack msg)         (Ticket + comments)    (Meeting)
     │                       │                      │                    │
     ▼                       ▼                      ▼                    ▼
  Just do it          "FYI, schema's done"    "Task: Build API"    "Let's align on
                      "Quick Q: what format?"  (PR comments)       the data model"
                                              (Ticket discussions)
```

### Key Insight: Meetings Are for ALIGNMENT, Not for WORK

Humans don't schedule meetings to DO work. They meet to:
1. **Align** — agree on what should be built
2. **Clarify** — resolve ambiguity before building
3. **Review** — validate before downstream depends on it
4. **Unblock** — figure out why something is stuck
5. **Decide** — choose between options when multiple are valid

After the meeting, they go back to their desks and work independently.

### What Triggers a "Meeting" vs a "Ticket"?

The decision comes down to **certainty**:

| Certainty about what to build | Action |
|-------------------------------|--------|
| **High** — clear spec, known pattern | Create ticket and assign |
| **Medium** — mostly clear, few open questions | Create ticket, add questions as comments |
| **Low** — unclear requirements, multiple approaches | Discuss first, then create ticket |
| **None** — don't even know if this is the right work | Escalate to manager/planner |

---

## Part 2: Mapping to Agent Collaboration

### Agent Equivalents of Human Coordination

| Human Pattern | Agent Equivalent | Existing Tool |
|---------------|-----------------|---------------|
| Create ticket | `request_task` | ✅ Exists |
| Assign to self | `request_task` (same role) | ✅ Exists (R9-1 fix) |
| Escalate to manager | `bounce_task` / `report_status` | ✅ Exists |
| Post status update | `write-block` to shared doc | ✅ Exists |
| Slack message / quick question | `discuss post` with mention | ✅ Exists |
| Meeting (alignment) | `discuss` thread (multi-round) | ✅ Exists but **no clear use cases** |
| PR review comments | `discuss` on task doc | ✅ Exists |
| Decision recording | `discuss decide` | ✅ Exists |

### When Should Agents Discuss? (Use Cases)

Based on human patterns, here are the **specific situations** where agent discussion adds value:

#### Use Case 1: Design Review Before Downstream Depends On It
```
Backend builds database schema (task-1)
Frontend depends on schema for API types (task-3)

Before task-1 completes:
  Backend agent posts schema to shared doc (write-block)
  Frontend agent reads and reviews (discuss post: "fields X and Y are missing for the UI")
  Backend agent adjusts before marking complete
  
Result: task-3 starts with a validated schema, no bounce needed
```
**When:** Upstream task has downstream dependants that need specific output format
**Trigger:** Task has dependants AND output is structural (schema, API contract, interface)

#### Use Case 2: Ambiguous Task — Agent Needs Clarification
```
Agent gets task: "Implement user authentication"
No spec on JWT vs sessions, no schema for user model

Agent posts to task discussion:
  "Unclear: should auth be JWT or session-based? What fields on User?"
  mentions: ["planner"] or mentions: ["backend-lead"]
  
Planner or mentioned role responds with clarification
Agent proceeds with clear spec
```
**When:** Task description is insufficient to start work
**Trigger:** Agent can't determine WHAT to build from description alone
**Note:** This is what the "When Context Is Missing" escalation protocol already handles

#### Use Case 3: Conflict Resolution Between Agents
```
Backend says: "Date fields should be Unix timestamps"
Frontend says: "Date fields should be ISO-8601 strings"

Both post to a shared discussion doc
Planner or senior agent records decision
Both proceed with the agreed format
```
**When:** Two agents have incompatible approaches and both are reasonable
**Trigger:** This is rare in a planned system — planner should prevent it

#### Use Case 4: Handoff with Complex Context
```
Agent-1 completed a complex task with many edge cases
Agent-2 depends on it and needs to understand the nuances

Agent-1 writes a detailed summary to the task discussion:
  "Here's what I built, the edge cases I found, and what to watch out for"
  
Agent-2 reads this BEFORE starting work
```
**When:** `complete_task` summary isn't enough to convey complexity
**Trigger:** High-complexity task with non-obvious decisions made during execution
**Note:** This is already partially solved by `deliverables` + `workspace_read_file`

#### Use Case 5: Blocked Agent Needs Collaborative Debugging
```
QA agent found a test failure but can't determine root cause
Posts to discussion: "Test X fails with error Y — is this a backend or frontend issue?"
Mentions both roles
Whoever can identify the issue responds
```
**When:** Agent is stuck and doesn't even know WHO should fix it
**Trigger:** Error that spans multiple domains

### When Should Agents NOT Discuss?

| Situation | Right action instead |
|-----------|---------------------|
| Task is clear → just do it | Execute task, call `complete_task` |
| Need work from another role, spec is clear | `request_task` with good context |
| Task is wrong for my role | `bounce_task` immediately |
| Need a status update from another agent | `collab read` their task output |
| Want to share findings | `write-block` to shared doc (informational, not conversational) |

---

## Part 3: The Discussion Lifecycle Gap

### How Discussion Docs Work Today

Discussion CRDT docs are **task-scoped** — created by `initCollabDocs()` when `dispatchTask()` runs:
```
Task dispatched → initCollabDocs(taskId) → creates {taskId}/discussion Y.Doc
```

This means:
- `task-1/discussion` exists only when task-1 is dispatched to an agent
- The agent on task-1 can `discuss post` on `task-1/discussion`
- **Only the agent assigned to task-1 is actively working** — other roles are either on different tasks or not running

### The Chicken-and-Egg Problem

**Scenario:** Backend agent (task-1) wants to align with Frontend (not yet started) on schema format.

| What agent wants | What exists | Problem |
|-----------------|-------------|---------|
| Discuss with frontend role | task-1/discussion | Frontend agent isn't running — no one reads it |
| Create task for frontend first, then discuss | Need task-2/discussion | Task already committed — discussion is post-hoc |
| Open a standalone "meeting room" | Nothing | No standalone discussion concept exists |

### When Are Multiple Agents Running Simultaneously?

This is the key constraint. Discussion only works if BOTH parties are active:

```
Timeline:
  task-1 (backend) ──────────────────►
  task-2 (frontend)                          ──────────────────►
                    ↑                        ↑
              backend working           frontend starts
              (frontend not running)    (backend may be done)
```

With the current sequential-ish execution (MAX_CONCURRENT_DISPATCHES = 2), two agents CAN run simultaneously when their tasks are both "ready" at the same time (no dependency between them). But for dependent tasks (task-2 depends on task-1), they're sequential by design — frontend starts AFTER backend completes.

**So real-time discussion between dependent roles is impossible in the current model.** The backend agent is done before the frontend agent starts.

### What Discussion IS Good For (Given Current Architecture)

| Scenario | Works? | Why |
|----------|--------|-----|
| Two parallel tasks on different roles (no dependency) | ✅ Yes | Both agents running simultaneously |
| Agent discusses with planner | ✅ Yes | Planner is always "running" (reads via notifications) |
| Agent leaves async note for future agent | ✅ Yes | `write-block` to shared doc, read later |
| Agent asks a question and waits for response | ❌ No | Other agent may not be running |
| Design review between dependent tasks | ❌ No | Upstream finishes before downstream starts |

### The Mechanism Already Exists — `request_task({ type: "collaboration" })`

From diagram [05-discussion-event-flow](../task-orchestration/markdown-tasks/diagrams/05-discussion-event-flow.md), the architecture already defines this:

```
Phase 1: Agent creates collaboration task
  request_task({ type: "collaboration", targetRole: "frontend-dev", relationship: "blocks-me" })
  → Task created, dispatched → target agent starts
  → Both agents now online, sharing task-N/discussion CRDT doc

Phase 2: CRDT discussion docs initialized
  → Y.Array("discussion"), Y.Map("decisions"), Y.Map("config"), Y.Map("cursors")

Phase 3: Both agents discuss via CRDT
  → discuss post / discuss read (cursor-tracked)
  → Guard rails: maxRounds, maxTokens, timeout

Phase 4: User can join (frontend HocuspocusProvider connects)

Phase 5: Decision recorded → collaboration task completes
  → Requesting agent's task unblocks (if blocks-me)
```

The task schema already supports this: `type: work | review | collaboration | subtask`

**So the mechanism works. What's missing is: WHEN should an agent choose `type: "collaboration"` vs `type: "work"` vs just doing the task?**

---

## Part 4: When to Use Each Task Type (Decision Framework)

### The Certainty Spectrum (from Part 1)

| What the agent knows | What it should do | Task type |
|---------------------|-------------------|-----------|
| **"I know exactly what I need built"** | Create a work task with clear spec | `type: "work"` |
| **"I need someone to review what I built"** | Create a review task | `type: "review"` |
| **"I need to align with another role before I proceed"** | Create a collaboration task | `type: "collaboration"` |
| **"I need a sub-piece done to complete my own task"** | Create a subtask | `type: "subtask"` |
| **"I'm stuck — I don't know what I need"** | Escalate to planner | `report_status` / `bounce_task` |

### When to Create a Collaboration Task (Specific Triggers)

An agent should create `type: "collaboration"` when:

1. **It needs input that only another role can provide, AND the right answer isn't obvious**
   - "I'm building the API but I don't know what response format the frontend expects"
   - NOT: "Build me a login page" (that's a work task with clear spec)

2. **It's building something structural that downstream roles depend on**
   - "I've designed the schema — frontend, does this cover your needs?"
   - The `blocks-me` relationship ensures the requesting agent's task waits for the collaboration to complete

3. **Two parallel agents have conflicting approaches and need to resolve**
   - "Backend uses timestamps, frontend uses ISO strings — let's agree"
   - Rare in a well-planned system, but the escape valve exists

4. **The agent hit something unexpected that crosses domain boundaries**
   - "Found a security issue in the auth flow — need both backend and infra input"

### When NOT to Create a Collaboration Task

| Situation | Right action | Why NOT collaboration? |
|-----------|-------------|----------------------|
| I know exactly what I need another role to build | `request_task({ type: "work" })` | No alignment needed — just delegate |
| My task description is vague | `report_status` with blockers | This is a planner problem, not a cross-role problem |
| I want to share what I built | `write-block` + include in `complete_task` deliverables | Informational, not conversational |
| I need a status update from another agent | `collab read` their task output | Read, don't meet |
| Task is wrong for my role | `bounce_task` immediately | Don't discuss — just return it |

### The Key Principle

> **Collaboration tasks are for answering questions that have multiple valid answers.**
> If there's ONE right answer, create a work task. If there are MANY valid answers and you need alignment, create a collaboration task.

---

## Part 5: What's Missing vs What Exists

### Already Designed and Wired

| Component | Status | Source |
|-----------|--------|--------|
| `request_task` with `type: "collaboration"` | ✅ Schema exists | Task.md format in feature_architecture.md |
| Discussion CRDT docs (Y.Array, Y.Map) | ✅ Wired | CrdtTaskSync.initCollabDocs() |
| Guard rails (maxRounds, maxTokens, timeout) | ✅ Wired | collab discuss in tools/index.ts |
| Discussion event flow | ✅ Wired | HocuspocusServer → SocketServerV2 → Frontend |
| Decision recording | ✅ Wired | discuss decide → Y.Map("decisions") |
| User participation | ✅ Wired | HocuspocusProvider in frontend |

### Gaps to Close

| Gap | What's needed | Effort |
|-----|---------------|--------|
| **No prompt guidance on task types** | Worker prompt: when to use `work` vs `collaboration` vs `review` | 1 day |
| **`type: "collaboration"` not handled differently in dispatch** | Lighter dispatch for collaboration tasks (no workspace needed, shorter timeout) | 1-2 days |
| **Dependant awareness missing** | `enrichedDescription` should tell agents about their downstream dependants | 0.5 day |
| **Requesting agent doesn't know how to use blocks-me** | Prompt: "After creating blocks-me task, call report_status and exit — you'll be re-dispatched when it completes" | Already in tool-audit doc, needs implementation |

---

## Part 6: Architecture Options

### Option A: Prompt Guidance Only

**Implementation:** Add the decision framework (Part 4) to the worker prompt and SKILL.md. No code changes.

**Effort:** 1 day

### Option B: Prompt Guidance + Lightweight Collaboration Dispatch

**Implementation:** Option A plus: when `type: "collaboration"` task is dispatched, use a lighter prompt (no workspace tools, just discuss + write-block + complete_task) and shorter timeout.

**Effort:** 2-3 days

### Option C: Option B + Dependant Awareness

**Implementation:** Option B plus: `enrichedDescription` tells agents "These tasks depend on YOUR output" so they know when their work is structural and may need cross-role alignment first.

**Effort:** 3-4 days

---

## Recommendation

**Option C** — because:
1. The collaboration mechanism already exists (diagram 05 is the spec)
2. What's missing is agent JUDGMENT about when to use it (prompt guidance)
3. Lighter dispatch for collaboration tasks prevents wasted resources (no workspace clone needed)
4. Dependant awareness helps agents decide: "my output is structural → maybe align first via collaboration task"
5. All 3 pieces are small, independent, and non-breaking

**Decision Required:** Proceed with A, B, or C?

---

## Appendix: External Research

### Multi-Agent Collaboration Patterns (from `agent-collab-docs/research.md`)

| System | Approach | Relevant? |
|--------|----------|-----------|
| **CrewAI** | Sequential/hierarchical message passing | No CRDT, no persistence |
| **AutoGen** | Agent chat groups with round-robin | Similar discuss model, no task DAG |
| **DPT-Agent** (ACL 2025) | Dual-process: System 1 (fast I/O) + System 2 (deep work) | Validates concurrent discussion + work |
| **Mastra** | Workflow-driven with tool delegation | No inter-agent negotiation |
| **MToM** | Agent→doc writes are informational, not conversational | Key insight: discussion ≠ document |

### Key Insight from Research
> "Agent→doc writes should be **informational** (status, findings), NOT conversational (asks). Conversation goes in chat/discussion." — MToM pattern

This supports keeping `discuss` for negotiation and `write-block` for deliverables, rather than mixing them.
