# F5: Rooms, Auth, ACL (Multi-Tenant) — Architecture

**Date:** May 2, 2026  
**Status:** Architected  
**Priority:** P2 — Required for cloud deployment  
**Depends on:** Feature 1 (rooms exist)  
**Feature List:** [CRDT-FEATURE-LIST.md](../CRDT-FEATURE-LIST.md) → Feature 5  
**Research:** [crdt-team-memory/research.md](../crdt-team-memory/research.md) (Liveblocks section)

---

## Problem

No authentication on Hocuspocus. Any WebSocket connection accesses any doc. Single-user only. Can't deploy to cloud.

## Goal

JWT-based auth for humans, agent tokens for agents. Per-room permissions (Liveblocks pattern). Multi-tenant isolation via org prefix.

## Architecture

### Identity

```typescript
// Human user
identifyUser({ userId, organizationId }) → JWT token

// Agent
identifyAgent({ agentId, teamId, role }) → agent token
```

### Permission Model (Liveblocks three-level)

| Room | defaultAccesses | Agent (self) | Agent (other) | Human (frontend) |
|------|----------------|-------------|---------------|-----------------|
| `team-memory` | `room:read` | `room:write` | `room:write` | `room:read` |
| `agent:{role}` | `[]` (private) | `room:write` | `room:read` | `room:read` |
| `goal:{goalId}` | `room:write` | `room:write` | `room:write` | `room:write` |
| `_system` | `[]` (private) | `room:read` | `room:read` | `[]` (denied) |

### Multi-Tenant

`orgId = {userId}/{teamId}` — fully isolates each user's team data. Different users can have teams with the same name without collision.

### Hocuspocus Hook

```typescript
onAuthenticate: async ({ token, documentName }) => {
  const identity = verifyToken(token);
  const roomId = extractRoomId(documentName);
  const access = resolveAccess(room, identity);
  if (access === "deny") throw new Error("Access denied");
  return { user: identity };
}
```

## Implementation Location

```
packages/collab-service/src/
  auth/
    TokenService.ts             — JWT creation + verification
    RoomManager.ts              — room ACL resolution
  server/HocuspocusServer.ts    — onAuthenticate hook with ACL
```

## Effort

~300 lines
