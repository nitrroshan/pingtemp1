# Tool Audit & Enhancement Recommendations

**Date:** April 13, 2026  
**Scope:** Full L1/L2 tool chain, request_task flow, agent prompt, CRDT wiring  
**Source:** Deep audit of WorkerPool → AgentManagerV2 → OrchestratorService → plugins → tools

---

## Current Tool Inventory (Complete)

### What Each Worker Agent Gets

```
┌─────────────────────────────────────────────────────────────────┐
│ TOOL INJECTION ORDER (WorkerPool.runTask)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 1. BASE TOOLS (always)                                           │
│    ├─ report_status   → status + progress callback               │
│    └─ complete_task   → completion callback → orchestrator       │
│                                                                  │
│ 2. TASK TOOLS (if taskStore set — after approvePlan)             │
│    ├─ request_task    → create tasks for other roles             │
│    └─ bounce_task     → return misassigned tasks                 │
│                                                                  │
│ 3. PLUGIN TOOLS (via pluginRegistry.getTools)                    │
│    │                                                             │
│    ├─ WorkspacePlugin                                            │
│    │  ├─ File: create, read, write, delete, exists, list         │
│    │  ├─ VCS: commit, history                                    │
│    │  ├─ Lifecycle: publish, reactivate, discard                 │
│    │  ├─ Activity: log_activity                                  │
│    │  ├─ Search: grep, glob, search_and_replace, file_stats      │
│    │  ├─ Scratchpad: scratch_note, scratch_todo,                 │
│    │  │   scratch_remember, scratch_file, promote_to_workspace   │
│    │  ├─ Keyword search: keyword_search                          │
│    │  └─ Identity: whoami, my_progress, my_tools, my_context     │
│    │                                                             │
│    └─ CollaborationPlugin                                        │
│       └─ collab (unified CRDT tool)                              │
│          ├─ discover → browse L2 categories                      │
│          ├─ list → show keys in a doc                            │
│          ├─ read → get structured data                           │
│          ├─ read-block → get rich text content                   │
│          ├─ write → set structured data (custom docs only)       │
│          ├─ write-block → insert rich text                       │
│          └─ discuss → post/read/decide in discussion docs        │
│                                                                  │
│ 4. SKILL INSTRUCTIONS (from plugin skill files)                  │
│    └─ Injected as system prompt additions                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### What the Worker Prompt Documents

| Tool Category | Documented in Prompt? | Actually Injected? |
|---|---|---|
| report_status, complete_task | ✅ Yes | ✅ Yes |
| Workspace file tools | ✅ Yes | ✅ Yes |
| Scratchpad tools | ✅ Yes | ✅ Yes |
| Identity tools | ✅ Yes | ✅ Yes |
| Collab tools | ✅ Yes | ✅ Yes |
| **request_task** | ❌ **NOT documented** | ✅ Yes (injected) |
| **bounce_task** | ❌ **NOT documented** | ✅ Yes (injected) |

---

## request_task Flow — Full Analysis

### Current Flow

```
Agent calls request_task({ title, description, targetRole, type, priority, relationship })
  │
  ├─ Guard Rails:
  │  ├─ No self-assign (targetRole ≠ callerRole)
  │  ├─ Validate targetRole exists in teamRoles
  │  ├─ Priority ceiling: 2-5 (1 reserved for planner)
  │  └─ Max 5 agent-created tasks per plan (derived from TaskStore)
  │
  ├─ Create Task:
  │  ├─ ID: `task-{timestamp}-{random}`  ← PROBLEM: inconsistent with planner IDs
  │  ├─ status: "pending"
  │  ├─ assigned_role: targetRole (lowercased)
  │  └─ context.createdBy: "agent:{callerRole}"
  │
  ├─ Handle Relationship:
  │  ├─ "blocks-me": currentTask.prerequisites.set(newTaskId, false)
  │  │   + newTask.dependants = [callerTaskId]
  │  ├─ "subtask": newTask.context.parentTask = callerTaskId
  │  └─ "independent": no dependency link
  │
  ├─ Persist:
  │  ├─ taskStore.create(newTask)
  │  ├─ dagResolver.rebuild(taskStore)
  │  └─ crdtTaskSync?.persistTask(newTask)  ← non-fatal if null/fails
  │
  └─ Notify:
     └─ onTaskCreated(newTask)  ← planner notified
        └─ ??? No dispatch trigger  ← PROBLEM
