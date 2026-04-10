# Local-First Desktop — Implementation Tracking

**Status:** In Progress  
**Created:** April 9, 2026  
**Planning:** [feature_implementation_planning.md](feature_implementation_planning.md)  
**Architecture:** [feature_architecture.md](feature_architecture.md)

---

## Phase 0: Foundation (DONE)

- [x] `ServiceRegistry` + all 7 file services (lowdb) — pre-existing
- [x] `config/index.ts` — `LOCAL_FIRST=true` env var bypass
- [x] `server.ts` — conditional `connectDB()` skip
- [x] `validateConfig()` — graceful degradation (warn, don't crash)
- [x] Desktop `main.ts` — spawn backend via `bun run`, pass `LOCAL_FIRST=true`
- [x] Desktop `preload.ts` — window controls (minimize/maximize/close)
- [x] Frontend `API_BASE_URL` centralized constant
- [x] Frontend `window.ping` TypeScript declarations
- [x] `@hocuspocus/provider` added to collaboration package.json
- [x] Backend starts successfully in file mode (`LOCAL_FIRST=true bun run dist/server.js`)
- [x] Health endpoint responds: `{"status":"ok"}`

## Phase 1: Wire ServiceRegistry Into API Layer

> **Approach (SOLID-compliant):** Created Mongo adapter classes (`services/mongo/`) that wrap existing Mongoose models behind the same `IService` interfaces used by file services. All route-layer code now calls `services.teams.getTeam()` etc. with **zero branching on storage mode**. Adding a third backend (SQLite, Turso) means only adding one new adapter — no route changes.

- [x] **Step 1.1** — `AgentManagerAPI` accepts `ServiceRegistry`; `server.ts` creates it via `createServiceRegistry(dataDir)`
- [x] **Step 1.2** — `AgentManagerRegistry.loadTeam()` uses `services.teams` + `services.agents` (no Mongoose imports)
- [x] **Step 1.3** — GET `/teams/:id/agents` uses `services.agents.getTeamAgents()` (single code path)
- [x] **Step 1.4** — HttpServer chat/goal/restore routes use `services.chat` + `services.goals`
- [x] **Step 1.5** — SocketServerV2 uses `services.chat.addMessage()` for user message persistence

### Mongo Adapter Classes Created
- `services/mongo/MongoTeamService.ts` — wraps `TeamConfig` Mongoose model
- `services/mongo/MongoAgentService.ts` — wraps `Agent` Mongoose model
- `services/mongo/MongoChatService.ts` — wraps `ChatMessage` Mongoose model
- `services/mongo/MongoGoalService.ts` — wraps `Goal` Mongoose model
- `services/mongo/MongoSkillService.ts` — wraps `Skill` Mongoose model
- `services/mongo/MongoAgentSkillService.ts` — wraps `AgentSkill` Mongoose model
- `services/mongo/MongoMemberService.ts` — wraps `TeamMember` Mongoose model

### Key Design Decisions
- All Mongo adapters use **lazy dynamic imports** for Mongoose models (`await import()`) to avoid loading Mongoose when in file mode
- `ServiceRegistry` factory reads `config.mongodbUri` (frozen config) rather than raw `process.env`
- `createAgentManagerHandlerV2(services)` now requires `ServiceRegistry` — not optional
- Route handlers eliminated ~200 lines of duplicated if/else branching

## Phase 2: Skills + Auth

- [ ] **Step 2.1** — Skills router uses ServiceRegistry
- [ ] **Step 2.2** — Auth bypass in desktop mode

## Phase 3: Electron Production Build

- [ ] **Step 3.1** — Bundle backend with desktop
- [ ] **Step 3.2** — Frontend production build
- [ ] **Step 3.3** — Auto-updater + GitHub Releases
