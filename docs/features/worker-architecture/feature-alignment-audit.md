# Feature Alignment Audit — Worker Architecture

**Date:** April 12, 2026  
**Purpose:** Resolve conflicts, eliminate redundancy, and define the real Chat Agent responsibilities across 14+ feature docs.

---

## 1. Audit Summary

### Documents Reviewed

| Doc | Feature ID | Status | Conflicts? |
|-----|-----------|--------|-----------|
| Worker Architecture | (consolidation) | Draft | Source of truth after this audit |
| Persistent Agents | A10 | Draft | Aligned |
| Sub-Agent Protocol | A10 detail | Draft | Aligned |
| Ping MCP Server | A11 | Draft | Aligned |
| External Agent Invocation | A7 | Draft | ⚠️ Interface mismatch (uses `IAgent`, not `SubAgentAdapter`) |
| Worker Sandboxing | A4 | New | Needs update: Crush runs in container, not proxied tool calls |
| Conversation Persistence | — | Planned | Aligned (orthogonal to git persistence) |
| Tools as MCP | A3 | New | Aligned |
| Collaboration Toolkit | — | Draft | Aligned |
| Git Task Context | A8 | New | Aligned |
| Team Stacking | B3 | New | Aligned |
| Untrusted Code Review | A10 | Draft | ⚠️ Trust levels not integrated into other docs |
| Task Orchestration | A6 | New | Aligned |
| Markdown Tasks | A6 detail | Draft | Aligned |
| Planner-as-Agent | A5 | ✅ Complete | Aligned |

### Conflicts Found

| # | Conflict | Resolution |
|---|----------|-----------|
| 1 | A7 uses `ExternalAgent extends IAgent`, A10 uses `SubAgentAdapter` | **A7 must adopt `SubAgentAdapter`.** One interface for all workers. |
| 2 | Worker Architecture doesn't detail streaming | **Add: workers stream directly to UI via stream channel. Chat Agent gets summary only.** Already defined in Sub-Agent Protocol — reference it. |
| 3 | Trust levels (A10/untrusted code) not in orchestrator dispatch | **Defer.** Trust is an enforcement layer added when sandboxing ships. Not needed for v1. |
| 4 | Worker Sandboxing describes proxied tool calls, but Crush changes this | **Update: Crush runs entirely inside container**, not tool-by-tool proxying. Simpler. |

### Redundancies

| Content | Appears In | Keep In |
|---------|-----------|---------|
| 3-layer hierarchy diagram | Worker Architecture, Persistent Agents, Production-Grade | **Worker Architecture** (consolidation doc) |
| SubAgentAdapter interface | Sub-Agent Protocol, Worker Architecture | **Sub-Agent Protocol** (canonical definition) |
| MCP tool list | Ping MCP Server, Collaboration Toolkit | **Ping MCP Server** (canonical), Collab Toolkit references it |
| Chat Agent as MCP server | Persistent Agents, Ping MCP Server, Worker Architecture, Production-Grade | **Worker Architecture** (what it does), **Ping MCP Server** (protocol details) |

---

## 2. The Real Chat Agent Responsibilities

This is the single source of truth for what a Chat Agent (Layer 2) does. Every feature doc should align to this.

### What a Chat Agent IS

A Chat Agent is **Ping's own AiSdkAgent** — a persistent, in-process LLM conversation that:
- Runs inside the Ping backend (Node.js, AI SDK `streamText()`)
- Has one instance per role per team (e.g., "Backend Dev" for Team X)
- Persists across tasks, conversations, and sessions
- Is always available for user chat — even with no active task

### What a Chat Agent Does (7 Responsibilities)

```
┌─────────────────────────────────────────────────────────────────────┐
│                   CHAT AGENT RESPONSIBILITIES                       │
│                                                                     │
│  1. CHAT         Always-on conversation with user about domain      │
│  2. SESSION      Create/manage task sessions (one per task)         │
│  3. WORKSPACE    Prepare isolated workspace (branch + clone)        │
│  4. CONNECT      Accept worker connections (Crush, Claude, etc.)    │
│  5. CONTEXT      Provide task instructions + dependency outputs     │
│  6. COLLECT      Receive results, merge branches, report to planner │
│  7. EXPOSE MCP   Serve Ping MCP endpoint for worker connections     │
└─────────────────────────────────────────────────────────────────────┘
```

### Responsibility Detail

