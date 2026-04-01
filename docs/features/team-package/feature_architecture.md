# Team Package Extraction — Feature Architecture

**Status:** New  
**Date:** March 29, 2026  
**ID:** B1  
**Depends on:** E5 (Team Service)

---

## Overview

Extract into **two separate packages**: `@ping/agent-manager` (the core orchestration engine) and `@ping/teams` (team management on top). Teams, CLI, and backend all consume `@ping/agent-manager`. The backend becomes a thin API layer.

### Current State
- `packages/backend/team/` has TeamService.ts, models.ts
- `packages/backend/agentManager/` has AgentManagerV2
- Everything is one monolith — can't use AgentManager without the full backend
- Frontend and CLI both talk to the backend via HTTP/WebSocket

### Target State

```
packages/
  agent-manager/              ← @ping/agent-manager (core engine)
    src/
      AgentManager.ts           — Orchestrator runtime (spawns planner, workers)
      TaskStore.ts              — Task state, DAG, single writer
      DependencyResolver.ts     — DAG resolution, critical path
      WorkerPool.ts             — Worker dispatch, concurrency
      Watchdog.ts               — Heartbeat, stall detection
      types/
        index.ts                — Task, Plan, AgentConfig, etc.
    package.json                — @ping/agent-manager (publishable)

  teams/                      ← @ping/teams (consumes @ping/agent-manager)
    src/
      TeamManager.ts            — Create, configure, manage teams
      TeamConfig.ts             — Team definition, roles, settings
      types/
        index.ts                — Team, TeamConfig, MemberConfig
    package.json                — @ping/teams (publishable)

  backend/                    ← Consumes @ping/teams + @ping/agent-manager
    api/                        — HTTP/WebSocket layer (thin)
    server.ts                   — Express + Socket.IO

  frontend/                   ← Consumes backend API

  cli/                        ← Imports @ping/agent-manager + @ping/teams directly
```

### Why Two Packages, Not One

```
❌ One package (@ping/teams with AgentManager inside):
   CLI wants to run a single agent, no team → still pulls in team logic
   External devs want orchestration → forced to understand teams
   AgentManager is useful standalone

✅ Two packages (@ping/agent-manager + @ping/teams):
   AgentManager is the universal engine — works alone or inside a team
   Teams is an opinion OVER AgentManager — team configs, roles, members
   CLI uses AgentManager directly for single-agent tasks
   CLI uses Teams for team-based workflows
   Backend is a thin API over both
```

---

## Package Dependency Graph

```
                    ┌────────────────┐
                    │   @ping/teams  │
                    │  (team mgmt)   │
                    └───────┬────────┘
                            │ depends on
                            ▼
                ┌──────────────────────┐
                │ @ping/agent-manager  │
                │   (core engine)      │
                └──────────┬───────────┘
                           │ depends on
                           ▼
                    ┌──────────────┐
                    │   AI SDK     │
                    │  (ai, tools) │
                    └──────────────┘

Consumers:
  backend  → imports @ping/teams + @ping/agent-manager
  cli      → imports @ping/teams + @ping/agent-manager (no HTTP needed)
  external → imports @ping/agent-manager (standalone orchestration)
```

---

## `@ping/agent-manager` — Core Engine

The standalone orchestration runtime. No team concept, no HTTP, no database opinions.

### Public API

```typescript
import { AgentManager } from '@ping/agent-manager';

// Create an orchestrator
const manager = new AgentManager({
  model: 'azure/gpt-4o',
  plannerConfig: { instructions: '...' },
  workerPool: { maxConcurrent: 5 },
});

// Run a goal
const execution = await manager.execute('Build a marketing campaign', {
  roles: ['researcher', 'writer', 'designer'],
  skills: { researcher: ['web-search', 'summarize'] },
  onStream: (part) => console.log(part),  // streaming events
});

// Or use it as a library — bring your own planner, tools, etc.
const taskStore = new TaskStore();
const depResolver = new DependencyResolver(taskStore);
const workerPool = new WorkerPool({ maxConcurrent: 3 });
```

### What Lives Here

| Component | Purpose |
|---|---|
| `AgentManager` | Top-level orchestrator — spawns planner, manages execution |
| `TaskStore` | Task CRUD, state machine, single writer |
| `DependencyResolver` | DAG resolution, cycle detection, critical path |
| `WorkerPool` | Worker dispatch, concurrency limits, heartbeat tracking |
| `Watchdog` | AIMD stall detection, dead worker cleanup |
| `PlanSchema` | Plan/Task type definitions and validation |
| `StreamBridge` | Converts AI SDK `fullStream` to typed events |

### What Does NOT Live Here