```

### Issues in request_task Flow

1. **No dispatch trigger** (R6-6): After calling `onTaskCreated()`, no one dispatches the new task. The orchestrator's `checkAndDispatchTasks()` only fires after another task completes. An independent agent-created task with no prerequisites sits in "ready" state indefinitely until something else finishes.

2. **Non-sequential IDs** (R6-5): Planner creates `task-1` through `task-9`. Agent creates `task-1713024000000-a1b2c3`. This confuses the discover output and CRDT doc paths.

3. **No "blocks-me" task dispatch**: When relationship is "blocks-me", the agent's current task gets a new prerequisite. But the agent is ALREADY running — it can't pause mid-execution to wait for the new prerequisite. The blocks-me relationship only prevents the task from being dispatched again if it were to re-run, which doesn't happen.

   **What the agent SHOULD do:** After creating a blocks-me task, call `report_status({ status: "blocked", summary: "Waiting for task-N from role-X" })` and exit gracefully (not `complete_task`). Currently the agent has no prompt guidance for this.

4. **Bounce redirects to planner but doesn't reassign**: `bounce_task` marks the task as "failed" and notifies the planner. The planner then needs to decide what to do — but there's no automated reassignment to the `suggestedRole`. The planner would need to create a new task manually.

---

## Enhancement Recommendations

### 1. Complete Worker Prompt — request_task & bounce_task Documentation

**Short-term fix (done):** Added to `getGenericWorkerPrompt()` — but this only reaches agents created from LLM role discovery (teams without plugins). **Plugin-based teams use `.md` agent files which have zero tool documentation.**

**Long-term fix (needed):** Create a **task-lifecycle SKILL.md** in `@ping/agent-manager/skills/task-lifecycle/SKILL.md` that gets injected via the plugin skill system — same pattern as `workspace-guide` and `collab-guide`. This reaches ALL agents regardless of prompt source.

The SKILL.md should cover:
- `report_status` — when and how to report progress, blockers
- `complete_task` — when to call, what to include
- `request_task` — full guidelines for creating tasks (relationships, priority, limits)
- `bounce_task` — when to bounce, what to include
- "When Context Is Missing" escalation protocol
- Decision tree: "Tool returned empty → report_status(blocked) → request_task(blocks-me)"

**Why SKILL.md, not prompt:** Plugin `.md` agents have domain-specific prompts (`<agent-identity>`, `<domain-instructions>`). These are specialized and shouldn't be polluted with generic tool docs. The skill system (`appendSystemPrompt()` in WorkerPool) is designed exactly for this — cross-cutting instructions injected at runtime.

**Architecture:** `workspace-guide SKILL.md` teaches workspace tools. `collab-guide SKILL.md` teaches collab tool. `task-lifecycle SKILL.md` would teach task lifecycle tools. All three are injected into every agent's system prompt via `pluginRegistry.getSkillInstructions()`.

```markdown
### Task Management — Create & Reassign

| Tool | Purpose |
|------|---------|
| **request_task** | Create a new task for another role when you need specialized work |
| **bounce_task** | Return this task if it's misassigned or you can't do it |

**request_task guidelines:**
- Target a specific role (e.g., "frontend-dev", "qa", "devops")
- Relationship types:
  - `"blocks-me"`: You need the result before you can finish → creates prerequisite
  - `"subtask"`: Delegated sub-work — related but not blocking
  - `"independent"`: Unrelated work you noticed needs doing
