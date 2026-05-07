# Task 002: CRDT Access Control — Restrict Hocuspocus to Team Owner/Members

**Status:** `not-started`
**Assignee:**
**Branch:** `feature/team-ownership-v1.0`

## Description

Hocuspocus (CRDT server) is exposed on port 1234 as a raw WebSocket server with **zero access control**. Any external client that can reach the port can read and write any CRDT document. This is a security hole — agent team docs must only be accessible to the team owner (or org members for org-owned teams).

## Problem

**The port is open to the network.** `HocuspocusServer.start(port)` binds an HTTP server on port 1234. The `onAuthenticate` hook accepts any token:

```typescript
// packages/collab-service/src/server/HocuspocusServer.ts L365-366
async onAuthenticate({ token }: { token: string }) {
  return { user: token || "anonymous" };
}
```

**Attack:** Anyone who can reach `ws://server:1234` can do:
```javascript
new HocuspocusProvider({ url: "ws://server:1234", name: "team-abc/goal-123/plan" });
// → Full read/write access to the plan document
```

This is not just a frontend issue — it's a **network-level vulnerability**. Backend agents happen to use in-process `openDirectConnection` (which bypasses WebSocket entirely), but that doesn't help. The WebSocket port is still open.

**Three connection paths and their auth status:**

| Connection path | How it connects | Auth? | Risk |
|---|---|---|---|
| Backend agents (planner, workers) | In-process `openDirectConnection` — no WebSocket | N/A (trusted, same process) | ✅ None |
| Frontend editor (user browser) | WebSocket to port 1234 | ❌ No validation | 🔴 Any authenticated user can access any team's docs |
| External attacker | WebSocket to port 1234 | ❌ No validation | 🔴 Anyone who can reach the port can read/write all docs |

## Fix Options

### Option A: Auth in `onAuthenticate` hook (keep separate port) — Simplest

Keep Hocuspocus on port 1234 but add real auth to the `onAuthenticate` hook.

**`onAuthenticate` already receives everything we need:**
```typescript
interface onAuthenticatePayload {
  token: string;           // ← client sends session cookie/token here
  documentName: string;    // ← "{teamId}/{goalId}/plan" — team encoded in path
  requestHeaders: IncomingHttpHeaders;  // ← cookie header from browser
  request: IncomingMessage;
}
```

**Implementation:**
```typescript
// packages/collab-service/src/server/HocuspocusServer.ts
async onAuthenticate({ token, documentName, requestHeaders }: onAuthenticatePayload) {
  // 1. Extract teamId from doc name
  const teamId = documentName.split("/")[0];
  if (!teamId) throw new Error("Invalid document name");

  // 2. Validate session via better-auth (same pattern as SocketServerV2.ts L118)
  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: new Headers({
      cookie: requestHeaders.cookie || "",
      authorization: token ? `Bearer ${token}` : "",
    }),
  });
  if (!session?.user?.id) throw new Error("Authentication required");

  // 3. Check team ownership
  const canAccess = await teamRegistry.canAccess(session.user.id, teamId);
  if (!canAccess) throw new Error("Not authorized for this team");

  return { user: session.user.id };
}
```

**Frontend change:** `HocuspocusProvider` in the browser already sends cookies automatically if the Hocuspocus server is same-origin or CORS-configured. The `requestHeaders.cookie` field will contain the better-auth session cookie. No explicit token passing needed if same-origin.

If cross-origin: frontend passes the session token explicitly via the `token` prop on `HocuspocusProvider`.

**Pros:** Minimal change. One hook update. Browser cookies work automatically.
**Cons:** Port 1234 is still exposed. Needs CORS config if frontend and collab are on different origins.

### Option B: Route through Express (eliminate separate port) — Most Secure

Stop Hocuspocus from listening on its own port. Instead, handle WebSocket upgrades on the Express HTTP server (port 3002), behind the existing auth middleware.

**How it works:**
```typescript
// packages/backend/api/AgentManagerAPI.ts
this.server = createServer(this.httpServer.getApp());

// Intercept WebSocket upgrades on /collab path
this.server.on("upgrade", (request, socket, head) => {
  if (request.url?.startsWith("/collab")) {
    // Auth check: validate cookie from request headers
    validateSession(request.headers).then(session => {
      if (!session?.user?.id) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      // Hand off to Hocuspocus
      hocuspocus.handleConnection(websocket, request, { user: session.user.id });
    });
  }
  // Socket.IO handles its own upgrades on /socket.io/v2
});
```

