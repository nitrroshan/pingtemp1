# Conversation Persistence v2.0 — Session Identity + Goal Lifecycle

> **Parent:** [feature_architecture.md](../feature_architecture.md)  
> **Status:** Mostly complete via [auth-security](../../auth-security/feature_implementation_planning.md). One remaining item.  
> **Fixes:** [BUG-001](../bugs/bug-001-addgoal-missing-sessionid.md) ✅, [BUG-002](../bugs/bug-002-auth-identity-not-threaded.md) ✅, [BUG-003](../bugs/bug-003-goal-status-never-updated.md) ❌ remaining

## What Was Done (via auth-security Phase 1)

Steps 1-5 of the original plan are now complete — implemented as part of the auth-security feature:

- [x] **Socket.IO auth middleware** — validates cookie, sets `socket.data.userId`
- [x] **HTTP auth middleware** — validates cookie, sets `req.userId`
- [x] **Frontend wiring** — `agentServiceV2.setUserId(session.user.id)`
- [x] **Fix addGoal** — BUG-001 fixed (userId field, correct status enum)
- [x] **Rename sessionId → userId** — 10 files, SQLite migration, Mongo fallback
- [x] **User messages use real userId** — `connection.userId` from auth

## What Remains

### Goal Lifecycle Status Updates (BUG-003)

When all tasks in a plan complete, nobody calls `goalService.updateGoal()`. Goals stay "executing" forever.

**Implementation:**

- [ ] **Step 1: Add `onGoalStatusChange` callback to `ManagerStreamCallbacks`**  
  File: `AgentManagerV2.ts`  
  Change: New callback `onGoalStatusChange?: (data: { teamId: string; status: string }) => void`  

- [ ] **Step 2: Emit goal status from OrchestratorService**  
  File: `OrchestratorService.ts`  
  Change: In `isAllComplete()` handler — when all tasks done, call `callbacks.onGoalStatusChange({ status: "completed" })`. When all failed, `{ status: "failed" }`.

- [ ] **Step 3: Wire in SocketServerV2**  
  File: `SocketServerV2.ts`  
  Change: `onGoalStatusChange` handler calls `services.goals.updateGoal()` — updates the goal record status.

**Effort:** ~20 lines across 3 files

### Assistant Message userId Threading

**Problem:** Worker and ChatAgent assistant messages are saved with `userId: "system"`. All data should belong to the team owner.

**Design:** User owns teams. All team data (messages, plans, goals) belongs to the owner. `TeamRegistryService.getOwner(teamId)` already stores the owner. Use it at assistant message save points — no Maps, no closures, no callback threading.

**Implementation:**

- [ ] **Step 1: Worker/planner assistant save**  
  File: `SocketServerV2.ts` (`ensureTeamCallbacks` → `onStream(finish)`)  
  Change: `userId: await this.services?.teamRegistry?.getOwner(teamId) ?? "system"`

- [ ] **Step 2: ChatAgent assistant save**  
  File: `SocketServerV2.ts` (`handleChatAgentMessage` → finish)  
  Change: `userId: await this.services?.teamRegistry?.getOwner(teamId) ?? "system"`

**Total: 2 lines in 1 file.**

