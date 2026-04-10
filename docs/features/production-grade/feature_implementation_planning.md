# Production-Grade Infrastructure — Implementation Plan

> Architecture: [feature_architecture.md](./feature_architecture.md)

## Branch
`feature/production-grade-infra`

## Scope
Six cross-cutting concerns in a single feature branch:
1. Production storage & deployment (Docker volumes, shutdown flush, StorageProvider)
2. Session persistence (auth via better-auth, chat history, goal history, session restore API)
3. Migrate backend logging from tslog to pino (single root + child loggers)
4. Add frontend logger wrapper (suppress debug/info in production)
5. Add typed feature flag system with dev/prod defaults + frontend API
6. File storage abstraction + workspace git remote push

---

## Phase 0: Production Infrastructure & Session Persistence

### Step 0.1: Production Docker Compose + volumes
- [ ] Rewrite `docker-compose.yml` with: collab container, backend container, frontend container
- [ ] Three named volumes: `ping-app-state`, `ping-collab`, `ping-workspaces`
- [ ] No MongoDB container in prod (MongoDB Atlas)
- [ ] Update `docker-compose.dev.yml` — MongoDB only (unchanged)
- [ ] Add `COLLAB_MODE` env var support: `embedded` (dev) / `external` (prod)

**Files to modify:**
- `docker-compose.yml` (full rewrite)
- `docker-compose.dev.yml` (verify/update)

**Files to create:**
- `packages/collaboration/Dockerfile` (standalone collab service)

### Step 0.2: MongoDB Atlas setup
- [ ] Create MongoDB Atlas free tier cluster (512MB)
- [ ] Update `.env.example` with Atlas connection string template
- [ ] Test: switch `MONGODB_URI` to Atlas → backend connects, all collections work
- [ ] Document Atlas setup in README or setup guide

**Files to modify:**
- `packages/backend/.env.example`

### Step 0.3: Graceful shutdown flush
- [ ] Add `flushAll()` method to `AgentManagerRegistry` — iterates cached managers, calls `FileTaskStore.flush()` on each
- [ ] Add `CollaborationService.flush()` call to shutdown sequence
- [ ] Call both in SIGTERM/SIGINT handlers in `server.ts` before `api.stop()`

**Files to modify:**
- `packages/backend/server.ts` (shutdown handlers)
- `packages/backend/agentManager/AgentManagerRegistry.ts` (add `flushAll()`)

### Step 0.4: Storage interfaces (AppState + Workspace + Collaboration)
- [ ] Create `AppStateStorage` interface + `FsAppStateStorage` implementation (wraps existing `fs` calls)
- [ ] Create `WorkspaceStorage` interface + `FsWorkspaceStorage` implementation (wraps existing `GitBranchManager`)
- [ ] Formalize `CollaborationService` interface (wraps existing `HocuspocusServer`)
- [ ] Add `COLLAB_MODE` to config — embedded Hocuspocus or external WebSocket client
- [ ] Add `gitRemoteUrl` + `gitRemoteToken` fields to Team MongoDB schema (for future git remote)

**Files to create:**
- `packages/backend/storage/AppStateStorage.ts` (interface + Fs impl)
- `packages/backend/storage/WorkspaceStorage.ts` (interface + Fs impl)
- `packages/backend/storage/index.ts` (factory + re-exports)

**Files to modify:**
- `packages/collaboration/src/L2/collaboration/HocuspocusServer.ts` (implement CollaborationService interface)
- `packages/backend/config/index.ts` (add `collabMode`, `collabUrl`, `storageType`)
- `packages/backend/config/default.ts` (defaults: `collabMode: 'embedded'`, `storageType: 'fs'`)
- `packages/backend/team/models.ts` (add `gitRemoteUrl`, `gitRemoteToken`)

### Step 0.5: Production auth with better-auth
- [ ] Install `better-auth` in backend and frontend packages
- [ ] Create `packages/backend/auth/index.ts` — configure betterAuth with MongoDB adapter, email/password
- [ ] Mount better-auth handler at `/api/auth/*` in HttpServer.ts
- [ ] Add `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` to `.env.example`
- [ ] Create `packages/frontend/lib/auth-client.ts` — React auth client with `useSession()`
- [ ] Build login/signup page component in frontend
- [ ] Update `SocketServerV2.ts` — validate session token on socket connect (middleware)
- [ ] Update `AgentServiceV2.ts` — pass auth session cookie with socket/HTTP requests
- [ ] Remove old `UserManager.ts` in-memory user tracking (replaced by better-auth)
- [ ] Run `npx @better-auth/cli migrate` to create auth tables in MongoDB

