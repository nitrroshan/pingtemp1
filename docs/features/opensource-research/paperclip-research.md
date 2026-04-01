# Paperclip — Competitive Research

**Date:** April 1, 2026  
**Source:** [github.com/paperclipai/paperclip](https://github.com/paperclipai/paperclip) (42.4k stars, MIT, 55 contributors)  
**Category:** Closest open-source competitor to Ping

---

## What Paperclip Is

"Open-source orchestration for zero-human companies." A Node.js server + React UI that orchestrates a team of AI agents to run a business. It's a **control plane** — it doesn't build agents, it manages them.

**Tagline:** "If OpenClaw is an employee, Paperclip is the company."

### Core Philosophy Difference

```
PAPERCLIP: "Agents are employees. You're the board. Run a company."
  → Autonomous execution with human oversight
  → Async (heartbeats), ticket-based, org hierarchy
  → Agents bring their own runtime (OpenClaw, Claude Code, Codex, Cursor)
  → Optimized for "24/7 autonomous operation"

PING: "Agents are team members. You're the supervisor. Collaborate."
  → Collaborative execution with human participation
  → Real-time (streaming), plan-based, teams stack into orgs
  → Ping creates internal agents AND orchestrates external agents via MCP
  → Optimized for "interactive goal completion"
```

---

## Architecture

### Stack

```
Server:    Express REST API (Node.js)
UI:        React + Vite
Database:  PostgreSQL (embedded PGlite for dev, external for prod)
ORM:       Drizzle
Monorepo:  pnpm workspaces

packages/
  ├── db/              Drizzle schema, migrations, DB clients
  ├── shared/          Types, constants, validators, API paths
  ├── adapters/        Agent adapters (Claude, Codex, Cursor, OpenClaw, HTTP, Bash)
  ├── adapter-utils/   Shared adapter utilities
  ├── plugins/         Plugin system
  server/              Express API + orchestration services
  ui/                  React board UI
  cli/                 CLI tools
  skills/              Runtime skill injection (markdown files)
```

### The Company Model (Data Structure)

```
Company (isolation boundary)
├── Settings (name, goals, branding)
├── Budget (monthly limits per agent, hard-stop enforcement)
├── Org Chart
│   ├── Agent: CEO (openclaw adapter)
│   │   ├── Agent: CTO (claude adapter)
│   │   │   ├── Agent: Backend Dev (codex adapter)
│   │   │   └── Agent: Frontend Dev (cursor adapter)
│   │   └── Agent: Marketing Lead (claude adapter)
│   └── Delegation flows up and down the hierarchy
├── Projects
│   ├── Project: "Build MVP"
│   │   ├── Issue: "Design API schema" → assigned to Backend Dev
│   │   └── Issue: "Build landing page" → assigned to Frontend Dev
│   └── Project: "Customer Support" (recurring via heartbeat schedule)
├── Governance
│   ├── Approval gates (new hires, strategy changes)
│   ├── Config revision history + rollback
│   └── Human override/pause/terminate at any time
└── Audit Log (every action traced, every decision explained)
```

### Agent Adapter Pattern

Paperclip doesn't build agents. It wraps existing agents via adapters:

| Adapter | What It Wraps | How It Connects |
|---|---|---|
| `claude` | Claude Code CLI | Spawns `claude` subprocess |
| `codex_local` | OpenAI Codex CLI | Spawns `codex`, manages per-company Codex home |
| `cursor` | Cursor | Cursor's API |
| `openclaw` | OpenClaw (autonomous) | Webhook: Paperclip sends heartbeat → OpenClaw wakes |
| `bash` | Any shell script | Runs arbitrary commands |
| `http` | Any HTTP API | POST with task context |

Common adapter interface — agents are interchangeable. Each gets its own workspace under `~/.paperclip/instances/default/workspaces/<agent-id>`.

### Heartbeat Coordination Model

Instead of event-driven dispatch (what Ping does):

```
1. Agent has a SCHEDULE (heartbeat interval — e.g. every 5 min)
2. Heartbeat fires → Agent "wakes up"
3. Agent checks: "Do I have work assigned?"
   YES → Execute the task (using the adapter)
   NO  → Go back to sleep
4. Work is "checked out" atomically — DB transaction prevents double-assignment
5. Agent reports results → Paperclip records them
6. Next heartbeat → repeat
```

**Properties:**
- Resilient — agent crash → next heartbeat picks it up
- Atomic checkout — task assignment + budget deduction is one DB transaction
- Session persistence — agent resumes same context across heartbeats
- Cost-bounded — budget enforced at checkout, not after the fact

### Ticket System (Issues)

```typescript
Issue {
  title, description
  assignedAgent          // single-assignee, atomic checkout
  status                 // open → in_progress → done/failed
  goalAncestry           // traces back to company mission (the "why")
  comments[]             // agent explains decisions
  toolCallTracing        // immutable audit log
  costTracking           // tokens used, API calls
}
```

**Goal ancestry** is key: every issue carries full context chain from company mission → project goal → specific issue. Agents always know WHY a task exists.

### Workspace Model

```
~/.paperclip/instances/default/
├── db/                      Embedded PostgreSQL data
├── data/
│   ├── storage/             Uploaded images/attachments
│   └── backups/             Auto DB backups (hourly, 30-day retention)
├── secrets/
│   └── master.key           Local encryption for secrets
├── workspaces/
│   └── <agent-id>/          Per-agent default workspace
└── companies/
    └── <company-id>/
        └── codex-home/      Per-company Codex config
```

For code tasks: **git worktrees** (not branches) per agent run. Each worktree is an isolated checkout of the project repo.

### Security

| Feature | How |
|---|---|
| Agent API keys | Bearer tokens, hashed at rest, company-scoped |
| Company isolation | Every entity scoped to company, cross-company prevented |
| Secret management | Local encryption with master key, strict mode for production |
| Untrusted PR review | Separate Docker container for reviewing untrusted code |
| Governance | Approval gates enforced, config revisioned, rollback supported |
| Board authority | Human can override/pause/terminate any agent at any time |

### Plugin System

```
packages/plugins/
  ├── knowledge-base
  ├── custom tracing
  ├── queue management
  └── community plugins (awesome-paperclip)
```

### Skills (Runtime Injection)

Markdown files that teach agents how to use Paperclip at runtime — heartbeat protocol, issue management, project context. Not code skills — document skills.

```
skills/                    # Global Paperclip skills
.agents/skills/            # Per-repo skill files
.claude/skills/            # Claude-specific skills
```

---

## What Paperclip Does That Ping Doesn't

| Feature | Paperclip | Ping Status |
|---|---|---|
| **Cost control** | Per-agent monthly budgets, atomic enforcement, hard-stop | ⚠️ Architecture designed, not built. See [cost-tracking](../cost-tracking/feature_architecture.md). |
| **Bring-your-own-agent** | Adapter pattern — any agent runtime works | ✅ `ExternalAgent` + MCP — any agent exposing MCP server is a worker. See [external-agent-invocation](../external-agent-invocation/feature_architecture.md). Better than adapters — one protocol, not N drivers. |
| **Org chart hierarchy** | CEO → CTO → Dev with delegation up/down | ✅ Team stacking — teams compose via `ExternalAgent`. Flat inside a team, hierarchical across teams. See [team-stacking](../team-stacking/feature_architecture.md). |
| **Atomic task checkout** | DB transaction prevents double-assignment | ❌ Not guaranteed |
| **Goal ancestry** | Issue carries full WHY chain from company mission | ⚠️ Planner research → `context.notes` on tasks. Structured but different — tool-based, not chain-based. See [planner-as-agent](../planner-as-agent/feature_architecture.md). |
| **Auto DB backups** | Hourly, 30-day retention, configurable | ⚠️ CRDT binary state export + `mongodump` for index. Infra supports it, scheduling not built. |
| **Secret management** | Encrypted at rest, strict mode, master key | ⚠️ Planned — Azure Key Vault (already on Azure for OpenAI). Build own later if needed. |
| **Company templates** | Export/import entire orgs with secret scrubbing | ⚠️ Architecture designed. See [company-templates](../company-templates/feature_architecture.md). |
| **Config revision + rollback** | Every config change versioned, rollback supported | ⚠️ Architecture designed. See [config-revision](../config-revision/feature_architecture.md). |
| **Heartbeat scheduling** | Agents wake on schedule, check for work | ❌ Event-driven only |
| **Session persistence** | Agent resumes same context across heartbeats/reboots | ⚠️ Designed but not built |
| **Git worktrees** | Isolated checkout per agent run | Uses branches |
| **Multi-company** | Full data isolation, one deployment | ⚠️ Team stacking architecture done — teams compose into orgs via `ExternalAgent`. Data isolation per team via CRDT doc namespacing. See [team-stacking](../team-stacking/feature_architecture.md). |
| **Untrusted code review** | Docker container for reviewing PRs safely | ⚠️ Architecture designed — sandboxed workers + trust levels. See [untrusted-code-review](../untrusted-code-review/feature_architecture.md). Builds on [worker-sandboxing](../worker-sandboxing/feature_architecture.md). |
| **Plugin system** | Extensible via packages/plugins | ❌ Nothing |

## What Ping Does That Paperclip Doesn't

| Feature | Ping | Paperclip Status |
|---|---|---|
| **Real-time CRDT collaboration** | Hocuspocus + Yjs, agents co-edit documents | ❌ Async only, ticket-based |
| **Agentic Planner** | Planner agent with tools — researches domain, analyzes requirements, assesses team capabilities, then creates DAG plans. Not just structured output. See [planner-as-agent](../planner-as-agent/feature_architecture.md). | ❌ Manual or agent-created issues |
| **Streaming** | AI SDK fullStream, token-by-token, tool call cards | ❌ Results appear when done |
| **3-layer memory** | L1 workspace + L2 collab + L3 knowledge | Plugin-based knowledge, less structured |
| **Code intelligence** | Tree-sitter symbol index, repo map, BM25 search | ❌ None (agents bring their own) |
| **Scratchpad** | Private play area per agent (.scratch/) | ❌ None |
| **Structured plan approval** | Plan with deps, risk, critical path → user approves | ❌ Ticket approve/reject only |
| **Group chat** | Time-boxed agent discussions with outcome extraction | ❌ None |

---

## What Ping Should Adopt

### Adopt Now (Phase 1-3)

| What | Why | Effort |
|---|---|---|
| **Lazy context injection** | Tasks carry goal + summaries of prior work in prompt. Agent pulls full details on demand via tools. Inspired by Paperclip's goal ancestry but adapted for Ping's tool-based architecture. | Low — summaries in prompt, `get_task_context` tool for details |
| **Cost tracking** | Production essential — know what agents cost | Medium — track tokens per task/agent, display in UI. [Feature doc](../cost-tracking/feature_architecture.md) |
| **Persistent shared docs** | Currently plans are JSON files, task state is in-memory, manifests on disk. All moves to CRDT shared docs (Hocuspocus) — agents read/write via existing `collab` tool, MongoDB indexes for aggregation. Backup = CRDT binary state + `mongodump` for index. See [data-persistence](../data-persistence/feature_architecture.md). | Medium — migrate PlanStore, TaskStore, manifests to CRDT docs + MongoDB index |
| **Secret management** | Security — use Azure Key Vault (already on Azure). Per-team scoping, rotation, audit. Build own vault later if needed. | Low — SDK integration, no custom crypto |

> **Note on atomic task checkout:** Paperclip needs DB locks because multiple agents pull work independently (heartbeat model). Ping doesn't — one AgentManager dispatches to workers directly. No race condition. A simple dispatch mutex flag is enough for defensive coding. DB-level locks only needed if Ping ever goes multi-process (not planned).

### Adopt Later (Phase 4-5)

| What | Why | Effort | Architecture |
|---|---|---|---|
| **Config revision + rollback** | Production safety — rollback bad config changes | Low | [config-revision](../config-revision/feature_architecture.md) |
| **Untrusted code review** | Security — sandbox code from external sources | Medium | [untrusted-code-review](../untrusted-code-review/feature_architecture.md) |
| **Company/team templates** | Export/import team configs for sharing | Low | [company-templates](../company-templates/feature_architecture.md) |
| **Plugin system** | Community extensibility | Medium | Not designed |

### Don't Adopt (Different Philosophy)

| What | Why Not |
|---|---|
| **Heartbeat model** | Ping is event-driven and real-time — heartbeats add latency. Our watchdog (AIMD) handles liveness. |
| **Rigid org chart** | Ping uses *composable* hierarchy via team stacking — not a fixed org chart. Teams are flat internally, hierarchical across teams. More flexible than Paperclip's static CEO→CTO→Dev tree. |
| **Git worktrees** | Branches are simpler and well-understood. Worktrees add complexity for marginal isolation benefit. |
| **Zero-human philosophy** | Ping is human+AI collaboration, not autonomous companies. |

---

## Key Takeaways

1. **Paperclip is the closest competitor** — same problem space (multi-agent orchestration), different philosophy (autonomous vs collaborative).

2. **They're further ahead on production concerns** — cost control, secrets, backups, governance. Ping has architecture for most of these (cost-tracking, Key Vault, CRDT+mongodump, team stacking) but hasn't shipped them yet.

3. **Ping is further ahead on collaboration** — real-time CRDT, streaming, structured planning, group chat, memory layers. Paperclip agents work in isolation.

4. **Ping's MCP approach supersedes Paperclip's adapter pattern** — one protocol (MCP) vs N adapter classes. Any agent that speaks MCP is a worker. See [external-agent-invocation](../external-agent-invocation/feature_architecture.md).

5. **42.4k stars in ~2 months** — there's massive demand for multi-agent orchestration. The market validates both approaches.
