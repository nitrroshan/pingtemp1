# F1: Agent-Scoped Memory — Architecture

**Date:** May 3, 2026  
**Status:** Ready for implementation  
**Priority:** P0 — First CRDT feature to implement  
**Depends on:** F0 Infrastructure (done — `packages/collab-service/`)  
**Feature List:** [CRDT-FEATURE-LIST.md](../CRDT-FEATURE-LIST.md) → Feature 1  
**Research:** [crdt-team-memory/research.md](../crdt-team-memory/research.md) (2552 lines)

---

## Philosophy

**Agents are users.** Not string prefixes, not hacks — real registered identities that log into CRDT, see their own workspace, have a shared team space, and collaborate in rooms. The same model that Slack, Notion, and Liveblocks use for humans, we use for AI agents.

## Problem

Today agents are anonymous. They connect to Hocuspocus with `token: "anonymous"`. Every agent writes to the same flat pool of documents under `{teamId}/{goalId}/`. No identity, no personal space, no team memory, no room management. It's like having 5 people share one Google Doc with no accounts.

## Architecture

### Core Model

```
┌─────────────────────────────────────────────────────────┐
│                    CRDT Room System                      │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Identity Registry                                │   │
│  │  ─────────────────                                │   │
│  │  registerAgent(teamId, role) → AgentIdentity      │   │
│  │  Each agent gets: id, role, teamId, permissions   │   │
│  │  Connects to Hocuspocus with identity token       │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Room Manager                                     │   │
│  │  ────────────                                     │   │
│  │  createRoom(id, type, config) → Room              │   │
│  │  joinRoom(agentId, roomId) → access level         │   │
│  │  leaveRoom(agentId, roomId)                       │   │
│  │  listRooms(filter?) → Room[]                      │   │
│  │  archiveRoom(roomId) → cold storage               │   │
│  │                                                    │   │
│  │  Room Types:                                       │   │
│  │   • personal  — agent's own workspace              │   │
│  │   • team      — shared team knowledge              │   │
│  │   • goal      — goal-scoped work (existing)        │   │
│  │   • system    — hidden config (agents-only)        │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Access Control                                   │   │
│  │  ──────────────                                   │   │
│  │  resolveAccess(agentId, roomId) → write|read|deny │   │
│  │  Enforced in Hocuspocus onAuthenticate hook       │   │
│  │                                                    │   │
│  │  Rules:                                            │   │
│  │   personal room → owner: write, others: read      │   │
│  │   team room     → all agents: write               │   │
│  │   goal room     → all agents: write (existing)    │   │
│  │   system room   → agents: read, frontend: deny    │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Agent Workspace (per agent)                      │   │
│  │  ─────────────────────────                        │   │
│  │  When an agent starts, it gets:                   │   │
│  │   1. Its personal room (auto-created)             │   │
│  │   2. Access to the team room (auto-joined)        │   │
│  │   3. Access to the active goal room               │   │
│  │                                                    │   │
│  │  Workspace API:                                    │   │
│  │   workspace.personal  → MemoryScope (scratchpad)  │   │
│  │   workspace.team      → MemoryScope (shared)      │   │
│  │   workspace.goal      → CollaborationSpace (work) │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### How It Works — Agent Lifecycle

**Single-user (Phase 0 — current):** `{teamId}/` prefix. Works now.  
**Multi-user (Phase 1 — after [multi-user](../multi-user/feature_architecture.md) ships):** `{userId}/{teamId}/` prefix for per-user isolation.

```
Phase 0 (single user):
  team-1/team-memory              — shared team knowledge
  team-1/agent:coder              — coder's personal space
  team-1/goal:build-app           — goal work

Phase 1 (multi-user):
  team-1/team-memory              — SHARED across all team members
  alice/team-1/agent:coder        — Alice's coder personal notes
  alice/team-1/goal:build-auth    — Alice's goal (only Alice sees)
  bob/team-1/agent:coder          — Bob's coder personal notes (isolated!)
  bob/team-1/goal:api-docs        — Bob's goal (only Bob sees)