**Dependencies to add:**
- `better-auth` (backend + frontend)

**Files to create:**
- `packages/backend/auth/index.ts`
- `packages/frontend/lib/auth-client.ts`
- `packages/frontend/components/Auth/LoginPage.tsx`

**Files to modify:**
- `packages/backend/api/HttpServer.ts` (mount `/api/auth/*`)
- `packages/backend/api/SocketServerV2.ts` (session validation middleware)
- `packages/backend/.env.example` (add BETTER_AUTH_SECRET, BETTER_AUTH_URL)
- `packages/frontend/services/AgentServiceV2.ts` (credentials in requests)
- `packages/frontend/App.tsx` (auth guard — redirect to login if no session)

**Files to remove:**
- `packages/backend/api/UserManager.ts` (replaced by better-auth)

### Step 0.6: Server-side chat history
- [ ] Create `ChatMessage` Mongoose schema
- [ ] Save user messages on receive (in socket handler)
- [ ] Save assistant messages on stream completion
- [ ] Add `GET /api/v2/teams/:teamId/messages?limit=50&before=<timestamp>` endpoint
- [ ] Frontend: load from API on team select, use localStorage as fast cache

**Files to create:**
- `packages/backend/db/models/ChatMessage.ts`

**Files to modify:**
- `packages/backend/api/SocketServerV2.ts` (save messages)
- `packages/backend/api/HttpServer.ts` (add messages endpoint)
- `packages/frontend/hooks/useChat.ts` (load from API)
- `packages/frontend/services/AgentServiceV2.ts` (add getMessages)

### Step 0.7: Goal & execution history
- [ ] Create `Goal` Mongoose schema
- [ ] Create goal doc on goal submission, update status through lifecycle
- [ ] Add `GET /api/v2/teams/:teamId/goals` endpoint

**Files to create:**
- `packages/backend/db/models/Goal.ts`

**Files to modify:**
- `packages/backend/api/agentManagerHandlerV2.ts`
- `packages/backend/api/HttpServer.ts`

### Step 0.8: Session recovery API
- [ ] Add `GET /api/v2/sessions/:teamId/restore` endpoint
- [ ] Returns: `{ team, goals, messages, tasks, plan }`
- [ ] Frontend: call on team select → one API call restores full UI

**Files to modify:**
- `packages/backend/api/HttpServer.ts`
- `packages/frontend/services/AgentServiceV2.ts`
- `packages/frontend/App.tsx`

### Step 0.9: Extended health check
- [ ] Check: MongoDB connected, `data/` writable, collab service reachable, uptime

**Files to modify:**
- `packages/backend/api/HttpServer.ts`

---

## Phase 1: Backend Logging — Pino Migration

### Step 1.1: Create shared logging module
- [ ] Install `pino` in root workspace (shared dep)
- [ ] Install `pino-pretty` as dev dependency
- [ ] Create `packages/backend/logging/index.ts` — root logger + `AppLogger` type export
- [ ] Add `LOG_LEVEL` to `packages/backend/.env.example`
- [ ] Add `LOG_LEVEL` to `packages/backend/config/index.ts` (AppConfig + env override)

**Files to create:**
- `packages/backend/logging/index.ts`

**Files to modify:**
- Root `package.json` (add pino, pino-pretty)
- `packages/backend/.env.example`
- `packages/backend/config/index.ts`

### Step 1.2: Migrate packages/backend (24 files)
- [ ] Replace tslog → pino in each file, using `rootLogger.child({ module: "Name" })`
- [ ] Remove `import { Logger } from "tslog"` from each file