#### R1: CHAT (Always-On Conversation)
- User can talk to any Chat Agent anytime
- Has **read-only tools**: `read_workspace`, `search_files`, `search_collab`, `search_knowledge`, `get_task_history`, `get_plan_context`
- Answers questions about past work, domain, decisions
- **Conversation persisted** in MongoDB (see Conversation Persistence doc)

#### R2: SESSION (Task Session Management)
When planner assigns a task:
```
Chat Agent receives task assignment
  → Creates TaskSession { sessionId, taskId, roleId, workerType, status }
  → Session tracks: which worker, what branch, what status
  → Session is the link between Chat Agent and Worker
```

#### R3: WORKSPACE (Prepare Isolated Environment)
Before any worker starts:
```
1. Clone team repo: workspaces/{teamId}/ → workspaces/{teamId}-clones/task-{taskId}/
2. Create task branch: git checkout -b task-{taskId}
3. Generate AGENTS.md with role identity + task instructions
4. Generate crush.json with Ping MCP config + model config (for Crush workers)
5. Set up workspace permissions (what the worker can access)
```
This is the same for ALL worker types. The workspace is prepared by Chat Agent before the worker connects.

#### R4: CONNECT (Accept Worker Connections)
Chat Agent exposes MCP server at `/mcp/teams/{teamId}/roles/{roleId}`:

```
ANY worker (Crush, Claude Code, Copilot, OpenClaw, child team) connects via MCP:
  │
  ├── Worker calls: connect({ agentType, capabilities })
  │   → Chat Agent validates capabilities against role requirements
  │   → Chat Agent creates session (or assigns existing one)
  │   → Returns: { sessionId, task, workspace, tools }
  │
  ├── Worker calls: get_task()
  │   → Returns: task instructions + dependency outputs + context
  │
  ├── Worker calls: report_status({ progress, message })
  │   → Chat Agent forwards to Socket.IO → UI
  │
  ├── Worker calls: ask_user({ question, options })
  │   → Chat Agent forwards to Socket.IO → UI → waits for answer → returns
  │
  ├── Worker calls: complete_task({ summary, artifacts })
  │   → Chat Agent records result, triggers merge decision
  │
  └── Worker disconnects
      → Chat Agent marks session complete/paused
```

**KEY INSIGHT:** This is identical for ALL worker types. Crush spawned server-side, Claude Code connected by user, Copilot CLI spawned locally — they all connect to the same MCP endpoint and get the same interface. The user sees the same UI regardless of which worker is doing the work.

#### R5: CONTEXT (Provide Task Context)
When a worker requests context:
```
Chat Agent provides:
├── Task instructions (from plan)
├── Dependency outputs (summaries from completed upstream tasks)
├── Workspace path (the prepared clone)
├── Role identity (from agent .md definition)
├── Available skills (from skill registry)
└── Team context (collab docs relevant to task)
```
Worker can also call `get_context({ detail: 'full' })` for more depth.

#### R6: COLLECT (Results & Merge)
When a worker completes:
```
1. Worker calls complete_task({ summary, artifacts })
2. Chat Agent checks task branch for commits
3. Merge decision:
   ├── autoMerge: true → merge to main
   └── autoMerge: false → wait for user approval (show in UI)
4. Chat Agent updates task status → planner gets notified
5. Cleanup: remove clone directory
```

#### R7: EXPOSE MCP (Protocol Layer)
Chat Agent runs a Ping MCP server that provides:

| Tool Category | Tools | Who Uses |
|---|---|---|
| **Coordination** | `connect`, `get_task`, `report_status`, `complete_task`, `ask_user` | All workers |
| **Collaboration** | `collab_read`, `collab_write`, `collab_discuss`, `get_decisions` | All workers |
| **Context** | `get_context`, `get_capabilities`, `invoke_skill` | All workers |
| **Workspace** (optional) | `workspace_read`, `workspace_write`, `workspace_commit`, `workspace_publish` | Workers without own file tools (rare) |

Ping MCP serves **only what the worker needs** based on capability negotiation. Claude Code has Read/Write/Bash → Ping skips workspace tools. Crush has everything → Ping skips workspace tools. Lightweight bot has nothing → Ping serves all tools.

---

## 3. The Seamless Worker Experience

### What Makes It Seamless (User Perspective)

