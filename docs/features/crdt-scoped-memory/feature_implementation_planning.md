# F1: Agent-Scoped Memory — Implementation Plan

**Architecture:** [feature_architecture.md](feature_architecture.md)  
**Feature List:** [CRDT-FEATURE-LIST.md](../CRDT-FEATURE-LIST.md) → Feature 1  
**Principle:** Each step must pass `bun run build:backend` + existing tests with ZERO breakage.

---

## Current State (Audited)

### How Agents Access CRDT Today

```
CollaborationPlugin.getTools(context)
  → CollabMcpServer.getTools({ role, taskId, consumer })
    → l2.getOrCreateSpace(goalId)                    ← always goal-scoped
      → new CollaborationSpace(teamId, goalId, provider)
        → prefix = "{teamId}/{goalId}/"
    → createCollabTool(space, agentRole, ...)         ← returns unified "collab" tool
```

**Key fact:** `CollaborationSpace` hardcodes prefix as `{teamId}/{goalId}/`. Agents only see goal-scoped docs. No team-level or agent-level docs exist.

### Files That Will Change

| File | Package | Change |
|------|---------|--------|
| `L2CollaborationPlugin.ts` | collaboration | Add `getTeamMemoryScope()`, `getAgentMemoryScope()` |
| `CollaborationPlugin.ts` | backend | Wire new tools into MCP server |
| `HocuspocusServer.ts` | collab-service | Add room prefix validation in `onAuthenticate` |
| NEW: `MemoryScope.ts` | collaboration | remember/recall/delete/list/tree |
| NEW: `team-memory.ts` | collaboration | `team_memory` agent tool |
| NEW: `personal-notes.ts` | collaboration | `personal_notes` agent tool |

### Files That MUST NOT Change

| File | Why |
|------|-----|
| `CollaborationSpace.ts` | Existing goal-scoped logic stays identical |
| `tools/index.ts` | Existing `collab` tool unchanged — new tools are separate |
| `CrdtTaskSync.ts`, `CrdtGoalStore.ts`, `PlanStore.ts` | Goal-scoped stores work as before |

---

## Step 1: Create MemoryScope class

**File:** `packages/collaboration/src/L2/memory/MemoryScope.ts`

The core abstraction. Wraps an `ICollabProvider` with a room prefix and provides remember/recall/delete/list/tree operations.

```typescript
import type { ICollabProvider } from "../collaboration/types/collab-provider.types.js";
import * as Y from "yjs";

export interface MemoryRecord {
  key: string;
  content: string;
  createdAt: string;
  source: string;
  scope: string;
}

export class MemoryScope {
  constructor(
    private provider: ICollabProvider,
    private roomPrefix: string,      // e.g. "{teamId}/team-memory" or "{teamId}/agent:coder"
    private agentRole: string,
  ) {}

  /** Store a memory in the given scope (defaults to "knowledge") */
  async remember(content: string, scope?: string): Promise<string> {
    const scopeName = scope || "knowledge";
    const doc = await this.provider.openDoc(`${this.roomPrefix}/${scopeName}`);
    const map = doc.getMap(scopeName);
    const key = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    map.set(key, {
      content,
      createdAt: new Date().toISOString(),
      source: this.agentRole,
    });
    return key;
  }

  /** Retrieve memories matching a query (Phase 0: substring match, Phase 1: Orama BM25) */
  async recall(query: string, options?: { scope?: string; limit?: number }): Promise<MemoryRecord[]> {
    const scopeName = options?.scope;
    const scopes = scopeName ? [scopeName] : ["decisions", "conventions", "knowledge", "lessons-learned"];
    const results: MemoryRecord[] = [];
    const q = query.toLowerCase();

    for (const s of scopes) {
      try {
        const doc = await this.provider.openDoc(`${this.roomPrefix}/${s}`);
        const map = doc.getMap(s);
        for (const [key, value] of map.entries()) {
          const v = value as any;
          if (v?.content && v.content.toLowerCase().includes(q)) {
            results.push({ key, content: v.content, createdAt: v.createdAt, source: v.source, scope: s });
          }
        }
      } catch { /* scope doesn't exist yet — skip */ }
    }

    return results
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, options?.limit ?? 10);
  }

  /** Delete a specific memory by key */
  async delete(key: string, scope: string): Promise<boolean> {
    const doc = await this.provider.openDoc(`${this.roomPrefix}/${scope}`);
    const map = doc.getMap(scope);
    if (map.has(key)) {
      map.delete(key);
      return true;
    }
    return false;
  }

  /** List all memories in a scope (or all scopes) */
  async list(scope?: string): Promise<MemoryRecord[]> {
    const scopes = scope ? [scope] : ["decisions", "conventions", "knowledge", "lessons-learned"];
    const results: MemoryRecord[] = [];

    for (const s of scopes) {
      try {
        const doc = await this.provider.openDoc(`${this.roomPrefix}/${s}`);
        const map = doc.getMap(s);
        for (const [key, value] of map.entries()) {
          const v = value as any;
          if (v?.content) {
            results.push({ key, content: v.content, createdAt: v.createdAt, source: v.source, scope: s });
          }
        }
      } catch { /* skip */ }
    }

    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /** Show scope tree with counts */
  async tree(): Promise<Record<string, number>> {
    const scopes = ["decisions", "conventions", "knowledge", "lessons-learned"];
    const tree: Record<string, number> = {};
    for (const s of scopes) {
      try {
        const doc = await this.provider.openDoc(`${this.roomPrefix}/${s}`);
        tree[s] = doc.getMap(s).size;
      } catch {
        tree[s] = 0;
      }
    }
    return tree;
  }
}
```

