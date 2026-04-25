# Auth Security Hardening — Implementation Planning

> **Parent:** [feature_architecture.md](./feature_architecture.md)  
> **Status:** ✅ Phase 1 Complete  
> **Branch:** `user/nitrroshan/fixplans`  
> **Depends on:** better-auth ✅ (already working for login/session)  
> **Blocks:** conversation-persistence v2.0 (needs real userId) ✅ unblocked

## Scope: Phase 1 — Identity Enforcement

Phase 1 closes all 4 CRITICAL and 5 HIGH vulnerabilities. ~80 lines.

## Implementation Steps

- [x] **Step 1: HTTP Auth Middleware**  
  File: `packages/backend/api/HttpServer.ts`  
  Change: `requireAuth` middleware using `auth.api.getSession({ headers: fromNodeHeaders(req.headers) })`. Applied to `/api/v2/*`. Public routes excluded. Sets `req.userId`.

- [x] **Step 2: Socket.IO Auth Middleware**  
  File: `packages/backend/api/SocketServerV2.ts`  
  Change: `io.use()` middleware validates auth cookie from `socket.handshake.headers`. Sets `socket.data.userId`. Rejects unauthenticated connections. `handleRegister` uses `socket.data.userId`.

- [x] **Step 3: Fix CORS**  
  Files: `HttpServer.ts`, `SocketServerV2.ts`  
  Change: Replaced `origin: true` with `ALLOWED_ORIGINS` from env. Both Express and Socket.IO.

- [x] **Step 4: Secure Git Push**  
  File: `HttpServer.ts`  
  Change: SSRF protection — blocks private IPs (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, metadata.google). Only allows HTTPS/SSH protocols. Auth protected by middleware.

- [x] **Step 5: Fix Fail-Open Socket Auth**  
  File: `SocketServerV2.ts`  
  Change: Auth middleware uses `next(new Error(...))` to reject. No fall-through. `handleRegister` uses server-verified `socket.data.userId`.

- [x] **Step 6: Fix Desktop Auth Bypass**  
  File: `packages/frontend/App.tsx`  
  Change: Desktop mode now uses `session.user.id` if auth is available, else machine-stable `desktop-${hostname}`. No longer skips auth entirely.

- [x] **Step 7: Wire Frontend Auth Identity**  
  Files: `AgentServiceV2.ts`, `App.tsx`  
  Change: `setUserId(session.user.id)` called after auth. Socket register sends userId but server ignores it (uses cookie).

- [x] **Step 8: Rename sessionId → userId**  
  Files: 10 files across types, SQLite (with migration), MongoDB (with fallback), SocketServerV2.  
  Change: All user-identity fields renamed from `sessionId` to `userId`. Socket protocol `sessionId` kept (different concept).

- [ ] **Step 8: Build + Test**  
  Verify:
  - Unauthenticated `curl` to `/api/v2/teams` → 401
  - Socket connect without cookie → rejected
  - Cross-origin request from evil.com → blocked
  - Login → connect → send message → works with real userId
  - Git push with internal URL → rejected

## Testing

- Unit: Auth middleware returns 401 for missing/invalid session
- Integration: Full flow — login → socket connect → send message → API call → all use same userId
- Security: `curl` without cookies → 401 on all protected routes
- Security: Forge socket connection with fake userId → rejected (server uses cookie)

## Rollback

- Remove `requireAuth` middleware → routes open again
- Remove `io.use()` → sockets accept any connection
- Revert CORS → `origin: true`
- All reversible in under 1 minute

## Phase 2: Authorization + Socket Rate Limiting

### Context

Teams are **plugin-based read-only projections** — no database table, no `ownerId`. `PluginTeamService` loads teams from `packages/registry/plugins/`. A new `TeamOwnershipService` is needed to track who created each team.

Socket messages have **zero rate limiting** — each `message` event triggers an immediate LLM call with no throttle. An attacker can spam messages and burn API credits.

### Implementation Steps

- [ ] **Step 2.1: `ITeamRegistryService` interface + SQLite/Mongo implementations**  
  Files: NEW `services/contracts/ITeamRegistryService.ts`, NEW `services/sqlite/SqliteTeamRegistryService.ts`, NEW `services/mongo/MongoTeamRegistryService.ts`  
  Type: `TeamRegistration { teamId, ownerId, pluginName, createdAt }`  
  Methods: `register(teamId, ownerId, pluginName)`, `getOwner(teamId)`, `canAccess(userId, teamId)`, `getTeamsForUser(userId)`  
  SQLite table: `team_registry (team_id TEXT PK, owner_id TEXT, plugin_name TEXT, created_at TEXT)`  
  Lines: ~60

- [ ] **Step 2.2: Wire into ServiceRegistry**  
  File: `services/ServiceRegistry.ts`  
  Change: Add `teamRegistry: ITeamRegistryService` to ServiceRegistry. Initialize alongside chat/goals.  
  Lines: ~5

- [ ] **Step 2.3: Store ownership on team creation**  
  File: `api/agentManagerHandlerV2.ts`  
  Change: `POST /teams` → after loading plugin, call `services.teamRegistry.register(teamId, req.userId, pluginName)`.  
  Lines: ~3

- [ ] **Step 2.4: Filter teams by user**  
  File: `api/agentManagerHandlerV2.ts`  
  Change: `GET /teams` → use `services.teamRegistry.getTeamsForUser(req.userId)` to filter. Return only teams the user owns.  
  Lines: ~5

- [ ] **Step 2.5: Check ownership on delete**  
  File: `api/agentManagerHandlerV2.ts`  
  Change: `DELETE /teams/:id` → check `canAccess(req.userId, teamId)` before allowing.  
  Lines: ~5

- [ ] **Step 2.6: Socket team room authorization**  
  File: `api/SocketServerV2.ts`  
  Change: `joinTeamRoom()` checks `canAccess` via `ITeamRegistryService` before `socket.join()`. Pass `services` to SocketServerV2 constructor (already has it).  
  Lines: ~10

- [ ] **Step 2.7: Socket message rate limiting**  
  File: `api/SocketServerV2.ts`  
  Change: In-memory sliding window rate limiter per userId. `Map<userId, { count: number, windowStart: number }>`. Max 10 messages per 10 seconds. Applied in `handleMessage()` before LLM call. Also limit `action` events (approve-plan triggers execution). Reject with error event when throttled.  
  Lines: ~25

- [ ] **Step 2.8: Build + Test**  
  Verify:
  - Create team → ownership record stored with userId
  - `GET /teams` → only user's teams returned
  - Socket `message` with wrong teamId → rejected
  - Spam 20 messages in 5 seconds → throttled after 10
  - Different user can't access first user's team

### Estimated Effort

| Step | Lines | Risk |
|---|---|---|
| 2.1 | ~60 | Low — simple CRUD service |
| 2.2 | ~5 | Low |
| 2.3-2.5 | ~13 | Low — one-liner checks |
| 2.6 | ~10 | Medium — async check in hot path |
| 2.7 | ~25 | Medium — rate limiter correctness |
| **Total** | **~118** | |

### Rollback

- Remove ownership checks → all users see all teams again
- Remove socket rate limiter → unthrottled messages again
- `team_ownership` table can be dropped with no side effects
