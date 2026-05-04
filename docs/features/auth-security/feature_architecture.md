# Auth Security Hardening — Feature Architecture

**Status:** Planning  
**Date:** April 25, 2026  
**Priority:** CRITICAL — must ship before any production deployment  
**Related:** [conversation-persistence v2.0](../conversation-persistence/v2.0/feature_implementation_planning.md), [browser-auth](../browser-auth/feature_architecture.md)

---

## Problem Statement

The platform has a working auth system (better-auth with email/password, sessions in SQLite/MongoDB) but **zero enforcement** after login. An attacker with network access can:

1. Read all team data without authentication (API routes unprotected)
2. Impersonate any user via socket (accepts client-chosen userId)
3. Push code to arbitrary git remotes (git push endpoint unauthenticated)
4. Delete any team or collaboration document
5. Execute cross-site attacks (CORS allows all origins with credentials)

## Security Audit Summary

| # | Severity | Vulnerability | OWASP Category |
|---|---|---|---|
| C1 | **CRITICAL** | All HTTP API routes unauthenticated | A01:2021 — Broken Access Control |
| C2 | **CRITICAL** | Socket accepts any userId, no mandatory auth | A07:2021 — Identification/Auth Failures |
| C3 | **CRITICAL** | CORS `origin: true` + `credentials: true` | A05:2021 — Security Misconfiguration |
| C4 | **CRITICAL** | Git push endpoint — no auth, arbitrary URLs (SSRF) | A01 + A10:2021 — SSRF |
| H1 | HIGH | No team membership/ownership checks | A01:2021 — Broken Access Control |
| H2 | HIGH | No CSRF protection | A01:2021 — Broken Access Control |
| H3 | HIGH | Socket auth validation fail-open | A07:2021 — Auth Failures |
| H4 | HIGH | Desktop mode flag bypasses frontend auth | A07:2021 — Auth Failures |
| H5 | HIGH | Frontend doesn't use authenticated userId for sockets | A07:2021 — Auth Failures |
| M1 | MEDIUM | No rate limiting on any endpoint | A04:2021 — Insecure Design |
| M2 | MEDIUM | No input validation/sanitization | A03:2021 — Injection |
| M3 | MEDIUM | No security headers (Helmet, CSP, HSTS) | A05:2021 — Security Misconfiguration |
| M4 | MEDIUM | Session secret deterministic in dev | A02:2021 — Crypto Failures |
| L1 | LOW | Error messages expose internal details | A04:2021 — Insecure Design |
| L2 | LOW | No audit logging | A09:2021 — Logging Failures |
| L3 | LOW | Swagger UI exposed without auth | A01:2021 — Broken Access Control |

---

## Architecture: Three Security Layers

```
LAYER 1 — IDENTITY (Who are you?)
  Socket.IO middleware: validate auth cookie → socket.data.userId
  HTTP middleware: validate auth cookie → req.userId
  better-auth does the heavy lifting — we just call auth.api.getSession()

LAYER 2 — AUTHORIZATION (What can you access?)
  Team membership check: user.id ∈ team.members
  Socket room join: only if member
  API route filter: only return data for user's teams

LAYER 3 — HARDENING (Defense in depth)
  CORS: allowlist specific origins
  Rate limiting: per-IP + per-user
  Input validation: Zod schemas on all payloads
  Security headers: Helmet
  Error sanitization: no stack traces in production
  CSRF: better-auth handles via SameSite cookies
  Audit logging: security events
```

---

## Implementation Plan — 3 Phases

### Phase 1: Identity Enforcement (blocks all CRITICAL + HIGH)

**Goal:** Every API call and socket connection has a verified user identity. No anonymous access.

#### Step 1.1: HTTP Auth Middleware

**Files:** `HttpServer.ts`  
**Pattern:** better-auth's recommended Express middleware using `fromNodeHeaders`:

```typescript
import { fromNodeHeaders } from "better-auth/node";

const requireAuth = async (req, res, next) => {
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session?.user?.id) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.userId = session.user.id;
    req.userEmail = session.user.email;
    next();
  } catch {
    res.status(401).json({ error: "Authentication required" });
  }
};

// Apply to all v2 API routes (NOT to /health, /api/auth/*, /api-docs)
this.app.use("/api/v2", requireAuth);
```

**Public routes (no auth):** `/health`, `/api/v2/health`, `/api/auth/*`, `/api-docs`

