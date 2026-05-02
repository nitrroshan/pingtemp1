# Approval System — Feature Architecture

**Phase:** 2
**ID:** A9

---

## Problem

Agents make decisions that need human oversight: starting execution plans, running destructive tools, publishing artifacts. Without a structured approval system, we either:
- Block on every action (unusable for autonomous teams)
- Auto-approve everything (dangerous for destructive operations)
- Use ad-hoc `ask_user` with `["Approve", "Reject"]` options (no context, no audit trail, no rules)

**Additional problem:** There's no per-agent execution control. Every agent runs the same way. Users need fine-grained control over how each agent operates — from fully autonomous to fully manual, with edit/review modes in between.

---

## Research: How Agent SDKs Handle Approval & Modes

| Framework | Tool Approval | Dynamic Approval | Task/Tool Classification | Sticky Decisions |
|---|---|---|---|---|
| **AI SDK v6** (our runtime) | ✅ `needsApproval: true` on tool | ✅ `needsApproval: async (args) => bool` | ❌ Not built-in | ❌ Manual via messages |
| **Claude Code** | ✅ Per-tool `allow/ask/deny` rules with pattern matching | ✅ `autoMode` has ML classifier with configurable rules | ✅ 6 permission modes: `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions` | ✅ Per-session allowlists |
| **OpenAI Agents SDK** | ✅ `needs_approval` per tool (bool or async fn) | ✅ `on_approval` callback for programmatic decisions | ✅ Tool guardrails (input/output validation) | ✅ `always_approve=True` / `always_reject=True` survives serialization |
| **Cursor** | ✅ Mode changes available tools | ❌ Binary | ✅ Normal / Plan / Edit modes | ❌ No |

### Key Insight: Two Independent Axes (from Claude Code + OpenAI research)

Claude Code separates **permission mode** (what the overall behavior is) from **per-tool rules** (`allow/ask/deny` patterns like `Bash(git push *)`). These are independent — mode controls default behavior, but per-tool rules always override.

OpenAI Agents SDK has the same pattern: `needs_approval` is per-tool, sticky decisions (`always_approve`) are per-session, and guardrails are independent validators.

**Our design follows this principle: two independent control axes.**

### AI SDK v6 Native Support

AI SDK v6 has **built-in tool approval** via `needsApproval`:

```typescript
// Dynamic — conditional based on args
const paymentTool = tool({
  description: 'Process payment',
  inputSchema: z.object({ amount: z.number() }),
  needsApproval: async ({ amount }) => amount > 1000,
  execute: async ({ amount }) => { /* ... */ }
});
```

**Flow:**
1. `streamText()` returns `tool-approval-request` parts in `result.content`
2. App collects user decision
3. App adds `tool-approval-response` to messages (`approved: true/false`)
4. Calls `streamText()` again — tool either executes or model sees denial

---

## Two-Axis Control Model

Instead of a single "mode" that conflates task dispatch and tool execution, we separate into **two independent axes**:

### Axis 1: Task Dispatch Policy (ChatAgent level)

Controls **when tasks are dispatched to workers** — the ChatAgent's decision when a task becomes `ready`.

| Dispatch Policy | Behavior | Use Case |
|---|---|---|
| **`auto`** | Dispatch immediately when task becomes ready | Trusted workflow, CI/CD |
| **`supervised`** | Dispatch immediately, but notify user in UI | Default — user sees what's happening |
| **`manual`** | Queue task, wait for user to click "Start" | Review-first, sensitive operations |

**Task type filtering** — within any dispatch policy, specific task types can be overridden:

```typescript
// Per-agent: which task types auto-dispatch vs require approval
autoDispatchTypes: ['work', 'subtask', 'research']     // these auto-start
requireApprovalTypes: ['decision', 'review']            // these always queue
```

This means: an agent in `supervised` dispatch with type filters will auto-start `work` tasks but queue `decision` tasks for user approval — regardless of what happens during execution.

### Axis 2: Tool Execution Policy (Worker level)

Controls **which tool calls need approval during task execution** — the AiSdkAgent's behavior when the model calls a tool.

| Tool Policy | Behavior | Use Case |
|---|---|---|
| **`auto`** | All tools execute without asking | Fully trusted agent |
| **`supervised`** | Destructive tools need approval, safe tools run freely | Default — balanced |
| **`acceptEdits`** | File write tools auto-accepted, bash/deploy need approval | Code-focused agents |
| **`manual`** | Every tool call needs explicit approval | Maximum oversight |

Per-tool overrides (Claude Code pattern: `allow/deny` rules):

```typescript
// Per-agent tool overrides — apply regardless of tool policy
toolRules: {
  allow: ['read_file', 'search', 'get_status'],     // never ask
  deny: ['deploy', 'delete_database'],                // always block
  ask: ['run_command', 'write_file'],                 // always ask
}
```

### Why Two Axes Are Better