- Priority: 2 (highest agent can set) to 5 (lowest)
- Limit: 5 tasks per agent per plan

**bounce_task guidelines:**
- Use when: wrong role, missing required skills, task is unclear
- Provide a clear reason and suggest the right role
- This marks your task as failed — the planner will reassign
```

### 2. Missing Context Protocol

Agents need explicit instructions for when CRDT reads return empty. Currently they hallucinate work.

```markdown
## When Context Is Missing or Tools Fail

If `collab read` returns empty data, `my_context` shows no dependency outputs, or
you cannot access the information you need to do your task properly:

1. Report the blocker: `report_status({ status: "blocked", summary: "..." })`
2. If another role has the data you need: `request_task({ relationship: "blocks-me", ... })`
3. Do NOT fabricate work based on assumptions
4. Do NOT call `complete_task` with hallucinated output
5. If you can do partial work, do it and report what's missing in the summary
```

### 3. Task Dispatch After Agent-Created Tasks

When `request_task` creates an independent task with no prerequisites, it should trigger dispatch immediately — not wait for another task to complete.

**Implementation:** In `requestTaskTool.ts`, after `onTaskCreated()`:
```typescript
// If independent task with no prerequisites, trigger dispatch
if (input.relationship === "independent" || input.relationship === "subtask") {
  ctx.onDispatchReady?.();   // New callback to trigger checkAndDispatchTasks()
}
```

### 4. Sequential Task IDs for Agent-Created Tasks

Agent-created task IDs should follow the same pattern as planner-created ones:

```typescript
// Instead of: `task-${Date.now()}-${randomHex}`
// Use: `task-${maxExistingNum + 1}`
const nums = taskStore.getAll().map(t => {
  const m = t.id.match(/^task-(\d+)$/);
  return m ? parseInt(m[1]) : 0;
});
const nextId = `task-${Math.max(0, ...nums) + 1}`;
```

### 5. Fix Y.Map Name Resolution (R5-2 + R6-1)

The collab tool uses `doc.getMap(docName)` which is wrong for system docs. Fix by detecting the actual Y.Map name from the doc's shared types:

```typescript
function resolveMapName(doc: CollabDocument, docName: string): string {
  // System docs use type-based names: "task", "plan", "goal", "_index"
  const known = ["task", "plan", "goal", "_index", "config", "cursors", "decisions"];
  const json = doc.toJSON();
  for (const name of known) {
    if (json[name] && Object.keys(json[name]).length > 0) return name;
  }
  // Custom docs use docName as map name (backward compat)
  return docName;
}
```

Apply to: `read` action (line 477), `list` action (line 433), and full-doc reads (line 483 `json[docName]`).

### 6. Wire `setGoalId` on Plan Approval (R5-1)

In `OrchestratorService.approvePlan()` after `resolveForGoal(goalId)`:

```typescript
// Update the collaboration plugin so worker tools read from the correct goal space
const collabPlugin = this.pluginRegistry?.get("collaboration");
if (collabPlugin && typeof (collabPlugin as any).setGoalId === 'function') {
  (collabPlugin as any).setGoalId(goalId);
}
```

### 7. CRDT Persistence Error Handling (R6-4)

Wrap persitTask loop in try/catch:

```typescript
const crdtTaskSync = this.crdtTaskSyncProxy?.get?.();
if (crdtTaskSync) {
  let persistedCount = 0;
  for (const task of this.taskStore.getAll()) {
    try {
      await crdtTaskSync.persistTask(task);
      persistedCount++;
    } catch (err) {
      logger.error(`Failed to persist task ${task.id} to CRDT: ${err}`);
    }
  }
  logger.info(`Persisted ${persistedCount}/${this.taskStore.getAll().length} tasks to CRDT`);
  // ... persist plan and index
}
```

---

## Tools That Should Be Added (Future)

| Tool | Why | Priority |
|------|-----|----------|
| **ask_user** | Agent needs human input for ambiguous requirements. Currently agents hallucinate instead of asking. | HIGH |
| **delegate_to_role** | Direct message to another role's agent (not task creation — just a query). Lightweight alternative to request_task for questions. | MEDIUM |
| **read_dependency_output** | Simplified wrapper to read upstream task outputs. Currently agents need to know CRDT doc paths. | MEDIUM |
| **get_team_status** | See all agents' progress at a glance. Currently need collab discover → tasks → read each. | LOW |

---

## CRITICAL: Agent Loop Enforcement Failure (R7)

**Date added:** April 13, 2026  
**Status:** OPEN — needs fix before agents can reliably defer/bounce tasks  

### Problem

Agents have `request_task`, `bounce_task`, `report_status`, and `complete_task` tools. The task-lifecycle SKILL.md tells them when to use each. **But there is ZERO technical enforcement.** After calling `report_status(blocked)`, agents get another LLM turn and can call `complete_task` with fabricated output. After calling `bounce_task`, the agent loop continues and the agent can keep working on the bounced task.

**Root cause:** The AI SDK `streamText()` loop uses `isLoopFinished()` (model-level) as the only stop condition. It has NO knowledge of which tools should be terminal. `complete_task` and `bounce_task` return text messages — the agent treats them as informational, not terminal.

### Evidence

From live testing:
1. Agent calls `collab read` → gets empty data
2. Agent calls `report_status({ status: "blocked" })` correctly
3. Agent then calls `complete_task` with fabricated output anyway
4. Loop never stops — `isLoopFinished()` is model-level only

### Possible Fixes

#### Fix A: `hasToolCall()` stop condition (RECOMMENDED — simplest, most reliable)

AI SDK v6 exports `hasToolCall(toolName)` as a `StopCondition`. Add it to the `stopWhen` array:

```typescript
// AiSdkAgent.ts executeToolMode():
import { hasToolCall } from "ai";

