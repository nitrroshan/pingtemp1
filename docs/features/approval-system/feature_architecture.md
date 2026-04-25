# Approval System — Feature Architecture

**Phase:** 2 (Post-Mastra)
**ID:** A9
**Depends on:** A1 (Mastra Migration), A5 (Planner as Agent)

---

## Problem

Agents make decisions that need human oversight: starting execution plans, running destructive tools, publishing artifacts. Without a structured approval system, we either:
- Block on every action (unusable for autonomous teams)
- Auto-approve everything (dangerous for destructive operations)
- Use ad-hoc `ask_user` with `["Approve", "Reject"]` options (no context, no audit trail, no rules)

---

## Why After Mastra (A1)

Mastra provides **three primitives** that are the foundation of our approval system. Building A9 before A1 means reimplementing these from scratch, then throwing them away.

| Mastra Primitive | What It Gives Us | What We'd Build Without It |
|---|---|---|
| `requireApproval: true` on tool | Pre-execution approval gate. Stream emits `tool-call-approval` chunk. Agent pauses until approved. | Custom `wrapWithApproval()` function + `Map<id, resolver>` bridge (~80 lines) |
| `suspend()` / `resume()` in tool `execute()` | Mid-execution pause. Tool starts, discovers danger, pauses. State persisted via storage provider. Stream emits `tool-call-suspended` chunk. | Custom `createSuspendableContext()` + state serialization (~100 lines) |
| `requireReadBeforeWrite` on tool | Guardrail: agent must call a `read_*` tool before any `write_*` tool. Auto-enforced. | Custom tool ordering validation (~40 lines) |
| Workflow state persistence | `suspended` state survives process restart. `restart()` from last active step. | Custom `approvalStore.save()` + reload on startup (~60 lines) |

**Total custom code eliminated: ~280 lines.** More importantly, Mastra's implementation is battle-tested and maintained upstream.

## Research: How Agent SDKs Handle Approval

| Framework | Pre-execution | Mid-execution | State Persistence | Auto-Approve |
|---|---|---|---|---|
| **Mastra** (our SDK) | ✅ `requireApproval: true` on tool | ✅ `suspend()` inside `execute()` | ✅ Storage provider snapshots | ✅ `autoResumeSuspendedTools` |
| **OpenAI Agents SDK** | ✅ `needs_approval` (bool or async fn) | ❌ Not built-in | ✅ `RunState.to_json()` | ✅ `on_approval` callback |
| **LangGraph** | ❌ No tool-level decorator | ✅ `interrupt()` in graph node | ✅ `MemorySaver` checkpointing | ❌ Manual |

### What Mastra Gives Us for Free

1. **`requireApproval: true`** → stream emits `tool-call-approval` chunk → we catch it in Socket.IO and route to frontend
2. **`suspend()`** → stream emits `tool-call-suspended` chunk → same Socket.IO routing
3. **State persistence** → configured storage provider (MongoDB) saves suspended state → survives restart
4. **`autoResumeSuspendedTools`** → for conversational flows where the agent can auto-resume from context

### What We Still Build on Top

Mastra provides the **primitives** (pause, resume, persist). We add the **product layer**:
- **Structured approval types** (plan, replan, tool, artifact) — Mastra only knows about tool approval
- **Auto-approve policy per team** — Mastra's `autoResumeSuspendedTools` is global, we need per-team rules
- **Audit trail** — Mastra doesn't log approval decisions
- **Sticky decisions** ("Approve always" for this tool) — not in Mastra
- **Conditional approval functions** (per-call based on args) — Mastra only has boolean `requireApproval`
- **Plan/replan approval** — higher-level than tool approval, orchestrator-level concern

## Why This Is Separate From User Interaction (A5)

A5 builds the **communication bridge** — `ask_user`, `tell_user`, `discuss_approach`. These are conversational tools. The agent asks a question, user answers, agent continues.

Approval is different:
- Approvals need **structured context** (what artifact/action, preview, diff, impact)
- Approvals need an **audit trail** (who approved what, when, why)
- Approvals need **auto-approve rules** (skip approval for safe actions in auto mode)
- Approvals need **different UI** (not a chat message — a dedicated approval card with context)
- Approvals need **team-level policy** (configurable per team, not per request)

