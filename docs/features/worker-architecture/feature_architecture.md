# Worker Architecture — Three-Layer Execution Model

**Status:** Architecture Draft  
**Date:** April 12, 2026  
**Consolidates:** A10 (Persistent Agents), A7 (External Agent Invocation), A11 (Ping MCP Server)  
**Depends on:** Conversation Persistence, Team Registry, Worker Sandboxing

---

## Problem

The system has three separate design documents that describe how work gets done — but none answers the central question: **how do we package internal workers, external workers, and the chat layer into a unified execution model?**

This document consolidates the 3-layer hierarchy into one reference that covers the full worker lifecycle: who plans, who manages sessions, who does the work, and how internal/external agents are interchangeable.

---

## The Three Layers

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: PLANNER  (persistent, team-scoped)                    │
│                                                                 │
│  One per team. Owns the user conversation. Creates plans,       │
│  decomposes goals into tasks, monitors execution, replans.      │
│  Always available for chat about strategy and progress.         │
│                                                                 │
│  Tools: submit_plan, ask_user, research_domain (sub-agent),     │
│         get_status, update_task, replan                          │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: CHAT AGENT  (persistent, role-scoped)                 │
│                                                                 │
│  One per role. Ping's own AiSdkAgent — always running.          │
│  The "session owner" — receives tasks from planner, creates     │
│  sessions per task, spawns workers, collects results.           │
│                                                                 │
│  Always available for chat about domain, past work, decisions.  │
│  Has READ-ONLY tools to inspect workspace, collab, knowledge.   │
│  Exposes itself as MCP server for external agent connections.   │
│                                                                 │
│  Tools: execute_task (spawns worker), read_workspace,           │
│         search_files, search_collab, search_knowledge,           │
│         get_task_history, get_plan_context                        │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: WORKER  (transient, task-scoped)                      │
│                                                                 │
│  Does the actual work. Fresh context per task, dies after       │
│  completion. Default: Crush (open-source CLI agent).            │
│                                                                 │
│  Crush is a general-purpose agent shell — has file/bash/LSP     │
│  tools built in, plus connects to Ping MCP for role-specific    │
│  tools. Works for coding AND non-coding roles.                  │
│                                                                 │
│  CODING roles: Crush uses its own file/bash tools + Ping MCP    │
│  NON-CODING roles: Crush uses Ping MCP tools only               │
│    (web_search, content_write, data_query, etc.)                │
│                                                                 │
│  Alternative: Claude Code, Copilot, external (user selects)     │
│                                                                 │
│  All workers get Ping MCP coordination tools:                   │
│    report_status, complete_task, collab_read/write, get_context  │
└─────────────────────────────────────────────────────────────────┘
```

### Why Three Layers, Not Two

| Without Layer 2 (Chat Agent) | With Layer 2 |
|---|---|
| Planner holds ALL domain context | Each role agent holds its own domain memory |
| Can't chat with individual roles | Users talk to persistent role agents anytime |
| Context window explodes (every task's 100k tokens on planner) | Sub-agents burn tokens independently; parent keeps only summaries |
| No session management for external agents | Chat Agent is the session owner — manages connections |
| No domain continuity between tasks | Backend Dev remembers what it built |

---

## Layer 2: Chat Agent as Session Owner

Chat Agents are **Ping's own AiSdkAgent** — persistent LLM conversations managed by Ping's backend. They are NOT external processes. They run in-process using AI SDK `streamText()` with read-only tools.

### What Chat Agents Can Do (Without Active Task)

| Tool | Type | Purpose |
|------|------|---------|
| `read_workspace` | Direct | Read files from team workspace (main branch, read-only) |
| `search_files` | Direct | Search workspace by pattern/content |
| `search_collab` | Direct | Search L2 collaboration docs |
| `search_knowledge` | Direct | Search L3 knowledge base |
| `get_task_history` | Direct | Read outputs/reports from completed tasks |
| `get_plan_context` | Direct | Read current plan status, task states |
| `execute_task` | Sub-agent | Spawn a worker for a new task |

**Chat Agents CANNOT** write files, commit, run code, or modify the workspace. They observe and discuss. When work needs to happen, they spawn a worker (Layer 3).

When a task arrives from the planner, the Chat Agent:

1. **Creates a session** for the task
2. **Prepares workspace** (git branch, clone for isolation)
3. **Selects a worker** — Crush, Ping internal, or external
4. **Provides session tools** — context, coordination, collaboration
5. **Collects results** — merges branch, reports to planner

### Session Per Task

```
Chat Agent (Backend Dev) — coding role
│
├── Task T-001: "Build auth API"
│   └── Session S-001
│       ├── Worker: Crush (default for coding)
│       ├── Branch: task-t001
│       ├── Status: completed
│       └── Summary: "Created 3 endpoints, 12 files"
│
├── Task T-004: "Add rate limiting"
│   └── Session S-004
│       ├── Worker: Claude Code (user selected via UI)
│       ├── Branch: task-t004
│       └── Status: in_progress
│
└── No active task → still available for chat (using read-only tools)
    User: "What auth library did you use?"
    Chat Agent: *uses read_workspace* "Passport.js with bcrypt. See /src/auth/middleware.ts"