```

**Key design decision:** Team memory is shared (one room per team). Agent personal rooms and goal rooms are per-user (different coder runs for different users have different context). This aligns with [multi-user](../multi-user/feature_architecture.md) where goals belong to users but teams/agents are shared.

### Agent Lifecycle (aligned with multi-user)

```
1. Team starts up
   → RoomManager creates team room: "team-1/team-memory" (shared)
   → RoomManager creates system room: "team-1/_system" (shared)

2. User "alice" starts a goal on team "team-1"
   → Agent "coder" registers for this user-team combination
   → IdentityRegistry.register("team-1", "coder", { userId: "alice" })
   → Returns AgentIdentity { id: "agent:coder", userId: "alice", teamId: "team-1" }
   → RoomManager creates personal room: "alice/team-1/agent:coder" (per-user)
   → Agent auto-joins: personal room (write) + team room (write)

3. Goal "build-auth" starts (owned by alice)
   → RoomManager creates goal room: "alice/team-1/goal:build-auth"
   → All alice's agents join this goal room
   → Bob's agents CANNOT see this room (different userId prefix)

4. Agent "coder" connects to Hocuspocus
   → onAuthenticate({ token: "alice:agent:coder" })
   → Validates identity → returns AgentIdentity as context
   → Can access: alice/team-1/agent:coder (write), team-1/team-memory (write)
   → Cannot access: bob/team-1/agent:coder (different user)