#### Step 1.2: Socket.IO Auth Middleware

**Files:** `SocketServerV2.ts`  
**Pattern:** `io.use()` middleware — validates cookie from handshake headers:

```typescript
import { fromNodeHeaders } from "better-auth/node";

io.use(async (socket, next) => {
  try {
    const auth = await getAuth();
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(socket.handshake.headers),
    });
    if (!session?.user?.id) return next(new Error("Unauthorized"));
    
    socket.data.userId = session.user.id;
    socket.data.userEmail = session.user.email;
    next();
  } catch {
    next(new Error("Authentication required"));
  }
});
```

**Effect:** Unauthenticated clients can't connect at all. `handleRegister` uses `socket.data.userId` (server-verified) instead of client-provided userId.

#### Step 1.3: Fix CORS — Allowlist Origins

**Files:** `HttpServer.ts`, `SocketServerV2.ts`  
**Change:** Replace `origin: true` with explicit allowlist:

```typescript
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  process.env.BETTER_AUTH_URL || "http://localhost:3002",
];

// Express
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));

// Socket.IO
cors: { origin: ALLOWED_ORIGINS, credentials: true }
```

#### Step 1.4: Secure Git Push Endpoint

**Files:** `HttpServer.ts`  
**Changes:**
- Auth required (via middleware from 1.1)
- Validate `remoteUrl` against allowlist or team config
- Reject internal URLs (block `169.254.*`, `10.*`, `127.*`, `localhost`)
- Log the push action with userId

#### Step 1.5: Fix Fail-Open Socket Auth

**Files:** `SocketServerV2.ts` (handleRegister)  
**Change:** Remove the `catch` block that falls through. If auth fails, disconnect:

```typescript
// BEFORE (fail-open):
} catch { logger.warn("Auth failed, using provided userId"); }

// AFTER (fail-closed):
} catch { socket.disconnect(true); return; }
```

#### Step 1.6: Remove Desktop Mode Auth Bypass

**Files:** `App.tsx`  
**Change:** Desktop mode should still require auth. Remove the `isDesktop` bypass or gate it behind a proper server-side token.

---

### Phase 2: Authorization (team-scoped access)

**Goal:** Users can only access their own teams' data.

#### Step 2.1: Team Membership Model

**Files:** New `TeamMember` type + schema  
**Design:** When a team is created, the creating user becomes the owner. For now, single-user teams (owner = only member).

```typescript
// Team membership check
async function isTeamMember(userId: string, teamId: string): Promise<boolean> {
  // V1: creator is the only member (stored in team record)
  // V2: explicit members list when we add collaboration
  const team = await teamService.getTeam(teamId);
  return team?.ownerId === userId;
}
```

#### Step 2.2: Thread Team Ownership into API Routes

**Files:** `HttpServer.ts`, `agentManagerHandlerV2.ts`  
**Change:** All team routes check membership:

```typescript
// GET /api/v2/teams — only user's teams
const teams = await services.teams.getTeamsForUser(req.userId);

// GET /api/v2/teams/:teamId/messages — verify membership first
if (!await isTeamMember(req.userId, teamId)) return res.status(403);
```

#### Step 2.3: Socket Room Authorization

**Files:** `SocketServerV2.ts`  
**Change:** `joinTeamRoom()` checks membership before `socket.join()`:

```typescript
private async joinTeamRoom(socket, teamId) {
  if (!await isTeamMember(socket.data.userId, teamId)) {
    socket.emit("error", { error: "Not a member of this team" });
    return;
  }
  socket.join(`team:${teamId}`);
}
```

---

### Phase 3: Hardening (defense in depth)

#### Step 3.1: Security Headers (Helmet)

**Files:** `HttpServer.ts`  
**Change:** `npm install helmet` + `app.use(helmet())`

#### Step 3.2: Rate Limiting

**Files:** `HttpServer.ts`, `SocketServerV2.ts`  
**Change:** `express-rate-limit` for HTTP. Custom throttle for socket messages.

```typescript
import rateLimit from "express-rate-limit";

app.use("/api/v2", rateLimit({
  windowMs: 60 * 1000,    // 1 minute
  max: 100,               // 100 requests per minute per IP
  standardHeaders: true,
}));
```

Socket throttle: max 10 messages per 10 seconds per user.