**SOLID:**
- **SRP**: `agent-manager` stays identity-free. Ownership resolved at API layer.
- **DIP**: Depends on `ITeamRegistryService` abstraction, not sockets/connections.
- No new data structures. Team ownership table is the single source of truth.
      headers: new Headers({ cookie: cookieHeader }) 
    });
    if (!session?.user?.id) return next(new Error("Invalid session"));
    
    socket.data.userId = session.user.id;
    socket.data.userName = session.user.name;
    next();
  } catch {
    next(new Error("Auth failed"));
  }
});
```

**Effect:** Every connected socket has a verified `socket.data.userId`.

### Step 2: Use Verified userId in Socket Handlers (backend)

**Files:** `SocketServerV2.ts` (handleRegister, handleMessage)  
**Change:**
- `handleRegister`: Use `socket.data.userId` instead of client-provided `data.userId`
- `handleMessage`: Thread `connection.userId` into all `addMessage()` calls as `sessionId`
- `handleChatAgentMessage`: Same — use `connection.userId`

### Step 3: HTTP Auth Middleware (backend)

**Files:** `HttpServer.ts`  
**Change:** Add middleware for `/api/v2/*` routes:

```typescript
const authMiddleware = async (req, res, next) => {
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) return res.status(401).json({ error: "Unauthorized" });
    req.userId = session.user.id;
    next();
  } catch {
    res.status(401).json({ error: "Auth failed" });
  }
};

// Apply to v2 API routes
this.app.use("/api/v2", authMiddleware);
```

**Effect:** All HTTP API requests have `req.userId` available.

### Step 4: Frontend — Pass Auth User to AgentServiceV2

**Files:** `AgentServiceV2.ts`, `App.tsx`  
**Change:**
- `AgentServiceV2.setUserId(id: string)`: Sets `this.userId` from auth session
- `App.tsx`: After `useSession()` succeeds, call `agentServiceV2.setUserId(session.user.id)`
- `register` event still sends `userId` but server now ignores it (uses cookie)

### Step 5: Fix addGoal() — Proper Goal Saving (backend)

**Files:** `SocketServerV2.ts` (onPlanUpdate callback)  
**Change:** Fix 3 bugs in `addGoal()`:

```typescript
this.services!.goals.addGoal({
  teamId,
  sessionId: connection.userId,  // BUG-001: was missing
  goal: goalText,
  planId: planId || goalId || `plan-${Date.now()}`,
  status: "executing",           // BUG-002: was "active"
  // BUG-003: removed taskCount (not a Goal field)
});
```

### Step 6: Goal Lifecycle — Status Transitions (backend)

**Files:** `AgentManagerV2.ts` (ManagerStreamCallbacks), `SocketServerV2.ts`  
**Change:** Add `onGoalStatusChange` callback:

```typescript
// ManagerStreamCallbacks — new callback:
onGoalStatusChange?: (data: { goalId: string; status: string; teamId: string }) => void;
```

Wire in OrchestratorService:
- `isAllComplete()` (all tasks done) → `onGoalStatusChange({ status: "completed" })`
- All tasks failed → `onGoalStatusChange({ status: "failed" })`

SocketServerV2 handler:
```typescript
onGoalStatusChange: ({ goalId, status, teamId }) => {
  this.services?.goals.updateGoal(goalId, { status });
}
```

### Step 7: User-Scoped Session Restore

**Files:** `HttpServer.ts` (restore endpoint), `IChatService.ts`, `SqliteChatService.ts`  
**Change:** Restore endpoint filters by `req.userId`:

```typescript
// getSessionMessages now takes userId
getSessionMessages(teamId, { userId: req.userId, sessionLimit: 100, workerLimit: 50 })
```

Storage queries add `AND sessionId = ?` filter. User A doesn't see User B's conversations.

### Step 8: Test + Verify

- Login as User A → send goal → plan executes
- Open new browser → login as User A → see same plan + conversations
- Login as User B → see empty (own workspace)
- Plan completes → goal status updates to "completed"
- Backend restart → plan recovered from PlanStore → restore works

## Migration

- Existing messages have `sessionId: "default"` → assigned to first user who logs in (or left as shared)
- New messages get real user ID
- No schema changes needed — `sessionId TEXT NOT NULL` column already exists

## SOLID Analysis

| Principle | How Applied |
|---|---|
| **S** | Auth middleware has one job: extract and validate user identity. Services receive userId, don't do auth. |
| **O** | Adding auth middleware doesn't change existing handlers — just enriches the request context. |
| **L** | `IChatService` interface unchanged — `sessionId` parameter already exists, just gets real values. |
| **I** | Auth middleware is separate from message handlers. Goal lifecycle callback is separate from plan callbacks. |
| **D** | Handlers depend on `socket.data.userId` (set by middleware), not on auth library directly. |

## Files Changed (Summary)

| File | Change | Step |
|---|---|---|
| `SocketServerV2.ts` | Auth middleware, use `connection.userId` in handlers, fix `addGoal()`, add `onGoalStatusChange` handler | 1, 2, 5, 6 |
| `HttpServer.ts` | Auth middleware for `/api/v2/*`, user-scoped restore | 3, 7 |
| `AgentServiceV2.ts` | `setUserId()` method | 4 |
| `App.tsx` | Call `setUserId(session.user.id)` after auth | 4 |
| `AgentManagerV2.ts` | `onGoalStatusChange` in `ManagerStreamCallbacks` | 6 |
| `OrchestratorService.ts` | Emit goal status change on completion/failure | 6 |
| `IChatService.ts` | `getSessionMessages` accepts optional `userId` filter | 7 |
| `SqliteChatService.ts` | Add `sessionId` filter to `getSessionMessages` query | 7 |
| `MongoChatService.ts` | Same — add `sessionId` filter | 7 |

## Estimated Effort

| Step | Lines | Risk |
|---|---|---|
| 1. Socket auth middleware | ~15 | Medium — auth cookie parsing |
| 2. Use verified userId | ~10 | Low — string replacement |
| 3. HTTP auth middleware | ~15 | Medium — must not break health/auth routes |
| 4. Frontend userId wiring | ~5 | Low |
| 5. Fix addGoal | ~3 | Low |
| 6. Goal lifecycle | ~20 | Medium — new callback chain |
| 7. User-scoped restore | ~15 | Low — query filter |
| 8. Test | — | — |
| **Total** | **~83 lines** | |

## Rollback

- Socket auth middleware: remove `io.use()` → falls back to client-provided userId
- HTTP middleware: remove `app.use("/api/v2", ...)` → routes open again
- All changes are behind the existing `FF_ENABLE_CONVERSATION_PERSISTENCE` flag
