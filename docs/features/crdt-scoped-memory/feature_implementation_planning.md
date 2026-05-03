# F1: Agent-Scoped Memory — Implementation Plan

**Architecture:** [feature_architecture.md](feature_architecture.md)  
**Feature List:** [CRDT-FEATURE-LIST.md](../CRDT-FEATURE-LIST.md) → Feature 1  
**Principle:** Each step must pass `bun run build:backend` + existing tests with ZERO breakage.

---

## Current State (Audited)

### How Agents Connect Today

```
1. Agent connects to Hocuspocus with token: "anonymous"
2. Opens any doc by name — no identity, no access control
3. All docs under {teamId}/{goalId}/ — flat, shared, no personal space
4. CollaborationSpace applies prefix — but that's just string convention
```

### Integration Point: Where Agents Get Their Tools

```
CollaborationPlugin (backend)
  → CollabMcpServer.getTools(context: { role, taskId, consumer })
    → l2.getOrCreateSpace(goalId) → CollaborationSpace
    → createCollabTool(space, role, ...) → "collab" tool
```

**Key insight:** `getTools()` already receives `context.role` — we know WHO the agent is. We just never used it for identity.

---

## Step 1: IdentityRegistry — Agents become users

**Package:** `packages/collab-service/src/rooms/IdentityRegistry.ts`

Agents register with the CRDT system and get a real identity. No JWT yet — identity is a typed object stored in-memory on the server.

```typescript
export interface AgentIdentity {
  id: string;           // "agent:coder"
  teamId: string;       // "team-1"
  role: string;         // "coder"
  type: "agent";
  registeredAt: string; // ISO timestamp
}

export class IdentityRegistry {
  private agents = new Map<string, AgentIdentity>();

  /** Register an agent — called when team initializes */
  register(teamId: string, role: string): AgentIdentity {
    const id = `agent:${role.toLowerCase()}`;
    const identity: AgentIdentity = {
      id,
      teamId,
      role: role.toLowerCase(),
      type: "agent",
      registeredAt: new Date().toISOString(),
    };
    this.agents.set(`${teamId}/${id}`, identity);
    return identity;
  }

  /** Look up an agent by token (used in onAuthenticate) */
  resolve(teamId: string, token: string): AgentIdentity | null {
    // Token format: "agent:role" or just "role"
    const normalized = token.startsWith("agent:") ? token : `agent:${token.toLowerCase()}`;
    return this.agents.get(`${teamId}/${normalized}`) || null;
  }

  /** List all registered agents for a team */
  listAgents(teamId: string): AgentIdentity[] {
    return Array.from(this.agents.values()).filter(a => a.teamId === teamId);
  }
}
```

**Exit criteria:** Agents can register and be looked up by token.

---

## Step 2: RoomManager — Rooms are first-class entities

**Package:** `packages/collab-service/src/rooms/RoomManager.ts`

Rooms are created, tracked, and managed. Each room has a type, an owner (for personal rooms), and access rules.

```typescript
export type RoomType = "personal" | "team" | "goal" | "system";
export type AccessLevel = "write" | "read" | "deny";

export interface Room {
  id: string;           // "team-1/agent:coder" or "team-1/team-memory"
  teamId: string;
  type: RoomType;
  owner?: string;       // agent ID for personal rooms
  createdAt: string;
  metadata?: Record<string, any>;
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  /** Create a room */
  createRoom(teamId: string, name: string, type: RoomType, owner?: string): Room {
    const id = `${teamId}/${name}`;
    if (this.rooms.has(id)) return this.rooms.get(id)!;
    
    const room: Room = {
      id, teamId, type, owner,
      createdAt: new Date().toISOString(),
    };
    this.rooms.set(id, room);
    return room;
  }

  /** Get room for a document name (matches by prefix) */
  getRoomForDoc(docName: string): Room | null {
    // Exact match first
    if (this.rooms.has(docName)) return this.rooms.get(docName)!;
    // Prefix match — "team-1/agent:coder/scratchpad" → room "team-1/agent:coder"
    for (const [roomId, room] of this.rooms) {
      if (docName.startsWith(roomId + "/")) return room;
    }
    return null;
  }

  /** List rooms with optional filter */
  listRooms(filter?: { teamId?: string; type?: RoomType }): Room[] {
    let rooms = Array.from(this.rooms.values());
    if (filter?.teamId) rooms = rooms.filter(r => r.teamId === filter.teamId);
    if (filter?.type) rooms = rooms.filter(r => r.type === filter.type);
    return rooms;
  }

  /** Archive a room — persist to cold storage, remove from active registry */
  archiveRoom(roomId: string): Room | null {
    const room = this.rooms.get(roomId);
    if (room) this.rooms.delete(roomId);
    return room || null;
  }
}
```