const stopConditions: StopCondition<ToolSet>[] = [];
stopConditions.push(isLoopFinished());
stopConditions.push(stepCountIs(200));
stopConditions.push(hasToolCall("complete_task"));   // ← STOP after complete
stopConditions.push(hasToolCall("bounce_task"));     // ← STOP after bounce
```

**Pros:** 
- Uses official AI SDK API
- 2 lines of code
- Agent gets exactly ONE turn after calling complete/bounce (to see the tool's return message), then loop halts
- No custom stop logic needed

**Cons:**
- `hasToolCall` might stop BEFORE the tool executes (need to verify — does it check "tool was called" or "tool call is pending"?)
- Need to verify exact AI SDK v6 semantics

**Risk:** Low — `hasToolCall` is a documented AI SDK feature

#### Fix B: `complete_task` blocks when `report_status(blocked)` was called

Track blocked state in a shared closure between tools. If agent reported "blocked", `complete_task` refuses to complete:

```typescript
// In WorkerPool.runTask(), create shared state:
const agentState = { blocked: false, bounced: false };

// reportStatusTool: 
if (input.status === "blocked") agentState.blocked = true;

// completeTaskTool:
if (agentState.blocked) {
  return "ERROR: Cannot complete task — you reported 'blocked'. Use bounce_task to return this task, or use request_task to create a blocking dependency.";
}

// bounceTaskTool:
agentState.bounced = true;
```

**Pros:**
- Prevents completing while blocked — structural guarantee
- Agent sees an error and may course-correct

**Cons:**
- Agent can just call `report_status({ status: "in_progress" })` to clear blocked state, then complete
- Adds state coupling between tools
- Doesn't actually stop the loop — agent still gets turns

#### Fix C: `bounce_task` throws to exit the generator

Make `bounce_task` throw a special error that the execution loop catches:

```typescript
// bounceTaskTool:
class BounceSignal extends Error {
  constructor(public data: any) { super("TASK_BOUNCED"); }
}
// In tool execute:
throw new BounceSignal({ taskId, reason, suggestedRole });