The approval system **uses** the same `Map<id, resolver>` bridge from A5 for blocking. But layers structured requests, policies, and audit on top.

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

```typescript
interface ApprovalRequest {
  id: string;
  type: 'plan' | 'replan' | 'tool' | 'artifact';
  requestedBy: {
    role: string;        // 'planner' | worker role
    taskId?: string;     // which task (for worker requests)
  };
  
  // What's being approved — type-specific payload
  payload:
    | { type: 'plan'; plan: PlanTask[]; summary: string }
    | { type: 'replan'; oldPlan: PlanTask[]; newPlan: PlanTask[]; reason: string }
    | { type: 'tool'; toolName: string; args: Record<string, any>; impact: string }
    | { type: 'artifact'; artifactPath: string; preview?: string; diff?: string };
  
  // Approval options
  options: ApprovalOption[];
  timeout?: number;      // auto-reject after N ms (default: 5min)
  createdAt: Date;
}

interface ApprovalOption {
  label: string;          // "Approve", "Reject", "Approve with changes"
  value: string;
  requiresReason?: boolean; // e.g., reject requires reason
}

interface ApprovalDecision {
  requestId: string;
  decision: string;       // matches ApprovalOption.value
  reason?: string;        // required if option.requiresReason
  decidedBy: string;      // userId or 'system' (for auto-approve)
  decidedAt: Date;
}
```

---

## Auto-Approve Rules

Not every action needs a human in the loop. Teams configure auto-approve rules:

```typescript
interface ApprovalPolicy {
  // Per-team defaults
  planApproval: 'always' | 'auto';           // default: 'always' — plans need user OK
  replanApproval: 'always' | 'auto';         // default: 'always' — replans need user OK
  toolApproval: 'always' | 'destructive-only' | 'never';  // default: 'destructive-only'
  artifactApproval: 'always' | 'auto';       // default: 'auto' — artifacts auto-approve
  
  // Override per agent type
  autoModeOverride?: {
    toolApproval: 'destructive-only';        // Ping Team: only destructive tools need approval
    artifactApproval: 'auto';                // Ping Team: auto-approve artifacts
  };
}
```

**How auto-approve works:**
```typescript
async function requestApproval(req: ApprovalRequest, policy: ApprovalPolicy): Promise<ApprovalDecision> {
  // Check auto-approve rules
  if (shouldAutoApprove(req, policy)) {
    const decision = { requestId: req.id, decision: 'approved', reason: 'auto-approved by policy', decidedBy: 'system', decidedAt: new Date() };
    auditLog.push(decision);
    transport.send(teamId, { type: 'approval:auto', decision }); // UI shows "auto-approved" badge
    return decision;
  }
  
  // Needs human — use the same Map<id, resolver> bridge from A5
  const { promise, resolve } = Promise.withResolvers<ApprovalDecision>();
  pendingApprovals.set(req.id, { resolve });
  transport.send(teamId, { type: 'approval:requested', request: req });
  
  const decision = await promise;  // blocks until user responds
  auditLog.push(decision);         // audit trail
  pendingApprovals.delete(req.id);
  return decision;
}
```

---

## Tool Approval: Mastra `requireApproval` + Our Extensions

Mastra provides the base: `requireApproval: true` on any tool. We extend it with conditional logic, sticky decisions, and structured context.

**Base (Mastra native):**
```typescript
const deleteTool = createTool({
  id: 'delete_file',
  requireApproval: true,  // ← Mastra native. Stream emits 'tool-call-approval'.
  execute: async ({ path }) => { /* ... */ }
});
```

**Extension 1: Conditional approval** (we build — Mastra only has boolean):
```typescript
// Approval functions evaluate args to decide if approval is needed
const approvalFunctions: Record<string, (args: any) => boolean> = {
  not_temp_file: (args) => !args.path?.startsWith('/tmp/'),
  high_cost_only: (args) => args.estimatedCost > 100,
};
// If function returns false → tool runs freely. If true → triggers Mastra's approval flow.
```