**Exit criteria:** Rooms can be created, looked up by doc name, listed, and archived.

---

## Step 3: AccessControl — Liveblocks three-level permission model

**Package:** `packages/collab-service/src/rooms/AccessControl.ts`

Permissions are stored on the room itself (room = source of truth). Three levels resolve in priority order: `usersAccesses` → `groupsAccesses` → `defaultAccesses`.

```typescript
import type { AgentIdentity } from "./IdentityRegistry.js";
import type { Room, RoomManager } from "./RoomManager.js";

export type Permission = "room:write" | "room:read";
export type AccessList = Permission[] | null;  // null = remove override

export interface RoomPermissions {
  defaultAccesses: Permission[];                           // fallback for everyone
  groupsAccesses: Record<string, Permission[] | null>;     // per-group overrides
  usersAccesses: Record<string, Permission[] | null>;      // per-user overrides (highest priority)
}

export class AccessControl {
  constructor(private roomManager: RoomManager) {}

  /**
   * Resolve access for an identity on a document.
   * Follows Liveblocks resolution: usersAccesses → groupsAccesses → defaultAccesses
   */
  resolveAccess(identity: AgentIdentity | null, docName: string): Permission[] {
    const room = this.roomManager.getRoomForDoc(docName);

    // No room registered → legacy goal-scoped doc → full access (backward compat)
    if (!room) return ["room:write"];

    // No identity (anonymous/frontend) → use defaultAccesses only
    if (!identity) return room.permissions.defaultAccesses;

    // 1. Check usersAccesses (highest priority)
    const userPerms = room.permissions.usersAccesses[identity.id];
    if (userPerms !== undefined && userPerms !== null) return userPerms;

    // 2. Check groupsAccesses (check all groups agent belongs to, use highest)
    if (identity.groupIds) {
      let bestGroupPerms: Permission[] | null = null;
      for (const groupId of identity.groupIds) {
        const groupPerms = room.permissions.groupsAccesses[groupId];
        if (groupPerms !== undefined && groupPerms !== null) {
          if (!bestGroupPerms || groupPerms.includes("room:write")) {
            bestGroupPerms = groupPerms;
          }
        }
      }
      if (bestGroupPerms) return bestGroupPerms;
    }

    // 3. Fallback to defaultAccesses
    return room.permissions.defaultAccesses;
  }

  /** Convenience: can this identity write to this doc? */
  canWrite(identity: AgentIdentity | null, docName: string): boolean {
    return this.resolveAccess(identity, docName).includes("room:write");
  }

  /** Convenience: can this identity read this doc? */
  canRead(identity: AgentIdentity | null, docName: string): boolean {
    const perms = this.resolveAccess(identity, docName);
    return perms.includes("room:read") || perms.includes("room:write");
  }
}
```

**Update RoomManager.Room to include permissions:**
```typescript
export interface Room {
  id: string;
  teamId: string;
  type: RoomType;
  owner?: string;
  permissions: RoomPermissions;
  createdAt: string;
}
```

**Update RoomManager.createRoom to set default permissions per room type:**
```typescript
createRoom(teamId: string, name: string, type: RoomType, owner?: string): Room {
  const id = `${teamId}/${name}`;
  if (this.rooms.has(id)) return this.rooms.get(id)!;

  // Set default permissions based on room type
  const permissions: RoomPermissions = {
    defaultAccesses: type === "team" || type === "goal" ? ["room:write"] : [],
    groupsAccesses: type === "system" ? { agents: ["room:read"] } : {},
    usersAccesses: owner ? { [owner]: ["room:write"] } : {},
  };

  const room: Room = { id, teamId, type, owner, permissions, createdAt: new Date().toISOString() };
  this.rooms.set(id, room);
  return room;
}

/** Update room permissions (Liveblocks updateRoom pattern) */
updateRoomPermissions(roomId: string, update: Partial<RoomPermissions>): Room | null {
  const room = this.rooms.get(roomId);
  if (!room) return null;

  if (update.defaultAccesses !== undefined) room.permissions.defaultAccesses = update.defaultAccesses;
  if (update.groupsAccesses) {
    for (const [groupId, perms] of Object.entries(update.groupsAccesses)) {
      if (perms === null) delete room.permissions.groupsAccesses[groupId];
      else room.permissions.groupsAccesses[groupId] = perms;
    }
  }
  if (update.usersAccesses) {
    for (const [userId, perms] of Object.entries(update.usersAccesses)) {
      if (perms === null) delete room.permissions.usersAccesses[userId];
      else room.permissions.usersAccesses[userId] = perms;
    }
  }
  return room;
}
```

