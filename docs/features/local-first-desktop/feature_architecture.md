# Local-First Desktop — Architecture

**Status:** In Progress  
**Created:** April 9, 2026  
**Owner:** @sahuroshan

---

## Problem Statement

The Ping platform currently requires MongoDB and a running backend server. For desktop distribution via Electron, we need everything to work **offline with local file storage** — no database server required. Users install the app, open it, and everything works.

## Architecture Decision

**Approach: Service Registry + Dual Adapters**

The backend already has a `ServiceRegistry` factory that selects between MongoDB and file-based (lowdb) services. The core work is:

1. **Wire the ServiceRegistry** into all API-layer code that currently bypasses it and uses Mongoose models directly
2. **Make the Electron shell** spawn the backend with `LOCAL_FIRST=true` and point it at user-local data
3. **Centralize frontend API URLs** so the renderer always hits the embedded backend

### What's Already Done

| Component | Status | Notes |
|-----------|--------|-------|
| `ServiceRegistry` + all 7 file services | ✅ Done | lowdb JSON files at `./data/*.json` |
| `config/index.ts` — `LOCAL_FIRST=true` bypass | ✅ Done | Ignores .env MONGODB_URI |
| `server.ts` — skip `connectDB()` in file mode | ✅ Done | Conditional on `config.mongodbUri` |
| `validateConfig()` — graceful degradation | ✅ Done | Warns instead of crashes |
| Desktop `main.ts` — spawns backend via `bun run` | ✅ Done | Sets `LOCAL_FIRST=true`, `DATA_DIR` |
| `preload.ts` — window controls exposed | ✅ Done | minimize/maximize/close via IPC |
| Frontend `API_BASE_URL` constant | ✅ Done | All services use `constants.ts` |
| Frontend `window.ping` type declaration | ✅ Done | Full TypeScript types |
| `@hocuspocus/provider` missing dep fix | ✅ Done | Added to collaboration package.json |

### What Needs Refactoring

The **5 critical files** that still use Mongoose models directly:

| # | File | Problem | Fix |
|---|------|---------|-----|
| 1 | `AgentManagerRegistry.ts` | Imports `TeamModel`, `AgentModel` — **startup blocker** | Inject `ServiceRegistry`, use contracts |
| 2 | `agentManagerHandlerV2.ts` | GET `/teams/:id/agents` still uses `AgentModel` directly | Use `services.agents` for remaining route |
| 3 | `HttpServer.ts` | `ChatMessageModel` + `GoalModel` queries for history | Thread `services.chat` + `services.goals` |
| 4 | `SocketServerV2.ts` | `ChatMessageModel.create()` to save user messages | Thread `services.chat.saveMessage()` |
| 5 | `AgentManagerAPI.ts` | `new TeamService()` (Mongoose-based) — unused but imports Mongoose | Remove or replace with ServiceRegistry |

### Non-blocking Lower Priority

| # | File | Problem | Fix |
|---|------|---------|-----|
| 6 | `skills/api/` routes | SkillRegistryService uses Mongoose directly | Thread `services.skills` + `services.agentSkills` |
| 7 | `skills/SkillRegistryService.ts` | 16+ Mongoose calls, embedding search | Complex — defer embeddings to Phase 2 |

---

## Dependency Graph

```
server.ts
 └─ AgentManagerAPI (constructor)
     ├─ new TeamService()          ← REMOVE (use ServiceRegistry)
     ├─ HttpServer
     │   ├─ createAgentManagerHandlerV2(services)  ← PASS registry
     │   ├─ ChatMessageModel.find()                ← REPLACE with services.chat
     │   ├─ GoalModel.find()                       ← REPLACE with services.goals
     │   └─ skillsRouter                           ← Phase 2
     ├─ SocketServerV2
     │   ├─ ChatMessageModel.create()              ← REPLACE with services.chat
     │   └─ agentManagerRegistry.getForTeam()      ← Registry needs services
     └─ agentManagerRegistry (singleton)
         ├─ TeamModel.findById()                   ← REPLACE with services.teams
         └─ AgentModel.find()                      ← REPLACE with services.agents
```

## Data Flow (Local-First)

```
User opens Ping Desktop
  → Electron main.ts spawns backend (bun run)
  → Backend starts with LOCAL_FIRST=true
  → config ignores MONGODB_URI
  → server.ts skips connectDB()
  → AgentManagerAPI creates ServiceRegistry(dataDir)
  → ServiceRegistry returns file-based services (lowdb)
  → All API layers receive services via DI
  → ServiceRegistry is threaded to:
     - HttpServer → routes
     - SocketServerV2 → chat persistence
     - AgentManagerRegistry → team loading
  → Data persisted as JSON files in user's data directory
```

## Key Constraints

- **No mongoose import at module top level** in API files — file mode must not trigger Mongoose initialization
- **Dynamic imports only** for Mongoose models (already done in handler for most routes)
- **ServiceRegistry is async** — must be awaited before constructing API objects
- **Skills embedding search** requires a different strategy for file mode (defer or use MiniSearch)
- **better-auth** needs its own storage adapter for file mode (or disable auth in desktop)

## Testing Strategy

1. Backend standalone: `LOCAL_FIRST=true bun run dist/server.js` — health, teams CRUD, chat
2. Electron launch: Desktop spawns backend, frontend loads, team creation works
3. Persistence: Create team, close app, reopen — team still present