```
COMMON REAL-WORLD SCENARIOS:

1. "Auto-dispatch, supervised tools" (most common)
   dispatch: auto, tools: supervised
   → Tasks start immediately, but bash/delete needs approval
   
2. "Manual dispatch, auto tools" (review-then-trust)
   dispatch: manual, tools: auto
   → User picks which tasks to start, but once started, let it run
   
3. "Auto dispatch, acceptEdits" (code-focused)
   dispatch: auto, tools: acceptEdits
   → Tasks start immediately, file edits auto-accepted, bash needs approval

4. "Manual everything" (maximum control)
   dispatch: manual, tools: manual
   → User approves task start AND every tool call

SINGLE-MODE CAN'T EXPRESS:
   - Scenario 2 is impossible with single mode (manual blocks everything)
   - Scenario 3 conflates edit-mode with dispatch policy
```

### Per-Agent Configuration

```yaml
# Agent YAML definition
---
id: backend-dev
name: Backend Developer
role: backend-dev

# Two independent axes
dispatch:
  policy: supervised              # auto | supervised | manual
  autoDispatchTypes:              # task types that auto-start in supervised mode
    - work
    - subtask
    - research
  requireApprovalTypes:           # task types that always queue for user
    - decision
    - review

tools:
  policy: supervised              # auto | supervised | acceptEdits | manual
  rules:                          # per-tool overrides (Claude Code pattern)
    allow:                        # these never ask
      - read_file
      - search
      - get_status
    ask:                          # these always ask
      - run_command
    deny:                         # these are blocked
      - deploy_production
---
```

```typescript
// Runtime override via Socket.IO — each axis independently
socket.emit("action", {
  type: "set-dispatch-policy",
  agentId: "backend-dev",
  goalId: "goal-123",
  policy: "manual"
});

socket.emit("action", {
  type: "set-tool-policy",
  agentId: "backend-dev",
  goalId: "goal-123",
  policy: "auto"
});
```

---

## Four Approval Types

| Type | Who Requests | What's Approved | When |
|---|---|---|---|
| **Plan approval** | Planner | Full task plan (DAG of tasks) | Before execution starts |
| **Replan approval** | Planner | Replacement plan | During execution, when plan changes |
| **Tool approval** | Worker | Destructive tool call (args visible) | Before tool executes |
| **Artifact approval** | Worker | Output artifact (file, deploy, etc.) | After worker produces output, before publishing |

---

## Core Types

### Dispatch & Tool Policies

```typescript
/** Task dispatch policy — controls ChatAgent's behavior when tasks become ready */
type DispatchPolicy = 'auto' | 'supervised' | 'manual';

/** Tool execution policy — controls which tool calls need approval during execution */
type ToolPolicy = 'auto' | 'supervised' | 'acceptEdits' | 'manual';

/** Existing task types from Task.types.ts — used for dispatch filtering */
type TaskType = 'work' | 'review' | 'collaboration' | 'discussion' | 'subtask' | 'decision' | 'research';

/** Per-agent dispatch configuration */
interface DispatchConfig {
  /** How tasks are dispatched when they become ready */
  policy: DispatchPolicy;
  /** Task types that auto-dispatch in supervised mode (default: all) */
  autoDispatchTypes?: TaskType[];
  /** Task types that always queue for user approval regardless of policy */
  requireApprovalTypes?: TaskType[];
}

/** Per-agent tool execution configuration */
interface ToolPolicyConfig {
  /** How tool calls are handled during execution */
  policy: ToolPolicy;
  /** Per-tool overrides — Claude Code pattern: allow/ask/deny rules */
  rules?: {
    allow?: string[];   // tools that never ask (e.g., read_file, search)
    ask?: string[];     // tools that always ask (e.g., run_command)
    deny?: string[];    // tools that are blocked entirely (e.g., deploy_production)
  };
}

/** Combined agent control config — stored in agent definition + runtime override */
interface AgentControlConfig {
  dispatch: DispatchConfig;
  tools: ToolPolicyConfig;
}

/** Default configs for quick setup */
const PRESETS: Record<string, AgentControlConfig> = {
  'autonomous': {
    dispatch: { policy: 'auto' },
    tools: { policy: 'auto' },
  },
  'balanced': {  // DEFAULT
    dispatch: { policy: 'supervised', autoDispatchTypes: ['work', 'subtask', 'research'] },
    tools: { policy: 'supervised' },
  },
  'careful': {
    dispatch: { policy: 'manual' },
    tools: { policy: 'supervised' },
  },
  'locked-down': {
    dispatch: { policy: 'manual' },
    tools: { policy: 'manual' },
  },
};
```

### Dispatch Resolution Logic

```typescript
/** Determines if a task should auto-dispatch or queue for user approval */
function shouldAutoDispatch(
  task: Task,
  config: DispatchConfig,
): boolean {
  const taskType = task.type ?? 'work';
  
  // 1. Always-queue types take priority
  if (config.requireApprovalTypes?.includes(taskType)) return false;
  
  // 2. Policy-based decision
  switch (config.policy) {
    case 'auto': return true;
    case 'manual': return false;
    case 'supervised':
      // Auto-dispatch if task type is in the allowed list
      if (config.autoDispatchTypes) {
        return config.autoDispatchTypes.includes(taskType);
      }
      // Default: auto-dispatch all types in supervised mode
      return true;
  }
}
```