**Exit criteria:** `MemoryScope` can remember, recall, delete, list, tree on any ICollabProvider.

**Verify:**
```bash
cd packages/collaboration && bunx tsc --noEmit
```

---

## Step 2: Create agent tools (team_memory + personal_notes)

**File:** `packages/collaboration/src/L2/tools/team-memory.ts`

```typescript
import { tool } from "ai";
import { z } from "zod";
import type { MemoryScope } from "../memory/MemoryScope.js";

export function createTeamMemoryTool(teamMemory: MemoryScope) {
  return tool({
    description: "Read, write, and manage shared team memory that persists across goals. Use for decisions, conventions, and accumulated knowledge.",
    parameters: z.object({
      action: z.enum(["remember", "recall", "list", "delete", "tree"]),
      content: z.string().optional().describe("Content to remember (for 'remember' action)"),
      query: z.string().optional().describe("Search query (for 'recall' action)"),
      scope: z.enum(["decisions", "conventions", "knowledge", "lessons-learned"]).optional()
        .describe("Memory scope. Defaults to 'knowledge'."),
      key: z.string().optional().describe("Memory key to delete (for 'delete' action)"),
    }),
    execute: async ({ action, content, query, scope, key }) => {
      switch (action) {
        case "remember":
          if (!content) return "Error: content is required for remember";
          const memKey = await teamMemory.remember(content, scope);
          return `Stored in team-memory/${scope || "knowledge"} with key: ${memKey}`;

        case "recall":
          if (!query) return "Error: query is required for recall";
          const results = await teamMemory.recall(query, { scope, limit: 10 });
          if (results.length === 0) return "No matching memories found.";
          return results.map(r => `[${r.scope}] ${r.content} (by ${r.source}, ${r.createdAt})`).join("\n");

        case "list":
          const items = await teamMemory.list(scope);
          if (items.length === 0) return scope ? `No memories in ${scope}.` : "Team memory is empty.";
          return items.map(r => `[${r.scope}] ${r.key}: ${r.content.slice(0, 100)}`).join("\n");

        case "delete":
          if (!key || !scope) return "Error: key and scope required for delete";
          const deleted = await teamMemory.delete(key, scope);
          return deleted ? `Deleted ${key} from ${scope}` : `Key ${key} not found in ${scope}`;

        case "tree":
          const tree = await teamMemory.tree();
          return Object.entries(tree).map(([s, n]) => `${s}: ${n} records`).join("\n");
      }
    },
  });
}
```

**File:** `packages/collaboration/src/L2/tools/personal-notes.ts`

```typescript
import { tool } from "ai";
import { z } from "zod";
import type { MemoryScope } from "../memory/MemoryScope.js";

export function createPersonalNotesTool(agentMemory: MemoryScope) {
  return tool({
    description: "Your private scratchpad. Write notes, context, and task history that only you can modify. Other agents can read but not write.",
    parameters: z.object({
      action: z.enum(["write", "read", "delete", "list", "clear"]),
      key: z.string().optional().describe("Key to read/write/delete"),
      value: z.string().optional().describe("Value to write"),
      section: z.enum(["scratchpad", "context", "task-history"]).optional()
        .describe("Section of personal notes. Defaults to 'scratchpad'."),
    }),
    execute: async ({ action, key, value, section }) => {
      const sec = section || "scratchpad";

      switch (action) {
        case "write":
          if (!value) return "Error: value is required for write";
          const k = key || `note-${Date.now()}`;
          await agentMemory.remember(value, sec);
          return `Written to ${sec}`;

        case "read":
          if (!key) {
            const all = await agentMemory.list(sec);
            return all.length === 0 ? `${sec} is empty.`
              : all.map(r => `${r.key}: ${r.content.slice(0, 200)}`).join("\n");
          }
          const items = await agentMemory.list(sec);
          const match = items.find(i => i.key === key);
          return match ? match.content : `Key '${key}' not found in ${sec}`;

        case "delete":
          if (!key) return "Error: key required for delete";
          const del = await agentMemory.delete(key, sec);
          return del ? `Deleted ${key} from ${sec}` : `Not found`;

        case "list":
          const list = await agentMemory.list(sec);
          return list.length === 0 ? `${sec} is empty.`
            : list.map(r => `${r.key}: ${r.content.slice(0, 80)}`).join("\n");

        case "clear":
          const all = await agentMemory.list(sec);
          for (const r of all) await agentMemory.delete(r.key, sec);
          return `Cleared ${all.length} items from ${sec}`;
      }
    },
  });
}
```