#### Step 3.3: Input Validation

**Files:** `SocketServerV2.ts`, `agentManagerHandlerV2.ts`  
**Change:** Zod schemas for all payloads:

```typescript
const MessageSchema = z.object({
  teamId: z.string().uuid(),
  agentId: z.string().min(1).max(100),
  content: z.string().min(1).max(50000),
  taskId: z.string().optional(),
  sessionId: z.string().optional(),
});
```

#### Step 3.4: Error Sanitization

**Files:** All API handlers  
**Change:** In production, return generic error messages:

```typescript
catch (err) {
  const isDev = process.env.NODE_ENV !== "production";
  res.status(500).json({ error: isDev ? err.message : "Internal server error" });
}
```

#### Step 3.5: Audit Logging

**Files:** New `audit.ts` service  
**Events:** Login, team creation/deletion, plan approval, git push, message send

#### Step 3.6: Swagger Protection

**Files:** `HttpServer.ts`  
**Change:** Only mount `/api-docs` in development:

```typescript
if (process.env.NODE_ENV !== "production") {
  this.app.use("/api-docs", swaggerUi.serve, ...);
}
```

#### Step 3.7: Enforce Session Secret in Production

**Files:** `auth/index.ts`  
**Change:** Throw in production if `BETTER_AUTH_SECRET` is not set (currently just warns).

---

## CORS + CSRF: Why better-auth Handles CSRF

better-auth uses `SameSite=Lax` cookies by default. Combined with:
- Strict CORS origin allowlist (Phase 1.3)
- Cookie-based sessions (not bearer tokens)
- `SameSite=Lax` prevents cross-site POST with cookies

No separate CSRF token is needed IF CORS is correctly restrictive. The current `origin: true` defeats this — fixing CORS (Phase 1.3) restores CSRF protection.

---

## Files Changed (Summary)

| Phase | File | Change |
|---|---|---|
| 1.1 | `HttpServer.ts` | Auth middleware for `/api/v2/*` |
| 1.2 | `SocketServerV2.ts` | Socket.IO `io.use()` auth middleware |
| 1.3 | `HttpServer.ts`, `SocketServerV2.ts` | CORS origin allowlist |
| 1.4 | `HttpServer.ts` | Git push URL validation + SSRF protection |
| 1.5 | `SocketServerV2.ts` | Remove fail-open catch block |
| 1.6 | `App.tsx` | Remove desktop auth bypass |
| 2.1 | New `TeamMember` type | Team ownership model |
| 2.2 | `HttpServer.ts`, handler | Team membership checks on routes |
| 2.3 | `SocketServerV2.ts` | Socket room auth |
| 3.1 | `HttpServer.ts` | Helmet security headers |
| 3.2 | `HttpServer.ts`, `SocketServerV2.ts` | Rate limiting |
| 3.3 | `SocketServerV2.ts`, handler | Zod input validation |
| 3.4 | All handlers | Error sanitization |
| 3.5 | New `audit.ts` | Audit logging |
| 3.6 | `HttpServer.ts` | Swagger dev-only |
| 3.7 | `auth/index.ts` | Enforce secret in production |

## Estimated Effort

| Phase | Scope | Lines | Priority |
|---|---|---|---|
| **Phase 1** | Identity enforcement | ~80 | **MUST** before production |
| **Phase 2** | Authorization (team-scoped) | ~60 | **MUST** before multi-user |
| **Phase 3** | Hardening | ~100 | **SHOULD** before production |

## Dependencies

- Phase 1 unblocks [conversation-persistence v2.0](../conversation-persistence/v2.0/feature_implementation_planning.md) (provides real userId for sessionId) ✅
- Phase 2 requires a team membership model (simple: owner = creator)
- Phase 3 has no blockers — can be done incrementally
- Goal lifecycle (BUG-003): planned in [conv-persistence v2.0](../conversation-persistence/v2.0/feature_implementation_planning.md) — ~20 lines, 3 files

## Additional Notes (from audit)

- **M4: SqliteGoalService.updateGoal** uses dynamic `fields.join(", ")` — currently safe (hardcoded field names only) but should be validated if user input is ever added. Covered by Step 3.3 (input validation).
- **Assistant message userId**: Workers/planner assistant messages saved with `userId: "system"` — correct for now. Full per-user threading requires tracking which user submitted the goal through the worker dispatch chain. Deferred.