### Tool Approval Resolution Logic

```typescript
/** Determines if a tool call needs user approval */
function needsToolApproval(
  toolName: string,
  args: Record<string, any>,
  config: ToolPolicyConfig,
  teamPolicy: ApprovalPolicy,
  stickyDecisions: Map<string, ApprovalDecision>,
): boolean {
  // 1. Sticky decision exists? Skip.
  if (stickyDecisions.has(toolName)) return false;
  
  // 2. Per-tool rule: deny → block (tool won't run at all)
  if (config.rules?.deny?.includes(toolName)) return true; // will be rejected
  
  // 3. Per-tool rule: allow → never ask
  if (config.rules?.allow?.includes(toolName)) return false;
  
  // 4. Per-tool rule: ask → always ask
  if (config.rules?.ask?.includes(toolName)) return true;
  
  // 5. Policy-based decision
  switch (config.policy) {
    case 'auto': return false;
    case 'manual': return true;
    case 'acceptEdits':
      // File writes auto-accepted, bash/deploy need approval
      if (isFileWriteTool(toolName)) return false;
      if (teamPolicy.destructiveTools.includes(toolName)) return true;
      return teamPolicy.safeTools.includes(toolName) ? false : true;
    case 'supervised':
      // Safe tools run freely, destructive tools need approval
      if (teamPolicy.safeTools.includes(toolName)) return false;
      if (teamPolicy.destructiveTools.includes(toolName)) return true;
      // Unknown tool: default to requiring approval
      return true;
  }
}
```

### Approval Request

```typescript
interface ApprovalRequest {
  id: string;
  type: 'plan' | 'replan' | 'tool' | 'artifact' | 'task-dispatch';
  goalId: string;
  requestedBy: {
    role: string;        // 'planner' | worker role
    taskId?: string;     // which task (for worker/dispatch requests)
    agentId?: string;    // which agent instance
  };
  
  // What's being approved — type-specific payload
  payload:
    | { type: 'plan'; plan: PlanTask[]; summary: string }
    | { type: 'replan'; oldPlan: PlanTask[]; newPlan: PlanTask[]; reason: string }
    | { type: 'tool'; toolName: string; toolCallId: string; args: Record<string, any>; impact?: string }
    | { type: 'artifact'; artifactPath: string; preview?: string; diff?: string }
    | { type: 'task-dispatch'; taskId: string; taskType: TaskType; title: string; description: string };
  
  // Approval options
  options: ApprovalOption[];
  timeout?: number;      // auto-reject after N ms (default: 5min)
  createdAt: Date;
  
  // Which policy triggered this approval
  triggeredBy: 'dispatch-policy' | 'tool-policy' | 'tool-rule' | 'team-policy';
}

interface ApprovalOption {
  label: string;          // "Approve", "Reject", "Approve with changes", "Always approve this tool"
  value: string;
  requiresReason?: boolean; // e.g., reject requires reason
  sticky?: boolean;        // if true, this becomes a sticky decision
}

interface ApprovalDecision {
  requestId: string;
  decision: string;       // matches ApprovalOption.value
  reason?: string;        // required if option.requiresReason
  decidedBy: string;      // userId or 'system' (for auto-approve)
  decidedAt: Date;
  sticky?: boolean;       // user chose "always approve"
  editedContent?: string; // for edit mode — user's modified output
}
```

---

## Auto-Approve Rules

Not every action needs a human in the loop. The **two-axis model** handles this cleanly:

```typescript
interface ApprovalPolicy {
  // Team-level defaults (used when agent doesn't specify)
  defaultDispatch: DispatchPolicy;           // default: 'supervised'
  defaultToolPolicy: ToolPolicy;             // default: 'supervised'
  planApproval: 'always' | 'auto';           // default: 'always'
  replanApproval: 'always' | 'auto';         // default: 'always'
  
  // Tool classification for 'supervised' and 'acceptEdits' policies
  destructiveTools: string[];                // e.g., ['delete_file', 'run_command', 'deploy']
  safeTools: string[];                       // e.g., ['read_file', 'search', 'get_status']
  fileWriteTools: string[];                  // e.g., ['write_file', 'edit_file'] — for acceptEdits
}
```

**Resolution order for tool approval:**
1. **Sticky decision** exists for this tool? → Skip approval
2. **Per-tool rule** on agent (`allow/ask/deny`) → Overrides everything
3. **Tool policy** (`auto/supervised/acceptEdits/manual`) → Base decision
4. **Team policy** classification (`destructiveTools/safeTools`) → When policy says "supervised"

**Resolution order for task dispatch:**
1. **`requireApprovalTypes`** on agent → Always queue these task types
2. **`autoDispatchTypes`** on agent → Auto-dispatch these in supervised mode
3. **Dispatch policy** (`auto/supervised/manual`) → Base decision

---

## Tool Approval: AI SDK `needsApproval` + Two-Axis Model