| # | File | Logger Name |
|---|------|-------------|
| 1 | `server.ts` | Server |
| 2 | `api/AgentManagerAPI.ts` | AgentManagerAPI |
| 3 | `api/HttpServer.ts` | HttpServer |
| 4 | `api/SocketServerV2.ts` | SocketServerV2 |
| 5 | `api/SocketConnectionManager.ts` | SocketConnectionManager |
| 6 | `api/UserManager.ts` | UserManager |
| 7 | `api/agentManagerHandlerV2.ts` | AgentManagerHandlerV2 |
| 8 | `agentManager/AgentManagerRegistry.ts` | AgentManagerRegistry |
| 9 | `db/config.ts` | worker/database |
| 10 | `team/database.ts` | teamService/database |
| 11 | `team/integration.test.ts` | integration-test |
| 12 | `skills/SkillResolver.ts` | SkillResolver |
| 13 | `skills/SkillIntegration.ts` | SkillIntegration |
| 14 | `skills/tools/SkillTools.ts` | SkillTools |
| 15 | `skills/api/skillsRouter.ts` | SkillsAPI |
| 16 | `skills/services/EmbeddingService.ts` | EmbeddingService |
| 17 | `skills/services/SkillRegistryService.ts` | SkillRegistryService |
| 18 | `skills/services/SkillFileReader.ts` | SkillFileReader |
| 19 | `skills/scripts/skills.test.ts` | skills:test |
| 20 | `skills/scripts/registry.test.ts` | registry:test |
| 21 | `skills/scripts/seedOfficialSkills.ts` | seed:skills |
| 22 | `scripts/seeds/index.ts` | seed |
| 23 | `scripts/seeds/reset.ts` | db:reset |
| 24 | `scripts/seeds/teams.seed.ts` | seed:teams |
| 25 | `scripts/seeds/agents.seed.ts` | seed:agents |

### Step 1.3: Migrate packages/agent-manager (10 files)
- [ ] Add pino dependency to `packages/agent-manager/package.json`
- [ ] Replace tslog → pino child loggers in each file
- [ ] Remove tslog dependency

| # | File | Logger Name |
|---|------|-------------|
| 1 | `src/AgentManagerV2.ts` | AgentManager |
| 2 | `src/agent/internal/AiSdkAgent.ts` | AiSdkAgent |
| 3 | `src/memory/MemoryManager.ts` | MemoryManager |
| 4 | `src/orchestrator/TaskStore.ts` | TaskStore |
| 5 | `src/persistence/FileTaskStore.ts` | FileTaskStore |
| 6 | `src/persistence/FilePlanStore.ts` | FilePlanStore |
| 7 | `src/plugin/PluginRegistry.ts` | PluginRegistry |
| 8 | `src/services/WorkerPool.ts` | WorkerPool |
| 9 | `src/util/RoleTaskQueue.ts` | RoleTaskQueue |

### Step 1.4: Migrate packages/workspace (11 files)
- [ ] Add pino dependency to `packages/workspace/package.json`
- [ ] Replace tslog → pino child loggers in each file
- [ ] Remove tslog dependency

| # | File | Logger Name |
|---|------|-------------|
| 1 | `src/L1/L1WorkspacePlugin.ts` | L1Plugin |
| 2 | `src/L1/workspace/WorkspaceManager.ts` | WorkspaceManager |
| 3 | `src/L1/workspace/AgentWorkspace.ts` | AgentWorkspace |
| 4 | `src/L1/workspace/Scratchpad.ts` | Scratchpad |
| 5 | `src/L1/workspace/GitBranchManager.ts` | GitBranchManager |
| 6 | `src/L1/workspace/search/WorkspaceSearchIndex.ts` | WorkspaceSearchIndex |
| 7 | `src/L1/workspace/codeintel/TreeSitterService.ts` | TreeSitterService |
| 8 | `src/L1/workspace/codeintel/SymbolIndex.ts` | SymbolIndex |
| 9 | `src/L1/workspace/codeintel/RepoMapBuilder.ts` | RepoMapBuilder |
| 10 | `src/L1/workspace/codeintel/persistence/IndexPersistence.ts` | IndexPersistence |
| 11 | `src/L1/workspace/__tests__/workspace-e2e.test.ts` | workspace-e2e |

### Step 1.5: Migrate packages/collaboration (7 files)
- [ ] Add pino dependency to `packages/collaboration/package.json`
- [ ] Replace tslog → pino child loggers
- [ ] Remove tslog dependency

| # | File | Logger Name |
|---|------|-------------|
| 1 | `src/L2/L2CollaborationPlugin.ts` | L2Plugin |
| 2 | `src/L2/collaboration/CollaborationSpace.ts` | CollaborationSpace |
| 3 | `src/L2/collaboration/RemoteCollabClient.ts` | RemoteCollabClient |
| 4 | `src/L2/collaboration/HocuspocusServer.ts` | CollabServer |
| 5 | `src/L2/collaboration/GroupChatManager.ts` | GroupChatManager |
| 6 | `src/L2/collaboration/PlanStore.ts` | PlanStore |
| 7 | `src/L2/codeintel/IndexPersistence.ts` | IndexPersistence |

