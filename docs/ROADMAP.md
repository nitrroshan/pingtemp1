# Platform Roadmap

**Last updated:** May 2, 2026  
**Goal:** Multiple users, each with multiple goals across multiple teams, with isolation, server deployment, and full state resume.

---

## Build Order

```
PHASE 0: Stabilize                     ← Fix what's broken
   ↓
PHASE 1: Goal Isolation                ← Goals stop contaminating each other
   ↓
PHASE 2: Persistence                   ← Close browser, come back, everything's there
   ↓
PHASE 3: Redis + BullMQ               ← Parallel execution, crash isolation, multi-server
   ↓
PHASE 4: Workspace + Frontend + Chat   ← Complete parallel goals experience
   ↓
PHASE 5: Multi-User                    ← Multiple users with authorization + quotas
   ↓
PHASE 6: Scale + Ecosystem             ← Production hardening, advanced features
```

---

## PHASE 0 — Stabilize (2-3 weeks)

Fix blocking issues before building new things. No new features.

| Feature | What | Effort |
|---|---|---|
| [stabilization-sprint](features/stabilization-sprint/) | Fix 20+ blocking issues (worktree bugs, frontend state, security holes) | 2w |
| [auth-security](features/auth-security/) Phase 1 | Enforce auth on all HTTP + Socket.IO routes — unauthenticated requests rejected | 1w |
| [server-goalid](features/server-goalid/) | Generate goalId server-side to prevent duplicate/collision bugs | 2d |
| [identity-simplification](features/identity-simplification/) | Replace 300-line IdentityCard class with `.ping/identity.json` | 2d |

**Entry:** Platform works but has known bugs and security gaps.  
**Exit:** Auth enforced, no crashing bugs, goalId generated server-side.

---

## PHASE 1 — Goal Isolation + Cleanup (3-4 weeks)

Make the codebase ready for multiple goals. Fix contamination, extract managers, clean up state management.

| Feature | What | Effort |
|---|---|---|
| [goal-isolation](features/goal-isolation/) | Fix 31 contamination violations — every operation carries explicit `goalId`, no `activeGoalId` fallbacks | 1-2w |
| [goal-manager](features/goal-manager/) | Extract goal lifecycle from OrchestratorService into standalone GoalManager (SRP) | 1w |
| [goal-scoped-sessions](features/goal-scoped-sessions/) | Broadcast goal-specific streams/tasks instead of team-wide | 3d |
| [xml-prompt-extraction](features/xml-prompt-extraction/) | Move hardcoded prompts to external XML files (consistent with planner pattern) | 3d |
| [config-revision](features/config-revision/) | Clean up agent/team config types | 2d |

**Entry:** Goals contaminate each other. GoalManager is tangled inside OrchestratorService.  
**Exit:** Goals are fully isolated. GoalManager is a clean standalone class. Ready for persistence.

---

## PHASE 2 — Persistence (3-4 weeks)

Move all state from in-memory to MongoDB. This is the foundation for resume, parallel goals, and multi-user.

| Feature | What | Effort |
|---|---|---|
| [data-persistence](features/data-persistence/) | GoalContext → MongoDB `goals`, TaskStore → MongoDB `tasks`, PlanStore → MongoDB `plans` | 2w |
| [task-status-restore](features/task-status-restore/) | Detect and re-dispatch orphaned `in_progress` tasks after restart | 3d |
| [conversation-persistence](features/conversation-persistence/) v1.1 | Goal-scoped conversations, improved session restore | 1w |
| [cost-tracking](features/cost-tracking/) | Track tokens/costs per agent per goal in MongoDB | 3d |

**Entry:** All state in-memory. Server restart = everything lost.  
**Exit:** Close browser, come back days later, every goal is exactly where you left it. Single server still.

---

## PHASE 3 — Redis + BullMQ (3-4 weeks)

Replace in-process execution with job queues. Enables parallel goals, crash isolation, and multi-server deployment.