**Update IdentityRegistry to include groupIds:**
```typescript
export interface AgentIdentity {
  id: string;
  teamId: string;
  role: string;
  type: "agent";
  groupIds: string[];       // e.g. ["agents", "developers"]
  registeredAt: string;
}
```

**Exit criteria:** Three-level permission resolution works. Personal rooms are private by default. `updateRoomPermissions()` can grant/revoke per-user access.

---

## Step 4: Wire into Hocuspocus onAuthenticate

**Package:** `packages/collab-service/src/server/HocuspocusServer.ts`

The `onAuthenticate` hook now resolves identity and enforces access using the three-level model:

```typescript
async onAuthenticate({ token, documentName, connection }: {
  token: string;
  documentName: string;
  connection: { readOnly: boolean };
}) {
  const teamId = documentName.split("/")[0];
  const identity = this.identityRegistry.resolve(teamId, token);
  
  // Resolve permissions using the three-level model
  const perms = this.accessControl.resolveAccess(identity, documentName);
  
  // Empty permissions array = denied
  if (perms.length === 0) {
    throw new Error(`Access denied: ${token} cannot access ${documentName}`);
  }
  
  // Read-only if no write permission
  if (!perms.includes("room:write")) {
    connection.readOnly = true;
  }
  
  return { user: identity?.id || token || "anonymous" };
},
```

---

## Step 5: Team initialization — Auto-create rooms and register agents

**Package:** `packages/collab-service/src/rooms/TeamInitializer.ts`

When a team starts up, create the standard rooms and register all agents:

```typescript
export class TeamInitializer {
  constructor(
    private identityRegistry: IdentityRegistry,
    private roomManager: RoomManager,
  ) {}

  /** Initialize CRDT rooms for a team — called once when team loads */
  initializeTeam(teamId: string, agentRoles: string[]): void {
    // Create team-level rooms
    this.roomManager.createRoom(teamId, "team-memory", "team");
    this.roomManager.createRoom(teamId, "_system", "system");

    // Register each agent and create their personal room
    for (const role of agentRoles) {
      const identity = this.identityRegistry.register(teamId, role);
      this.roomManager.createRoom(teamId, `agent:${role.toLowerCase()}`, "personal", identity.id);
    }
  }

  /** Create a goal room — called when a new goal starts */
  initializeGoal(teamId: string, goalId: string): void {
    this.roomManager.createRoom(teamId, `goal:${goalId}`, "goal");
  }
}
```

**Exit criteria:** When team "dev-team" loads with roles [coder, researcher, writer]:
- 3 personal rooms created: `dev-team/agent:coder`, `dev-team/agent:researcher`, `dev-team/agent:writer`
- 1 team room: `dev-team/team-memory`
- 1 system room: `dev-team/_system`
- 3 agents registered in IdentityRegistry

---

## Step 6: MemoryScope — remember/recall on any room

**Package:** `packages/collaboration/src/L2/memory/MemoryScope.ts`

Same as before but now operates within a room context, not raw doc names:

```typescript
export class MemoryScope {
  constructor(
    private provider: ICollabProvider,
    private roomId: string,        // e.g. "team-1/team-memory"
    private agentRole: string,
    private sections: string[],    // well-known sections for this room type
  ) {}

  async remember(content: string, section?: string): Promise<string> { /* ... */ }
  async recall(query: string, opts?: { section?: string; limit?: number }): Promise<MemoryRecord[]> { /* ... */ }
  async delete(key: string, section: string): Promise<boolean> { /* ... */ }
  async list(section?: string): Promise<MemoryRecord[]> { /* ... */ }
  async tree(): Promise<Record<string, number>> { /* ... */ }
}
```

---

## Step 7: AgentWorkspace — Unified API for agents

**Package:** `packages/collaboration/src/L2/memory/AgentWorkspace.ts`

Each agent gets one workspace object that provides access to all their rooms:

```typescript
export class AgentWorkspace {
  readonly personal: MemoryScope;
  readonly team: MemoryScope;
  
  constructor(
    private provider: ICollabProvider,
    readonly identity: AgentIdentity,
    private teamId: string,
  ) {
    this.personal = new MemoryScope(
      provider,
      `${teamId}/agent:${identity.role}`,
      identity.role,
      ["scratchpad", "context", "task-history", "preferences"],
    );
    this.team = new MemoryScope(
      provider,
      `${teamId}/team-memory`,
      identity.role,
      ["decisions", "conventions", "knowledge", "lessons-learned"],
    );
  }

  /** Read another agent's personal space (read-only) */
  readAgentSpace(role: string): MemoryScope {
    return new MemoryScope(
      this.provider,
      `${this.teamId}/agent:${role.toLowerCase()}`,
      this.identity.role,
      ["scratchpad", "context", "task-history"],
    );
  }
}
```