5. Bob starts a goal on the same team
   → RoomManager creates: "bob/team-1/agent:coder" (Bob's coder notes)
   → Bob's coder has SEPARATE personal space from Alice's coder
   → Both coders share team-1/team-memory (team decisions persist for all)
```

### Room Types & Access Matrix

Following Liveblocks' **three-level permission model**: `defaultAccesses` → `groupsAccesses` → `usersAccesses`. Each level overrides the one above.

#### Permission Types (from Liveblocks)

| Permission | Can Read | Can Write | Can Delete |
|------------|---------|----------|-----------|
| `["room:write"]` | ✅ | ✅ | ✅ own entries |
| `["room:read"]` | ✅ | ❌ | ❌ |
| `[]` (private) | ❌ | ❌ | ❌ |

#### Room Defaults

Rooms fall into two categories: **shared** (team-scoped) and **per-user** (user+team-scoped).

| Room Type | Scope | Example (single-user) | Example (multi-user) | defaultAccesses |
|-----------|-------|-----------------------|---------------------|----------------|
| **team** | Shared | `team-1/team-memory` | `team-1/team-memory` | `["room:write"]` |
| **system** | Shared | `team-1/_system` | `team-1/_system` | `[]` (private) |
| **personal** | Per-user | `team-1/agent:coder` | `alice/team-1/agent:coder` | `[]` (private) |
| **goal** | Per-user | `team-1/goal:build-app` | `alice/team-1/goal:build-app` | `["room:write"]` |

**Why personal rooms are per-user:** In multi-user, the same `coder` agent runs tasks for Alice and Bob. Alice's coder accumulates context specific to her goals ("Alice prefers PostgreSQL"). Bob's coder accumulates different context ("Bob's project uses MongoDB"). If they shared a personal room, context would leak between users.

**Why team-memory is shared:** Team decisions ("We use TypeScript strict mode") apply to all members. This aligns with [multi-user](../multi-user/feature_architecture.md) where team resources (agents, skills) are shared.

### Multi-User Access Integration

CRDT room permissions map to [multi-user](../multi-user/feature_architecture.md) team roles:

| Team Role | team-memory | Other user's goals | Other user's agent rooms | system |
|-----------|------------|--------------------|-----------------------------|--------|
| **Owner** | write | read (admin view) | read | write |
| **Admin** | write | read (admin view) | read | read |
| **Member** | write | deny | deny | deny |
| **Viewer** | read | deny | deny | deny |

Team owners/admins can view (read-only) all goals and agent rooms within their team — matching the multi-user doc where "Team owners/admins can see all goals in their team."

#### Per-Room Overrides

Permissions are stored ON the room (Liveblocks ID Token pattern — room is source of truth):

```typescript
// Personal room — private by default, owner gets write via usersAccesses
const coderRoom = roomManager.createRoom("team-1/agent:coder", {
  type: "personal",
  defaultAccesses: [],                              // private by default
  usersAccesses: {
    "agent:coder": ["room:write"],                  // owner has full access
  },
  groupsAccesses: {},
});

// Grant researcher read access to coder's room
roomManager.updateRoom("team-1/agent:coder", {
  usersAccesses: {
    "agent:coder": ["room:write"],                  // owner keeps write
    "agent:researcher": ["room:read"],              // researcher can read
  },
});

// Team room — everyone writes by default
const teamRoom = roomManager.createRoom("team-1/team-memory", {
  type: "team",
  defaultAccesses: ["room:write"],                  // all team agents
  usersAccesses: {},
  groupsAccesses: {},
});

// System room — private, only agents group gets read
const systemRoom = roomManager.createRoom("team-1/_system", {
  type: "system",
  defaultAccesses: [],                              // private
  groupsAccesses: {
    "agents": ["room:read"],                        // all agents can read
  },
  usersAccesses: {},
});
```

#### Access Resolution Order (Liveblocks pattern)

```
1. usersAccesses[userId]    → if set, use this (highest priority)
2. groupsAccesses[groupId]  → if user is in this group, use this
3. defaultAccesses          → fallback for everyone
```

**This is exactly how Liveblocks does it.** The user-level override beats the group-level, which beats the default. Setting a permission to `null` removes the override, falling through to the next level.

#### Groups

Agents belong to groups. Groups are simple string arrays set at identity registration:

```typescript
// Agent "coder" belongs to "agents" and "developers" groups
identityRegistry.register("team-1", "coder", {
  groupIds: ["agents", "developers"],
});

// Agent "researcher" belongs to "agents" and "analysts" groups
identityRegistry.register("team-1", "researcher", {
  groupIds: ["agents", "analysts"],
});
```

#### Example Scenarios

**Coder wants to share findings with writer only:**
```typescript
roomManager.updateRoom("team-1/agent:coder", {
  usersAccesses: {
    "agent:coder": ["room:write"],       // owner
    "agent:writer": ["room:read"],       // writer can read
    // researcher, tester → no entry (falls through to defaultAccesses: [])
  },
});
```

**Coder revokes writer's access:**
```typescript
roomManager.updateRoom("team-1/agent:coder", {
  usersAccesses: {
    "agent:coder": ["room:write"],
    "agent:writer": null,                // removed → falls to default ([])
  },
});
```

**System room grants all agents read, but one agent gets write:**
```typescript
roomManager.updateRoom("team-1/_system", {
  defaultAccesses: [],                   // private
  groupsAccesses: {
    "agents": ["room:read"],             // all agents read
  },
  usersAccesses: {
    "agent:orchestrator": ["room:write"],// orchestrator can modify config
  },
});
```

### Agent Workspace API

Each agent gets a unified workspace scoped to its user + team:

```typescript
interface AgentWorkspace {
  /** Agent's private space — per-user, per-role */
  personal: MemoryScope;
  
  /** Shared team knowledge — shared across all team members */
  team: MemoryScope;
  
  /** Current goal work — per-user goal (existing CollaborationSpace) */
  goal: CollaborationSpace;
  
  /** Agent identity (includes userId for multi-user) */
  identity: AgentIdentity;
  
  /** List all rooms this agent can access */
  listRooms(): Room[];
  
  /** Read another agent's personal notes within same user scope (read-only) */
  readAgentSpace(role: string): MemoryScope;
}

interface AgentIdentity {
  id: string;             // "agent:coder"
  role: string;           // "coder"
  teamId: string;         // "team-1"
  userId: string;         // "alice" (from goal owner, single-user: "default")
  groupIds: string[];     // ["agents", "developers"]
  type: "agent";
}
```

### Personal Room Structure

Each agent's personal room has well-known sections:

```
agent:coder/
  ├── scratchpad       Y.Map — working notes, drafts, temp data
  ├── context          Y.Map — accumulated context from past tasks  
  ├── task-history     Y.Map — summaries of completed tasks
  └── preferences      Y.Map — learned patterns, tool preferences
```

### Team Room Structure

The shared team room persists across all goals:

```
team-memory/
  ├── decisions        Y.Map — "We chose PostgreSQL" (cross-goal)
  ├── conventions      Y.Map — "Use TypeScript strict mode" 
  ├── knowledge        Y.Map — accumulated domain knowledge
  └── lessons-learned  Y.Map — what worked, what didn't
```

### Agent Tools

Two new tools that use the workspace API:

```typescript
// team_memory — shared team knowledge
tool({ name: "team_memory", parameters: z.object({
  action: z.enum(["remember", "recall", "list", "delete", "tree"]),
  content: z.string().optional(),
  query: z.string().optional(),
  scope: z.enum(["decisions", "conventions", "knowledge", "lessons-learned"]).optional(),
  key: z.string().optional(),
})});

// personal_notes — agent's own workspace
tool({ name: "personal_notes", parameters: z.object({
  action: z.enum(["write", "read", "delete", "list", "clear"]),
  key: z.string().optional(),
  value: z.string().optional(),
  section: z.enum(["scratchpad", "context", "task-history", "preferences"]).optional(),
})});
```

## Implementation Location

```
packages/collab-service/src/
  rooms/
    RoomManager.ts              — Room CRUD, room registry, room types
    IdentityRegistry.ts         — Agent registration, identity tokens
    AccessControl.ts            — resolveAccess(), permission rules
  server/
    HocuspocusServer.ts         — Updated onAuthenticate with access control

packages/collaboration/src/L2/
  memory/
    MemoryScope.ts              — remember/recall/delete/list/tree on any room
    AgentWorkspace.ts           — Unified workspace: personal + team + goal
  tools/
    team-memory.ts              — team_memory tool
    personal-notes.ts           — personal_notes tool

packages/backend/
  agentManager/plugins/
    CollaborationPlugin.ts      — Wire AgentWorkspace + tools into agent lifecycle
```

## What This Feature Does NOT Include

- JWT/token-based auth for production → Feature 5 (crdt-auth). Phase 0 uses role strings as identity.
- Orama search for recall → Feature 3 (crdt-search). Phase 0 uses substring match.
- Memory consolidation/dedup → Feature 4 (crdt-consolidation)
- Goal archival/cleanup → Feature 2 (crdt-goal-lifecycle)
- Agent presence/awareness → Future feature

## Effort

~500 lines total:
- RoomManager + IdentityRegistry + AccessControl: ~150 lines
- MemoryScope + AgentWorkspace: ~150 lines
- Tools (team_memory + personal_notes): ~100 lines
- Wiring (CollaborationPlugin, HocuspocusServer): ~50 lines
- Tests: ~100 lines

---

## Alignment with Multi-User Platform

This feature is designed to work with [multi-user](../multi-user/feature_architecture.md). The key decisions:

| Decision | Rationale |
|----------|-----------|
| **userId on AgentIdentity** | Agents run on behalf of a user. Same agent role, different users → different personal rooms. Single-user mode uses `userId: "default"`. |
| **Team memory is shared** | Room `{teamId}/team-memory` has no userId prefix. All team members contribute to and read from the same decisions/conventions. Matches multi-user where team resources are shared. |
| **Personal rooms are per-user** | Room `{userId}/{teamId}/agent:{role}`. When coder runs Alice's task then Bob's task, each execution accumulates context in the right user's space. |
| **Goal rooms are per-user** | Room `{userId}/{teamId}/goal:{goalId}`. Matches multi-user where `goal.userId` scopes visibility. |
| **Team roles map to room access** | Multi-user team roles (owner/admin/member/viewer) translate to `groupsAccesses` on CRDT rooms. Owner/admin get read access to all user rooms in their team. |
| **Phase 0 works without multi-user** | Single-user mode omits the userId prefix. All rooms under `{teamId}/`. Migration to multi-user just adds the prefix — no data model change. |

### Migration Path

```
Phase 0 (now, single-user):
  Rooms: team-1/team-memory, team-1/agent:coder, team-1/goal:xyz
  Identity: { id: "agent:coder", userId: "default", teamId: "team-1" }

Phase 1 (after multi-user ships):
  Shared rooms stay: team-1/team-memory
  Per-user rooms get prefix: alice/team-1/agent:coder, alice/team-1/goal:xyz
  Identity: { id: "agent:coder", userId: "alice", teamId: "team-1" }
  
  Migration: move existing personal+goal rooms under "default/" prefix
  → default/team-1/agent:coder → stays as-is (single user = "default")
  → When alice logs in, her rooms are alice/team-1/agent:coder
```