**Exit criteria:** Both tools compile. They accept a `MemoryScope` instance.

---

## Step 3: Wire into L2CollaborationPlugin

**File:** `packages/collaboration/src/L2/L2CollaborationPlugin.ts`

Add two new methods that create `MemoryScope` instances for team and agent rooms:

```typescript
// ADD to L2CollaborationPlugin class:

import { MemoryScope } from "./memory/MemoryScope.js";

/** Get team-level memory scope (shared across all goals) */
getTeamMemoryScope(): MemoryScope {
  return new MemoryScope(
    this._collabProvider,
    `${this._teamId}/team-memory`,
    "system",
  );
}

/** Get agent-level memory scope (private per agent role) */
getAgentMemoryScope(agentRole: string): MemoryScope {
  return new MemoryScope(
    this._collabProvider,
    `${this._teamId}/agent:${agentRole.toLowerCase()}`,
    agentRole.toLowerCase(),
  );
}
```

**Key design:** These use the SAME `_collabProvider` (CollabServer) as `CollaborationSpace`. The only difference is the doc name prefix. No new servers, no new connections.

**What breaks: NOTHING.** New methods, no changes to existing code.

---

## Step 4: Wire tools into CollaborationPlugin (backend)

**File:** `packages/backend/agentManager/plugins/CollaborationPlugin.ts`

Add `team_memory` and `personal_notes` tools to the MCP server's `getTools()`:

```typescript
// In CollabMcpServer.getTools():

getTools(context: ToolContext): any[] {
  if (context.consumer === "planner") return [];
  if (!context.role) return [];
  if (!this.l2.isReady) return [];

  const tools: any[] = [];

  // Existing: collab tool (goal-scoped)
  if (this.goalId) {
    const space = this.l2.getOrCreateSpace(this.goalId);
    tools.push(createCollabTool(space, context.role, this.l2, this.repoPath, context.taskId, this.collabCallbacks));
  }

  // NEW: team_memory tool (cross-goal)
  const teamMemory = this.l2.getTeamMemoryScope();
  tools.push(createTeamMemoryTool(teamMemory));

  // NEW: personal_notes tool (per-agent)
  const agentMemory = this.l2.getAgentMemoryScope(context.role);
  tools.push(createPersonalNotesTool(agentMemory));

  return tools;
}
```

**What breaks: NOTHING.** Adds tools alongside existing `collab` tool. Existing agents get new tools automatically.

---

## Step 5: Room prefix validation in Hocuspocus

**File:** `packages/collab-service/src/server/HocuspocusServer.ts`

Update `onAuthenticate` to validate room access by doc name prefix:

```typescript
async onAuthenticate({ token }: { token: string }) {
  // Token format: "{agentRole}" or "anonymous" (for frontend)
  const user = token || "anonymous";
  const role = user.toLowerCase();

  // For now: all connections allowed (auth enforcement deferred to Feature 5)
  // This step just logs room access for observability
  return { user: role };
},
```

**Phase 0 (this step):** No enforcement — just identity tagging. The prefix convention (`team-memory/`, `agent:role/`, `goalId/`) provides logical isolation but not security.

**Phase 1 (Feature 5):** `onAuthenticate` validates JWT and enforces:
- `agent:coder/*` → only `coder` can write, others read-only
- `team-memory/*` → all agents write
- `_system/*` → agents read, frontend denied

**What breaks: NOTHING.** `onAuthenticate` already returns `{ user: token || "anonymous" }`.

---

## Step 6: Export new modules + update barrel

**File:** `packages/collaboration/src/L2/memory/index.ts` (NEW)
```typescript
export { MemoryScope } from "./MemoryScope.js";
export type { MemoryRecord } from "./MemoryScope.js";
```

**File:** `packages/collaboration/src/index.ts` (UPDATE)
```typescript
// ADD:
export { MemoryScope } from "./L2/memory/index.js";
export type { MemoryRecord } from "./L2/memory/index.js";
export { createTeamMemoryTool } from "./L2/tools/team-memory.js";
export { createPersonalNotesTool } from "./L2/tools/personal-notes.js";
```

---

## Step 7: Tests

