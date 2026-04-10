# Local-First Desktop — Implementation Plan

**Status:** In Progress  
**Created:** April 9, 2026  
**Architecture:** [feature_architecture.md](feature_architecture.md)

---

## Phase 1: Wire ServiceRegistry Into API Layer (Critical Path)

> **Goal:** Backend starts and serves full CRUD with file-based storage when `LOCAL_FIRST=true`.

### Step 1.1 — Make AgentManagerAPI async + inject ServiceRegistry

**Files:** `api/AgentManagerAPI.ts`, `server.ts`

- Change `AgentManagerAPI` constructor to accept `ServiceRegistry` (or create it internally)
- Move initialization to async `init()` method
- Call `createServiceRegistry(dataDir)` in `server.ts` before constructing API
- Pass registry to `HttpServer`, `SocketServerV2`, and `agentManagerRegistry`
- Remove `new TeamService()` (Mongoose-based)

**Changes:**
```
server.ts:
  const services = await createServiceRegistry(config.dataDir);
  const api = new AgentManagerAPI(PORT, services);
  await api.start();

AgentManagerAPI.ts:
  constructor(port, services: ServiceRegistry) {
    this.httpServer = new HttpServer({ agentManager, services });
    this.socketServerV2 = new SocketServerV2(this.server, services);
  }
```

### Step 1.2 — Inject ServiceRegistry into AgentManagerRegistry

**File:** `agentManager/AgentManagerRegistry.ts`

- Add `setServices(services: ServiceRegistry)` method on singleton
- In `loadTeam()`: if services available, use `services.teams.getTeam()` + `services.agents.getTeamAgents()` instead of `TeamModel.findById()` + `AgentModel.find()`
- Keep MongoDB path as fallback for backward compat
- Remove top-level `import { TeamModel }` / `import { AgentModel }` — use dynamic imports

**Changes:**
```
class AgentManagerRegistry {
  private services: ServiceRegistry | null = null;
  
  setServices(s: ServiceRegistry) { this.services = s; }
  
  private async loadTeam(teamId: string) {
    if (this.services) {
      const team = await this.services.teams.getTeam(teamId);
      const agents = await this.services.agents.getTeamAgents(teamId);
      // ... build manager
    } else {
      // Dynamic import for MongoDB fallback
      const { TeamModel } = await import("./team/schema/teamSchema.js");
      // ... existing MongoDB code
    }
  }
}
```

### Step 1.3 — Fix remaining GET agents route in handler

**File:** `api/agentManagerHandlerV2.ts`

- The GET `/teams/:id/agents` route (line ~278) still uses `AgentModel.find()` directly without the `if (services)` split
- Add the dual-path pattern matching other routes
- Remove stale top-level `import { AgentModel }` — not imported but was previously

### Step 1.4 — Thread services into HttpServer chat/goal routes  

**File:** `api/HttpServer.ts`

- Accept `ServiceRegistry` in `HttpServerOptions`
- GET `/api/v2/teams/:teamId/messages`: use `services.chat.getMessages()` in file mode
- GET `/api/v2/teams/:teamId/goals`: use `services.goals.getGoals()` in file mode
- GET `/api/v2/sessions/:teamId/restore`: same pattern
- Keep `ChatMessageModel` / `GoalModel` as dynamic imports for MongoDB mode

### Step 1.5 — Thread services into SocketServerV2

**File:** `api/SocketServerV2.ts`

- Accept `ServiceRegistry` in constructor
- Replace `ChatMessageModel.create()` with `services.chat.saveMessage()` in file mode
- Keep MongoDB fallback via dynamic import

---

## Phase 2: Skills API + Auth (Non-blocking)

> **Goal:** Skills browsing and assignment work in file mode. Auth is optional in desktop.

### Step 2.1 — Skills router uses ServiceRegistry

- Thread `services.skills` + `services.agentSkills` into skills API routes
- File mode: `FileSkillService` + `FileAgentSkillService` handle basic CRUD
- Skip embedding-based search in file mode (fall back to text search)

### Step 2.2 — Disable/bypass auth in desktop mode

- When `LOCAL_FIRST=true`, skip better-auth middleware
- Desktop is single-user — no login screen needed
- Frontend detects `window.ping?.isDesktop` and skips LoginPage

---

## Phase 3: Electron Production Build

> **Goal:** Distribute as installable `.exe` / `.dmg`.

### Step 3.1 — Bundle backend with desktop

- Include `packages/backend/dist/` in Electron package
- Include necessary `node_modules` for backend runtime
- Set `DATA_DIR` to `app.getPath('userData')/data`

### Step 3.2 — Frontend production build

- `vite build` frontend into `packages/desktop/frontend/`
- Desktop loads from `file://` in production mode

### Step 3.3 — Auto-updater + GitHub Releases

- Already configured in `forge.config.js`
- Publish via `electron-forge publish`

---

## Execution Order

| Priority | Step | Estimated Complexity | Depends On |
|----------|------|---------------------|------------|
| P0 | 1.1 AgentManagerAPI + ServiceRegistry DI | Medium | — |
| P0 | 1.2 AgentManagerRegistry file mode | Medium | 1.1 |
| P0 | 1.3 Fix GET agents route | Low | 1.1 |
| P0 | 1.4 HttpServer chat/goal routes | Medium | 1.1 |
| P0 | 1.5 SocketServerV2 chat persistence | Low | 1.1 |
| P1 | 2.1 Skills router ServiceRegistry | Medium | 1.1 |
| P1 | 2.2 Auth bypass in desktop | Low | — |
| P2 | 3.1 Bundle backend | High | All P0 |
| P2 | 3.2 Frontend prod build | Low | — |
| P2 | 3.3 Auto-updater | Low | 3.1 |
