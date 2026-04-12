# Service Layer Refactoring -- Architecture

**Status:** Planned
**Date:** April 12, 2026
**Related:** [Conversation Persistence](../conversation-persistence/feature_architecture.md), [Team Registry](../team-registry/feature_architecture.md)

---

## Problem

The service layer has accumulated technical debt from the plugin migration:

1. **Plugin logic leaked into route handlers** -- `agentManagerHandlerV2.ts` has `if (team.pluginName)` branching in 3 endpoints (GET teams, GET agents, GET teams list)
2. **Dead services** -- `FileAgentService`, `FileSkillService`, `FileAgentSkillService` store nothing (agents/skills come from plugin .md files)
3. **Duplicate agent loading** -- `AgentManagerRegistry.loadTeam()` and `agentManagerHandlerV2.ts` both independently load plugins
4. **ServiceRegistry has 7 services** -- only 3 are actually used (teams, chat, goals)
5. **`loadPluginByName()` helper** duplicated across files with `__dirname` path hacks
6. **Two separate service interfaces** for the same data: `IAgentService` (DB) vs `PluginLoader` (files)
7. **`ITeamService.getTeam()` returns `Team`** but route handler casts `(team as any).pluginName` -- type doesn't match reality

---

## Research: What We Actually Use

### Services that are ALIVE:

| Service | Used by | Storage |
|---------|---------|---------|
| `teams` (ITeamService) | Route handler, auto-register, startup | `teams.json` (lowdb) |
| `chat` (IChatService) | SocketServerV2, message persistence | JSONL (local) / MongoDB (cloud) |
| `goals` (IGoalService) | HttpServer goals endpoint, session restore | `goals/` (lowdb) |

### Services that are DEAD:

| Service | Why dead | What replaced it |
|---------|----------|-----------------|
| `agents` (IAgentService) | `agents.json` doesn't exist | Plugin .md files via PluginLoader |
| `skills` (ISkillService) | Skills come from SKILL.md in plugins | Plugin .md files via PluginLoader |
| `agentSkills` (IAgentSkillService) | Skills assigned in agent frontmatter `defaultSkills` | Agent .md frontmatter |
| `members` (IMemberService) | Never called from any route or runtime code | Nothing (unused feature) |

### Code path that is DEPRECATED:

| Code | Why deprecated | What replaces it |
|------|---------------|-----------------|
| LLM role discovery (`POST /teams` without `pluginName`) | Creates temp AgentManager, calls LLM to hallucinate roles, writes to `agents` DB | Meta-team (v1.1) discovers EXISTING tested agents from registry and composes new plugin |
| `AgentManager.getRoles()` / `configureNewWorkflow()` | Only used by legacy team creation | Meta-team's Agent Builder + Team Builder |
| `services.agents.addAgent()` in route handler | Writes LLM-discovered roles to DB that nothing reads | Plugin .md files (no DB writes needed) |

---

## Design: Clean Service Layer

### Principle: PluginLoader IS the file service. No separate DB layer for definitions.

```
Before (over-engineered):
  ServiceRegistry
  ├── FileTeamService (lowdb teams.json)        ← redundant, PluginLoader does this
  ├── FileAgentService (lowdb agents.json)      ← dead, agents.json doesn't exist
  ├── FileSkillService (lowdb skills.json)      ← dead, skills come from SKILL.md
  ├── FileAgentSkillService (lowdb)             ← dead
  ├── FileMemberService (lowdb)                 ← dead
  ├── FileChatService (JSONL)                   ← ALIVE (runtime data)
  └── FileGoalService (lowdb)                   ← ALIVE (runtime data)

After (clean):
  ServiceRegistry
  ├── plugins: PluginLoader                     ← teams + agents + skills (read from .md)
  ├── teamStore: TeamStore                      ← team records with pluginName (simple JSON)
  ├── conversations: IConversationService       ← chat persistence (JSONL / MongoDB)
  └── goals: IGoalService                       ← goal tracking (JSONL)
```