**File:** `packages/collaboration/src/__tests__/memory-scope.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { CollabServer } from "@ping/collab-service";
import { MemoryScope } from "../L2/memory/MemoryScope.js";

describe("MemoryScope", () => {
  let server: CollabServer;
  let scope: MemoryScope;
  const storageDir = `./data/test-memory-${Date.now()}`;

  beforeAll(async () => {
    server = new CollabServer(storageDir);
    scope = new MemoryScope(server, "test-team/team-memory", "researcher");
  });

  afterAll(async () => {
    await server.stop();
    const fs = await import("fs/promises");
    await fs.rm(storageDir, { recursive: true, force: true });
  });

  it("should remember and recall", async () => {
    const key = await scope.remember("We chose PostgreSQL", "decisions");
    const results = await scope.recall("PostgreSQL");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toBe("We chose PostgreSQL");
    expect(results[0].scope).toBe("decisions");
  });

  it("should list memories in a scope", async () => {
    await scope.remember("Use TypeScript", "conventions");
    const items = await scope.list("conventions");
    expect(items.length).toBeGreaterThan(0);
  });

  it("should delete a memory", async () => {
    const key = await scope.remember("Temporary note", "knowledge");
    const deleted = await scope.delete(key, "knowledge");
    expect(deleted).toBe(true);
    const results = await scope.recall("Temporary note", { scope: "knowledge" });
    expect(results.length).toBe(0);
  });

  it("should show tree with counts", async () => {
    const tree = await scope.tree();
    expect(tree["decisions"]).toBeGreaterThanOrEqual(1);
    expect(typeof tree["conventions"]).toBe("number");
  });

  it("should isolate agent rooms", async () => {
    const coderScope = new MemoryScope(server, "test-team/agent:coder", "coder");
    await coderScope.remember("My private note", "scratchpad");

    const researcherScope = new MemoryScope(server, "test-team/agent:researcher", "researcher");
    const results = await researcherScope.recall("private note", { scope: "scratchpad" });
    // Researcher's scope doesn't see coder's notes (different room prefix)
    expect(results.length).toBe(0);
  });
});
```

**Verify:**
```bash
cd packages/collaboration && bun test
```

---

## Step 8: Add SKILL.md instructions for agents

Add to the existing collab guide skill so agents know about the new tools:

```markdown
## Team Memory (cross-goal knowledge)

Use `team_memory` to store and retrieve knowledge that persists across goals:
- `team_memory({ action: "remember", content: "We decided to use PostgreSQL", scope: "decisions" })`
- `team_memory({ action: "recall", query: "database" })`
- `team_memory({ action: "tree" })` — see what's stored

Scopes: decisions, conventions, knowledge, lessons-learned

## Personal Notes (your private space)

Use `personal_notes` to keep your own scratchpad:
- `personal_notes({ action: "write", value: "Found 3 relevant papers", section: "scratchpad" })`
- `personal_notes({ action: "read", section: "context" })`
- `personal_notes({ action: "clear", section: "scratchpad" })` — clean up when done
```

---

## Verification Checklist

- [ ] `cd packages/collaboration && bunx tsc --noEmit` — types pass
- [ ] `cd packages/collab-service && bunx tsc --noEmit` — types pass
- [ ] `bun run build:backend` — backend builds
- [ ] `cd packages/collaboration && bun test` — new + existing tests pass
- [ ] `cd packages/collab-service && bun test` — existing 4 tests still pass
- [ ] Start backend → create team → submit goal → agent has `team_memory` + `personal_notes` tools
- [ ] `team_memory({ action: "remember", content: "test" })` → stored
- [ ] `team_memory({ action: "recall", query: "test" })` → returns the stored memory
- [ ] Complete goal → start new goal → `team_memory({ action: "recall" })` → still finds memory from previous goal
- [ ] Two different agent roles → `personal_notes` isolated (coder can't see researcher's notes)

---

## Summary

| Step | What | Risk | Files |
|------|------|------|-------|
| 1 | MemoryScope class | Zero — new file | `memory/MemoryScope.ts` |
| 2 | Agent tools | Zero — new files | `tools/team-memory.ts`, `tools/personal-notes.ts` |
| 3 | L2Plugin methods | Zero — additive | `L2CollaborationPlugin.ts` |
| 4 | Backend wiring | Low — adds tools | `CollaborationPlugin.ts` |
| 5 | Room validation | Zero — logging only | `HocuspocusServer.ts` |
| 6 | Exports | Zero — barrel update | `index.ts` |
| 7 | Tests | Zero | `__tests__/memory-scope.test.ts` |
| 8 | Agent instructions | Zero | SKILL.md |

**Total new code:** ~350 lines  
**Existing code changes:** ~20 lines (2 methods in L2Plugin + tool wiring in CollabPlugin)  
**Risk:** Near-zero — all additive. Existing `collab` tool and `CollaborationSpace` completely untouched.