AI SDK v6 provides native tool approval via `needsApproval`. We wire the **tool policy axis** into it.

**Integration with AiSdkAgent:**

```typescript
// In AiSdkAgent — tools are wrapped with policy-aware needsApproval
private wrapToolWithApproval(sdkTool: any, toolName: string): any {
  const toolConfig = this.toolPolicyConfig;
  const teamPolicy = this.approvalPolicy;
  const stickyDecisions = this.stickyDecisions;
  
  return tool({
    ...sdkTool,
    needsApproval: async (args: any) => {
      return needsToolApproval(toolName, args, toolConfig, teamPolicy, stickyDecisions);
    },
  });
}
```

**Task dispatch in ChatAgent (dispatch policy axis):**

```typescript
// ChatAgent.handleTask() — dispatch policy + task type filtering
async handleTask(taskId: string, role: string): Promise<void> {
  const task = this.taskStore.get(taskId);
  if (!task) return;
  
  const shouldDispatch = shouldAutoDispatch(task, this.dispatchConfig);
  
  if (!shouldDispatch) {
    // Queue for user approval — emit task-dispatch approval request
    this.queue.push({ taskId, role });
    this.callbacks.onApprovalRequest?.({
      type: 'task-dispatch',
      taskId, role,
      taskType: task.type ?? 'work',
      title: task.title ?? task.id,
      description: task.description,
    });
    return;
  }
  
  // Auto-dispatch (check concurrency limits)
  if (this.active.size >= this.maxConcurrentWorkers) {
    this.queue.push({ taskId, role });
    return;
  }
  
  await this.spawnWorker(taskId, role);
}
```

**Stream handling in WorkerPool:**

```typescript
// WorkerPool catches tool-approval-request from AI SDK stream
for await (const event of agent.execute(input)) {
  if (event.type === 'stream_part') {
    const part = event.part;
    
    if (part.type === 'tool-approval-request') {
      // Emit to frontend via Socket.IO
      this.callbacks.onApprovalRequest?.({
        approvalId: part.approvalId,
        toolCall: part.toolCall,
        agentId, taskId, goalId,
      });
      
      // Wait for user decision (blocks this worker, not others)
      const decision = await this.waitForApproval(part.approvalId);
      
      // Add approval response to messages and continue
      messages.push({
        role: 'tool',
        content: [{
          type: 'tool-approval-response',
          approvalId: part.approvalId,
          approved: decision.decision === 'approved',
          reason: decision.reason,
        }]
      });
      
      // Continue streamText with updated messages
      continue;
    }
    
    // Normal stream parts forwarded to Socket.IO
    this.callbacks.onStream?.(event);
  }
}
```

**Edit mode — draft handling:**

```typescript
// In edit mode, write tools produce drafts instead of applying directly
if (agentMode.mode === 'edit' && isWriteTool(toolName)) {
  // Tool executes but output is held as a draft
  const draftId = crypto.randomUUID();
  drafts.set(draftId, { toolName, args, result });
  
  // Emit draft for user review
  this.callbacks.onDraftReady?.({
    draftId,
    toolName,
    args,
    preview: result,
    goalId, taskId,
  });
  
  // Wait for user to approve/edit/reject the draft
  const editDecision = await this.waitForDraftDecision(draftId);
  
  if (editDecision.decision === 'approved') {
    // Apply as-is
  } else if (editDecision.decision === 'edited') {
    // Apply user's modified version
    result = editDecision.editedContent;
  } else {
    // Rejected — tool result is discarded, model informed
  }
}
```

**Sticky decisions** (blocks repeated approvals):
```typescript
// When user selects "Always approve this tool" in the approval card,
// the decision is stored and future calls to that tool skip approval
class StickyDecisionStore {
  private decisions = new Map<string, ApprovalDecision>();
  
  set(toolName: string, decision: ApprovalDecision): void {
    if (decision.sticky) {
      this.decisions.set(toolName, decision);
    }
  }
  
  has(toolName: string): boolean {
    return this.decisions.has(toolName);
  }
  
  // Sticky decisions expire at end of goal/session
  clear(): void {
    this.decisions.clear();
  }
}
```

---

## Socket.IO Event Flow

### Approval Request Flow (Backend → Frontend → Backend)

```
Agent mode check → needsApproval() returns true
  → AI SDK emits tool-approval-request in stream
  → WorkerPool catches → emits onApprovalRequest callback
  → SocketServerV2 → emits 'approval:requested' to frontend
  → Frontend renders ApprovalCard (tool name, args, impact)
  → User clicks Approve / Reject / Always Approve
  → Frontend emits 'action' { type: 'approval:decided', approvalId, decision }
  → SocketServerV2 → resolves pending approval promise
  → WorkerPool adds tool-approval-response to messages
  → streamText() called again → tool executes or model sees denial
```

### Socket.IO Events

