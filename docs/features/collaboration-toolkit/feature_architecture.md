# Collaboration Toolkit — Tool Inventory & Build Plan

**Status:** Architecture Draft  
**Date:** April 11, 2026  
**Scope:** All tools needed to enable collaboration, MCP server, and team stacking  
**Deferred:** Dual-agent / DPT pattern (tracked separately in agent-collab-docs)

---

## Purpose

This document catalogs every tool that needs to be built or extended across three feature tracks — **Collaboration**, **Ping MCP Server**, and **Team Stacking** — to turn Ping's CRDT infrastructure into a defensible multi-agent coordination platform.

The tools are organized by **who uses them** (worker agents, planner, external agents, teams) and **when they ship** (v1.0, v1.1, v2.0).

---

## Current Tool Inventory (What Exists)

| Category | Count | Key Tools |
|---|---|---|
| **Workspace (L1)** | 31-36 | `workspace_read_file`, `workspace_write_file`, `workspace_commit`, `workspace_grep`, `keyword_search`, `whoami`, `my_context`, code intel (5 optional) |
| **Collaboration (L2)** | 1 | `collab` — unified tool with 6 actions: `discover`, `list`, `read`, `read-block`, `write`, `write-block` |
| **Planner coordination** | 20 | `submit_plan`, `get_status`, `get_context`, `add_tasks`, `cancel_task`, `ask_user`, `tell_user`, `discuss_approach`, `request_approval`, etc. |
| **Worker lifecycle** | 2 | `report_status`, `complete_task` |
| **Knowledge (L3)** | 0 | Stub — `L3KnowledgePlugin` exists but no tools registered |
| **Total** | ~57 | |

### What's Missing

The `collab` tool today supports **data sharing** (read/write to CRDT docs) but NOT:
- Structured discussions between agents
- Agent-to-agent task delegation
- Decision recording with quorum
- Cross-plan output queries
- MCP-exposed equivalents for external agents
- Team-level goal delegation

---

## Tools to Build — Complete Catalog

### Track 1: Collaboration Tools (for Worker Agents)

These 4 tools (plus one behavioral extension to `submit_plan`) extend what agents can do when collaborating with each other and with humans. All operate on the existing CRDT/Hocuspocus infrastructure.

---

#### T1. `discuss` — Structured Discussion Threads

**Who uses it:** Worker agents  
**Where it lives:** New action on existing `collab` tool  
**Depends on:** Existing `CollaborationSpace`, `Y.Array`  
**Ships in:** v1.0

**What it does:** Posts a structured message block to a discussion thread (Y.Array) on a CRDT doc. Agents discuss design decisions, unblock each other, and record outcomes — all without blocking task execution.

```typescript
collab({
  action: "discuss",
  docName: "collab/task-007/discussion",
  value: {
    content: "The auth endpoint needs PKCE for SPAs. @frontend-dev — does the SDK handle code_verifier generation?",
    mentions: ["frontend-dev"],
    type: "message",          // message | question | decision
    replyTo: "block-002",     // optional — thread replies
  }
})
// Returns: { ok: true, blockId: "block-003" }
```

**Schema:**
| Param | Type | Required | Description |
|---|---|---|---|
| `action` | `"discuss"` | Yes | |
| `docName` | `string` | Yes | CRDT doc path (e.g., `collab/task-007/discussion`) |
| `value.content` | `string` | Yes | Markdown message body |
| `value.mentions` | `string[]` | No | Roles to notify (triggers Socket.IO events) |
| `value.type` | `"message" \| "question" \| "decision"` | No | Default: `message`. `decision` auto-records to `Y.Map("decisions")` |
| `value.replyTo` | `string` | No | Block ID to reply to (threading) |

**Backend work:**
- Add `discuss` case to `collab` tool handler in `packages/collaboration/src/L2/tools/index.ts`
- Push `DiscussionBlock` to `Y.Array("discussion")` on the target doc
- On push: emit `discussion:new-block` via Socket.IO to mentioned agents/users
- Track `roundsPerAgent` and `totalTokensUsed` in `Y.Map("config")` for guard rails
- Respect `maxRounds` (10), `maxTokens` (50k), `timeoutMinutes` (15)

**Frontend work:**
- `DiscussionThread` component — renders `Y.Array("discussion")` blocks
- `DiscussionComposer` — input with @mention autocomplete, type selector
- Socket.IO listener for `discussion:new-block` → notification badge

---