**Extension 2: Sticky decisions** (we build — blocks repeated approvals):
```typescript
// User selects "Approve always" → future calls to that tool skip approval for rest of run
// Map<toolName, ApprovalDecision>. Checked before Mastra's requireApproval fires.
```

**Extension 3: Structured context** (we build — Mastra only passes tool args):
```typescript
// Our approval handler enriches the stream's 'tool-call-approval' chunk with:
// - impact description, file preview/diff, affected resources
// - Frontend shows rich approval card, not just "approve delete_file?"
```

## Mid-Execution Suspension (Mastra Native)

Mastra provides `suspend()` / `resume()` natively in tool `execute()`. We just need to wire the stream events to Socket.IO.

```typescript
const runMigration = createTool({
  id: 'run_migration',
  requireApproval: true,  // Mastra: pre-exec approval
  inputSchema: z.object({ file: z.string() }),
  suspendSchema: z.object({ reason: z.string(), tables: z.array(z.string()), sql: z.string() }),
  resumeSchema: z.object({ confirmed: z.boolean() }),
  execute: async ({ context, suspend }) => {
    const plan = parseMigration(context.file);
    
    // Mastra native: suspend mid-execution
    if (plan.drops.length > 0) {
      const { confirmed } = await suspend({
        reason: `Drops ${plan.drops.length} tables: ${plan.drops.join(', ')}`,
        tables: plan.drops,
        sql: plan.sql,
      });
      if (!confirmed) return { error: 'Migration cancelled by user' };
    }
    
    return await executeMigration(plan);
  }
});
// Stream emits 'tool-call-suspended' → SocketServerV2 catches → emits approval:suspended → frontend shows
// User responds → SocketServerV2 catches → Mastra agent.resume() → tool continues
```

**What Mastra handles:** State serialization, storage provider persistence, stream event emission, agent pause/resume lifecycle.
**What we add:** Socket.IO routing of stream events to frontend, structured UI for suspend payloads, audit logging.

---

## Persistence (Mastra Native + Our Audit)

**Mastra handles:** Suspended tool/agent state persisted via configured storage provider (MongoDB). On restart, `restart()` from last active step. Pending approvals survive process crash.

**We handle:** Audit trail persistence — Mastra doesn't care about who approved what. We log every decision to MongoDB.

```typescript
interface ApprovalAuditEntry {
  request: ApprovalRequest;
  decision: ApprovalDecision;
  teamId: string;
  timestamp: Date;
}
// Stored in MongoDB (via Mastra's storage provider), queryable by team, type, decision, time range
```

---

## Socket.IO Events

| Event | Direction | Payload |
|---|---|---|
| `approval:requested` | Server → Client | `ApprovalRequest` (full context, options, preview) |
| `approval:decided` | Client → Server | `ApprovalDecision` (decision + reason) |
| `approval:auto` | Server → Client | `ApprovalDecision` (for UI "auto-approved" badge) |
| `approval:suspended` | Server → Client | `{ requestId, suspendPayload }` (mid-execution pause — Mastra pattern) |
| `approval:resumed` | Client → Server | `{ requestId, resumeData }` (user responds to suspend) |
| `approval:timeout` | Server → Client | `{ requestId }` (timed out, auto-rejected) |

---

## Integration Points

| System | How Approval System Connects |
|---|---|
| **A1 (Mastra Migration)** | Uses `requireApproval`, `suspend()`, storage provider, stream events. **Must complete before A9 starts.** |
| **A5 (Planner as Agent)** | Plan/replan approval uses `requestApproval()`. Uses `ask_user` bridge for plan-level approval (planner is driving, not a tool). |
| **A6 (Task Orchestration)** | Tools in agent YAML declare `requireApproval: true` — Mastra handles the gate. Our wrapper adds conditional logic + sticky decisions on top. |
| **SocketServerV2** | Catches Mastra stream events (`tool-call-approval`, `tool-call-suspended`) → routes to frontend via `approval:*` Socket.IO events. Handles `approval:decided`/`approval:resumed` from frontend → feeds back to Mastra agent. |
| **Frontend** | Dedicated approval card UI (not chat message). Shows context, preview, diff. Approve/reject/always-approve buttons. |

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
