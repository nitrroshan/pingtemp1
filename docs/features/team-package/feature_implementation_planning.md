# Team Package Extraction — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 3 (Teams & Packages)  
**ID:** B1

---

## Branch
- `feature/team-package`

## Scope
Extract `@ping/agent-manager` (core orchestration engine) and `@ping/teams` (team management) as separate packages. Backend becomes a thin API layer.

## Implementation Steps

### Step 1: Create @ping/agent-manager Package
**Files to create:**
- `packages/agent-manager/package.json` — `@ping/agent-manager`, deps: `ai`, `@ai-sdk/azure`, `zod`
- `packages/agent-manager/tsconfig.json`
- `packages/agent-manager/src/index.ts` — Barrel exports

**Files to move/refactor (from packages/backend):**
- `orchestrator/OrchestratorService.ts` → `packages/agent-manager/src/AgentManager.ts`
- `orchestrator/TaskStore.ts` → `packages/agent-manager/src/TaskStore.ts`
- `orchestrator/DependencyResolver.ts` → `packages/agent-manager/src/DependencyResolver.ts`
- `services/WorkerPool.ts` → `packages/agent-manager/src/WorkerPool.ts`

**Exit criteria:** `@ping/agent-manager` builds independently, exports `AgentManager`, `TaskStore`, `DependencyResolver`, `WorkerPool`

### Step 2: Create @ping/teams Package
**Files to create:**
- `packages/teams/package.json` — `@ping/teams`, deps: `@ping/agent-manager`, `mongoose`
- `packages/teams/tsconfig.json`
- `packages/teams/src/index.ts`

**Files to move/refactor (from packages/backend):**
- `team/TeamService.ts` → `packages/teams/src/TeamManager.ts`
- `team/models.ts` → `packages/teams/src/models.ts`
- `team/types.ts` → `packages/teams/src/types/index.ts`

**Exit criteria:** `@ping/teams` builds independently, exports `TeamManager`, `TeamConfig`

### Step 3: Update Backend to Consume @ping/teams Only
**Tag: REFACTOR**

Frontend only uses teams. Backend API exposes team operations — never exposes `AgentManager` directly.

**Files to modify:**
- `packages/backend/package.json` — Add `@ping/teams` as workspace dep (which transitively depends on `@ping/agent-manager`)
- `packages/backend/server.ts` — Import from `@ping/teams` instead of local paths
- `packages/backend/api/HttpServer.ts` — Use `TeamManager` from `@ping/teams`. All endpoints are team-scoped: `/api/teams/:id/goals`, `/api/teams/:id/tasks`, etc.
- `packages/backend/api/SocketServerV2.ts` — Subscribe to team events (`team.on('stream', ...)`). Frontend connects to a team, not to an AgentManager.

**Key constraint:** Backend does NOT import `@ping/agent-manager` directly. It only uses `@ping/teams`, which internally creates `AgentManager` instances per team. This ensures the frontend's only entry point is always through a team.

**Exit criteria:** Backend is a thin API layer over `@ping/teams`. All routes are team-scoped. No direct `AgentManager` usage in API layer.

### Step 4: Update Bun Workspace Config
**Files to modify:**
- Root `package.json` — Add `packages/agent-manager` and `packages/teams` to workspaces
- Root `tsconfig.json` — Add project references

**Exit criteria:** `bun install` resolves workspace deps, `bun run build` builds all packages

### Step 5: Update CLI to Import @ping/agent-manager Directly
**Tag: REFACTOR**

CLI directly calls `@ping/agent-manager` for session creation — no HTTP, no teams needed for single-agent tasks.

**Files to modify:**
- `packages/backend/cli/app.ts` — Import `AgentManager` from `@ping/agent-manager` for direct session creation. Import `TeamManager` from `@ping/teams` for team-based workflows.

**Two CLI modes:**
1. **Session mode** (default): `ping "build a login page"` → creates `AgentManager` directly → session starts. No team, no HTTP.
2. **Team mode**: `ping --team marketing "build a campaign"` → loads team via `TeamManager` → team's internal `AgentManager` handles it.

**Exit criteria:** `ping "goal"` works without running the HTTP server. `ping --team <id> "goal"` works with teams. Both modes work with no backend server running.

### Step 6: Verify Package Boundaries
- Ensure `@ping/agent-manager` has NO dependency on `@ping/teams`
- Ensure `@ping/teams` depends on `@ping/agent-manager` (not vice versa)
- Backend depends on both
- No circular dependencies

**Exit criteria:** Dependency graph is clean, packages publishable independently

## Testing Strategy
- Build each package in isolation
- Integration test: backend starts and routes through packages correctly
- CLI test: runs commands using direct package imports
- Verify no circular deps with `depcheck` or manual review

## Complexity
Medium — 2-3 weeks. Mostly restructuring with careful dependency management.