```typescript
// Server → Client
'approval:requested'  // New approval needed. Payload: ApprovalRequest
'approval:auto'       // Auto-approved by policy. Payload: { requestId, reason }
'approval:timeout'    // Approval timed out. Payload: { requestId }

// Client → Server (via 'action' event)
{ type: 'approval:decided', approvalId: string, decision: ApprovalDecision }
{ type: 'set-dispatch-policy', agentId: string, goalId: string, policy: DispatchPolicy }
{ type: 'set-tool-policy', agentId: string, goalId: string, policy: ToolPolicy }
{ type: 'draft:decided', draftId: string, decision: 'approved' | 'edited' | 'rejected', editedContent?: string }
```

### Frontend Components

```
ApprovalCard (new)        — Shows tool name, args, impact description
  ├── ApproveButton       — "Approve" / "Always Approve" (sticky)
  ├── RejectButton        — "Reject" + optional reason input
  └── EditButton          — Opens editable preview (acceptEdits mode only)

TaskDispatchCard (new)    — Shows queued task, type badge, description
  ├── StartButton         — Dispatch the task to a worker
  ├── SkipButton          — Skip / defer the task
  └── TypeBadge           — Shows task type (decision, review, work, etc.)

AgentPolicySelector (new) — Two dropdowns in agent header:
  ├── DispatchDropdown    — Auto / Supervised / Manual
  └── ToolDropdown        — Auto / Supervised / AcceptEdits / Manual
  └── Updates via Socket.IO action → backend stores per-goal override

DraftPreview (new)        — Shows write-tool output before applying
  ├── ApplyButton         — Apply draft as-is
  ├── EditArea            — Inline editor for modifications
  └── DiscardButton       — Reject draft
```

---

## Persistence & Audit

```typescript
interface ApprovalAuditEntry {
  request: ApprovalRequest;
  decision: ApprovalDecision;
  teamId: string;
  goalId: string;
  timestamp: Date;
}
// Stored in MongoDB, queryable by team, type, decision, time range
```

---

## Integration Points

| Component | Change |
|---|---|
| **AiSdkAgent** | `wrapToolWithApproval()` — wraps tools with tool-policy-aware `needsApproval` |
| **WorkerPool** | Catches `tool-approval-request` stream parts → emits callback → waits for decision |
| **ChatAgent** | `handleTask()` uses `shouldAutoDispatch()` with dispatch policy + task type filtering. Replace `'auto' \| 'review' \| 'manual'` with `DispatchPolicy` + `ToolPolicy` |
| **SocketServerV2** | New `approval:requested/decided` events. New `set-dispatch-policy` and `set-tool-policy` action handlers |
| **GoalManager** | Stores `AgentControlConfig` per agent per goal. Clears sticky decisions on goal completion |
| **Agent YAML** | New `dispatch:` and `tools:` config blocks in frontmatter |
| **Plugin manifest** | `ApprovalPolicy` in team `settings` (destructiveTools, safeTools classification) |
| **Frontend types** | New `DispatchPolicy`, `ToolPolicy`, `ApprovalRequest`, `ApprovalDecision` types |
| **Frontend components** | `ApprovalCard`, `TaskDispatchCard`, `AgentPolicySelector`, `DraftPreview` |

---

## Socket.IO Events (Summary)

| Event | Direction | Payload |
|---|---|---|
| `approval:requested` | Server → Client | `ApprovalRequest` (full context, options, preview) |
| `approval:decided` | Client → Server | `ApprovalDecision` (decision + reason + sticky flag) |
| `approval:auto` | Server → Client | Auto-approved by policy (for UI "auto-approved" badge) |
| `approval:timeout` | Server → Client | `{ requestId }` (timed out, auto-rejected) |
| `set-dispatch-policy` | Client → Server | `{ agentId, goalId, policy: DispatchPolicy }` |
| `set-tool-policy` | Client → Server | `{ agentId, goalId, policy: ToolPolicy }` |

---

## Dependencies

| System | How Approval System Connects |
|---|---|
| **AI SDK v6** | `needsApproval` on tools — our runtime provides the primitive. No custom wrapper needed. |
| **OrchestratorService** | Plan/replan approval uses existing `approvePlan()`. Extends with `ApprovalPolicy`. |
| **Task Model** | Task `type` field (`work/review/decision/...`) drives dispatch filtering. Already exists. |
| **SocketServerV2** | Extends existing `handleAction()` switch. Catches `tool-approval-request` stream parts. |
| **Frontend** | Dedicated approval card UI (not chat message). Shows context, preview, diff. Approve/reject/always-approve buttons. Two-dropdown policy selector. |

---

## What Mastra Owns vs What A9 Builds