### Why PluginLoader replaces 3 services:

| Old service | What it did | PluginLoader equivalent |
|-------------|------------|------------------------|
| `FileTeamService.listTeams()` | Read `teams.json` | `pluginLoader.getPluginManifests()` |
| `FileTeamService.getTeam(id)` | Find team by ID | `teamStore.get(id)` (simple Map/JSON) |
| `FileAgentService.getTeamAgents(teamId)` | Read `agents.json` (empty) | `pluginLoader.loadPlugin(name).agents` |
| `FileSkillService.getAllSkills()` | Read `skills.json` (empty) | `pluginLoader.loadPlugin(name).skills` |

### TeamStore (replaces FileTeamService)

The only thing `teams.json` stores that PluginLoader doesn't have is:
- `id` (UUID assigned at registration)
- `pluginName` (which plugin folder)
- `ownerId`, `workspaceId` (runtime metadata)

This is just a simple key-value store, not a full service:

```typescript
interface TeamStore {
  register(pluginName: string): Promise<TeamRecord>;
  get(teamId: string): Promise<TeamRecord | null>;
  list(): Promise<TeamRecord[]>;
  remove(teamId: string): Promise<void>;
}

interface TeamRecord {
  id: string;
  pluginName: string;
  ownerId: string;
  workspaceId: string;
  createdAt: string;
}
```

Implementation: simple JSON file (`data/teams.json`) or even just scan plugin folders on startup.

---

## Implementation Plan

Based on code inventory (25+ call sites audited, every consumer mapped):

### Phase 1: Fix types + move agent resolution (safe, no behavior change)

**Step 1.1: Fix Team type** (5 min)
- `pluginName?: string` is already on `Team` type
- Remove all 8 `(team as any).pluginName` casts in:
  - `agentManagerHandlerV2.ts` (lines 188, 190, 203, 273, 275, 288)
  - `AgentManagerRegistry.ts` (lines 103, 104)
- Fix `(a as any).goal` cast in handler (line 301) -- add `goal` to response type

**Step 1.2: Add `getTeamAgents()` to ITeamService** (30 min)
- Add method to `ITeamService` contract
- `FileTeamService` implementation:
  ```typescript
  async getTeamAgents(teamId: string): Promise<AgentInfo[]> {
    const team = await this.getTeam(teamId);
    if (!team) return [];
    if (team.pluginName) {
      const plugin = await this.pluginLoader.loadPlugin(team.pluginName);
      return plugin.agents.map(a => ({ id: a.id, name: a.name, role: a.role, description: a.description ?? "" }));
    }
    // Legacy: read from agents.json (FileAgentService)
    return []; // or delegate to FileAgentService internally
  }
  ```
- `FileTeamService` receives `PluginLoader` instance via constructor

**Step 1.3: Inject PluginLoader at startup** (15 min)
- Create single `PluginLoader` instance in `createServiceRegistry()`
- Pass to `FileTeamService` constructor
- Remove `loadPluginByName()` from `agentManagerHandlerV2.ts`
- Remove PluginLoader imports from handler

**Step 1.4: Clean route handler** (20 min)
- `GET /teams/:id/agents`: replace 40 lines with `services.teams.getTeamAgents(teamId)`
- `GET /teams`: replace plugin member count logic with `services.teams.getTeamAgents(t.id).length`
- `GET /teams/:id`: use `services.teams.getTeamAgents(teamId).length` for memberCount
- `DELETE /teams/:id`: call `services.teams.deleteTeam(teamId)` only (no agent cleanup needed for plugin teams)

### Phase 2: Remove dead services + deprecate LLM discovery (safe, no consumers)

**Step 2.1: Remove LLM role discovery from POST /teams** (15 min)
- Remove the entire `// Legacy: LLM role discovery` branch from `POST /teams`
- `POST /teams` now REQUIRES `pluginName` -- no more temp AgentManager, no LLM call
- Remove `AgentManager` import from `agentManagerHandlerV2.ts`
- Remove `services.agents.addAgent()` calls from handler
- Frontend already has plugin selector dropdown -- this is the only path now