| Feature | What | Effort |
|---|---|---|
| [redis-infrastructure](features/redis-infrastructure/) | Redis setup, Socket.IO adapter for multi-server pub/sub | 1w |
| BullMQ task dispatch | Replace `WorkerPool.executeTask()` with BullMQ jobs, worker processes pull and execute | 2w |
| [communication-layer-refactor](features/communication-layer-refactor/) v3.0 | Unify state sources, Redis-based streaming pipeline (worker → Redis → Socket.IO) | 1w |
| [dev-prod-setup](features/dev-prod-setup/) | Docker Compose (Redis + MongoDB + web + workers), env validation | 3d |

**Entry:** Single server, single process, direct function calls for execution.  
**Exit:** Stateless web servers behind load balancer. Stateless worker processes pull BullMQ jobs. Crash isolation — one goal crashing doesn't affect others. True parallel execution.

---

## PHASE 4 — Workspace + Frontend + Chat (3-4 weeks)

Complete the parallel goals experience with workspace safety, goal-first UI, and ChatAgents.

| Feature | What | Effort |
|---|---|---|
| [workspace-isolation](features/workspace-isolation/) | Per-task git clones/worktrees — two goals can't corrupt each other's files | 2w |
| [frontend-redesign-goal-first](features/frontend-redesign-goal-first/) | Goal-centric UI: goal list, plan viewer, task dashboard, goal switching | 1-2w |
| [frontend-state-refactor](features/frontend-state-refactor/) | Reduce 100+ useState/useRef into proper state machine | 1w |
| [chat-agent-layer](features/chat-agent-layer/) | Persistent per-role ChatAgents — user asks "how's the API going?" and gets real answers | 1-2w |
| [approval-system](features/approval-system/) | Structured plan approval workflow with per-agent execution control | 3d |

**Entry:** Parallel goals work but share workspace (file conflicts). Frontend is team-centric, not goal-centric.  
**Exit:** Full parallel goals experience. Users manage multiple goals, switch between them, chat with agents, approve plans. No file conflicts.

---

## PHASE 5 — Multi-User (5 weeks)

Add user identity, team membership, authorization, and per-user quotas on top of the parallel goals infrastructure.

| Feature | What | Effort |
|---|---|---|
| [multi-user](features/multi-user/) Phase 1 | Add `userId` to GoalContext in MongoDB — goal ownership | 1w |
| [multi-user](features/multi-user/) Phase 2 | TeamMembership collection (M:N users↔teams, roles: owner/admin/member/viewer) | 1w |
| [multi-user](features/multi-user/) Phase 3 | Goal authorization — users see only their own goals, team admins see all | 1w |
| [multi-user](features/multi-user/) Phase 4 | Per-user resource quotas (max goals, max workers, LLM token budget) | 1w |
| [multi-user](features/multi-user/) Phase 5 | User dashboard — all goals across all teams for logged-in user | 1w |

**Entry:** Platform supports parallel goals with persistence, but any user can see/control any goal.  
**Exit:** Multiple users, each with their own goals across shared teams. Full isolation, resume, and authorization. Production-ready multi-user platform.

---

## PHASE 6 — Scale + Ecosystem (ongoing)

Production hardening and advanced features. Not sequenced — build based on demand.

| Feature | What | Priority |
|---|---|---|
| [production-grade](features/production-grade/) | Unified logging, feature flags, monitoring, deployment scripts | High |
| [worker-sandboxing](features/worker-sandboxing/) | Container-level agent isolation (Docker/Firecracker per task) | Medium |
| [external-agent-invocation](features/external-agent-invocation/) | Call agents in other teams/orgs via IWorker interface | Medium |
| [tools-as-mcp](features/tools-as-mcp/) | Expose agent tools as MCP servers for external consumption | Medium |
| [plugin-taxonomy](features/plugin-taxonomy/) | Clean, extensible plugin model with SOLID lifecycle hooks | Medium |
| [git-task-context](features/git-task-context/) | Per-team git repo, branch-per-task, task context from git history | Medium |
| [team-stacking](features/team-stacking/) | Compose teams hierarchically (team of teams) | Low |
| [skills-integration](features/skills-integration/) | Live skill refresh, skill marketplace | Low |
| [cli-system](features/cli-system/) | CLI interface for headless goal submission | Low |
| [local-first-desktop](features/local-first-desktop/) | Electron/Tauri desktop app with local-first CRDT sync | Low |
| [persistent-agents](features/persistent-agents/) | Always-on agents that monitor repos and act autonomously | Future |
| [evolving-agent](features/evolving-agent/) | Agents that learn and improve from task outcomes | Future |
| [post-task-learning](features/post-task-learning/) | Agents write learnings after task completion for future reference | Future |