**Frontend change:** `HocuspocusProvider` URL changes from `ws://localhost:1234` to `ws://localhost:3002/collab`.

**Pros:** No extra port. Auth reuses Express middleware. Single entry point.
**Cons:** More wiring. Socket.IO and Hocuspocus share the HTTP server — need careful upgrade routing. Need to coordinate with `collab-service` package.

### Option C: Hybrid — Auth hook + don't expose port externally

Use Option A for the auth logic, but **don't expose port 1234 to the internet** in production. Only bind to localhost or use network-level firewall rules.

In production (Railway/Docker):
- Port 3002 (Express + Socket.IO) → exposed publicly
- Port 1234 (Hocuspocus) → internal only, not in `EXPOSE` or port mapping
- Frontend connects to Hocuspocus through a reverse proxy path on port 3002 (nginx/caddy routes `/collab` → `localhost:1234`)

**Pros:** Quick to implement. No code changes to Express server.
**Cons:** Relies on infrastructure config, not code enforcement. Still need auth hook for the reverse-proxied connections.

## Recommendation

**Option A for now, Option B later.**

Option A is a 1-file change (`HocuspocusServer.ts`) that closes the security hole immediately. The pattern is identical to what `SocketServerV2.ts` already does — call `auth.api.getSession()` with the cookie header.

Option B is the right long-term architecture (single port, no CORS issues), but it requires wiring changes across `AgentManagerAPI`, `collab-service`, and frontend — better done as part of Phase 5 (process isolation) when the deployment architecture is refactored anyway.

## Dependencies for Option A

`HocuspocusServer` lives in `packages/collab-service/` which currently has no dependency on `packages/backend/auth/` or `packages/backend/services/postgres/`. To validate sessions and check team access, we need to either:

1. **Pass auth + teamRegistry as constructor args** to `CollabServer` / `HocuspocusServer` (from `AgentManagerRegistry` which already has both)
2. **Or make `HocuspocusServer` import `getAuth()` directly** (adds a cross-package dependency)

**Recommended: Option 1** — pass as callbacks:
```typescript
// CollabServer constructor
new CollabServer(storageDir, repoPath, blobStorage, {
  validateSession: (headers) => auth.api.getSession({ headers }),
  canAccessTeam: (userId, teamId) => teamRegistry.canAccess(userId, teamId),
});
```

This keeps `collab-service` decoupled from `backend` — it receives auth behavior via injection, not import.

## Files to Modify

- `packages/collab-service/src/server/HocuspocusServer.ts` — `onAuthenticate` hook + accept auth callbacks
- `packages/backend/agentManager/AgentManagerRegistry.ts` — pass auth callbacks when creating `CollaborationPlugin`
- `packages/collaboration/src/L2/L2CollaborationPlugin.ts` — forward auth callbacks to `CollabServer`
- `packages/frontend/components/CollaborativeEditor.tsx` — pass session token if cross-origin
- `packages/frontend/hooks/useDiscussion.ts` — same

## Acceptance Criteria

- [ ] `onAuthenticate` validates the session cookie/token via better-auth
- [ ] `teamId` is parsed from `documentName` and checked via `canAccess(userId, teamId)`
- [ ] Unauthorized WebSocket connections are rejected with error (not silently allowed)
- [ ] In-process `openDirectConnection` continues to work without auth (no cookie needed)
- [ ] Frontend can still connect when authenticated (cookies forwarded automatically or token passed)
- [ ] No cross-package import from `collab-service` → `backend` (auth injected via callbacks)

## Testing

- Manual: Open `ws://localhost:1234` with no cookie → connection rejected
- Manual: Open `ws://localhost:1234` with valid cookie but wrong team → connection rejected
- Manual: Open `ws://localhost:1234` with valid cookie and own team → connection accepted
- Manual: Verify agents still read/write CRDT docs (in-process, no WebSocket)
- Manual: Verify frontend CollaborativeEditor still works

## Notes

- `requestHeaders.cookie` is automatically sent by browser WebSocket connections to same-origin servers
- `onAuthenticate` is called per-document — a user connecting to 5 docs gets 5 auth checks (one per doc name)
- `openDirectConnection` (used by backend agents) does NOT go through `onAuthenticate` — it's in-process and already trusted
- The `onAuthenticate` hook throwing an error causes Hocuspocus to close the WebSocket with an error frame
