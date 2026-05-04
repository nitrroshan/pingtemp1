# Communication Layer Refactor — Implementation Tracking

> **Architecture:** [feature_architecture.md](./feature_architecture.md) — three-layer fix  
> **Delivery:** v1.0 (superseded) → v2.0 (active) → v3.0 (not started)

## Version Status

| Version | Layer | Status | Summary |
|---------|-------|--------|---------|
| [v1.0](./v1.0/) | Patches | Superseded | GoalCoordinator, shared types, authFetch. All v1 files deleted — v2 is the active path. |
| [v2.0](./v2.0/) | GoalSessionStore | **Complete** | Unified store. All goal transitions via switchGoal()/newGoal()/clearGoal(). All state emissions goal-scoped. |
| v2.5 | Goal-centric frontend | **Complete** | goalId-only identity, `/g/{goalId}` URLs, server auto-joins goal room, getState(goalId) replay, pending-plan goal-scoped. |
| [v3.0](./v3.0/) | Backend persistence | Planned | Database as single source of truth for workflow state. CRDT for collaborative content only. File stores eliminated. |

## Key Decisions

- **May 1, 2026:** v1.0 reviewed — GoalCoordinator is a patch, not a fix. 5 review issues found and patched, but root cause (7 independent state locations) remains. Proceeded to v2.0.
- **May 1, 2026:** v2.0 implemented — goalSessionStore replaces chatStore + orchestrationStore + GoalCoordinator. Multiple review rounds identified and fixed: URL restore race, planner chat key routing, worker message key mismatch, goal-scoped state updates, cross-team goal submission, DetailPanel goalId, shared type contract drift, sessionStorage removal, uiStore cleanup, pending-plan goalId.
- **Architecture:** Three-layer approach — frontend unified store → backend persistence → server-owned sessions.