---

## Step 8: Agent tools (team_memory + personal_notes)

**Package:** `packages/collaboration/src/L2/tools/team-memory.ts` + `personal-notes.ts`

Tools that wrap the workspace. Identical to previous plan but now backed by proper rooms.

---

## Step 9: Wire into CollaborationPlugin

**Package:** `packages/backend/agentManager/plugins/CollaborationPlugin.ts`

```typescript
// In CollabMcpServer.getTools():
getTools(context: ToolContext): any[] {
  if (context.consumer === "planner") return [];
  if (!context.role) return [];
  
  const tools: any[] = [];
  
  // Existing: collab tool (goal-scoped)
  if (this.goalId) {
    const space = this.l2.getOrCreateSpace(this.goalId);
    tools.push(createCollabTool(space, context.role, this.l2, this.repoPath, context.taskId, this.collabCallbacks));
  }
  
  // NEW: Get agent's workspace (personal + team rooms)
  const workspace = this.l2.getAgentWorkspace(context.role);
  tools.push(createTeamMemoryTool(workspace.team));
  tools.push(createPersonalNotesTool(workspace.personal));
  
  return tools;
}
```

**In L2CollaborationPlugin:** Add `getAgentWorkspace(role)` that creates `AgentWorkspace` with identity:

```typescript
getAgentWorkspace(role: string): AgentWorkspace {
  const identity = this.teamInitializer.identityRegistry.resolve(this._teamId, role)
    || this.teamInitializer.identityRegistry.register(this._teamId, role);
  return new AgentWorkspace(this._collabProvider, identity, this._teamId);
}
```

---

## Step 10: Team initialization hook

**Package:** `packages/backend/agentManager/plugins/CollaborationPlugin.ts`

Call `TeamInitializer.initializeTeam()` during plugin initialization:

```typescript
async initialize(): Promise<void> {
  await this.l2.initialize();
  
  // Register agents and create rooms
  const agentRoles = this.getAgentRoles(); // from team config
  this.teamInitializer.initializeTeam(this.teamId, agentRoles);
}
```

---

## Step 11: Tests

```typescript
describe("Agent-Scoped Memory", () => {
  it("agent registers and gets identity", () => { /* ... */ });
  it("personal room created on registration", () => { /* ... */ });
  it("agent can write to own personal room", () => { /* ... */ });
  it("agent can read but not write to other agent's room", () => { /* ... */ });
  it("all agents can write to team room", () => { /* ... */ });
  it("system room denies frontend access", () => { /* ... */ });
  it("team memory persists across goals", () => { /* ... */ });
  it("remember and recall work in team scope", () => { /* ... */ });
  it("personal notes isolated between agents", () => { /* ... */ });
});
```

---

## Verification Checklist

- [ ] `bun run build:backend` — passes
- [ ] `cd packages/collab-service && bun test` — existing 4 tests pass
- [ ] `cd packages/collaboration && bun test` — new tests pass
- [ ] Agent connects with identity token, not "anonymous"
- [ ] Agent sees personal room + team room + goal room
- [ ] Agent can write to own personal room, read-only on other agents'
- [ ] Team memory persists: goal 1 stores decision → goal 2 recalls it
- [ ] Frontend can read team/personal rooms but not system room

---

## Summary

| Step | What | Package | Lines |
|------|------|---------|-------|
| 1 | IdentityRegistry | collab-service | ~40 |
| 2 | RoomManager | collab-service | ~60 |
| 3 | AccessControl | collab-service | ~40 |
| 4 | onAuthenticate update | collab-service | ~15 |
| 5 | TeamInitializer | collab-service | ~30 |
| 6 | MemoryScope | collaboration | ~80 |
| 7 | AgentWorkspace | collaboration | ~40 |
| 8 | Agent tools | collaboration | ~100 |
| 9 | CollaborationPlugin wiring | backend | ~20 |
| 10 | Team init hook | backend | ~10 |
| 11 | Tests | collab-service + collaboration | ~100 |
| **Total** | | | **~535 lines** |

**Risk:** Low. Steps 1-5 are in `collab-service` (new files, zero existing code changes). Steps 6-8 are in `collaboration` (new files). Steps 9-10 are the only existing file modifications (~30 lines total). The existing `collab` tool and `CollaborationSpace` are completely untouched.