// In AiSdkAgent executeToolMode or WorkerPool:
catch (e) {
  if (e instanceof BounceSignal) {
    callbacks.onBounce(e.data);
    return; // Exit generator
  }
}
```

**Pros:** Guarantees loop exit on bounce
**Cons:** 
- Error-based flow control is an anti-pattern
- May interfere with AI SDK's internal error handling
- Doesn't help with `complete_task` (which needs to NOT stop if work is valid)

#### Fix D: Custom `StopCondition` function

Write a custom stop condition that tracks tool calls:

```typescript
function hasCalledTerminalTool(): StopCondition<ToolSet> {
  const terminalTools = new Set(["complete_task", "bounce_task"]);
  let called = false;
  
  return {
    check({ steps }) {
      // Check if any step called a terminal tool
      for (const step of steps) {
        if (step.toolCalls?.some(tc => terminalTools.has(tc.toolName))) {
          called = true;
        }
      }
      return called ? { type: "stop", reason: "terminal-tool-called" } : { type: "continue" };
    }
  };
}
```

**Pros:** Full control over logic
**Cons:** Requires understanding AI SDK's StopCondition interface (may not match this shape)

### Recommendation

**Fix A (`hasToolCall`)** is the right approach — it uses the official AI SDK API, requires 2 lines of code, and provides the exact behavior we need: stop the loop after `complete_task` or `bounce_task` is called.

**Fix B (block complete when blocked)** should be added as a secondary guard — prompt-level instruction that `complete_task` tool ALSO enforces. This catches the case where an agent tries to complete without having done real work.

**Order:** Fix A first (loop termination), then Fix B (blocked-state guard).

### What about `request_task`?

`request_task` should NOT stop the loop — the agent may need to continue working after creating a task. Only `complete_task` and `bounce_task` are terminal.

For `blocks-me` relationships: after calling `request_task(blocks-me)`, the agent should call `report_status(blocked)` and then `bounce_task` to hand back the task until the dependency completes. The SKILL.md documents this flow but can't enforce it. Fix B helps here — if agent reports blocked, it can't complete.

| Principle | Grade | Notes |
|-----------|-------|-------|
| **S — Single Responsibility** | ✅ | Each tool does one thing. Collab tool is the one exception — it's a multi-action facade, but acceptable for discoverability. |
| **O — Open/Closed** | ✅ | Plugin system allows adding tools without modifying WorkerPool. New plugins = new tools. |
| **L — Liskov Substitution** | ✅ | All tools implement `StructuredToolInterface`. Any tool can be swapped. |
| **I — Interface Segregation** | ⚠️ | Collab tool has 7 actions. Could be split into `collab_read`, `collab_write`, `collab_discover` for clearer agent UX. But the single tool reduces tool count. Acceptable tradeoff. |
| **D — Dependency Injection** | ✅ | All tools receive their dependencies via factory params. No hard-coded singletons. |

Tools are well-structured. The issues are in **wiring** (R5-1, R6-4, R6-6) and **documentation** (R6-2, R6-3), not in the tools themselves.

---

## Inter-Agent Task Passing & Collaboration Design (R8)

**Date:** April 14, 2026  
**Problem:** Agents can't effectively create tasks, pass work, or coordinate with each other. `request_task` exists but agents never use it because (1) they don't know team roles, (2) `complete_task` is easier, (3) there's no enforcement.

### What Exists Today

| Mechanism | Status | Gap |
|-----------|--------|-----|
| `request_task` tool | ✅ Built, injected | Agents don't use it — no role visibility, too complex (6 fields) |
| `bounce_task` tool | ✅ Built, injected | Agents don't use it — `complete_task` has no guard |
| Discussions (CRDT) | ✅ Built | Passive polling only — no auto-routing on @mentions |
| Task output flow | ✅ Built | `previousOutputs` flow downstream automatically |
| Planner notification | ✅ Built | Planner sees completions/bounces via `notifyPlanner()` |
| Team role visibility | ❌ Missing | Workers have zero knowledge of who's on the team |
| Loop enforcement | ❌ Missing | `complete_task`/`bounce_task` don't stop the execution loop |

### Design: 3-Part Fix

#### Part 1: Make agents AWARE (team context in dispatchTask)

**Problem:** Agent gets a task but has zero knowledge of who else is on the team.

**Fix:** In `OrchestratorService.dispatchTask()`, inject team roster into enriched description:

```
## Your Team
Available roles you can create tasks for or collaborate with:
- backend-dev — Backend API development, database design
- frontend-dev — React UI components, user experience  
- qa — Testing, quality assurance, code review
- devops — Deployment, CI/CD, infrastructure