### Step 1.6: Migrate packages/knowledge (2 files)
- [ ] Add pino dependency to `packages/knowledge/package.json`
- [ ] Replace tslog → pino child loggers
- [ ] Remove tslog dependency

| # | File | Logger Name |
|---|------|-------------|
| 1 | `src/L3/L3KnowledgePlugin.ts` | L3Plugin |
| 2 | `src/L3/knowledge/KnowledgeBase.ts` | KnowledgeBase |

### Step 1.7: Migrate packages/registry (4 files)
- [ ] Add pino dependency to `packages/registry/package.json`
- [ ] Replace tslog → pino child loggers
- [ ] Remove tslog dependency

| # | File | Logger Name |
|---|------|-------------|
| 1 | `index.ts` | agentRegistry/server |
| 2 | `util.ts` | agentRegistry/util |
| 3 | `db/db.ts` | agentRegistry/database |
| 4 | `db/vectorQuery.ts` | agentRegistry/vectorQuery |

### Step 1.8: Cleanup
- [ ] Remove `tslog` from all `package.json` files (6 packages)
- [ ] Run `bun install` to clean lockfile
- [ ] Run `bun run build:backend` — verify zero errors
- [ ] Verify dev output (pretty-printed) and production output (`NODE_ENV=production` → JSON)

---

## Phase 2: Frontend Logger Wrapper

### Step 2.1: Create frontend logger utility
- [ ] Create `packages/frontend/utils/logger.ts` with level-aware wrapper

**File to create:**
- `packages/frontend/utils/logger.ts`

### Step 2.2: Replace console calls in frontend (3 files, 18 call sites)
- [ ] `services/AgentServiceV2.ts` — 15 calls (10 log, 4 error, 1 warn)
- [ ] `hooks/useAgentTree.ts` — 2 calls (2 error)
- [ ] `components/ChatArea/ChatArea.tsx` — 1 call (1 error)

**Rules:**
- `console.log(...)` → `logger.info(...)`
- `console.error(...)` → `logger.error(...)`
- `console.warn(...)` → `logger.warn(...)`
- `console.debug(...)` → `logger.debug(...)`

### Step 2.3: Verify
- [ ] `bun run dev:frontend` — confirm logs appear in dev
- [ ] `bun run build` (production) — confirm info/debug logs suppressed, error/warn still show

---

## Phase 3: Feature Flags

### Step 3.1: Define FeatureFlags type and defaults
- [ ] Create `packages/backend/config/featureFlags.ts` — `FeatureFlags` interface, `FLAG_DEFAULTS`, `FRONTEND_FLAG_KEYS`
- [ ] Add dev defaults in `packages/backend/config/development.ts`
- [ ] Add prod defaults in `packages/backend/config/production.ts`

**File to create:**
- `packages/backend/config/featureFlags.ts`

**Files to modify:**
- `packages/backend/config/index.ts` — add `featureFlags: FeatureFlags` to `AppConfig`, wire `FF_*` env overrides
- `packages/backend/config/default.ts` — add `featureFlags` to default config
- `packages/backend/config/development.ts` — add dev overrides (all flags on)
- `packages/backend/config/production.ts` — add prod overrides (experimental off)

### Step 3.2: Migrate existing flags
- [ ] Replace `config.useOrchestrator` → `config.featureFlags.useOrchestrator` in all usage sites
- [ ] Replace `config.useApiV2` → `config.featureFlags.useApiV2` in all usage sites
- [ ] Replace any direct `process.env.PLANNER_MODE` reads → `config.featureFlags.plannerMode`
- [ ] Remove old `useOrchestrator` / `useApiV2` from top-level `AppConfig`
- [ ] Update `.env.example` — rename `USE_ORCHESTRATOR` → `FF_USE_ORCHESTRATOR`, `USE_API_V2` → `FF_USE_API_V2`

### Step 3.3: Add backend feature flags API endpoint
- [ ] Add `GET /api/v2/feature-flags` in `packages/backend/api/HttpServer.ts`
- [ ] Endpoint reads `getConfig().featureFlags`, filters to `FRONTEND_FLAG_KEYS`, returns JSON

### Step 3.4: Add frontend feature flags hook
- [ ] Create `packages/frontend/hooks/useFeatureFlags.ts` — fetches from `/api/v2/feature-flags` on mount, returns typed flags
- [ ] Create `packages/frontend/types/featureFlags.ts` or add `FrontendFeatureFlags` type to `types.ts`

**Files to create:**
- `packages/frontend/hooks/useFeatureFlags.ts`

