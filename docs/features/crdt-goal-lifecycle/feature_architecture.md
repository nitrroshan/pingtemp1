# F2: Goal Lifecycle (Archive + Stale Cleanup) — Architecture

**Date:** May 2, 2026  
**Status:** Research complete, ready for implementation planning  
**Priority:** P0 — Ships with Feature 1  
**Depends on:** Feature 1 (crdt-scoped-memory)  
**Feature List:** [CRDT-FEATURE-LIST.md](../CRDT-FEATURE-LIST.md) → Feature 2

---

## Problem

Completed goal docs stay in Hocuspocus memory forever. After 50 goals, you have 50 sets of plan/tasks/discussion consuming RAM. No archival, no cleanup, no way to remove stale data. Agents can't forget outdated information.

## Goal

Completed goals are archived to cold storage. Key learnings are extracted to team-memory before eviction. Stale memories decay in recall ranking. Agents can explicitly delete memories they no longer need.

## Architecture

### Goal Completion Pipeline

When a goal transitions to `completed` or `failed`:

```
1. Extract learnings (LLM)
   → "We decided to use PostgreSQL" (decision)
   → "React component tests run slowly — use vitest" (lesson)
   → "API endpoint: POST /users" (knowledge)

2. Store in team-memory room
   → team-memory/decisions: { content, goalId, source: "goal-archival" }
   → team-memory/lessons-learned: { content, goalId, source: "goal-archival" }

3. Snapshot goal room to cold storage
   → Y.encodeStateAsUpdate(doc) → data/collab/archive/{teamId}/{goalId}.bin

4. Evict goal room from Hocuspocus memory
   → server.hocuspocus.documents.delete(docName) for all goal docs
```

### LLM Extraction (extract_memories pattern from CrewAI)

```typescript
async function extractLearnings(goalDocs: Y.Doc[]): Promise<Learning[]> {
  // Collect all text from plan, tasks, discussion, outputs
  const content = goalDocs.map(extractText).join("\n---\n");
  
  // LLM breaks into atomic facts
  const result = await generateText({
    model: provider,
    prompt: `Extract key learnings from this completed goal. 
             Return as JSON array of { content, type: "decision"|"lesson"|"knowledge" }.
             Only include reusable cross-goal knowledge. Skip task-specific details.`,
    messages: [{ role: "user", content }],
  });
  
  return JSON.parse(result.text);
}
```

### Recency Decay (CrewAI pattern)

Memories don't get deleted automatically — they decay in ranking:

```typescript
function recencyScore(createdAt: Date, halfLifeDays: number = 30): number {
  const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / halfLifeDays);
  // 1.0 today, 0.5 at 30 days, 0.25 at 60 days, 0.125 at 90 days
}

// recall() uses: relevanceScore * 0.7 + recencyScore * 0.3
```

Old memories are still findable but rank lower. Agents naturally see recent knowledge first.

### Explicit Forget

Agents can delete memories they know are outdated:

```typescript
// Delete specific memory
team_memory({ action: "delete", key: "mem-1714567890-a1b2c3d4" })

// Delete all memories in a scope
team_memory({ action: "forget", scope: "lessons-learned" })

// Clear personal notes
personal_notes({ action: "clear" })
```

### Cold Storage

Goal snapshots persist on disk for potential future retrieval:

```
data/collab/archive/
  {teamId}/
    {goalId}.bin                    — Y.encodeStateAsUpdate() binary
    {goalId}.meta.json              — { goal, status, completedAt, taskCount, learningsExtracted }
```

Snapshots can be restored with `Y.applyUpdate(doc, readFileSync(path))` if needed.

### When Archival Runs

- **Trigger:** GoalManager emits `goal:completed` or `goal:failed` event
- **Where:** Hook in `AgentManagerV2.ts` or `GoalManager.ts` goal lifecycle
- **Async:** Archival runs in background — doesn't block goal completion response
- **Retry:** If LLM extraction fails, snapshot is still saved (learnings = 0, but no data loss)

## Industry Patterns

| Pattern | Source | Our Implementation |
|---------|--------|-------------------|
| `extract_memories(output)` | CrewAI | LLM breaks goal output into atomic facts |
| `memory.forget(scope)` | CrewAI | `team_memory({ action: "forget", scope })` |
| `recency_half_life_days` | CrewAI | Exponential decay in recall ranking |
| `DELETE /rooms/{roomId}` | Liveblocks | Evict goal docs from Hocuspocus after archival |
| `Y.encodeStateAsUpdate()` | Y.js | Binary snapshot to cold storage |

## Implementation Location

```
packages/collaboration/src/L2/
  memory/
    GoalArchiver.ts                 — extract learnings + snapshot + evict
    MemoryDecay.ts                  — recency scoring for recall results
packages/collab-service/src/
  server/RoomManager.ts             — evictRoom(), archiveRoom(), restoreRoom()
packages/backend/
  agentManager/AgentManagerV2.ts    — hook goal completion → trigger archival
```

## What This Feature Does NOT Include

- Automatic TTL-based deletion (too risky — let agents decide)
- Vector-based semantic dedup (Feature 4)
- Version history of archived goals (Feature 6)
- Scheduled batch cleanup jobs (future — manual trigger first)

## Effort

~200 lines code (GoalArchiver ~120, MemoryDecay ~30, RoomManager additions ~50)