#### T2. `request_task` — Agent-to-Agent Task Delegation (Including Collaboration)

**Who uses it:** Worker agents  
**Where it lives:** New standalone tool in `packages/agent-manager/src/agent/internal/tools/`  
**Depends on:** TaskStore, DependencyResolver, CollaborationSpace (when `type: "collaboration"`)  
**Ships in:** v1.0

**What it does:** An agent creates a task for another role. The task enters the normal TaskStore DAG — gets dispatched when prerequisites are met. This is how agents ask each other for help, request reviews, or initiate structured collaboration sessions.

**Why one tool, not two?** A collaboration session IS a task — it has an assignee, a DAG position, guard rails, and a completion state. The only difference from a `work` task is that `type: "collaboration"` also sets up a CRDT discussion space with shared docs. Keeping this as one tool with an optional `collaboration` config means agents learn one tool for all delegation, and the backend uses the same TaskStore pipeline for everything.

##### Example: Work Task (default)

```typescript
request_task({
  title: "Fix API auth endpoint — missing PKCE flow",
  description: "The auth endpoint only supports basic OAuth2. Needs PKCE for SPAs.",
  targetRole: "backend-dev",
  type: "work",
  priority: 3,
  context: {
    reason: "Discovered during API spec review — spec is incomplete",
    files: [".ping/tasks/task-003.md"],
    artifacts: ["src/api/auth.ts"],
  },
  relationship: "independent",
})
// Returns: { ok: true, taskId: "task-006", status: "pending" }
```

##### Example: Collaboration Task

```typescript
request_task({
  title: "Align API spec with frontend requirements",
  description: "The auth endpoints need PKCE — need to agree on flow with frontend.",
  targetRole: "frontend-dev",
  type: "collaboration",
  relationship: "blocks-me",             // auto-elevates to priority 2
  collaboration: {
    participants: ["frontend-dev"],
    includePlanner: false,
    includeUser: false,
    topic: "Auth endpoints need PKCE — does the frontend SDK support it?",
    expectedOutcome: "Agreed auth flow with updated API spec",
    sharedDocs: ["api-spec.md"],
    readOnlyDocs: ["requirements.md"],
    maxRounds: 10,
    maxTokens: 50000,
    timeoutMinutes: 15,
  },
})
// Returns: { ok: true, taskId: "task-007", status: "pending",
//           collabDocName: "collab/task-007/discussion" }
```

**Schema:**
| Param | Type | Required | Description |
|---|---|---|---|
| `title` | `string` | Yes | Task title |
| `description` | `string` | Yes | What the target agent should do |
| `targetRole` | `string` | Yes | Lowercase role key (e.g., `"backend-dev"`) |
| `type` | `"work" \| "review" \| "collaboration"` | No | Default: `work` |
| `priority` | `2-5` | No | Default: `3`, but **auto-elevated** by type + relationship (see Priority Escalation). Agents can't set priority 1 (planner-only) |
| `context.reason` | `string` | No | Why this task was created |
| `context.files` | `string[]` | No | Paths for context |
| `context.artifacts` | `string[]` | No | Relevant workspace files |
| `relationship` | `"independent" \| "subtask" \| "blocks-me"` | No | Default: `independent` |
| `collaboration` | `object` | No | **Required when `type: "collaboration"`.** See below. |

**`collaboration` config (only when `type: "collaboration"`):**
| Param | Type | Required | Description |
|---|---|---|---|
| `participants` | `string[]` | No | Additional roles to include |
| `includePlanner` | `boolean` | No | Default: `false` |
| `includeUser` | `boolean` | No | Default: `false` — invites human counterpart |
| `topic` | `string` | Yes | What to discuss |
| `expectedOutcome` | `string` | No | What a successful resolution looks like |
| `sharedDocs` | `string[]` | No | Co-editable CRDT doc names |
| `readOnlyDocs` | `string[]` | No | Reference docs |
| `maxRounds` | `number` | No | Default: 10 per agent |
| `maxTokens` | `number` | No | Default: 50,000 total budget |
| `timeoutMinutes` | `number` | No | Default: 15 — escalates if stalled |

**What happens per type:**
| Type | DAG behavior | CRDT setup | Agent prompt |
|---|---|---|---|
| `work` | Standard task dispatch | None | Task description + context files |
| `review` | Standard task dispatch | None | Task description + artifacts to review |
| `collaboration` | Standard dispatch + opens CRDT space | `Y.Array("discussion")`, `Y.Map("decisions")`, `Y.Map("config")`, shared BlockNote docs | Collaboration context + doc paths + guard rail config |