Chat Agent (Marketing Lead) — content role
│
├── Task T-006: "Write launch blog post"
│   └── Session S-006
│       ├── Worker: Crush + content MCP tools (default)
│       ├── Status: in_progress
│       └── MCP tools: web_search, content_write, collab_read
│
└── No active task → still available for chat
    User: "What’s our messaging for the auth feature?"
    Chat Agent: *uses search_knowledge* "Security-first, zero-config auth..."
```

### How Worker Selection Works

```
Task arrives → Chat Agent checks for connected external agents
  │
  ├── External agent connected + user selected it? → External worker
  │
  └── Default → Spawn Crush process
      Crush gets: crush.json with Ping MCP config (role-specific tools)
      CODING role → Crush uses its own file/bash/LSP tools + Ping MCP
      NON-CODING role → Crush mainly uses Ping MCP tools (web_search, content, etc.)
```

This is the **default mode** — Ping works fully autonomously. External agents (Claude Code, OpenClaw, etc.) are optional alternatives the user can select via the UI.

---

## Internal Workers vs External Workers

### The Universal Interface

Both internal and external workers implement the same `SubAgentAdapter` interface:

```typescript
interface SubAgentAdapter {
  start(task: SubAgentTask): AsyncGenerator<SubAgentEvent>;
  send(message: SubAgentMessage): void;
  cancel(): Promise<void>;
  isRunning(): boolean;
}
```

The Chat Agent doesn't care what's behind the adapter. It calls `start()`, iterates events, handles `ask_user`, and collects the `complete` result. The UI doesn't know either — same stream channel, same rendering.

### Default Worker: Crush (Open-Source CLI Agent)

Instead of building a custom internal agent with workspace tools, Ping uses **Crush** (formerly OpenCode, by charmbracelet) as the **default worker for ALL roles** — coding and non-coding. Crush is a general-purpose CLI agent that already has file tools, terminal, LSP, MCP client, and multi-provider LLM support.

> **Note:** OpenCode (opencode-ai/opencode) was archived Sep 2025. The project continued as [Crush](https://github.com/charmbracelet/crush) (charmbracelet/crush, 22.9k stars, actively maintained). License: FSL-1.1-MIT.
>
> **Why Crush for non-coding roles too?** There are NO open-source non-coding agent tools equivalent to Crush/Claude Code. The entire agentic AI ecosystem is coding-focused. Rather than building a separate internal agent (duplicate work), Crush serves as a general-purpose agent shell — its file/bash tools are harmless for non-coding roles, and role-specific tools (web search, content generation, etc.) come via Ping MCP.

### How Crush Works Differently Per Role Category

```
CODING role (backend-dev, frontend-dev, qa, devops):
  Crush uses:
  ├── Its own tools heavily: view, write, edit, patch, bash, grep, glob, LSP
  └── Ping MCP tools: report_status, complete_task, collab_read/write, skills

NON-CODING role (marketing, sales, content, research, design):
  Crush uses:
  ├── Its own tools lightly: bash (for scripts), write (for drafts), fetch (web)
  └── Ping MCP tools heavily: web_search, content_write, generate_image,
      data_query, collab_read/write, get_context, invoke_skill