**Files to modify:**
- `packages/frontend/types.ts`

### Step 3.5: Add FF_* env vars to .env.example
- [ ] Document all `FF_*` env vars with descriptions in `.env.example`

### Step 3.6: Verify
- [ ] Backend: `getConfig().featureFlags` has correct dev defaults
- [ ] Backend: `NODE_ENV=production` → prod defaults applied
- [ ] Backend: `FF_ENABLE_COST_TRACKING=true` env var overrides config
- [ ] Frontend: `useFeatureFlags()` hook returns flags from API
- [ ] Build succeeds: `bun run build:backend`

---

## Phase 4: File Storage Abstraction & Git Remote Push

### Step 4.1: Create StorageProvider interface + FsStorageProvider
- [ ] Define `StorageProvider` interface: `read(path)`, `write(path, data)`, `delete(path)`, `list(prefix)`
- [ ] Implement `FsStorageProvider` — wraps existing `fs` reads/writes to `data/` directory
- [ ] Add `STORAGE_TYPE` to config system (`fs` | `azure` | `s3`), default `fs`
- [ ] Create `getStorageProvider()` factory that returns provider based on config
- [ ] Add `STORAGE_TYPE` to `.env.example`

**Files to create:**
- `packages/backend/storage/StorageProvider.ts` (interface)
- `packages/backend/storage/FsStorageProvider.ts`
- `packages/backend/storage/index.ts` (factory + re-exports)

**Files to modify:**
- `packages/backend/config/index.ts` (add `storageType` to AppConfig)
- `packages/backend/config/default.ts` (default: `fs`)
- `packages/backend/.env.example` (add `STORAGE_TYPE`)

### Step 4.2: Wire StorageProvider into existing file-based stores
- [ ] Update `FileTaskStore` to use `StorageProvider` instead of direct `fs` calls
- [ ] Update `FilePlanStore` / `PlanStore` to use `StorageProvider`
- [ ] Update `HocuspocusServer` database extension to use `StorageProvider` for `.bin` files
- [ ] Verify all `data/` reads/writes go through `StorageProvider`

**Files to modify:**
- `packages/agent-manager/src/persistence/FileTaskStore.ts`
- `packages/agent-manager/src/persistence/FilePlanStore.ts`
- `packages/collaboration/src/L2/collaboration/PlanStore.ts`
- `packages/collaboration/src/L2/collaboration/HocuspocusServer.ts`

### Step 4.3: Azure Blob StorageProvider (prod cloud storage)
- [ ] Implement `AzureBlobStorageProvider` using `@azure/storage-blob`
- [ ] Read/write to Azure Blob container
- [ ] Configure via `AZURE_STORAGE_CONNECTION_STRING` + `AZURE_STORAGE_CONTAINER` env vars
- [ ] Test: `STORAGE_TYPE=azure` → all file operations go to Azure Blob

**Dependencies to add:**
- `@azure/storage-blob`

**Files to create:**
- `packages/backend/storage/AzureBlobStorageProvider.ts`

**Files to modify:**
- `packages/backend/storage/index.ts` (register azure provider)
- `packages/backend/.env.example` (add Azure Blob env vars)

### Step 4.4: Workspace git remote push (user-initiated)
- [ ] Add `addRemote(name, url)` and `push(remote, branch)` methods to `GitBranchManager`
- [ ] Add `gitRemoteUrl` and `gitRemoteToken` fields to Team MongoDB schema
- [ ] Add `POST /api/v2/workspaces/:teamId/push` endpoint
  - Validates session (better-auth)
  - Reads remote config from Team document
  - Calls `GitBranchManager.addRemote()` + `push()`
- [ ] Frontend: Add "Push to GitHub" button in workspace/output panel

**Files to modify:**
- `packages/workspace/src/L1/workspace/GitBranchManager.ts` (add `addRemote`, `push`)
- `packages/backend/team/models.ts` (add `gitRemoteUrl`, `gitRemoteToken` to Team schema)
- `packages/backend/api/HttpServer.ts` (add push endpoint)

**Files to create:**
- `packages/frontend/components/WorkspacePush/PushToGitHub.tsx` (button + configure modal)

### Step 4.5: S3 StorageProvider (optional — if AWS needed)
- [ ] Implement `S3StorageProvider` using `@aws-sdk/client-s3`
- [ ] Configure via `AWS_S3_BUCKET`, `AWS_REGION` env vars
- [ ] Same interface as Azure — swap by changing `STORAGE_TYPE=s3`

