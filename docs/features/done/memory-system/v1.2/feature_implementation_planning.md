# v1.2 — Superseded (Merged into v1.1)

> **Status:** This version has been merged into [v1.1 — L2 Team Collaboration](../v1.1/feature_implementation_planning.md).

---

## Why This Changed

The original version structure had:
- v1.0: Foundation (PlanStore, output manifests, Task enhancements)
- v1.1: Agent Workspace (L1)
- v1.2: Collaboration Space (L2)

After reclassifying PlanStore and output manifests as **L2 components** (team-scoped, not shared/foundation), the structure was simplified to:

| Version | Layer | Contents |
|---------|-------|----------|
| **v1.0** | L1: Agent Workspace | GitBranchManager, AgentWorkspace, WorkspaceManager |
| **v1.1** | L2: Team Collaboration | PlanStore, output manifests, CollaborationSpace, Hocuspocus + BlockNote, GroupChat |
| **v2.0** | L3: Knowledge Base | Hierarchical retrieval, LlamaIndex.TS, promotion workflow |

The old v1.2 (Collaboration Space) content — CollaborationSpace, CRDT documents, Hocuspocus, BlockNote, group chat integration — now lives in **v1.1 Phase 2-5**.

See [v1.1/feature_implementation_planning.md](../v1.1/feature_implementation_planning.md) for the complete L2 plan.