| Aspect | What User Sees | What Differs Underneath |
|--------|---------------|----------------------|
| **Task assignment** | Same UI — task card with worker selector | Different adapter spawned |
| **Progress** | Same progress stream in UI | Crush: stdout parsed. Claude Code: MCP events. |
| **Questions** | Same ask_user dialog in UI | Crush: MCP tool call. Claude Code: MCP tool call. Same. |
| **Results** | Same completion card with summary | Same — all workers call `complete_task` via MCP |
| **Workspace** | Same branch, same merge flow | Same — Chat Agent prepares workspace identically |
| **Chat during task** | Same — talk to Chat Agent anytime | Chat Agent is always running, separate from worker |

### What Makes It Seamless (Developer Perspective)

One protocol (MCP), one endpoint per role, one session model:

```
Chat Agent MCP Server
  │
  ├── Crush connects (spawned by Ping, server-side, --yolo mode)
  │   ├── Uses own tools: view, write, edit, bash, grep, LSP
  │   ├── Uses Ping MCP: report_status, complete_task, collab_*, get_context
  │   └── Streams: stdout → CrushSubAgent adapter → SubAgentEvent
  │
  ├── Claude Code connects (launched by user, client-side, interactive)
  │   ├── Uses own tools: Read, Write, Edit, Bash, Grep, LSP
  │   ├── Uses Ping MCP: report_status, complete_task, collab_*, get_context
  │   └── Streams: MCP events → ClaudeSubAgent adapter → SubAgentEvent
  │
  ├── Copilot CLI connects (spawned by Ping, local process)
  │   ├── Uses own tools: (built-in)
  │   ├── Uses Ping MCP: report_status, complete_task, collab_*, get_context
  │   └── Streams: stdout → CopilotCliSubAgent adapter → SubAgentEvent
  │
  └── Child Ping Team connects (another Ping instance, MCP)
      ├── Uses own tools: (entire 3-layer hierarchy internally)
      ├── Uses parent's Ping MCP: report_status, complete_task
      └── Streams: MCP events → TeamSubAgent adapter → SubAgentEvent
```

**All adapters output `SubAgentEvent`.** Chat Agent iterates the same async generator regardless of worker type.

---

## 4. What Changes in Existing Docs

### Worker Sandboxing (A4) — Update Needed
**Current:** Tool calls proxied through `SandboxProvider.exec()`  
**Updated:** Crush runs entirely inside container. No proxying. The whole process is sandboxed.
```
docker run -v workspace:/workspace -e AZURE_OPENAI_API_KEY=... crush -p "..." --yolo
```
Sandboxing = container around Crush. Not tool-call interception.

### External Agent Invocation (A7) — Update Needed
**Current:** `ExternalAgent extends BaseAgent` with `IAgent` interface  
**Updated:** Must use `SubAgentAdapter` interface (from A10 Sub-Agent Protocol). All workers — internal and external — implement `SubAgentAdapter`.

### Worker Architecture — This Doc (Already Updated)
**Status:** Aligned after all the iterations in this session. This doc is now the consolidation point.

### Other Docs — No Changes Needed
All other docs are internally consistent and don't conflict with the unified model.

---

## 5. Feature Priority Alignment

Based on what's needed to achieve the seamless worker experience:

### Must Have Before Workers Work

| Priority | Feature | Why | Status |
|----------|---------|-----|--------|
| 1 | **Conversation Persistence** | Chat Agents need persistent conversations to be "always on" | Planned |
| 2 | **Ping MCP Server (A11)** | The protocol layer all workers connect to | Draft |
| 3 | **Git Task Context (A8)** | Workspace isolation (branch per task, clone per worker) | New |
| 4 | **SubAgentAdapter interface** | Universal worker interface (from A10 Sub-Agent Protocol) | Draft |

### Nice to Have (Can Ship Without)

| Priority | Feature | Why | Status |
|----------|---------|-----|--------|
| 5 | Worker Sandboxing (A4) | Security isolation — needed for production, not for dev | New |
| 6 | Team Stacking (B3) | Child teams as workers — advanced feature | New |
| 7 | Untrusted Code Review | Trust levels — production security feature | Draft |
| 8 | Collaboration Toolkit tools | Enhanced agent-to-agent collaboration | Draft |

### Already Done

| Feature | Status |
|---------|--------|
| Planner-as-Agent (A5) | ✅ Complete |
| AI SDK Migration (A1) | ✅ Complete |
| Agentic Streaming (A2) | ✅ Complete |
| Task Orchestration (A6) | ✅ Core complete |
| Skills Integration (C3) | ✅ Complete |
| Event Refactor (3B) | ✅ Complete |
