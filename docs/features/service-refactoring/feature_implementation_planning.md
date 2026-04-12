# Service Layer Refactoring -- Implementation Planning

**Architecture:** [feature_architecture.md](feature_architecture.md)

## Branch
`feature/service-refactoring`

## Scope

Replace 7-service `ServiceRegistry` with PluginLoader + thin persistence layer.

| In scope | Out of scope |
|----------|-------------|
| Remove dead services (agents, skills, agentSkills, members) | Conversation persistence redesign (separate feature) |
| Remove LLM role discovery from POST /teams | Meta-team implementation (v1.1) |
| Move agent/team resolution to PluginLoader | Frontend refactoring |
| Clean route handler (remove plugin branching) | Old skillsRouter MongoDB cleanup |
| Fix Team type (remove `as any` casts) | |
| Consolidate PluginLoader instantiation | |

---

## Step 1: Create PluginTeamService (replaces FileTeamService + FileAgentService)

**Files:** `packages/backend/services/PluginTeamService.ts`

New service that combines team records (JSON) with agent loading (PluginLoader).
Replaces both `FileTeamService` and `FileAgentService` in one class.

```typescript
import { PluginLoader } from "@ping/registry/src/loader/PluginLoader";

interface TeamRecord {
  id: string;
  name: string;
  description?: string;
  pluginName: string;
  ownerId: string;
  workspaceId: string;
  settings: { executionMode: string; maxConcurrency: number };
  createdAt: string;
  updatedAt: string;
}

interface AgentInfo {
  id: string;
  name: string;
  role: string;
  description: string;
  skills: string[];
}

export class PluginTeamService {
  private teams: TeamRecord[] = [];
  private pluginLoader: PluginLoader;

  constructor(private dataFile: string, pluginLoader: PluginLoader) {
    this.pluginLoader = pluginLoader;
  }

  async init(): Promise<void> {
    // Load teams.json (simple JSON read, no lowdb needed)
  }

  // Team CRUD (reads/writes teams.json)
  async createTeam(params): Promise<TeamRecord> { }
  async getTeam(teamId: string): Promise<TeamRecord | null> { }
  async listTeams(): Promise<TeamRecord[]> { }
  async deleteTeam(teamId: string): Promise<void> { }

  // Agent resolution (delegates to PluginLoader)
  async getTeamAgents(teamId: string): Promise<AgentInfo[]> {
    const team = await this.getTeam(teamId);
    if (!team) return [];
    const plugin = await this.pluginLoader.loadPlugin(team.pluginName);
    return plugin.agents.map(a => ({
      id: a.id, name: a.name, role: a.role,
      description: a.description ?? "",
      skills: (a.config as any)?.skills ?? [],
    }));
  }

  // Skill resolution (delegates to PluginLoader)
  async getTeamSkills(teamId: string): Promise<SkillInfo[]> {
    const team = await this.getTeam(teamId);
    if (!team) return [];
    const plugin = await this.pluginLoader.loadPlugin(team.pluginName);
    return plugin.skills.map(s => ({ id: s.id, name: s.name, description: s.description }));
  }
}
```

**Key change:** `pluginName` is REQUIRED on every team. No more optional.
Team = plugin. Always. No DB-only teams.

**Depends on:** Nothing
**Tests:** Create team, getTeamAgents returns agents from .md files

---

## Step 2: Update ServiceRegistry

**Files:** `packages/backend/services/ServiceRegistry.ts`

```typescript
// Before: 7 services, 5 dead
interface ServiceRegistry {
  teams: ITeamService;
  agents: IAgentService;        // DELETE
  skills: ISkillService;        // DELETE
  agentSkills: IAgentSkillService;  // DELETE
  chat: IChatService;
  goals: IGoalService;
  members: IMemberService;      // DELETE
  mode: "file" | "hybrid";
}

// After: 3 services
interface ServiceRegistry {
  teams: PluginTeamService;     // teams + agents + skills via PluginLoader
  chat: IChatService;           // JSONL (local) / MongoDB (cloud)
  goals: IGoalService;          // per-team JSONL
  mode: "file" | "hybrid";
}
```

- Create single `PluginLoader` instance, inject into `PluginTeamService`
- Remove `FileAgentService`, `FileSkillService`, `FileAgentSkillService`, `FileMemberService` init calls
- Remove their imports

**Depends on:** Step 1
**Tests:** Server starts, ServiceRegistry has 3 services

---

## Step 3: Clean route handler

**Files:** `packages/backend/api/agentManagerHandlerV2.ts`

### 3a: Clean GET /teams/:id/agents (40 lines -> 5 lines)

```typescript
// Before: 40 lines with plugin branching
router.get("/teams/:id/agents", async (req, res) => {
  const team = await services.teams.getTeam(teamId);
  if (team && (team as any).pluginName) {
    // load plugin, map agents...
  } else {
    // load from DB...
  }
});

// After: 5 lines
router.get("/teams/:id/agents", async (req, res) => {
  const teamId = req.params.id as string;
  const agents = await services.teams.getTeamAgents(teamId);
  res.json({ agents, count: agents.length });
});
```

### 3b: Clean GET /teams (member count)

```typescript
// Before: 15 lines with plugin branching per team
for (const t of teams) {
  if ((t as any).pluginName) {
    const plugin = await loadPluginByName(...);
    memberCount = plugin.agents.length;
  } else {
    memberCount = (await services.agents.getTeamAgents(t.id)).length;
  }
}

// After: 3 lines per team
for (const t of teams) {
  const agents = await services.teams.getTeamAgents(t.id);
  teamList.push({ ...t, memberCount: agents.length });
}
```

### 3c: Remove POST /teams legacy LLM discovery

