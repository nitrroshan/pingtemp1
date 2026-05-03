# v5.1 — HttpServer Route Extraction

## Branch
`feature/v5.1-httpserver-routes`

## Scope
Split `HttpServer.ts` (812 lines) into focused Express Router modules. HttpServer becomes a ~200-line orchestrator that mounts middleware + routers. Each router is independently testable. No behavioral changes — pure structural refactor.

## Prerequisites
- [x] v5.0 SocketServerV2 split (completed — validates the pattern)
- [x] `agentManagerHandlerV2.ts` already extracted (328 lines — teams/roles/skills CRUD)

## Context
HttpServer.ts has a single 650-line `setupRoutes()` method mixing 7 unrelated domains (GitHub, collab, workspace, sessions, chat, goals, chat-agent). The SocketServerV2 split (v5.0 Step 2) proved the pattern: extract domain-specific handlers into separate files, keep the orchestrator thin.

Unlike SocketServerV2, HttpServer routes are stateless request handlers with no shared mutable state — making this a lower-risk refactor. The main benefit is discoverability and preventing further growth.

## Steps

- [x] **Step 1: Create `routes/sessionRoutes.ts`** (234 lines)
  - Extract `GET /api/v2/sessions/:teamId/restore` (legacy restore)
  - Extract `GET /api/v2/goals/:goalId/session` (v4.0 goal session)
  - Factory: `createSessionRoutes(services: ServiceRegistry): Router`

- [x] **Step 2: Create `routes/chatRoutes.ts`** (91 lines)
  - Extract `GET /api/v2/teams/:teamId/messages`
  - Extract `GET /api/v2/teams/:teamId/agents/:agentId/messages`
  - Extract `GET /api/v2/teams/:teamId/goals`
  - Extract `GET /api/v2/teams/:teamId/roles/:role/tasks` (chat-agent snapshot)
  - Factory: `createChatRoutes(services: ServiceRegistry): Router`

- [x] **Step 3: Create `routes/githubRoutes.ts`** (77 lines)
  - Extract `GET /api/v2/github/repos`
  - Extract `GET /api/v2/github/repos/:owner/:repo/branches`
  - Extract `GET /api/v2/github/user`
  - GitHubService instantiation + token resolver moved into this file
  - Factory: `createGithubRoutes(services: ServiceRegistry): Router`

- [x] **Step 4: Create `routes/collabRoutes.ts`** (77 lines)
  - Extract `GET /api/collab/:teamId/docs`
  - Extract `DELETE /api/collab/:teamId/docs/:docName`
  - Factory: `createCollabRoutes(): Router`

- [x] **Step 5: Create `routes/workspaceRoutes.ts`** (86 lines)
  - Extract `POST /api/v2/workspaces/:teamId/push`
  - SSRF protection kept inline (route-specific)
  - Factory: `createWorkspaceRoutes(services: ServiceRegistry): Router`

- [x] **Step 6: Slim down HttpServer.ts** (260 lines)
  - Keeps: constructor, `setupMiddleware()`, health checks, auth mount, swagger, feature flags, `mountRegistryRoutes()`, `listen()`, `close()`
  - Mounts extracted routers via `this.app.use("/api/v2", createXxxRoutes(services))`

- [x] **Step 7: Build + verify**
  - `bun run build:backend` — clean
  - `bun run --filter @ping/agent-manager typecheck` — clean
  - Frontend vite build — clean
  - Zero compile errors in HttpServer.ts

## Shared Utility
- `safeError()` moves to `packages/backend/api/routes/shared.ts` (used by all routers)
- Each router imports `rootLogger` and creates its own child logger

## Testing
- Build verification (all 3 build targets)
- Existing API contracts unchanged — same paths, same request/response shapes
- No new dependencies

## Rollback
- Revert to pre-split HttpServer.ts (single file, no router imports)
- Zero risk — pure structural refactor with no behavioral changes

## Complexity
- Low risk, medium effort (~30 min implementation)
- Pattern proven by v5.0 SocketServerV2 split