---

## Features Superseded or Absorbed

These don't need separate implementation — they're covered by the phases above.

| Feature | Absorbed Into | Why |
|---|---|---|
| parallel-plans v1.0/v2.0/v3.0 | Phases 1-4 | Parallel goals doc now owns the phased plan |
| process-isolation | Phase 3 (BullMQ workers) | BullMQ gives process isolation by design |
| data-persistence (CRDT-primary model) | Phase 2 (MongoDB) | MongoDB is primary store, not CRDT |
| browser-auth | Phase 0 (auth-security) | Already uses better-auth with cookie sessions |
| agent-worker-migration | Phase 4 (chat-agent-layer) | Chat agent layer unifies the agent hierarchy |
| seed-data | Phase 3 (dev-prod-setup) | Seeding included in dev setup |
| task-state-persistence | Phase 2 (data-persistence) | Tasks persisted as part of MongoDB migration |
| crdt-* (8 features) | Deferred | CRDT is supplementary storage, not primary |
| goal-scoped-sessions | Phase 1 (goal-isolation) | Scoped broadcasts included in isolation work |
| worker-architecture | Phase 4 (chat-agent-layer) | Three-layer model implemented via ChatAgents |
| persistent-agents | Phase 6 | Requires multi-user + production grade first |

---

## Timeline

```
         Month 1          Month 2          Month 3          Month 4          Month 5
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │  PHASE 0     │ │  PHASE 2     │ │  PHASE 3     │ │  PHASE 4     │ │  PHASE 5     │
    │  Stabilize   │ │  Persistence │ │  Redis+Bull  │ │  Workspace   │ │  Multi-User  │
    │  (2-3w)      │ │  (3-4w)      │ │  (3-4w)      │ │  +Frontend   │ │  (5w)        │
    │              │ │              │ │              │ │  +Chat (3-4w)│ │              │
    │  PHASE 1     │ │              │ │              │ │              │ │              │
    │  Isolation   │ │              │ │              │ │              │ │              │
    │  (3-4w)      │ │              │ │              │ │              │ │              │
    └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
                                                                              ↓
                                                                        PHASE 6
                                                                        Scale +
                                                                        Ecosystem
                                                                        (ongoing)

Milestones:
  End of Month 1:  Goals isolated, platform stable
  End of Month 2:  Resume works (close browser, come back)
  End of Month 3:  Parallel goals with crash isolation
  End of Month 4:  Full parallel goals UX (workspace + frontend + chat)
  End of Month 5:  Multi-user production-ready
```

---

## Key Architecture Docs

| Doc | Covers |
|---|---|
| [parallel-goals/feature_architecture.md](features/parallel-goals/feature_architecture.md) | Phases 1-4 execution model (MongoDB, BullMQ, Redis, workspace isolation) |
| [multi-user/feature_architecture.md](features/multi-user/feature_architecture.md) | Phase 5 user model (userId, TeamMembership, authorization, quotas) |
| [process-isolation/feature_architecture.md](features/process-isolation/feature_architecture.md) | Reference: worker_threads vs fork vs BullMQ comparison (superseded by Phase 3) |
| [goal-isolation/feature_architecture.md](features/goal-isolation/feature_architecture.md) | Phase 1 contamination analysis (31 violations, fix plan) |
| [auth-security/feature_architecture.md](features/auth-security/feature_architecture.md) | Phase 0 security audit (16 vulnerabilities, 3-layer fix) |
| [data-persistence/feature_architecture.md](features/data-persistence/feature_architecture.md) | Phase 2 persistence model (historical CRDT design — superseded by MongoDB-primary) |