- Team management (→ `@ping/teams`)
- HTTP/WebSocket layer (→ `packages/backend`)
- Database layer (→ consumer provides storage adapter)
- UI components (→ `packages/frontend`)

---

## `@ping/teams` — Team Management

Team-level orchestration built on top of `@ping/agent-manager`.

### Public API

```typescript
import { TeamManager } from '@ping/teams';
import { AgentManager } from '@ping/agent-manager';

// Create a team
const team = await TeamManager.create({
  name: 'Marketing Campaign Team',
  roles: [
    { name: 'researcher', skills: ['web-search', 'summarize'] },
    { name: 'writer', skills: ['write-copy', 'grammar-check'] },
    { name: 'designer', skills: ['generate-image'] },
  ],
  plannerModel: 'azure/gpt-4o',
  autoApproval: { researcher: true, writer: false },
});

// Each team gets its own AgentManager instance
const manager = team.getAgentManager();  // → AgentManager

// Run a goal within the team context
await team.runGoal('Build a marketing campaign for product X');
```

### What Lives Here

| Component | Purpose |
|---|---|
| `TeamManager` | Create, configure, list, delete teams |
| `TeamConfig` | Team definition — roles, skills, approval rules, settings |
| `RoleManager` | Role definitions, skill assignments per role |
| `MemberManager` | Human + agent members of a team |
| Team persistence | MongoDB models for teams |

### Relationship to AgentManager

```typescript
class Team {
  private agentManager: AgentManager;  // from @ping/agent-manager

  constructor(config: TeamConfig) {
    this.agentManager = new AgentManager({
      model: config.plannerModel,
      workerPool: { maxConcurrent: config.maxWorkers },
      roles: config.roles,
      skills: this.resolveSkills(config.roles),
    });
  }

  async runGoal(goal: string): Promise<Execution> {
    return this.agentManager.execute(goal, {
      roles: this.config.roles.map(r => r.name),
      approvalConfig: this.config.autoApproval,
      onStream: (part) => this.emitToSubscribers(part),
    });
  }
}
```

Each team = one AgentManager instance. Multiple teams = multiple independent AgentManagers.

---

## How Each Consumer Uses the Packages

### Backend (API layer)

```typescript
// packages/backend/api/HttpServer.ts
import { TeamManager } from '@ping/teams';

app.post('/api/teams', async (req, res) => {
  const team = await TeamManager.create(req.body);
  res.json(team);
});

app.post('/api/teams/:id/goals', async (req, res) => {
  const team = await TeamManager.get(req.params.id);
  const execution = await team.runGoal(req.body.goal);
  res.json(execution);
});
```

Backend is a **thin HTTP/WebSocket layer** over `@ping/teams`. No orchestration logic in the API layer.

### CLI (direct import, no HTTP)

```typescript
// packages/cli/commands/run.ts
import { AgentManager } from '@ping/agent-manager';
import { TeamManager } from '@ping/teams';

// Single agent mode — just AgentManager, no teams
async function runSingleAgent(goal: string, role: string) {
  const manager = new AgentManager({ model: 'azure/gpt-4o' });
  await manager.execute(goal, {
    roles: [role],
    onStream: (part) => renderToTerminal(part),
  });
}

// Team mode — full team support
async function runTeam(teamId: string, goal: string) {
  const team = await TeamManager.get(teamId);
  await team.runGoal(goal);
}
```

CLI imports packages **directly** — no backend server needed for local execution.

### External Consumers (standalone)

```typescript
// Any Node.js app can use @ping/agent-manager
import { AgentManager, TaskStore } from '@ping/agent-manager';

const manager = new AgentManager({ model: 'azure/gpt-4o' });
await manager.execute('Analyze this dataset', {
  roles: ['analyst'],
  skills: { analyst: ['data-analysis', 'summarize'] },
});
```

---

## Migration Path

| Step | What Moves | From | To |
|---|---|---|---|
| 1 | AgentManager, TaskStore, WorkerPool, DependencyResolver | `packages/backend/agentManager/` | `packages/agent-manager/` |
| 2 | Task types, Plan types, Agent types | `packages/backend/*/types/` | `packages/agent-manager/types/` |
| 3 | Watchdog, heartbeat logic | `packages/backend/services/` | `packages/agent-manager/` |
| 4 | TeamService, TeamConfig, RoleManager | `packages/backend/team/`, `packages/backend/roleManager/` | `packages/teams/` |
| 5 | Backend imports both packages | — | `packages/backend/` becomes thin API |
| 6 | CLI imports both packages | — | `packages/cli/` works without backend |

**Effort:** Medium (2-3 weeks)
