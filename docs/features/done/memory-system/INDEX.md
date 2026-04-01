# Memory System — Documentation Index

> Complete documentation for the 3-layer memory architecture

---

## Quick Start

**Conceptual Overview:** Read [agent_memory_system.md](../../ping/agent_memory_system.md) first — explains the 3-layer model with human analogies.

**Technical Architecture:** [feature_architecture.md](./feature_architecture.md) — detailed interfaces, schemas, data flows.

---

## Layer Summary

| Layer | Purpose | Lifetime | Storage |
|-------|---------|----------|---------|
| **L1: Task Memory** | Agent working memory during task | Task duration | Git branch + checkpoint |
| **L2: Team Memory** | Shared artifacts, real-time docs, binaries | Project duration | Hocuspocus (CRDT persistence, S3/filesystem via Database extension) |
| **L3: Org Memory** | Permanent knowledge base | Forever | MongoDB Atlas Vector Search (index) + Git (content) |

---

## Documentation Structure

```
docs/features/memory-system/
├── INDEX.md                         ← You are here
├── feature_architecture.md          ← Technical architecture (all layers)
├── AGENT_WORKSPACE_RESEARCH.md      ← Research: scratchpad, toolbelt, visibility
├── PERSISTENCE_STRATEGY.md          ← Session recovery, storage backends
├── WORKER_INTEGRATION.md            ← AgentManager/WorkerPool integration
│
├── v1.0/
│   └── feature_implementation_planning.md  ← L1: Agent Workspace (Git branches)
│
├── v1.1/
│   └── feature_implementation_planning.md  ← L2: Team Collaboration (PlanStore, output manifests, Hocuspocus CRDT, shared binaries)
│
├── v1.2/
│   └── feature_implementation_planning.md  ← ⚠️ Superseded (merged into v1.1)
│
└── v2.0/
    └── feature_implementation_planning.md  ← L3: Knowledge Base (retrieval)
```

---

## Implementation Roadmap

| Version | Focus | Duration | Key Deliverables |
|---------|-------|----------|------------------|
| **v1.0** | L1: Agent Workspace | 1 week | GitBranchManager, AgentWorkspace, WorkspaceManager |
| **v1.1** | L2: Team Collaboration | 2 weeks | PlanStore (move), output manifests, CollaborationSpace, Hocuspocus + BlockNote, GroupChat |
| **v2.0** | L3: Org Memory | 2 weeks | Hierarchical retrieval (LlamaIndex.TS), Promotion workflow, Project docs |

**Total Estimated:** ~5 weeks

---

## Key Integration Points

### Current Code (What Exists)

| File | Layer | Status |
|------|-------|--------|
| `src/worker/memoryManager/MemoryManager.ts` | Task state (L1) | ✅ Working (in-memory) |
| `src/worker/orchestrator/FilePlanStore.ts` | L2 (to move) | ✅ Working — moves to `memory/collaboration/` |
| `src/worker/orchestrator/ArtifactRegistry.ts` | L2 (to delete) | ❗ In-memory only — replaced by git-based output manifests (`.ping/outputs/`) |
| `src/worker/memory/` | All | ❌ Not yet implemented (empty subfolders exist, no source files) |

### Entry Points

```typescript
// AgentManager creates MemoryCoordinator
await agentManager.initializeOrchestrator(teamId, roles);

// Workers access via MemoryCoordinator
const context = await memoryCoordinator.getTaskContext(taskId);

// Knowledge retrieval
const knowledge = await memoryCoordinator.knowledge?.getForTask(taskContext);
```

---

## Related Documents

| Document | Location |
|----------|----------|
| Conceptual Model | [agent_memory_system.md](../../ping/agent_memory_system.md) |
| Organizational Knowledge Layer | [organizational-knowledge-layer.md](../../product/ideas/organizational-knowledge-layer.md) |
| Real-Time Collaboration | [realtime-collaboration.md](../../ping/realtime-collaboration.md) |
| Artifact Output Strategy | [artifact-output-strategy.md](../../ping/artifact-output-strategy.md) |
| Group Chat Architecture | [group-chat-architecture.md](../../ping/group-chat-architecture.md) |

---

## Dependencies

```json
{
  "L1 (v1.0)": {
    "simple-git": "Git branch operations (already installed)"
  },
  "L2 (v1.1)": {
    "yjs": "CRDT library",
    "y-protocols": "Yjs sync protocols",
    "@hocuspocus/server": "Hocuspocus Yjs backend (embedded in Node.js)",
    "@hocuspocus/extension-database": "Custom persistence (S3/filesystem fetch/store)",
    "@hocuspocus/provider": "Frontend WebSocket provider",
    "@blocknote/react": "Block editor (frontend)",
    "@blocknote/core": "Block editor core"
  },
  "L3 (v2.0)": {
    "llamaindex": "Hierarchical RAG retrieval engine"
  }
}
```

---

## Next Steps

1. **v1.0 — L1 Agent Workspace** — Git-based isolation, rollback capability (1 week)
2. **v1.1 — L2 Team Collaboration** — Move PlanStore, delete ArtifactRegistry, CollaborationSpace, Hocuspocus + BlockNote, CRDT docs (2 weeks)
3. **v2.0 — L3 Knowledge Base** — Hierarchical retrieval via LlamaIndex.TS (defer until L1+L2 stable)