**Step 2.2: Delete unused service contracts** (10 min)
- `services/contracts/IAgentService.ts`
- `services/contracts/ISkillService.ts`
- `services/contracts/IAgentSkillService.ts`
- `services/contracts/IMemberService.ts`
- Update `services/contracts/index.ts` barrel export

**Step 2.2: Delete unused service implementations** (10 min)
- File: `FileAgentService.ts`, `FileSkillService.ts`, `FileAgentSkillService.ts`, `FileMemberService.ts`
- Mongo: `MongoAgentService.ts`, `MongoSkillService.ts`, `MongoAgentSkillService.ts`, `MongoMemberService.ts`
- Update `services/file/index.ts` and `services/mongo/index.ts` barrel exports

**Step 2.3: Delete unused type definitions** (5 min)
- `services/types/Agent.ts` (replaced by `AgentInfo` in ITeamService)
- `services/types/Skill.ts`
- `services/types/AgentSkill.ts`
- `services/types/TeamMember.ts`
- Update `services/types/index.ts` barrel export

**Step 2.4: Slim ServiceRegistry** (10 min)
```typescript
// Before: 7 services
interface ServiceRegistry {
  teams, agents, skills, agentSkills, chat, goals, members, mode
}

// After: 3 services
interface ServiceRegistry {
  teams: ITeamService;
  chat: IChatService;     // → IConversationService in Phase 3
  goals: IGoalService;
  mode: "file" | "hybrid";
}
```
- Remove `agents`, `skills`, `agentSkills`, `members` from `createServiceRegistry()`
- Remove init calls for deleted services

### Phase 3: Conversation service (depends on conversation-persistence feature)

**Step 3.1:** Replace `IChatService` with `IConversationService`
- Per-agent conversation model (see conversation-persistence feature)
- `parts[]` message format (text + tool calls + results)
- `conversationId` scoping

### Phase 4: Clean up old skills system

**Step 4.1: Audit skillsRouter** (research needed)
- `skillsRouter` uses `SkillRegistryService` (singleton, goes directly to MongoDB)
- NOT connected to `services.skills` at all
- 19 Mongoose calls in `skillsRouter.ts`
- Decision: keep for now (separate system) or replace with `DiscoveryService`?
- This is a separate feature, not part of service refactoring

**Step 4.2: Remove old MongoDB schemas** (after Phase 2)
- `schemas/AgentRoleSchema.ts` -- still used by `MongoAgentService` (delete with Phase 2)
- `schemas/TeamConfigSchema.ts` -- still used by `MongoTeamService` (keep -- chat/auth in cloud mode)
- `schemas/SkillSchema.ts` -- used by `skillsRouter` (keep until Phase 4.1 decided)
- `schemas/AgentSkillSchema.ts` -- used by `skillsRouter` (keep until Phase 4.1 decided)
- `schemas/TeamMemberSchema.ts` -- used by `MongoMemberService` (delete with Phase 2)

---

## Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|-----------|
| Phase 1 | Agent resolution behavior change | Test: `GET /teams/:id/agents` returns same data before/after |
| Phase 2 | Hidden consumer of deleted service | Inventory shows 0 usages -- safe. Grep again before deleting. |
| Phase 3 | Frontend chat integration | Do together with frontend `useChat` refactor |
| Phase 4 | skillsRouter MongoDB dependency | Leave until skills system fully migrated to plugins |

## Estimated Effort

| Phase | Time | Files changed | Files deleted |
|-------|------|--------------|--------------|
| Phase 1 | 1-2 hours | 4 modified | 0 |
| Phase 2 | 30 min | 3 modified | 12 deleted |
| Phase 3 | 2-3 hours | 6 modified | 2 deleted |
| Phase 4 | TBD | TBD | TBD |