**Dependencies to add (optional):**
- `@aws-sdk/client-s3`

**Files to create:**
- `packages/backend/storage/S3StorageProvider.ts`

### Step 4.6: Verify storage abstraction
- [ ] Dev: `STORAGE_TYPE=fs` → everything works as before (local `data/`)
- [ ] Prod: `STORAGE_TYPE=azure` → tasks, plans, CRDT, workspaces all in Azure Blob
- [ ] Push to GitHub: configure team → click button → verify branch appears on GitHub
- [ ] Build succeeds: `bun run build:backend`

---

## Testing Strategy

| What | How |
|------|-----|
| Logger output format | Manual: dev → pretty, `NODE_ENV=production` → JSON |
| Log level filtering | Set `LOG_LEVEL=warn` → verify info/debug suppressed |
| Frontend log suppression | Build prod bundle → inspect console in browser |
| Feature flags dev/prod | Start with `NODE_ENV=development` vs `production`, compare `getConfig().featureFlags` |
| Feature flags env override | Set `FF_ENABLE_COST_TRACKING=true`, verify override |
| Frontend flags API | `GET /api/v2/feature-flags` returns only frontend-safe flags |
| Session restore | Reconnect → `GET /api/v2/sessions/:teamId/restore` → full UI state |
| Chat persistence | Send message → verify in MongoDB → refresh page → messages reload from API |
| Goal history | Submit goal → complete → `GET /api/v2/teams/:teamId/goals` shows history |
| User identity | Close browser → reopen → same userId, same data |
| Auth flow | Sign up → sign in → sign out → sign in again → session persists |
| StorageProvider fs | `STORAGE_TYPE=fs` → create/read/delete file in `data/` |
| StorageProvider azure | `STORAGE_TYPE=azure` → create/read/delete blob in Azure container |
| Git push | Configure team remote → click push → branch appears on GitHub |
| Build & types | `bun run build:backend` + `bun run typecheck` — zero errors |

## Rollback Plan
- Revert feature branch — all changes are additive and behind config
- If pino causes issues: revert to tslog (git revert the migration commits)
- Feature flags default to current behavior — no functional change on deploy
- Session collections are new — no existing data affected
- StorageProvider defaults to `fs` — zero change to existing behavior unless `STORAGE_TYPE` is set

## Execution Order & Dependencies

```
Phase 0 (Infra + Sessions) ──→ Phase 4 (StorageProvider) ──→ Phase 1 (Logging)
     │                              │                             │
     │  Do first —                  │  After Phase 0 —            │  Independent
     │  fixes data loss +           │  abstracts file storage     │
     │  enables B2B sessions        │  before pino touches        │
     │                              │  same files                 │
     │                              │                             │
     └──────────────────────────────┴─────────────────────────────┘
                                                                  │
                              Phase 2 (Frontend Logger) ──────────┘
                                        │                    
                              Phase 3 (Feature Flags) ──── Independent
```

**Recommended order:**
1. **Phase 0** — Auth, chat, goals, Docker volume, shutdown flush (foundation)
2. **Phase 4** — StorageProvider + git push (makes file storage cloud-ready)
3. **Phase 1** — Pino migration (can be done in parallel with Phase 4)
4. **Phase 2** — Frontend logger (quick, independent)
5. **Phase 3** — Feature flags (independent)

## Total File Count

| Phase | Files to Create | Files to Modify | Files to Remove | Deps to Change |
|-------|-----------------|-----------------|-----------------|----------------|
| Phase 0 | 9 (Collab Dockerfile, storage interfaces x3, auth x3, ChatMessage, Goal) | ~15 (server, socket, HTTP, handlers, config, Team model, AgentServiceV2, App, useChat, .env.example, docker-compose x2, HocuspocusServer) | 1 (UserManager.ts) | +better-auth |
| Phase 1 | 1 | 58 + 6 package.json | 0 | +pino, +pino-pretty, -tslog |
| Phase 2 | 1 | 3 | 0 | None |
| Phase 3 | 2 | 5 + .env.example | 0 | None |
| Phase 4 | 3 (AzureBlobProvider, S3Provider, PushToGitHub component) | ~8 (storage index, FileTaskStore, FilePlanStore, PlanStore, GitBranchManager, HttpServer, .env.example) | 0 | +@azure/storage-blob, +@aws-sdk/client-s3 (optional) |
| **Total** | **16** | **~96** | **1** | **5-6 dep changes** |