Use request_task({ targetRole: "role-name" }) to create work for another role.
Use bounce_task() to return this task if it should go to a different role.
```

**Source:** `this.teamRoles` + agent definitions from WorkerPool.

#### Part 2: Make the right behavior ENFORCED (code-level guards)

**Fix A — Loop termination:**
```typescript
// AiSdkAgent.ts: add to stopWhen
import { hasToolCall } from "ai";
stopConditions.push(hasToolCall("complete_task"));
stopConditions.push(hasToolCall("bounce_task"));
```
After calling either tool, the execution loop STOPS.

**Fix B — Blocked guard:**
```typescript
// In WorkerPool.runTask(), shared state between tools:
const agentState = { lastStatus: "in_progress" };

// reportStatusTool: agentState.lastStatus = input.status;
// completeTaskTool: if (agentState.lastStatus === "blocked") → reject
```
Agent can't complete while blocked. Forces `bounce_task` or `request_task`.

#### Part 3: Make task passing NATURAL

Three approaches from simplest to most sophisticated:

**Approach A: `defer_task` — one-action "I need help" (RECOMMENDED for Phase 2)**

A simplified tool that combines bounce + request + dependency link:

```typescript
defer_task({
  reason: "Need the database schema before I can build the API",
  needFrom: "backend-dev",      // which role should help
  whatINeed: "Database schema with table definitions"
})
```

Internally:
1. Creates a new task for `needFrom` role
2. Sets new task as prerequisite of current task  
3. Marks current task as "deferred" (not failed — will auto-resume)
4. When new task completes → current task becomes "ready" → re-dispatches with upstream output
5. Notifies planner

**Why this works:** Single intent, 3 fields, no DAG knowledge needed. The tool handles orchestration.

**Approach B: Discussion-triggered tasks (Phase 3)**

Agent posts in discussion with `type: "request"` + `@mention`:
```
collab({ action: "discuss", docName: "task-5/discussion", key: "post", value: {
  content: "I need the DB schema. @backend-dev can you provide table definitions?",
  type: "request",
  mentions: ["backend-dev"]
}})
```

The planner monitors discussion events and creates tasks from requests. Natural conversation → task creation.

**Approach C: Planner-reviewed agent tasks (Phase 3)**

Agent calls `request_task` → goes to planner approval queue → planner approves/modifies → task created.

### Recommendation (Priority Order)

**Phase 1 — Immediate (code fixes):**
1. Inject team roles into enriched task description
2. Add `hasToolCall("complete_task")` + `hasToolCall("bounce_task")` stop conditions
3. Add blocked guard on `complete_task`

**Phase 2 — Next (new tool):**
4. Create `defer_task` tool — single-action "I need X from Y" with auto-resume
5. Keep `request_task` for advanced cases (independent tasks, reviews, subtasks)

**Phase 3 — Future (collaboration):**
6. Discussion-triggered task proposals via planner monitoring
7. Planner review queue for agent-created tasks