**Relationship effects:**
| Relationship | DAG Effect |
|---|---|
| `independent` | New task, no dependency edge to creator's task |
| `subtask` | New task with `parentTask: {creator's taskId}` |
| `blocks-me` | New task becomes prerequisite of creator's task — creator pauses |

**Guard rails:**
- `maxAgentCreatedTasks` = 5 per agent per plan (prevents infinite loops)
- No self-assignment (can't create tasks for own role)
- Priority ceiling = 2 (priority 1 reserved for planner) — but auto-elevation can reach 2
- Planner notified via `get_status` (sees `createdBy: agent:{role}`)
- Planner can cancel via `cancel_task`
- Collaboration tasks additionally enforce `maxRounds`, `maxTokens`, `timeoutMinutes`

**Priority Escalation — Collaboration Bubbles Up:**

Collaboration and review tasks are inherently urgent — an agent is often blocked waiting for the result. The system auto-elevates priority based on type + relationship so they don't sit behind regular work tasks in the queue:

| Type | Relationship | Agent-set priority | Effective priority | Why |
|---|---|---|---|---|
| `work` | `independent` | 3 | **3** (unchanged) | Normal work, no urgency |
| `work` | `blocks-me` | 3 | **2** (elevated) | Someone is paused waiting |
| `review` | any | 3 | **2** (elevated) | Reviews gate downstream work |
| `collaboration` | `independent` | 3 | **2** (elevated) | Collaboration is cross-agent coordination — inherently urgent |
| `collaboration` | `blocks-me` | 3 | **2** (elevated) | Blocking agent + needs discussion — highest agent priority |

The rules:
1. **`type: "collaboration"` → auto-elevate to min(agent_priority, 2)**. Collaboration is never low-priority — an agent created it because they need input.
2. **`type: "review"` → auto-elevate to min(agent_priority, 2)**. Reviews unblock downstream tasks.
3. **`relationship: "blocks-me"` → auto-elevate to min(agent_priority, 2)**. Someone is literally paused.
4. **Agent can set priority 2 explicitly** — the system won't lower it. Auto-elevation only raises.
5. **Priority 1 stays planner-only.** The system never auto-promotes to 1. If the planner sees a stuck collaboration via `get_status`, it can manually `reprioritize` to 1.

The agent doesn't need to think about this. They call `request_task` with whatever priority feels right (or omit it for default 3), and the system ensures collaboration + reviews + blocking tasks jump the queue.

```typescript
// Agent calls this — doesn't specify priority
request_task({
  title: "Align API spec",
  targetRole: "frontend-dev",
  type: "collaboration",
  relationship: "blocks-me",
  collaboration: { topic: "PKCE support?", ... },
})
// System auto-sets effective priority = 2
// → jumps ahead of priority-3 work tasks in the dispatch queue
```

**Backend work:**
- New file: `packages/agent-manager/src/agent/internal/tools/requestTaskTool.ts`
- Creates `Task` in TaskStore with `createdBy: "agent:{role}"`
- Writes `.ping/tasks/{taskId}.md` via TaskSyncer (if markdown-tasks enabled)
- If `blocks-me`: adds new prerequisite to creator's task in DependencyResolver
- Injects into WorkerPool dispatch queue
- **When `type: "collaboration"`:** also opens CRDT doc `collab-{taskId}` via `CollaborationSpace.openDoc()`, initializes `Y.Array("discussion")`, `Y.Map("decisions")`, `Y.Map("config")` with guard rail settings, opens shared working docs as BlockNote editors, starts timeout timer (escalation: planner → user)

---

#### T3. `record_decision` — Record a Structured Decision

**Who uses it:** Worker agents, users  
**Where it lives:** New action on `collab` tool  
**Depends on:** CollaborationSpace  
**Ships in:** v1.0

**What it does:** Records a formal decision in `Y.Map("decisions")` on a CRDT doc. Separate from `discuss` type=decision — this writes to the persistent decision store, queryable by other agents and the planner.

```typescript
collab({
  action: "record-decision",
  docName: "collab/task-007",
  key: "auth-flow",
  value: {
    decision: "Use PKCE with S256 method",
    reasoning: "PKCE prevents authorization code interception in public clients",
    agreedBy: ["architect", "frontend-dev"],
  }
})
// Returns: { ok: true, decisionId: "auth-flow" }
```

**Schema:**
| Param | Type | Required | Description |
|---|---|---|---|
| `action` | `"record-decision"` | Yes | |
| `docName` | `string` | Yes | CRDT doc path |
| `key` | `string` | Yes | Decision identifier (queryable) |
| `value.decision` | `string` | Yes | What was decided |
| `value.reasoning` | `string` | No | Why |
| `value.agreedBy` | `string[]` | No | Roles that agreed |

**Backend work:**
- Add `record-decision` case to collab tool handler
- Write to `Y.Map("decisions")` on the doc
- Project to `.ping/collaboration/decisions.json` via filesystem projection

---

#### T4. `get_decisions` — Query Recorded Decisions

**Who uses it:** Worker agents, planner  
**Where it lives:** New action on `collab` tool  
**Depends on:** T3  
**Ships in:** v1.0

**What it does:** Reads decisions from a collaboration doc or across all docs.

```typescript
collab({
  action: "get-decisions",
  docName: "collab/task-007",     // optional — omit to query all
  key: "auth-flow",              // optional — omit to get all decisions
})
// Returns: { decisions: [{ key: "auth-flow", decision: "Use PKCE...", ... }] }
```

**Backend work:**
- Add `get-decisions` case to collab tool handler
- Read from `Y.Map("decisions")` — single doc or iterate all CollaborationSpace docs

---

#### Pre-Plan Research — Handled by `submit_plan` (No Separate Tool)

**Why no `submit_research` tool?** Same reasoning as `create_collaboration`: research is just task creation. The planner already has `submit_plan` and `replan`. A "research phase" is simply a plan where all tasks have `type: "research"`.

**How it works with existing tools:**

```typescript
// Step 1: Planner submits a research-only plan
submit_plan({
  planId: "plan-001-research",
  goal: "Build payment system",
  tasks: [
    {
      id: "pre-001",
      title: "Investigate current tech stack",
      assignedRole: "researcher",
      type: "research",              // ← new type value on existing task schema
      expectedOutput: "Tech stack inventory",
    },
    {
      id: "pre-002",
      title: "Identify payment compliance requirements",
      assignedRole: "security-reviewer",
      type: "research",
      expectedOutput: "Compliance requirements summary",
    },
  ],
})

// Step 2: Research tasks execute normally via TaskStore → WorkerPool
// Step 3: Outputs flow into planner context via get_context / onTaskComplete

// Step 4: Planner calls replan with the informed work plan
replan({
  reason: "Research complete — stack is Node.js + Postgres, PCI-DSS Level 1 applies",
  newTasks: [
    { id: "task-001", title: "Implement Stripe integration", ... },
    { id: "task-002", title: "Build PCI-compliant token vault", ... },
  ],
})
```

**Backend work (extends existing `submit_plan`):**
- Add `"research"` to the `type` enum on the Task schema (alongside `work`, `review`, `collaboration`)
- When ALL tasks in a plan are `type: "research"`, OrchestratorService auto-detects and transitions state to `researching`
- State machine: `idle → researching → planning (on research complete) → executing → completed`
- On `replan` after research: creates the real work plan, informed by research outputs
- No new tool file needed — modify `submitPlan.ts` + `OrchestratorService.ts`

---

### Track 2: Ping MCP Server Tools (for External Agents)

These tools are exposed via the MCP server at `/mcp`. External agents (Claude Code, Cursor, Windsurf) connect and get access to Ping's coordination + collaboration capabilities.

**Principle:** External agents keep their OWN workspace tools (Read, Write, Bash, etc.). Ping serves only what they don't have: coordination, collaboration, context, and skills.

---

#### M1. `report_status` (MCP)

**Ships in:** v1.0

Wraps existing internal `report_status` tool as MCP tool.

```typescript
// MCP tool registration
server.tool('report_status', {
  status: z.enum(['in_progress', 'blocked', 'ready_for_review', 'need_clarification']),
  summary: z.string(),
  progress: z.number().min(0).max(100).optional(),
}, handler)
```

**Backend work:** Proxy to existing `createReportStatusTool` handler via WorkerPool callbacks.

---

#### M2. `complete_task` (MCP)

**Ships in:** v1.0

Wraps existing internal `complete_task` tool.

```typescript
server.tool('complete_task', {
  summary: z.string(),
  deliverables: z.array(z.string()),
  nextSteps: z.array(z.string()),
}, handler)
```

**Backend work:** Proxy to existing `createCompleteTaskTool` handler.

---

#### M3. `collab_discover` (MCP)

**Ships in:** v1.0

```typescript
server.tool('collab_discover', {
  path: z.string().optional(),    // e.g., "task/*", "collab/*"
}, handler)
// Returns: { docs: ["agent-statuses", "task/task-003/doc-api-spec", ...] }
```

**Backend work:** Proxy to `collab({ action: "discover" })`.

---

#### M4. `collab_read` (MCP)

**Ships in:** v1.0

```typescript
server.tool('collab_read', {
  doc: z.string(),
  key: z.string(),
}, handler)
// Returns: { value: any }
```

**Backend work:** Proxy to `collab({ action: "read" })`.

---

#### M5. `collab_write` (MCP)

**Ships in:** v1.0

```typescript
server.tool('collab_write', {
  doc: z.string(),
  key: z.string(),
  value: z.any(),
}, handler)
// Returns: { ok: true }
```

**Backend work:** Proxy to `collab({ action: "write" })`.

---

#### M6. `collab_read_block` (MCP)

**Ships in:** v1.0

```typescript
server.tool('collab_read_block', {
  doc: z.string(),
}, handler)
// Returns: { blocks: [{ type, content }] }
```

**Backend work:** Proxy to `collab({ action: "read-block" })`.

---

#### M7. `collab_write_block` (MCP)

**Ships in:** v1.0

```typescript
server.tool('collab_write_block', {
  doc: z.string(),
  blocks: z.array(z.object({ type: z.string(), content: z.string() })),
}, handler)
// Returns: { ok: true }
```

**Backend work:** Proxy to `collab({ action: "write-block" })`.

---

#### M8. `collab_discuss` (MCP)

**Ships in:** v1.0 (after T1 ships)

```typescript
server.tool('collab_discuss', {
  doc: z.string(),
  content: z.string(),
  mentions: z.array(z.string()).optional(),
  type: z.enum(['message', 'question', 'decision']).optional(),
  replyTo: z.string().optional(),
}, handler)
// Returns: { ok: true, blockId: "block-003" }
```

**Backend work:** Proxy to `collab({ action: "discuss" })`.

---

#### M9. `get_context` (MCP)

**Ships in:** v1.0

```typescript
server.tool('get_context', {
  taskId: z.string().optional(),
}, handler)
// Returns: { task: { id, title, description, status, dependencies, ... },
//            previousOutputs: [...], teamGoal: "...", sharedMemory: {...} }
```

**Backend work:** Proxy to planner's `get_context` + inject task-specific paths, prerequisite outputs, and shared memory.

---

#### M10. `get_capabilities` (MCP)

**Ships in:** v1.0

```typescript
server.tool('get_capabilities', {}, handler)
// Returns: { teamName: "...", role: "...", availableTools: [...], activeMode: "..." }
```

**Backend work:** Query team config + agent config + PluginRegistry for currently loaded tools.

---

#### M11. `invoke_skill` (MCP)

**Ships in:** v1.0

```typescript
server.tool('invoke_skill', {
  skillId: z.string(),
}, handler)
// Returns: { content: "SKILL.md body text..." }
```

**Backend work:** Load SKILL.md from plugin folder, return body content. Same as the internal appendSystemPrompt flow but returned as tool result.

---

#### M12-M20. Workspace Tools (MCP, Optional)

**Ships in:** v1.1

Only served to external agents that **don't have their own workspace tools** (detected via capability negotiation from agent frontmatter `tools` field).

| MCP Tool | Internal Equivalent | Purpose |
|---|---|---|
| `workspace_read_file` | Same | Read file |
| `workspace_write_file` | Same | Write file |
| `workspace_create_file` | Same | Create file |
| `workspace_delete_file` | Same | Delete file |
| `workspace_list_files` | Same | List directory |
| `workspace_commit` | Same | Commit changes |
| `workspace_status` | Same | Branch + changes |
| `workspace_info` | Same | Workspace identity |
| `workspace_publish` | Same | Publish workspace |

**Backend work:** Proxy to existing L1 workspace tools. Only register these in `tools/list` response when the connecting agent lacks workspace capabilities.

---

### Track 3: Team Stacking Tools (for Parent/Child Team Coordination)

These tools enable hierarchical team composition — a parent team's planner assigns goals to child teams, which execute independently and stream results back.

---

#### S1. `submit_goal` — Team MCP Server Tool

**Who uses it:** Parent team's ExternalAgent (MCP client) calls this on child team's MCP server  
**Where it lives:** `packages/agent-manager/src/team/McpTeamServer.ts`  
**Depends on:** Ping MCP Server (Track 2), ExternalAgent class  
**Ships in:** v1.1

**What it does:** Submit a goal to a child team. The child team plans and executes independently. Results stream back as SSE events via MCP Streamable HTTP.

```typescript
// Registered on child team's MCP server
server.tool('submit_goal', {
  goal: z.string(),
  context: z.any().optional(),           // parent context, dependencies
  delegationChain: z.array(z.string()).optional(),  // cycle detection
}, async function* ({ goal, context, delegationChain }) {
  // 1. Check delegation chain for cycles
  if (delegationChain?.includes(teamId)) throw new Error("Circular delegation");
  
  // 2. Create orchestrator for this goal
  const orchestrator = getOrchestratorForTeam(teamId);
  
  // 3. Stream progress back as SSE events
  for await (const event of orchestrator.executeGoal(goal, context)) {
    yield event;  // SSE event: progress, task_completed, artifacts, done
  }
})
```

**SSE event types streamed back:**
```typescript
type TeamProgressEvent =
  | { type: "planning", message: string }
  | { type: "task_started", taskId: string, role: string, title: string }
  | { type: "task_completed", taskId: string, output: any, artifacts: string[] }
  | { type: "progress", message: string, percent: number }
  | { type: "completed", summary: string, outputs: any[], artifacts: string[] }
  | { type: "failed", error: string, partialOutputs: any[] }
```

**Backend work:**
- New file: `packages/agent-manager/src/team/McpTeamServer.ts`
- FastMCP server per team with Streamable HTTP transport
- Wire to OrchestratorService — `executeGoal()` returns `AsyncGenerator<TeamProgressEvent>`
- Cycle detection via `delegationChain` array

---

#### S2. `get_capabilities` — Team MCP Server Tool

**Ships in:** v1.1

```typescript
server.tool('get_capabilities', {}, async () => ({
  teamName: "Engineering",
  roles: ["backend-dev", "frontend-dev", "qa-engineer"],
  skills: ["typescript", "react", "testing"],
  activeTasks: 3,
  capacity: "available",    // available | busy | full
}))
```

**Backend work:** Query team's agent definitions + current task load.

---

#### S3. `cancel` — Team MCP Server Tool

**Ships in:** v1.1

```typescript
server.tool('cancel', {
  goalId: z.string(),
}, async ({ goalId }) => {
  orchestrator.cancel(goalId);
  return { ok: true };
})
```

**Backend work:** Cancel running orchestration — abort in-progress tasks, clean up workspaces.

---

#### S4. ExternalAgent Class (Not a Tool, but Required Infrastructure)

**Ships in:** v1.0 (same as A7)

The `ExternalAgent` implements `IAgent` and connects to remote MCP servers. Parent team sees child team as just another agent.

```typescript
class ExternalAgent extends BaseAgent {
  async *execute(input: AgentInput): AsyncGenerator<AgentEvent> {
    const stream = await this.mcpClient.callTool('submit_goal', {
      goal: input.task.description,
      context: input.context,
      delegationChain: [...(input.delegationChain || []), this.teamId],
    });
    for await (const event of stream) {
      yield this.normalizeToAgentEvent(event);
    }
  }
}
```

**Backend work:**
- New file: `packages/agent-manager/src/agent/external/ExternalAgent.ts`
- New file: `packages/agent-manager/src/agent/external/McpTransport.ts`
- Modify `AgentFactory.ts` — register `external` type → `ExternalAgent`
- Modify `OrchestratorService` — allow external workers in dispatch

---

### Track 4: Supporting Infrastructure (Not Tools, but Required)

These aren't agent-facing tools but are required backend infrastructure for the tools above to work.

---

#### I1. Task.md File Format + TaskSyncer

**Ships in:** v1.0

Markdown-first task storage. Tasks are `.ping/tasks/{taskId}.md` with YAML frontmatter. TaskSyncer parses them into the runtime `TaskStore` Map.

**Backend work:**
- New file: `packages/agent-manager/src/orchestrator/sync/TaskSyncer.ts`
- Parse `gray-matter` frontmatter → `Task` object
- On status change: update frontmatter in `.md` file
- Bidirectional: runtime state ↔ file system

---

#### I2. Plan.md File Format

**Ships in:** v1.0

Plans stored as `.ping/plans/plan-{id}.md` with YAML frontmatter + mermaid task graph.

**Backend work:**
- Modify `submit_plan` to also write Plan.md
- Parsing via `gray-matter`

---

#### I3. MCP Server Setup (Express Middleware)

**Ships in:** v1.0

```typescript
// packages/agent-manager/src/mcp/PingMcpServer.ts
class PingMcpServer {
  private server: McpServer;
  
  constructor(workerPool, pluginRegistry) {
    this.server = new McpServer({ name: 'ping', version: '1.0.0' });
    this.registerTools();  // M1-M11
  }
  
  asMiddleware(): Express.RequestHandler  // Mount at /mcp
}
```

**Backend work:**
- New file: `packages/agent-manager/src/mcp/PingMcpServer.ts`
- Mount on HttpServer at `/mcp`
- Feature flag: `PING_MCP_SERVER_ENABLED`

---

#### I4. MCP Authentication

**Ships in:** v1.0

Bearer token validation for MCP connections.

**Backend work:**
- New file: `packages/agent-manager/src/mcp/auth/mcpAuth.ts`
- Validate `Authorization: Bearer {token}` header
- Token from env: `PING_MCP_AUTH_TOKEN`
- No token configured → allow unauthenticated (local dev)

---

#### I5. Capability Negotiation

**Ships in:** v1.0 (basic), v2.0 (MCP initialize)

Filter exposed MCP tools based on connecting agent's declared capabilities.

- **v1.0:** Read `tools` field from agent `.md` frontmatter at load time. If agent has `[Read, Write, Bash, Edit]`, skip `workspace_*` tools in `tools/list`.
- **v2.0:** MCP `initialize` handshake — client sends `capabilities` in `clientInfo`, Ping filters response.

---

#### I6. Team MCP Server Lifecycle

**Ships in:** v1.1

Each team gets its own MCP server (same host, different path).

**Backend work:**
- On `createTeam()` → start MCP server at `/mcp/teams/{teamId}`
- On `deleteTeam()` → stop MCP server
- Register team in Agent Registry with `type: "team"` and `mcpEndpoint`

---

#### I7. Discussion Guard Rail Engine

**Ships in:** v1.0 (with T1)

Enforces `maxRounds`, `maxTokens`, `timeoutMinutes` on discussions.

**Backend work:**
- Track state in `Y.Map("config")` on each collab doc
- On new discussion block: increment counters, check limits
- At 80% token budget → inject "wrap up" guidance
- At limit → force-close, escalate to planner → user
- Timeout: background checker (or Hocuspocus `onLoadDocument` hook) detects stale discussions

---

## Shipping Plan — What Goes When

### v1.0 — Collaboration Primitives + MCP Server

**Goal:** Agents can discuss, delegate, record decisions. External agents can connect.

| ID | Tool/Component | Track | New/Extend | Effort |
|---|---|---|---|---|
| T1 | `discuss` action | Collaboration | Extend `collab` | 2-3 days |
| T2 | `request_task` (work + review + collaboration) | Collaboration | New tool | 4-5 days |
| T3 | `record-decision` action | Collaboration | Extend `collab` | 1 day |
| T4 | `get-decisions` action | Collaboration | Extend `collab` | 0.5 day |
| I1 | TaskSyncer (Task.md) | Infrastructure | New | 3-4 days |
| I2 | Plan.md format | Infrastructure | Modify `submit_plan` | 1-2 days |
| I3 | MCP Server setup | MCP | New | 2-3 days |
| I4 | MCP Auth | MCP | New | 1 day |
| I5 | Capability negotiation (basic) | MCP | New | 1-2 days |
| I7 | Discussion guard rails | Infrastructure | New | 2 days |
| M1-M8 | MCP coordination + collab tools | MCP | Proxies | 2-3 days |
| M9-M11 | MCP context + skills tools | MCP | Proxies | 1-2 days |
| S4 | ExternalAgent class | Team Stacking | New | 3-4 days |

**Total v1.0 estimate:** ~23-28 days of work

### v1.1 — Team Stacking + Full Workspace MCP

**Goal:** Teams delegate to child teams. Research-before-planning via `type: "research"` tasks.

| ID | Tool/Component | Track | New/Extend | Effort |
|---|---|---|---|---|
| — | `type: "research"` on tasks | Collaboration | Extend `submit_plan` | 1-2 days |
| S1 | `submit_goal` (team MCP) | Team Stacking | New | 3-4 days |
| S2 | `get_capabilities` (team MCP) | Team Stacking | New | 1 day |
| S3 | `cancel` (team MCP) | Team Stacking | New | 1 day |
| I6 | Team MCP server lifecycle | Infrastructure | New | 2-3 days |
| M12-M20 | Workspace MCP tools | MCP | Proxies | 2-3 days |

**Total v1.1 estimate:** ~11-15 days of work

### v2.0 — Recursive Composition + Advanced Negotiation

| ID | Tool/Component | Track | Notes |
|---|---|---|---|
| — | Recursive team stacking (depth limit, cycle detection) | Team Stacking | `delegationChain` already designed |
| — | MCP `initialize` capability negotiation | MCP | Full handshake vs frontmatter detection |
| — | Cross-team shared CRDT docs | Collaboration | Teams share docs across boundaries |
| — | Cross-team dependency resolution | Team Stacking | Child team A output → child team B input |

---

## File Map — Where Everything Goes

### New Files

```
packages/agent-manager/src/
├── agent/internal/tools/
│   └── requestTaskTool.ts              ← T2
├── agent/external/
│   ├── ExternalAgent.ts                ← S4
│   └── McpTransport.ts                ← S4
├── orchestrator/sync/
│   └── TaskSyncer.ts                  ← I1
├── mcp/
│   ├── PingMcpServer.ts               ← I3
│   ├── auth/
│   │   └── mcpAuth.ts                 ← I4
│   └── tools/
│       ├── taskTools.ts               ← M1, M2
│       ├── collabTools.ts             ← M3-M8
│       ├── contextTools.ts            ← M9, M10
│       └── skillTools.ts              ← M11
├── team/
│   └── McpTeamServer.ts              ← S1, S2, S3, I6
```

### Modified Files

```
packages/collaboration/src/L2/tools/index.ts    ← T1, T3, T4 (new actions)
packages/agent-manager/src/agent/AgentFactory.ts ← Register ExternalAgent
packages/agent-manager/src/orchestrator/tools/submitPlan.ts ← Plan.md writes (I2)
packages/agent-manager/src/orchestrator/OrchestratorService.ts ← researching state (type:research detection)
packages/agent-manager/src/orchestrator/tools/submitPlan.ts ← accept type:research tasks
packages/backend/server.ts (or api/AgentManagerAPI.ts) ← Mount MCP middleware (I3)
```

---

## Tool Access Matrix — Who Gets What

| Tool | Internal Worker | Planner | External Agent (MCP) | Child Team |
|---|---|---|---|---|
| `collab` (all actions) | Yes | — | Via M3-M8 | Via M3-M8 |
| `discuss` | Yes | — | Via M8 | Via M8 |
| `request_task` (work/review/collab) | Yes | — | — (uses complete_task) | — |
| `record-decision` | Yes | — | Via M8 (discuss type=decision) | — |
| `report_status` | Yes | — | Via M1 | — |
| `complete_task` | Yes | — | Via M2 | — |
| `submit_plan` (work/research) | — | Yes | — | — |
| `get_status` | — | Yes | — | — |
| `get_context` | — | Yes | Via M9 | — |
| `get_capabilities` | — | Yes | Via M10 | Via S2 |
| `invoke_skill` | — | — | Via M11 | — |
| `submit_goal` | — | — | — | Via S1 |
| `cancel` | — | — | — | Via S3 |
| Workspace tools (31) | Yes | — | Via M12-M20 (if needed) | — |

---

## Design Principles

1. **One protocol (MCP) for everything.** Internal tools use AI SDK `tool()`. External agents get the same capabilities via MCP. No separate HTTP/WS adapter.

2. **Proxy, don't duplicate.** MCP tools proxy to existing internal tool handlers. One implementation, two interfaces.

3. **Guard rails by default.** Every discussion has token budgets, round limits, and timeouts. Every agent-created task has caps. Prevent unbounded LLM spend.

4. **Agents see files, not APIs.** Task.md and Plan.md are workspace files — agents read them with `workspace_read_file`, not custom query tools. Fewer tools to learn.

5. **Capability subtraction.** MCP serves ALL tools by default, then subtracts what the client already has. Don't force agents to declare what they need — detect what they have.

6. **Planner governs, agents act.** Agents can create tasks and initiate collaboration, but the planner can always cancel, reprioritize, or override. The hierarchy is preserved.