| Concern | Owner |
|---|---|
| `requireApproval: true` on tools | **Mastra** (native) |
| `suspend()` / `resume()` in tool execute | **Mastra** (native) |
| Suspended state persistence (survives restart) | **Mastra** (storage provider) |
| Stream events (`tool-call-approval`, `tool-call-suspended`) | **Mastra** (native) |
| `requireReadBeforeWrite` guardrail | **Mastra** (native) |
| Conditional approval functions (per-call based on args) | **A9** (we build) |
| Sticky decisions ("Approve always" per-run) | **A9** (we build) |
| Auto-approve policy per team (`ApprovalPolicy`) | **A9** (we build) |
| Plan/replan approval (orchestrator-level) | **A9** (we build, uses A5's bridge) |
| Audit trail (every decision logged) | **A9** (we build) |
| Stream event → Socket.IO routing | **A9** (we build — wire Mastra events to frontend) |
| Frontend approval cards | **A9** (we build) |

---

## What A5 Keeps vs What A9 Owns

| Concern | Owner |
|---|---|
| `ask_user`, `tell_user`, `discuss_approach` tools | **A5** |
| `Map<questionId, resolver>` bridge | **A5** |
| Worker `ask_user` / `tell_user` / `discuss_approach` | **A5** |
| Plan approval (planner calls `requestApproval` via tool) | **A5** (uses A9's `requestApproval()`) |
| `ApprovalRequest`, `ApprovalDecision`, `ApprovalPolicy` types | **A9** |
| `requestApproval()` + auto-approve rules | **A9** |
| Conditional + sticky approval logic | **A9** |
| Audit trail | **A9** |
| `approval:*` Socket.IO events | **A9** |
| Stream event wiring (Mastra → Socket.IO) | **A9** |

---

## Artifact Trust & Provenance Model

Artifact approval (the 4th approval type above) answers "should this be accepted?" But there's a prior question: **"who produced this, and has anyone reviewed it?"**

Not all task outputs need the same level of human review. Files produced by an internal LLM agent need careful inspection. Files already human-reviewed in a child team or via an external agent's PR workflow can be accepted with a glance.

### Review Tags

Each file in a task's output carries a **review tag** tracking its provenance:

| Tag | Icon | Meaning | User action |
|-----|------|---------|-------------|
| `agent` | 🤖 | Raw LLM output, nobody reviewed | Must review before accepting |
| `reviewed` | 👤 | Human or quality-checked (ChatAgent, external agent human, auto-rule) | Can accept without re-reviewing |
| `approved` | 🔒 | Formally approved by authorized reviewer (child team human, domain expert) | Auto-accepted, shown for audit |

### ArtifactReviewStatus Type

```typescript
interface ArtifactReviewStatus {
  path: string;                 // file path in workspace branch
  reviewTag: 'agent' | 'reviewed' | 'approved';
  reviewedBy?: string;          // userId, teamId, or agent identifier
  reviewSource?:
    | 'chat_agent'              // ChatAgent quality-checked in onMyTaskCompleted
    | 'child_team_human'        // Human in child Ping team approved
    | 'external_agent_human'    // Human reviewed via Claude/Cursor PR flow
    | 'self'                    // Human contributor authored it directly
    | 'auto_rule';              // Matched an auto-approve glob pattern
  reviewedAt?: string;          // ISO timestamp
}
```

### How Tags Are Set

| Source | Trigger | Tag set |
|--------|---------|---------|
| **Internal worker (Crush)** | Task completes | `agent` (default — no review yet) |
| **ChatAgent background review** | `onMyTaskCompleted` runs, finds no quality issues | `reviewed` (source: `chat_agent`) |
| **ChatAgent flags concerns** | `onMyTaskCompleted` finds problems | Stays `agent` — user must review |
| **Child Ping team** | Child team's human approves output in their review flow | `approved` (source: `child_team_human`) |
| **External agent (Claude Code)** | External agent reports `{ humanReviewed: true }` on completion | `reviewed` (source: `external_agent_human`) |
| **Auto-approve glob rules** | File path matches `autoApprovePatterns` in TeamReviewConfig | `reviewed` (source: `auto_rule`) |
| **Human contributor** | Human authored the file directly (not via agent) | `approved` (source: `self`) |

### TeamReviewConfig Extension

```typescript
interface TeamReviewConfig {
  // When does the user get asked to review?
  reviewTrigger: 'per_task' | 'per_goal' | 'on_escalation' | 'never';

  // What does the user see?
  reviewScope: 'artifacts_only' | 'artifacts_and_process' | 'summary_only';

  // Glob patterns that auto-set 'reviewed' tag (skip human review)
  autoApprovePatterns?: string[];
  // e.g., ["*.test.ts", "docs/**", "*.md", "package.json"]

  // Trust artifacts from child Ping teams that were human-approved there
  trustChildTeams?: boolean;  // default: true

  // Trust artifacts from these external agents when they report human review
  trustedExternalAgents?: string[];
  // e.g., ["claude-code", "cursor", "copilot-workspace"]
}
```

### Frontend: Changes Collapsible with Trust Tags

The Changes collapsible (Phase 15 of frontend redesign) shows trust tags per file:

```
▼ Changes (6 files, +342 lines)

  📄 src/auth/middleware.ts    +45    🤖 Agent      [Diff] [File]
  📄 src/auth/routes.ts       +89    🤖 Agent      [Diff] [File]
  📄 src/auth/types.ts        +23    👤 Reviewed    [Diff] [File]
  📄 tests/auth.test.ts      +112    👤 Reviewed    [Diff] [File]
  📄 src/config/jwt.ts        +18    🔒 Approved    [Diff] [File]
  📝 README.md                +55    🤖 Agent      [Diff] [File]

  ──────────────────────────────────────────────
  2 need review  •  2 reviewed  •  1 approved

  [Accept reviewed ✓]  [Review remaining ↗]
```

### GoalSummaryCard with Trust Tags

Goal-level review aggregates trust across all tasks:

```
┌───────────────────────────────────────────────────────┐
│  ✅  Build Authentication System                       │
│                                                        │
│  📊 Review: ████████████░░░░░░  4/6 reviewed          │
│                                                        │
│  📄 middleware.ts    +45   🤖 Agent                    │
│  📄 routes.ts       +89   🤖 Agent                    │
│  📄 types.ts        +23   👤 ChatAgent                │
│  📄 auth.test.ts   +112   👤 auto-rule                │
│  📄 jwt.ts          +18   🔒 child team               │
│  📝 README.md       +55   👤 Claude Code              │
│                                                        │
│  [Accept 4 reviewed ✓]    [Review 2 remaining ↗]      │
└───────────────────────────────────────────────────────┘
```

### Smart Accept Actions

| Scenario | Available actions |
|----------|-------------------|
| All files 🤖 Agent | `[Review all]` — user must review each file |
| Mix of 🤖 and 👤/🔒 | `[Accept reviewed ✓]` + `[Review remaining ↗]` — user only reviews unreviewed files |
| All files 👤 Reviewed or 🔒 Approved | `[Accept all ✓]` — single click, trust the chain |

### How Trust Flows Through the System

```
Worker completes task
  → All files tagged 'agent' by default
  → ChatAgent.onMyTaskCompleted() runs background review
    → If quality OK: files → 'reviewed' (chat_agent)
    → If concerns: files stay 'agent'
  → Auto-approve rules checked: matching files → 'reviewed' (auto_rule)

External agent (Claude Code) completes task
  → Reports: { humanReviewed: true, reviewer: 'user@...' }
  → If agent in trustedExternalAgents: files → 'reviewed' (external_agent_human)
  → If not trusted: files stay 'agent'

Child Ping team completes task
  → Child team's user approved their goal output
  → If trustChildTeams=true: files → 'approved' (child_team_human)
  → If not trusted: files stay 'agent'

Goal review presented to user
  → GoalSummaryCard / Changes collapsible shows per-file tags
  → User can accept reviewed files in one click
  → User only manually reviews 'agent' tagged files
```

### Depends On

- **A8 Git Task Context (Phase 3):** Workspace branch-per-task provides the files to tag
- **A7 External Agent Invocation:** External agents report `humanReviewed` flag on completion
- **A10 Persistent Agents:** ChatAgent `onMyTaskCompleted` runs the background quality review
- **Phase 15 (Task Changes collapsible):** Frontend displays trust tags per file
- **Vision: Team Composability:** Child teams reporting approval status to parent teams

---

## Worker Trust Configuration UI

Two surfaces for configuring trust: **per-instance controls** (two collapsibles at chat input, quick override before sending) and **team-level defaults** (settings panel, configure once).

### Per-Instance: Agent + Trust Selectors (Chat Input Area)

Two collapsible pill selectors sit **above the chat input**, pre-populated from team defaults. User can override per-instance before sending a message.

**Collapsed state (default — two pills showing current selection):**

```
├─────────────────────────────────────────────────────┤
│ 🤖 Crush             ▾ │ 👤 Reviewed          ▾   │
├─────────────────────────────────────────────────────┤
│ [Type a message...]                            [▶]  │
└─────────────────────────────────────────────────────┘
      ↑ agent selector         ↑ trust selector
```

Both pre-populated from team defaults for this role's default worker.

**Agent selector expanded (click left pill):**

```
│ ▼ Agent                                             │
│ ┌─────────────────────────────────────────────────┐ │
│ │ ● 🤖 Crush (internal)             always on    │ │
│ │ ○ 🔮 Claude Code                  1 connected  │ │
│ │ ○ 🖥️ Cursor                       0 connected  │ │
│ │ ○ 👥 Design Team                  1 agent      │ │
│ └─────────────────────────────────────────────────┘ │
│                                    👤 Reviewed  ▾   │
├─────────────────────────────────────────────────────┤
│ [Type a message...]                            [▶]  │
```

Shows all available workers with connection status. Selecting a different agent **auto-updates the trust pill** to that agent's team default.

**Trust selector expanded (click right pill):**

```
│ 🔮 Claude Code       ▾ │ ▼ Trust                   │
│                         │ ┌───────────────────────┐ │
│                         │ │ ○ 🤖 Agent (review)  │ │
│                         │ │ ● 👤 Reviewed (skip)  │ │
│                         │ │ ○ 🔒 Approved (auto)  │ │
│                         │ │                       │ │
│                         │ │ Default: 👤 Reviewed  │ │
│                         │ │ (from team settings)  │ │
│                         │ └───────────────────────┘ │
├─────────────────────────────────────────────────────┤
│ [Build auth with OAuth2...]                    [▶]  │
```

Shows team default at the bottom so user knows what they're overriding.

**Override indicator — when trust differs from team default:**

```
│ 🔮 Claude Code       ▾ │ 🤖 Agent  ⚠️ override ▾  │
```

`⚠️ override` badge when trust differs from team default for the selected agent.

**Behavior:**

| Action | What happens |
|--------|-------------|
| Page load | Both pills populated from team defaults for this role's default worker |
| Select different agent | Trust auto-updates to that agent's team default |
| Change trust | Override for this instance only. Badge shows `⚠️ override` |
| Send message | Worker type + trust level attached to the task dispatch context |
| Next message | Resets to defaults (override was per-instance, not sticky) |

### Team-Level: Trust Settings Panel

Accessible from: worker config bar `[⚙️]`, or `/manage-teams` → team → Settings tab.

```
┌─────────────────────────────────────────────────────┐
│ Engineering Team — Settings                    ✕    │
├─────────────────────────────────────────────────────┤
│ General │ Workers │ Review │                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│ INTERNAL WORKERS                                    │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 🤖 Crush                                       │ │
│ │ Trust level: [👤 Reviewed ▾]                    │ │
│ │ (ChatAgent reviews output before presenting)    │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ EXTERNAL AGENTS                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 🔮 Claude Code        [Trusted ✓]              │ │
│ │    Trust: [👤 Reviewed ▾]                       │ │
│ │    Reason: Human reviews PR before merge        │ │
│ │                                                 │ │
│ │ 🖥️ Cursor              [Untrusted]              │ │
│ │    Trust: [🤖 Agent ▾]                          │ │
│ │    Reason: No human review in workflow          │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ CHILD TEAMS                                         │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 👥 Design Team (3 agents)  [Trusted ✓]          │ │
│ │    Trust: [🔒 Approved ▾]                       │ │
│ │    Reason: Human approves in their flow         │ │
│ │                                                 │ │
│ │ 👥 QA Team (2 agents)      [Trusted ✓]          │ │
│ │    Trust: [👤 Reviewed ▾]                       │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ AUTO-APPROVE PATTERNS                               │
│ ┌─────────────────────────────────────────────────┐ │
│ │ *.test.ts                                [✕]   │ │
│ │ docs/**                                  [✕]   │ │
│ │ *.md                                     [✕]   │ │
│ │ [+ Add pattern]                                │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ REVIEW DEFAULTS                                     │
│ Review trigger:  [Per goal ▾]                       │
│ Review scope:    [Artifacts + process ▾]            │
│                                                     │
│                        [Save]  [Reset to defaults]  │
└─────────────────────────────────────────────────────┘
```

**Trust level dropdown options:**
- `🤖 Agent` — raw output, always requires human review
- `👤 Reviewed` — treated as reviewed (ChatAgent or human checked)
- `🔒 Approved` — treated as formally approved (skip review entirely)

### Precedence: Per-Instance Overrides Team Defaults

```
Team Settings (defaults)
  │
  ├─ "Claude Code: trusted, 👤 Reviewed"
  │
  └─ Per-Instance Override (chat input pills)
      ├─ User sends task with Claude Code → 🔒 Approved  (trusts more for this task)
      └─ User sends task with Claude Code → 🤖 Agent     (trusts less for this task)
      └─ Next message → resets to 👤 Reviewed (team default)
```

Per-instance overrides apply only to that dispatch. Team defaults apply to all subsequent messages unless overridden again.

### Data Model

```typescript
// Team-level defaults (stored in team config / MongoDB)
interface WorkerTrustConfig {
  internalTrustLevel: 'agent' | 'reviewed' | 'approved';  // default: 'reviewed'
  
  externalAgents: Record<string, {
    trusted: boolean;
    trustLevel: 'agent' | 'reviewed' | 'approved';
    reason?: string;
  }>;
  
  childTeams: Record<string, {
    trusted: boolean;
    trustLevel: 'agent' | 'reviewed' | 'approved';
  }>;
  
  autoApprovePatterns: string[];
  reviewTrigger: 'per_task' | 'per_goal' | 'on_escalation' | 'never';
  reviewScope: 'artifacts_only' | 'artifacts_and_process' | 'summary_only';
}

// Per-instance override (transient, sent with message — NOT stored)
// Attached to task dispatch context when user overrides at chat input
interface InstanceWorkerOverride {
  workerType: string;       // "crush" | "claude-code" | "cursor" | child team ID
  trustLevel: 'agent' | 'reviewed' | 'approved';
  isOverride: boolean;      // true if differs from team default
}
```

### API Endpoints

| Endpoint | Method | What |
|----------|--------|------|
| `/api/v2/teams/:teamId/settings/trust` | `GET` | Get team trust config |
| `/api/v2/teams/:teamId/settings/trust` | `PUT` | Update team trust config |
| `/api/v2/teams/:teamId/roles/:role/worker-config` | `GET` | Get per-role worker config |
| `/api/v2/teams/:teamId/roles/:role/worker-config` | `PUT` | Update per-role worker config |
