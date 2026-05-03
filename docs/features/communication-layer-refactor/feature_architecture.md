# Communication Layer Refactor — Architecture

> **Updated:** May 3, 2026 — Reflects v1-v3 completion + v4-v5 plans
> **Status:** v1-v3 Done, v3.1-v5 Planned

## Current State (post v3.0)

### What's been fixed (v1-v3)

| Version | What | Status |
|---------|------|--------|
| v1.0 | GoalCoordinator (patch) | Done — superseded by v2.0 |
| v2.0 | GoalSessionStore — single frontend store | Done — replaced chatStore + orchestrationStore + GoalCoordinator |
| v2.5 | goalId explicit everywhere | Done — zero getCurrentGoalId() in action handlers, frontend sends goalId with every action |
| v3.0 | Backend persistence — MongoDB dual-write | Done — 14 mutation paths, startup recovery, goal metadata recovery |

### What's left

| Problem | Where | Planned Fix |
|---------|-------|-------------|
| CRDT/File task stores still write redundantly alongside MongoDB | GoalManager (15 CRDT calls), AgentManagerV2 (10 File calls) | v3.1: Remove |
| updateTaskStatus scoped by taskId only, not goalId | ITaskPersistence, MongoTaskService | v3.1: Add goalId to interface |
| SQLite task persistence is a no-op stub | ServiceRegistry local mode | v3.1: Implement |
| Restore endpoint reads from in-memory first, DB second | HttpServer.ts L422-555 | v4.0: DB-primary |
| 13 untyped Socket.IO events, catch-all `state` event | SocketServerV2.ts (1641 lines) | v4.0: Typed events |
| Frontend derives sessionState locally | goalSessionStore | v4.0: Server-computed |
| No shared types between frontend + backend | Duplicate definitions | v5.0: packages/shared |
| SocketServerV2 is 1641 lines (SRP violation) | backend/api/ | v5.0: Split into 4 services |
| 5-layer callback chain (AiSdkAgent → SocketServerV2) | WorkerPool, OrchestratorService, AgentManagerV2 | v5.0: Flatten to 3 |
| 10 Socket.IO subscriptions wired manually in App.tsx | App.tsx L269-410 (~164 lines) | v5.0: Zustand middleware |
| Workers report to planner, not ChatAgent | GoalManager.onWorkerDone | v5.0: ChatAgent routing (Channel B) |

### Current data flow

```
Frontend (goalSessionStore)
  → AgentServiceV2 (Socket.IO + HTTP)
    → SocketServerV2 (1641 lines — events, actions, broadcasts)
      → AgentManagerV2 (orchestrator facade)
        → OrchestratorService → GoalManager → WorkerPool → AiSdkAgent

Persistence (v3.0):
  GoalManager mutations → MongoDB (dual-write, fire-and-forget)
  GoalManager mutations → CRDT + File (redundant, to be removed in v3.1)

Recovery:
  Startup → loadFromDatabase() (primary) → loadActivePlan() (fallback)
  Restore → in-memory TaskStore (live) → MongoDB (cold start fallback)
```

## Delivery Plan

| Version | What | Status |
|---------|------|--------|
| **v3.1** | Persistence cleanup — remove CRDT/File stores, scope updates by goalId, SQLite persistence | Planned |
| **v4.0** | Server-owned sessions — DB-primary restore, typed Socket.IO events, server-computed state | Planned |
| **v5.0** | Communication contracts — shared types, split SocketServerV2, flatten callbacks, Zustand middleware, ChatAgent routing | Planned |

See version-specific plans:
- [v3.1](v3.1/feature_implementation_planning.md) — 5 steps, removes 25+ redundant persistence calls
- [v4.0](v4.0/feature_implementation_planning.md) — 4 steps, server becomes single source of truth
- [v5.0](v5.0/feature_implementation_planning.md) — 5 steps, structural refactor (SocketServerV2 split, callback chain, Zustand middleware)

## Design Principles

1. **goalId is the universal scope** — every action, event, and persistence call carries goalId explicitly
2. **DB is the source of truth** — in-memory is a cache for live execution, DB survives restarts
3. **Server computes, frontend renders** — no state derivation on the client
4. **Workers report to ChatAgent, not Planner** — Channel A (stream) to frontend, Channel B (task updates) to ChatAgent
5. **Typed contracts** — shared types between packages, compile-time safety
