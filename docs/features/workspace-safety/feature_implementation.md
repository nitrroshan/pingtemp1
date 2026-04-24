# Workspace Safety & Parallel Execution — Implementation Tracker

> **Planning:** [feature_implementation_planning.md](./feature_implementation_planning.md)  
> **Architecture:** [feature_architecture.md](./feature_architecture.md)

---

## Phase 1 — Merge-Gate + Identity Fix

| Step | Description | Status | Files |
|------|-------------|--------|-------|
| 1 | Fail task on merge failure (Bug A) | ⬜ Not started | `OrchestratorService.ts` |
| 2 | Fix writeIdentityFile (Bug C) | ⬜ Not started | `WorkspacePlugin.ts` |
| 3 | Type-safe writeIdentityFile caller | ⬜ Not started | `WorkerPool.ts` |
| 4 | Verify Phase 1 | ⬜ Not started | — |

## Phase 2 — Per-Task Clone Directories

| Step | Description | Status | Files |
|------|-------------|--------|-------|
| 5 | Restructure workspace directory layout | ⬜ Not started | `WorkspaceManager.ts` |
| 6 | Clone team repo per task | ⬜ Not started | `WorkspaceManager.ts` |
| 7 | Push-and-merge completion flow | ⬜ Not started | `AgentWorkspace.ts`, `WorkspaceManager.ts` |
| 8 | Verify Phase 2 | ⬜ Not started | — |

## Phase 3 — GoalId Scoping (Parallel Plans)

| Step | Description | Status | Files |
|------|-------------|--------|-------|
| 9 | Add goalId to Task + TaskStore scoping | ⬜ Not started | `TaskStore.ts`, `Task.types.ts` |
| 10 | GoalContext abstraction | ⬜ Not started | `OrchestratorService.ts` |
| 11 | Frontend goal switcher | ⬜ Not started | Frontend components |
| 12 | Verify Phase 3 | ⬜ Not started | — |