Remove entire block (lines ~120-165):
- `const tempManager = new AgentManager();`
- `await tempManager.configureNewWorkflow(...)`
- `const roles = await tempManager.getRoles(goal);`
- `services.agents.addAgent(...)` loop

POST /teams now REQUIRES `pluginName`. Error if missing.

### 3d: Remove loadPluginByName helper + imports

- Delete `loadPluginByName()` function (lines 34-42)
- Remove `PluginLoader` import from handler
- Remove `AgentManager` import from handler

**Depends on:** Step 2
**Tests:** All 5 API endpoints return same data as before

---

## Step 4: Clean AgentManagerRegistry.loadTeam()

**Files:** `packages/backend/agentManager/AgentManagerRegistry.ts`

```typescript
// Before: 50 lines with plugin-vs-DB branching
if ((team as any).pluginName) {
  const { PluginLoader } = await import(...)
  const loader = new PluginLoader(registryDir);
  const plugin = await loader.loadPlugin(pluginName);
  teamRoles = plugin.agents.map(...);
} else {
  const agents = await this.services.agents.getTeamAgents(teamId);
  teamRoles = agents.map(...);
}

// After: 5 lines
const team = await this.services.teams.getTeam(teamId);
if (!team) throw new Error(`Team ${teamId} not found`);
const agents = await this.services.teams.getTeamAgents(teamId);
const teamRoles = agents.map(a => ({
  id: a.id, role: a.role, name: a.name, goal: a.description,
  systemPrompt: /* loaded from plugin via PluginLoader */
}));
```

Note: `loadTeam()` also needs systemPrompt + pluginConfig for `initializeOrchestrator()`.
`PluginTeamService.getTeamAgents()` should return full `AgentDefinition` (not just `AgentInfo`)
OR add `getTeamAgentDefinitions()` that returns the full config.

**Depends on:** Step 2
**Tests:** Team loads, agents have correct system prompts

---

## Step 5: Delete dead files

**Delete contracts:**
- `services/contracts/IAgentService.ts`
- `services/contracts/ISkillService.ts`
- `services/contracts/IAgentSkillService.ts`
- `services/contracts/IMemberService.ts`

**Delete file implementations:**
- `services/file/FileAgentService.ts`
- `services/file/FileSkillService.ts`
- `services/file/FileAgentSkillService.ts`
- `services/file/FileMemberService.ts`
- `services/file/FileTeamService.ts` (replaced by PluginTeamService)

**Delete mongo implementations:**
- `services/mongo/MongoAgentService.ts`
- `services/mongo/MongoSkillService.ts`
- `services/mongo/MongoAgentSkillService.ts`
- `services/mongo/MongoMemberService.ts`
- `services/mongo/MongoTeamService.ts`

**Delete types:**
- `services/types/Agent.ts`
- `services/types/Skill.ts`
- `services/types/AgentSkill.ts`
- `services/types/TeamMember.ts`

**Delete schemas:**
- `services/mongo/schemas/AgentRoleSchema.ts`
- `services/mongo/schemas/TeamConfigSchema.ts`
- `services/mongo/schemas/TeamMemberSchema.ts`

**Keep schemas (used by skillsRouter):**
- `services/mongo/schemas/SkillSchema.ts`
- `services/mongo/schemas/AgentSkillSchema.ts`

**Update barrel exports:**
- `services/contracts/index.ts`
- `services/file/index.ts`
- `services/mongo/index.ts`
- `services/types/index.ts`

**Depends on:** Steps 3 and 4 (ensure no consumers remain)
**Total: 19 files deleted**

---

## Step 6: Update server.ts autoRegisterPluginTeams

**Files:** `packages/backend/server.ts`

```typescript
// Before: creates PluginLoader locally, calls services.teams.createTeam()
async function autoRegisterPluginTeams(services: ServiceRegistry) {
  const { PluginLoader } = await import(...)
  const loader = new PluginLoader(registryDir);
  const manifests = await loader.getPluginManifests();
  // ...
  await services.teams.createTeam({ pluginName, ... });
}

// After: uses services.teams directly (PluginTeamService has the loader)
async function autoRegisterPluginTeams(services: ServiceRegistry) {
  const manifests = await services.teams.pluginLoader.getPluginManifests();
  for (const manifest of manifests) {
    if (!(await services.teams.getByPluginName(manifest.name))) {
      await services.teams.register(manifest.name);
    }
  }
}
```

Remove local `PluginLoader` instantiation from `server.ts`.

**Depends on:** Step 2

---

## File Summary

| New files | Purpose |
|-----------|---------|
| `services/PluginTeamService.ts` | Unified teams + agents + skills via PluginLoader |

| Modified files | Change |
|---------------|--------|
| `services/ServiceRegistry.ts` | 7 services -> 3 |
| `api/agentManagerHandlerV2.ts` | Remove branching, remove LLM discovery |
| `agentManager/AgentManagerRegistry.ts` | Remove plugin branching |
| `server.ts` | Simplify autoRegister |
| `services/contracts/index.ts` | Remove dead exports |
| `services/file/index.ts` | Remove dead exports |
| `services/mongo/index.ts` | Remove dead exports |
| `services/types/index.ts` | Remove dead exports |

| Deleted files | Count |
|--------------|-------|
| Contracts (4) | IAgentService, ISkillService, IAgentSkillService, IMemberService |
| File services (5) | FileTeamService, FileAgentService, FileSkillService, FileAgentSkillService, FileMemberService |
| Mongo services (5) | MongoTeamService, MongoAgentService, MongoSkillService, MongoAgentSkillService, MongoMemberService |
| Types (4) | Agent, Skill, AgentSkill, TeamMember |
| Schemas (3) | AgentRoleSchema, TeamConfigSchema, TeamMemberSchema |
| **Total** | **21 files deleted** |