```

The difference isn't the agent — it's the **tools available via Ping MCP**. Crush is the shell. Ping MCP provides role-specific capabilities.

### Crush Tool Diagram

```
Chat Agent (Backend Dev)
  │
  │ Task arrives → spawn Crush CLI process
  │
  └── Crush process:
      ├── Crush's own tools (no need for Ping to provide these):
      │   ├── view, write, edit, patch  (file operations)
      │   ├── bash                      (terminal/commands)
      │   ├── grep, glob, ls            (search + navigation)
      │   ├── diagnostics               (LSP code intelligence)
      │   ├── fetch                     (web requests)
      │   └── agent                     (sub-task delegation)
      │
      ├── Ping MCP tools (via crush.json mcp config):
      │   ├── report_status, complete_task, ask_user
      │   ├── collab_read, collab_write
      │   ├── get_context, invoke_skill
      │   └── workspace_commit, workspace_publish
      │
      ├── Model: configured per role (Azure OpenAI, Anthropic, etc.)
      ├── Context: task instructions injected via -p flag or AGENTS.md
      ├── Workspace: runs cwd = cloned repo on task branch
      └── Skills: Ping skills loaded via invoke_skill MCP tool
```

**Why Crush instead of a custom agent?**
- **No workspace tools to build** — Crush already has view, write, edit, patch, bash, grep, glob, LSP diagnostics.
- **No non-coding agent exists** — Searched the ecosystem. ALL open-source agentic tools (Crush, Claude Code, Codex, OpenClaw, Copilot) are coding-focused. No equivalent for marketing/sales/content. Instead of building one from scratch, use Crush as a general-purpose shell and deliver role-specific tools via MCP.
- **MCP native** — Crush is an MCP client. Configure Ping's MCP server in `crush.json` and it gets role-specific tools automatically — whether that's `workspace_commit` for coding or `web_search` for marketing.
- **Same integration pattern as Claude Code** — Claude Code connects to Ping MCP, Crush connects to Ping MCP. Same architecture.
- **Multi-provider** — Crush supports Azure OpenAI, Anthropic, OpenAI, Groq, Ollama, etc.
- **Non-interactive mode** — `crush -p "task instructions" --yolo` runs autonomously.
- **Open source** — Can fork and customize if needed (Go, FSL-1.1-MIT).

### Ping MCP Tools by Role Category

Crush gets different MCP tools based on the role:

| Tool Category | Coding Roles | Content Roles | Research Roles | Operations Roles |
|--------------|-------------|---------------|----------------|------------------|
| **Coordination** (always) | ✅ | ✅ | ✅ | ✅ |
| report_status, complete_task, ask_user | ✅ | ✅ | ✅ | ✅ |
| **Collaboration** (always) | ✅ | ✅ | ✅ | ✅ |
| collab_read, collab_write, get_context | ✅ | ✅ | ✅ | ✅ |
| **Workspace** (coding) | ✅ | ❌ | ❌ | ❌ |
| workspace_commit, workspace_publish | ✅ | ❌ | ❌ | ❌ |
| **Content** (non-coding) | ❌ | ✅ | ✅ | ✅ |
| web_search, content_write | ❌ | ✅ | ✅ | ❌ |
| **Research** (non-coding) | ❌ | ❌ | ✅ | ❌ |
| data_query, source_analyze | ❌ | ❌ | ✅ | ❌ |
| **Operations** (non-coding) | ❌ | ❌ | ❌ | ✅ |
| email_draft, schedule_meeting | ❌ | ❌ | ❌ | ✅ |
| **Skills** (always) | ✅ | ✅ | ✅ | ✅ |
| invoke_skill | ✅ | ✅ | ✅ | ✅ |

Ping's MCP server filters which tools to expose based on the role's category in the `.md` frontmatter.

**How Ping spawns Crush:**

```typescript
// Chat Agent spawns Crush for a task
const crush = spawn('crush', ['-p', taskInstructions, '--yolo', '-f', 'json'], {
  cwd: workspaceClonePath,        // isolated task branch
  env: {
    ...process.env,
    AZURE_OPENAI_API_KEY: config.apiKey,
    AZURE_OPENAI_API_ENDPOINT: config.endpoint,
  },
});
```

**Crush config (`crush.json`) placed in workspace clone:**

```json
{
  "$schema": "https://charm.land/crush.json",
  "agents": {
    "coder": {
      "model": "azure-openai.gpt-4o",
      "maxTokens": 8000
    }
  },
  "mcp": {
    "ping": {
      "type": "http",
      "url": "http://localhost:3002/mcp/teams/{teamId}/roles/{roleId}"
    }
  },
  "permissions": {
    "allowed_tools": ["view", "write", "edit", "patch", "bash", "grep", "glob", "ls"]
  }
}
```

**What makes it "sandboxed":**
- Fresh process per task (no accumulated conversation from previous tasks)
- Isolated workspace branch (cloned repo, `task-{taskId}` branch)
- Dies after task completion — Chat Agent reads output, extracts summary
- Optionally runs in a container (Worker Sandboxing feature): `docker run -v workspace:/workspace crush -p "..." --yolo`
- Ping MCP endpoint scoped per team/role — can only access its own team's coordination tools

**When to use:** Default for **all roles**. Always available. No user action needed.

### Future: Dedicated Non-Coding Agents

Crush-as-shell works today, but dedicated agents may emerge:

| If this happens... | Then we... |
|---|---|
| Open-source content agent appears (like Crush but for writing) | Add a new `SubAgentAdapter`, make it default for content roles |
| Open-source research agent appears | Same — new adapter, default for research roles |
| We outgrow Crush for non-coding | Fork Crush (it's open-source) and strip coding tools, add native content tools |
| Someone builds a generic agentic shell (coding-agnostic) | Evaluate and potentially switch |

The `SubAgentAdapter` interface means switching default workers is a configuration change, not an architecture change.

### External Worker: Claude Code

User's Claude Code instance (in VS Code) connects to Chat Agent's MCP endpoint. Uses its own superior workspace tools (Read, Write, Edit, Bash, LSP) plus Ping's coordination/collaboration tools.

```
User's VS Code + Claude Code
  │
  │ claude_desktop_config.json:
  │ { "ping": { "type": "http", "url": "http://localhost:3002/mcp" } }
  │
  └── Claude Code connects → Chat Agent MCP server
      │
      ├── Claude Code has: Read, Write, Bash, Edit, Grep, LSP
      │   (superior workspace tools — Ping doesn't replace these)
      │
      └── Ping MCP provides: report_status, complete_task,
          collab_read, collab_write, get_context, invoke_skill
          (coordination, collaboration, context — what Claude Code lacks)
```

**When to use:** User wants interactive control. Complex tasks where human judgment helps. Tasks requiring tools Claude Code has that internal agents don't (LSP, computer use, browser).

### External Worker: OpenClaw

Self-hosted or cloud OpenClaw agent. Communicates via HTTP + SSE.

```
Chat Agent → execute_task → OpenClawSubAgent
  │
  │  POST /sessions → create session on OpenClaw
  │  GET /sessions/{id}/stream → SSE event stream
  │  POST /sessions/{id}/answer → respond to ask_user
  │
  └── SubAgentEvent stream → same as internal
```

**When to use:** Organization has OpenClaw deployment. Tasks requiring OpenClaw-specific capabilities. Running agents on dedicated infrastructure.

### External Worker: Another Ping Team (Team Stacking)

A child Ping team wrapped as a single worker. The parent doesn't know it's an entire team internally.

```
Parent Team (Product)
  └── Chat Agent assigns task "Build auth system"
      └── TeamSubAgent → MCP client → Child Team MCP server
          │
          Child Team (Engineering) — has its own 3-layer hierarchy:
          ├── L1: Child Planner decomposes "Build auth system"
          ├── L2: Chat Agents (backend-dev, qa, frontend-dev)
          └── L3: Workers executing sub-tasks
          │
          └── Returns: single complete event with summary
              Parent sees: "Auth system built. 3 endpoints, tests pass."
```

**When to use:** Complex tasks that need their own team structure. Delegation to specialized teams. Tasks owned by different people/orgs.

### External Worker: Copilot CLI

Local CLI process spawned by Chat Agent. Communicates via stdin/stdout.

```
Chat Agent → execute_task → CopilotCliSubAgent
  │
  │  spawn('copilot', ['--task', instructions], { cwd: workspace })
  │  Parse stdout → SubAgentEvent stream
  │  Write to stdin → user answers, pings
  │
  └── On exit → complete event
```

---

## How Workers Get Selected

### Default: Crush Process (All Roles)

When no external agent is connected and the user hasn't selected one:

```
Chat Agent receives task
  │
  └── Default → Spawn Crush CLI process
      Crush gets: crush.json with Ping MCP config (role-specific tools)
      Crush gets: AGENTS.md with role identity + task instructions
      Crush runs: in isolated workspace clone on task branch
      On exit: Chat Agent reads output, extracts summary
```

### User-Directed Selection (UI-Driven)

Worker selection happens in the **UI**, not via natural language. When a task is ready, the Chat Agent shows available workers and the user picks one:

```
┌─ Task T-004: "Add rate limiting" (backend-dev) ───────────────┐
│                                                                │
│  Select worker:                                                │
│                                                                │
│  ● My Agent (default)          ← Crush + coding MCP tools      │
│  ○ Claude Code (connected)     ← user's VS Code instance       │
│  ○ OpenClaw (connected)        ← remote OpenClaw agent          │
│  ○ Engineering Team (available) ← child Ping team               │
│                                                                │
│  [Start Task]                                                  │
└────────────────────────────────────────────────────────────────┘

┌─ Task T-005: "Write launch blog post" (marketing) ────────────┐
│                                                                │
│  Select worker:                                                │
│                                                                │
│  ● My Agent (default)          ← Crush + content MCP tools     │
│  ○ ChatGPT (connected)         ← external content agent         │
│                                                                │
│  [Start Task]                                                  │
└────────────────────────────────────────────────────────────────┘
```

**How it works:**
1. Task arrives at Chat Agent from planner
2. UI shows the task with a worker selector
3. Selector lists: "My Agent" (default) + any connected external agents
4. User selects one (or accepts default)
5. Chat Agent creates a session with the selected worker
6. If user doesn't select within a configurable timeout → default (my agent) starts automatically

**Connected agents appear in the selector automatically.** When a Claude Code instance connects to the Chat Agent's MCP endpoint, it shows up as an option. When it disconnects, it disappears. No configuration needed.

### Per-Role Configuration (Agent .md Frontmatter)

```yaml
---
name: backend-developer
role: backend
autoStart: true                   # auto-start with default worker (no user selection)
# autoStart: false                # wait for user to select worker
# autoStartTimeout: 30000         # ms before auto-starting with default
---
```

---

## Capability Negotiation

When an agent connects (internal or external), the Chat Agent validates it can handle the role:

```
Agent connects → sends capabilities
  │
  ├── languages: ["typescript", "python"]
  ├── tools: ["Read", "Write", "Bash", "Edit"]
  ├── skills: ["react", "api-design", "testing"]
  ├── canRunCode: true
  └── canAccessNetwork: true
  │
  ▼
Chat Agent checks against role requirements
  │
  ├── Role requires: typescript, api-design
  ├── Agent has: typescript, api-design ✓
  │
  └── Accepted → session created, tools provided
```

For **internal agents**: capabilities are always sufficient (we control the tools).
For **external agents**: missing capabilities → rejection with clear reason.

Ping detects what the external agent already has and only serves what's missing:

```
Claude Code connects → has [Read, Write, Bash, Edit, Grep, LSP]
  → Ping serves: coordination + collaboration + context + skills ONLY

Lightweight bot connects → has nothing
  → Ping serves: ALL tools (workspace + coordination + collab + skills)
```

---

## Session Lifecycle

Every task execution follows the same session lifecycle regardless of worker type:

```
1. TASK_RECEIVED    → Chat Agent gets task from planner/orchestrator
2. SESSION_CREATED  → Workspace branch created, context prepared
3. WORKER_SELECTED  → Crush spawned (default) OR external (user-selected)
4. WORKING          → Worker streams progress, asks questions, writes code
5. COMPLETE/FAILED  → Worker signals done → Chat Agent collects results
6. MERGE_DECISION   → Chat Agent decides: auto-merge or wait for approval
7. REPORT           → Summary sent to planner, task marked complete
```

### Session State

**Workers own their own sessions.** Crush, Claude Code, child Ping teams — they all maintain their own internal sessions with conversation history, context, and state. Ping does NOT manage worker sessions.

Ping's Chat Agent tracks only the external reference:

```typescript
type TaskAssignment = {
  taskId: string;
  roleId: string;
  workerType: 'crush' | 'claude-code' | 'openclaw' | 'copilot' | 'team' | 'custom';
  workerSessionRef: string;    // opaque ID from the worker's own session
  workspaceBranch: string;
  streamChannel: string;       // Socket.IO room for forwarding events
  status: 'pushed' | 'accepted' | 'working' | 'paused' | 'completed' | 'failed';
  createdAt: Date;
};
```

When a worker calls `report_status`, `ask_user`, or `complete_task` via MCP, it includes its own `sessionRef`. Ping routes events to the UI using the `streamChannel` but never touches the worker's internal state.

---

## Communication Flows

### Default Worker Communication (Crush)

```
Planner ──task──→ Chat Agent ──spawn──→ Crush CLI process
                      │                     │
                      │                     ├── Crush connects to Ping MCP
                      │                     ├── Uses own tools (view, write, edit, bash...)
                      │                     ├── report_status → Ping MCP → Socket.IO → UI
                      │                     ├── ask_user → Ping MCP → Socket.IO → UI → answer
                      │                     ├── complete_task → Ping MCP → Chat Agent
                      │                     └── Commits to task branch in workspace
                      │
                      └── Chat Agent merges branch, reports to Planner
```

**Key insight:** Crush connects to Ping the same way Claude Code does — via MCP. The only difference is Crush is spawned by Ping (server-side, autonomous) while Claude Code is launched by the user (client-side, interactive). Same protocol, same tools, same constraints. For non-coding roles, the Ping MCP just serves different tools (web_search, content_write instead of workspace_commit).

### External Worker Communication (MCP)

```
Planner ──task──→ Chat Agent (MCP Server)
                      │
                      │ External agent connects via MCP:
                      │ { "ping": { "type": "http", "url": "http://localhost:3002/mcp" } }
                      │
                      ├── connect      → validate capabilities → create session
                      ├── get_task     → return task instructions + context
                      ├── report_status → progress shown in Ping UI
                      ├── ask_question  → routed to user or answered by Chat Agent
                      ├── complete_task → Chat Agent collects results
                      └── disconnect   → session closed
```

### Key Insight: Same Bounds

External agents operate under the **same constraints** as internal agents:
- Same `maxSteps` / turn limits
- Same tool permissions (from agent .md frontmatter)
- Same task DAG (prerequisites must be met)
- Same streaming protocol (SubAgentEvent)
- Same approval flows

The UI cannot distinguish internal from external execution.

---

## Packaging Model

### What "Packaging" Means

Each worker type is packaged as a `SubAgentAdapter` implementation:

| Package | Adapter Class | Protocol | Deployment |
|---------|--------------|----------|------------|
| **My Agent** (default, all roles) | `CrushSubAgent` | CLI process + Ping MCP | Crush spawned by Ping backend |
| **Claude Code** | `ClaudeSubAgent` | MCP (Ping exposes MCP server) | User's VS Code connects to Ping |
| **OpenClaw** | `OpenClawSubAgent` | HTTP + SSE | Remote OpenClaw server |
| **Copilot CLI** | `CopilotCliSubAgent` | stdin/stdout (child process) | Local CLI process |
| **Child Ping Team** | `TeamSubAgent` | MCP (child team exposes MCP server) | Same or remote Ping instance |
| **Generic** | `AgentProtocolSubAgent` | Agent Protocol REST | Any compliant agent |

### Adding a New Worker Type

1. Implement `SubAgentAdapter` interface (4 methods: `start`, `send`, `cancel`, `isRunning`)
2. Register adapter factory in Chat Agent's worker registry
3. Add agent type to `.md` frontmatter schema

No changes to planner, orchestrator, UI, or streaming pipeline. The adapter encapsulates everything.

---

## Workspace Isolation Per Worker

Each worker gets an isolated workspace clone:

```
workspaces/{teamId}/                          ← main team repo
workspaces/{teamId}-clones/task-{taskId}/     ← isolated clone per task
```

1. Chat Agent clones the team repo for the task
2. Creates `task-{taskId}` branch in the clone
3. Places `crush.json` in clone root (MCP config + model config)
4. Default worker: Crush spawned with `cwd = clone path`
5. External worker: clone path provided via MCP session or mounted into container
6. On completion: worker commits → pushes branch → Chat Agent merges

For **containerized workers** (Worker Sandboxing feature):
```
docker run -v workspaces/{teamId}-clones/task-{taskId}:/workspace crush -p "..." --yolo
```

---

## References

- [Persistent Agents (A10)](../persistent-agents/feature_architecture.md) — Full 3-layer hierarchy, sub-agent patterns, parallel plans
- [Sub-Agent Protocol](../persistent-agents/sub-agent-protocol.md) — SubAgentAdapter interface, all adapter implementations, ask_user/ping/redirect
- [External Agent Invocation (A7)](../external-agent-invocation/feature_architecture.md) — ExternalAgent as worker, MCP-only protocol
- [Ping MCP Server (A11)](../ping-mcp-server/feature_architecture.md) — MCP tools exposed to external agents, capability negotiation
- [Conversation Persistence](../conversation-persistence/feature_architecture.md) — Per-agent conversation model, session storage
- [Worker Sandboxing](../worker-sandboxing/feature_architecture.md) — Container isolation for workers
- [Team Stacking](../team-stacking/feature_architecture.md) — Child teams as workers
