# @ping/agent-manager

Orchestration layer for the Ping platform. Manages teams, workers, tasks, and AI agent execution.

## Phase 3C Roadmap Status

This package was created as **Phase 3C Step 1** of the Ping monorepo extraction roadmap.

| Step | Status | Description |
|------|--------|-------------|
| Step 1 | ✅ **Done** | Package declared; public contract types exported from `@ping/agent-manager` |
| Step 2 | 🔜 Planned | Source code physically moved from `@ping/backend/agentManager/` to `packages/agent-manager/src/` |
| Step 3 | 🔜 Planned | `@ping/backend` updated to import `AgentManager` from `@ping/agent-manager` |

See `docs/features/ROADMAP.md` — Phase 3C: Team Package & Multi-Team.

## Current State

The source code for `AgentManager`, `OrchestratorService`, and `WorkerPool` still lives in `packages/backend/`. This package exposes the **public contract** (callback interfaces and shared types) that form the package boundary. Consumers who want to type their callback registrations should import from here.

```ts
import type {
  ManagerStreamCallbacks,
  WorkerCallbacks,
  OrchestratorCallbacks,
} from "@ping/agent-manager";
```

## Public API

### Callback Interfaces

| Interface | Description |
|-----------|-------------|
| `ManagerStreamCallbacks` | Top-level callbacks registered with `AgentManager` |
| `WorkerCallbacks` | Per-worker event callbacks used by `WorkerPool` |
| `OrchestratorCallbacks` | Callbacks emitted by `OrchestratorService` during planning |

### Event Types

| Type | Description |
|------|-------------|
| `OrchestratorState` | State machine states for the orchestrator (`idle`, `gathering`, `awaiting_approval`, `executing`) |
| `PlanProposedEvent` | Emitted when a plan is ready for user approval |
| `PlanApprovedEvent` | Emitted after a plan is approved and tasks are queued |

### Plan Types

| Type | Description |
|------|-------------|
| `TaskItem` | A single task in an execution plan |
| `AgentPlanOutput` | Complete plan returned by the plan builder agent |
| `TaskPlan` | Alias for `AgentPlanOutput` |

### Registry Types

| Type | Description |
|------|-------------|
| `TeamData` | Team data shape used to configure an `AgentManager` instance |

## After Phase 3C Step 2

Once the source is moved, the full API will be importable from `@ping/agent-manager`:

```ts
import { AgentManager, agentManagerRegistry } from "@ping/agent-manager";
```

## Development

```bash
# Type-check only (no emit needed for source-in-place packages)
bun run typecheck
```
