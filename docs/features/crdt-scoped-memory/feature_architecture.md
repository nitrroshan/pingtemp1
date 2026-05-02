# F1: Agent-Scoped Memory — Architecture

**Date:** May 2, 2026  
**Status:** Ready for implementation planning  
**Priority:** P0 — First CRDT feature to implement  
**Depends on:** F0 Infrastructure (done — `packages/collab-service/`)  
**Feature List:** [CRDT-FEATURE-LIST.md](../CRDT-FEATURE-LIST.md) → Feature 1  
**Research:** [crdt-team-memory/research.md](../crdt-team-memory/research.md) (2552 lines)

---

## Problem

All agents write to the same CRDT docs under `{teamId}/{goalId}/`. No personal space. No team-level persistence. Knowledge dies when the goal ends.

## Goal

Each agent has its own CRDT room (read/write/delete). Team has a shared memory room. Current goal-scoped functionality preserved. No auth complexity — just room isolation via doc name prefixes.

## Architecture

### Room Structure

```
{teamId}/team-memory                    — Shared team knowledge (NEW)
  └─ Y.Map("decisions")                  Decision log (cross-goal)
  └─ Y.Map("conventions")                Team coding conventions
  └─ Y.Map("knowledge")                  Accumulated domain knowledge
  └─ Y.Map("lessons-learned")            Past mistakes, what worked

{teamId}/agent:{role}                   — Agent personal space (NEW)
  └─ Y.Map("scratchpad")                 Working notes, drafts
  └─ Y.Map("context")                    Accumulated task context
  └─ Y.Map("task-history")               Completed task summaries

{teamId}/{goalId}/                      — Goal-scoped work (EXISTING, unchanged)
  └─ plan, tasks, discussion, etc.
```

### Room Isolation (No Auth Required)

Room isolation via doc name prefix checking in `onAuthenticate`:

```typescript
// Agent "coder" connecting to doc "{teamId}/agent:coder/scratchpad"
// → allowed (own room)

// Agent "coder" connecting to doc "{teamId}/agent:researcher/context"
// → allowed read-only (other agent's room)

// Agent "coder" connecting to doc "{teamId}/team-memory/decisions"
// → allowed read+write (shared team room)
```

Implementation: `onAuthenticate` checks the doc name prefix against the connecting agent's role. No JWT, no tokens — just string prefix matching. Auth (Feature 5) adds proper tokens later.

### Agent Tools

```typescript
// Team knowledge tool
tool({ name: "team_memory", inputSchema: z.object({
  action: z.enum(["remember", "recall", "list", "delete", "tree"]),
  content: z.string().optional(),
  query: z.string().optional(),
  scope: z.enum(["decisions", "conventions", "knowledge", "lessons-learned"]).optional(),
  key: z.string().optional(),       // for delete
})});

// Personal notes tool
tool({ name: "personal_notes", inputSchema: z.object({
  action: z.enum(["write", "read", "delete", "list", "clear"]),
  key: z.string().optional(),
  value: z.any().optional(),
  section: z.enum(["scratchpad", "context", "task-history"]).optional(),
})});
```

### remember() and recall()

```typescript
class MemoryScope {
  constructor(private provider: ICollabProvider, private roomPrefix: string) {}

  async remember(content: string, scope?: string): Promise<void> {
    const doc = await this.provider.openDoc(`${this.roomPrefix}/${scope || "knowledge"}`);
    const map = doc.getMap(scope || "knowledge");
    const key = `mem-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    map.set(key, {
      content,
      createdAt: new Date().toISOString(),
      source: this.agentRole,
    });
  }

  async recall(query: string, options?: { limit?: number }): Promise<MemoryRecord[]> {
    // Phase 0: simple substring match on all entries in scope
    // Phase 1 (Feature 3): use Orama BM25 search
    const entries = await this.listAll();
    return entries
      .filter(e => e.content.toLowerCase().includes(query.toLowerCase()))
      .slice(0, options?.limit ?? 10);
  }

  async delete(key: string, scope?: string): Promise<void> {
    const doc = await this.provider.openDoc(`${this.roomPrefix}/${scope || "knowledge"}`);
    const map = doc.getMap(scope || "knowledge");
    map.delete(key);
  }
}
```

### How This Connects to Existing Code

```
CollaborationSpace (existing)          MemoryScope (new)
  prefix: {teamId}/{goalId}/            prefix: {teamId}/team-memory/
  openDoc("plan") → goal doc            openDoc("decisions") → team doc
  Used by: CrdtTaskSync, PlanStore      Used by: team_memory tool, personal_notes tool
```

Both use the same `ICollabProvider` (CollabServer). No new infrastructure. Just new doc prefixes.

## Implementation Location

```
packages/collaboration/src/L2/
  memory/                               ← NEW directory
    MemoryScope.ts                      — remember(), recall(), list(), delete(), tree()
    AgentMemoryRoom.ts                  — opens/manages agent:{role} room
    TeamMemoryRoom.ts                   — opens/manages team-memory room
  tools/
    team-memory.ts                      — team_memory tool for agents
    personal-notes.ts                   — personal_notes tool for agents
packages/collab-service/src/
  server/HocuspocusServer.ts            — add room prefix validation in onAuthenticate
```

## What This Feature Does NOT Include

- JWT/token authentication → Feature 5 (crdt-auth)
- Orama search for recall → Feature 3 (crdt-search). Phase 0 uses substring match.
- Memory consolidation/dedup → Feature 4 (crdt-consolidation)
- Goal archival/cleanup → Feature 2 (crdt-goal-lifecycle)
- Multi-tenant isolation → Feature 5 (crdt-auth)

## Effort

~300 lines code + ~50 lines tool definitions
