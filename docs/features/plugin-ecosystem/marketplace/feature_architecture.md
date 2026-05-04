# Plugin Marketplace — Feature Architecture

**Status:** Architecture Draft  
**Date:** May 1, 2026  
**Parent:** [Plugin Ecosystem](../feature_architecture.md)  
**Depends on:** Plugin Format Spec (H1), Meta-Team Builder  
**Code locations:** `packages/registry/src/loader/PluginLoader.ts`, `packages/backend/api/registryRouter.ts`

---

## Problem

Today plugins exist only as local folders in `packages/registry/plugins/`. There's no way to:
- Install plugins from a remote source (GitHub repo)
- Publish plugins to a shared location
- Browse available plugins across the community

## Industry Research: How Plugin Distribution Works

### Pattern 1: Central Registry (npm)

```
Author → npm publish → npmjs.com registry → User → npm install
```

- Central server stores packages
- `package.json` defines metadata
- Versioning via semver
- **Pros:** Simple install (`npm install X`), dependency resolution
- **Cons:** Central point of failure, hosting costs, governance

### Pattern 2: Git Tap (Homebrew)

```
Author → creates GitHub repo homebrew-<name> → User → brew tap user/name → brew install formula
```

- Each "tap" is a GitHub repo containing formulae
- `brew tap user/repo` clones the repo locally
- Formulae are Ruby files describing how to install
- **Pros:** Decentralized, zero hosting cost, versioned via git
- **Cons:** Requires git, no central discovery

### Pattern 3: Marketplace Catalog (Claude Code)

```
Author → creates GitHub repo with marketplace.json → User → /plugin marketplace add owner/repo → /plugin install name@marketplace
```

- A **marketplace** is a GitHub repo with `.claude-plugin/marketplace.json`
- `marketplace.json` lists plugins with their sources (relative path, GitHub repo, npm, git URL)
- Each plugin is a separate source — can be in the same repo or external
- Users add marketplaces, then install individual plugins
- Plugin files copied to local cache `~/.claude/plugins/cache/`
- **Pros:** Decentralized, supports multiple source types, version pinning, battle-tested
- **Cons:** Two-step (add marketplace, then install plugin)

### Pattern 4: GitHub Releases

```
Author → git tag v1.0.0 → GitHub release → User → download + extract to plugins dir
```

- Plugin distributed as GitHub release artifact (zip/tar)
- No catalog — user finds plugin via README/docs
- **Pros:** Simplest possible distribution
- **Cons:** No discovery, manual install, no version tracking

---

## Decision: Homebrew Tap Model for Ping

**Ping uses a simplified "tap" model inspired by Homebrew**, not Claude Code's two-level marketplace system. Rationale:

| Factor | Claude Code Marketplace | Ping "Tap" Model |
|--------|------------------------|-------------------|
| Concept | Marketplace contains catalog → catalog lists plugins → install individually | Tap IS the plugin repo → install directly |
| Steps to install | 3: add marketplace → browse → install plugin | 2: add tap → auto-loaded |
| Complexity | marketplace.json schema with sources, versions, strict mode, channels, etc. | Just a GitHub repo with `.ping-plugin/` folder |
| User's mental model | "App store" with catalog | "GitHub repo = team" |
| Publishing | Create marketplace.json, list plugins with sources | Push plugin to GitHub. Done. |

### How It Works

**A tap is a GitHub repo that IS a plugin.** Not a catalog of plugins — the repo itself is one plugin (one team).

```
GitHub repo: github.com/user/marketing-team
├── .ping-plugin/
│   └── plugin.json
├── agents/
│   ├── content-writer.md
│   └── seo-specialist.md
├── skills/
│   └── brand-voice/SKILL.md
└── README.md
```

**Install:** `POST /api/v2/taps/add { repo: "user/marketing-team" }`  
**Result:** Cloned to `~/.ping/taps/user--marketing-team/` → team appears in sidebar.

### Why Not Claude Code's Marketplace Model?

1. **Ping's unit is the team.** A team = one plugin. There's rarely a need for "a catalog of teams in one repo." If someone has 5 teams, they have 5 repos.

2. **Claude Code plugins are small** (one skill, one hook). Multiple fit in one marketplace. Ping plugins are large (3-6 agents + skills + planner). One per repo makes sense.

3. **Simplicity.** User says "I want this team" → gives GitHub URL → team installed. No intermediate catalog layer.

4. **The user's goal as marketplace:** The meta-team creates the plugin → pushes to user's GitHub repo → that repo IS installable. No extra `marketplace.json` needed.

---

## User Flows

### Flow 1: Create + Publish

```
User: "Create a content marketing team and push to github.com/user/my-content-team"

1. Meta-team's planner creates tasks for research-analyst + plugin-author
2. Agents create the plugin folder in workspace
3. WorkspacePlugin creates git repo, commits files
4. WorkspacePlugin pushes to github.com/user/my-content-team
5. Done — that GitHub repo is now installable by anyone
```

### Flow 2: Install from GitHub

```
User: "Add the team from github.com/acme/engineering-team"

POST /api/v2/taps/add { repo: "acme/engineering-team" }

1. Backend clones repo to ~/.ping/taps/acme--engineering-team/
2. PluginLoader validates .ping-plugin/plugin.json + agents/ + skills/
3. PluginTeamService projects it as a team (deterministic teamId from name)
4. Socket.IO: { type: "tap:added", teamId, name }
5. Frontend shows new team in sidebar
6. First message → lazy AgentManager initialization (existing flow)
```

### Flow 3: Update a Tap

```
POST /api/v2/taps/update { repo: "acme/engineering-team" }

1. Backend does git pull in ~/.ping/taps/acme--engineering-team/
2. PluginLoader reloads plugin (checks for changes)
3. If AgentManager is cached → evict (AgentManagerRegistry.remove)
4. Next message re-initializes with updated definitions
5. Socket.IO: { type: "tap:updated", teamId, changes }
```

### Flow 4: Remove a Tap

```
DELETE /api/v2/taps/acme--engineering-team

1. Check for active goals (409 if any running)
2. AgentManagerRegistry.remove(teamId)
3. Delete ~/.ping/taps/acme--engineering-team/
4. Socket.IO: { type: "tap:removed", teamId }
5. Frontend removes team from sidebar
```

---

## API Design

```
# Tap management
POST   /api/v2/taps/add       { repo: "user/repo" }            → { tapId, teamId, name, agents, skills }
GET    /api/v2/taps                                              → [{ tapId, repo, teamId, name, lastUpdated }]
POST   /api/v2/taps/:tapId/update                                → { updated: true, changes: [...] }
DELETE /api/v2/taps/:tapId                                       → { removed: true }

# Discovery (existing, enhanced)
GET    /api/registry/suggest?goal=<text>                         → { plugins, agents, skills }  (existing)
GET    /api/registry/plugins                                     → includes taps (existing, expanded)
```

### Tap Storage

```
~/.ping/
├── taps/                           # Installed taps (git clones)
│   ├── user--marketing-team/       # github.com/user/marketing-team
│   │   ├── .ping-plugin/
│   │   ├── agents/
│   │   └── skills/
│   └── acme--engineering-team/     # github.com/acme/engineering-team
│       ├── .ping-plugin/
│       ├── agents/
│       └── skills/
└── config.json                     # Tap registry (which repos are tapped)
```

`config.json`:
```json
{
  "taps": [
    { "repo": "user/marketing-team", "addedAt": "2026-05-01T10:00:00Z", "lastUpdated": "2026-05-01T10:00:00Z" },
    { "repo": "acme/engineering-team", "addedAt": "2026-04-28T15:30:00Z", "lastUpdated": "2026-05-01T08:00:00Z" }
  ]
}
```

---

## Plugin Resolution Order

When `PluginLoader` scans for plugins, it checks in this order:

1. **Built-in** — `packages/registry/plugins/` (ships with Ping, lowest priority)
2. **Taps** — `~/.ping/taps/*/` (user-installed from GitHub)
3. **Local** — `./ping-plugins/` (project-specific, highest priority)

Name conflicts: later sources win. A local plugin overrides a tap. A tap overrides built-in.

---

## Integration with Existing Code

### PluginLoader Changes

```typescript
// PluginLoader needs to scan multiple directories
class PluginLoader {
  private storages: IPluginStorage[];  // Multiple storage backends
  
  constructor(storages: IPluginStorage[]) {
    // Built-in: LocalPluginStorage("packages/registry/plugins")
    // Taps: LocalPluginStorage("~/.ping/taps")  
    // Local: LocalPluginStorage("./ping-plugins")
    this.storages = storages;
  }
  
  async loadAllPlugins(): Promise<LoadedPlugin[]> {
    const plugins = new Map<string, LoadedPlugin>(); // name → plugin (last wins)
    for (const storage of this.storages) {
      const loaded = await this.scanStorage(storage);
      for (const plugin of loaded) {
        plugins.set(plugin.manifest.name, plugin); // override by name
      }
    }
    return [...plugins.values()];
  }
}
```

### TapService (New)

```typescript
class TapService {
  private tapsDir: string; // ~/.ping/taps/
  
  async add(repo: string): Promise<TapInfo> {
    // 1. git clone https://github.com/{repo} → tapsDir/{sanitized-name}/
    // 2. Validate .ping-plugin/plugin.json exists
    // 3. Save to config.json
    // 4. Return tap info
  }
  
  async update(tapId: string): Promise<UpdateResult> {
    // 1. git pull in tap directory
    // 2. Return changes
  }
  
  async remove(tapId: string): Promise<void> {
    // 1. Delete directory
    // 2. Remove from config.json
  }
  
  async list(): Promise<TapInfo[]> {
    // Read config.json
  }
}
```

### ServiceRegistry Integration

```typescript
// In ServiceRegistry, add TapService alongside existing services
interface ServiceRegistry {
  teams: PluginTeamService;
  taps: TapService;        // NEW
  chat: ChatService;
  // ...
}
```

---

## Future: Multi-Plugin Repos (v2.0)

If needed later, support repos with multiple plugins:

```
github.com/user/my-plugins
├── .ping-plugin/
│   └── marketplace.json    ← Optional catalog
├── marketing-team/
│   ├── .ping-plugin/
│   └── agents/
└── sales-team/
    ├── .ping-plugin/
    └── agents/
```

But v1.0 keeps it simple: **one repo = one plugin = one team.**

---

## Plugin Lifecycle Management

### Full Lifecycle

```
discover → install → configure → use → disable → offboard → delete
```

| State | Description | API |
|-------|-------------|-----|
| **Available** | Plugin exists in a GitHub repo, not installed | Discovered via search/browsing |
| **Installing** | Git clone in progress | `POST /api/v2/taps/add` |
| **Installed** | Plugin on disk, team projected in sidebar | Automatic after clone |
| **Configuring** | User filling in `userConfig` values (API keys, etc.) | `POST /api/v2/taps/:id/configure` |
| **Active** | Team initialized, accepting goals | First message triggers lazy init |
| **Disabled** | Team hidden, no new goals, existing goals continue | `POST /api/v2/taps/:id/disable` |
| **Offboarding** | Active goals being cancelled/completed | `POST /api/v2/taps/:id/offboard` |
| **Removed** | Plugin deleted from disk | `DELETE /api/v2/taps/:id` |

### Install Flow (Complete)

```
POST /api/v2/taps/add { repo: "acme/engineering-team" }
  │
  ├─ 1. Check user limits (max taps reached? → 403)
  ├─ 2. Check duplicate (already installed? → 409)
  ├─ 3. git clone https://github.com/acme/engineering-team → ~/.ping/taps/acme--engineering-team/
  ├─ 4. Validate .ping-plugin/plugin.json + agents/ + skills/
  │     → Invalid? → delete clone, return 422 with validation errors
  ├─ 5. Check if plugin has userConfig → return { needsConfig: true, fields: [...] }
  ├─ 6. Save to config.json (tap registry)
  ├─ 7. PluginTeamService projects it as team (deterministic teamId)
  ├─ 8. Socket.IO: { type: "tap:installed", teamId, name, needsConfig }
  │
  ▼
  Response: { tapId, teamId, name, agents: [...], skills: [...], needsConfig: boolean }
```

### Configure Flow (for plugins with `userConfig`)

```
POST /api/v2/taps/:tapId/configure
  Body: { "api_endpoint": "https://...", "github_token": "ghp_..." }
  │
  ├─ 1. Validate required fields from manifest.userConfig
  ├─ 2. Store non-sensitive in config.json
  ├─ 3. Store sensitive in system keychain (or encrypted file)
  ├─ 4. Socket.IO: { type: "tap:configured", tapId }
  │
  ▼
  Response: { configured: true }
```

### Disable Flow

```
POST /api/v2/taps/:tapId/disable
  │
  ├─ 1. Mark tap as disabled in config.json
  ├─ 2. If AgentManager cached → keep it (existing goals continue)
  ├─ 3. Block new goals for this team
  ├─ 4. Hide from sidebar
  ├─ 5. Socket.IO: { type: "tap:disabled", tapId }
  │
  ▼
  Response: { disabled: true }
```

### Offboard Flow (Full Removal)

```
POST /api/v2/taps/:tapId/offboard
  │
  ├─ Check active goals → 409 if any running
  │    Response: { error: "active_goals", goals: [...], message: "Cancel or complete goals first" }
  ├─ Check in-progress tasks → 409 if any
  │    Response: { error: "active_tasks", tasks: [...], message: "Wait for tasks to complete" }
  │
  ▼ (all clear)
  1. AgentManagerRegistry.remove(teamId) → dispose manager, stop workers
  2. PluginRegistry disposes plugins (workspace cleanup, CRDT shutdown)
  3. Remove from config.json
  4. Delete ~/.ping/taps/<tapId>/
  5. Delete userConfig values (including keychain entries)
  6. Socket.IO: { type: "tap:offboarded", tapId }
  7. Frontend removes team from sidebar

  Response: { offboarded: true, cleaned: { workers: 4, skills: 7, goals: 2 } }
```

### Enable (Re-enable after disable)

```
POST /api/v2/taps/:tapId/enable
  │
  ├─ 1. Mark tap as enabled in config.json
  ├─ 2. Show in sidebar
  ├─ 3. Socket.IO: { type: "tap:enabled", tapId }
  │
  ▼
  Response: { enabled: true }
```

---

## User Limits & Usage Tracking

### Industry Patterns

| Platform | How limits work |
|----------|----------------|
| **GitHub Copilot** | Per-seat licensing. Usage-based billing on premium requests. Budget alerts at 75/90/100% |
| **Claude Code** | Plugin count unlimited. LLM usage billed per-token via API key |
| **CrewAI Enterprise** | Per-crew-run billing. Token usage tracked per agent per task |
| **Homebrew** | No limits (free, OSS) |
| **npm** | Unlimited public packages. Private package limits per plan |

### Ping's Approach: Resource Limits, Not Plugin Limits

The cost of a plugin isn't the plugin itself (it's just files) — it's the **LLM tokens consumed when the team runs goals**. So limits should be on usage, not on install count.

#### Limit Levels

```typescript
interface UserLimits {
  // Plugin/Team limits
  maxInstalledTaps: number;        // Default: 20 (generous — plugins are just folders)
  maxConcurrentTeams: number;      // Default: 3 (teams with active goals simultaneously)
  maxAgentsPerTeam: number;        // Default: 10 (agents in one plugin)
  
  // Goal/Execution limits
  maxConcurrentGoals: number;      // Default: 3 (across all teams)
  maxGoalsPerDay: number;          // Default: 50
  goalTimeoutMs: number;           // Default: 300000 (5 min per goal)
  maxTasksPerGoal: number;         // Default: 50
  
  // LLM Token limits
  maxTokensPerDay: number;         // Default: 1_000_000
  maxTokensPerGoal: number;        // Default: 200_000
  maxTokensPerTask: number;        // Default: 50_000
}
```

#### Where Limits Are Enforced

| Limit | Enforcement Point | Error |
|-------|------------------|-------|
| `maxInstalledTaps` | `TapService.add()` | 403: "Max installed teams reached (20). Remove a team first." |
| `maxConcurrentTeams` | `AgentManagerRegistry.getForTeam()` | 429: "Max 3 teams can be active simultaneously." |
| `maxAgentsPerTeam` | `PluginLoader.loadPlugin()` validation | 422: "Plugin has 15 agents, max is 10." |
| `maxConcurrentGoals` | `OrchestratorService.handleMessage()` | 429: "Max 3 concurrent goals. Wait for one to complete." |
| `maxGoalsPerDay` | `OrchestratorService.handleMessage()` | 429: "Daily goal limit reached (50). Resets at midnight UTC." |
| `goalTimeoutMs` | `GoalManager` | Auto-cancel after timeout |
| `maxTasksPerGoal` | `createPlannerTools()` → `submit_plan` | Planner told: "Plan rejected — max 50 tasks per goal." |
| `maxTokensPerDay` | `AiSdkAgent.execute()` → token counting | 429: "Daily token limit reached." |
| `maxTokensPerGoal` | `GoalManager` → aggregate across tasks | Goal auto-paused: "Token budget exhausted for this goal." |
| `maxTokensPerTask` | `AiSdkAgent.execute()` | Task failed: "Task token limit reached." |

#### Usage Tracking

```typescript
interface UsageRecord {
  userId: string;
  teamId: string;
  goalId: string;
  taskId?: string;
  
  tokensInput: number;
  tokensOutput: number;
  tokensTotal: number;
  
  modelId: string;
  agentRole: string;
  
  timestamp: Date;
  durationMs: number;
}
```

**Storage:** MongoDB collection `usage_records`. Indexed by `userId + date` for daily aggregation.

**API:**
```
GET /api/v2/usage
  Query: ?from=2026-05-01&to=2026-05-02&teamId=optional
  Response: { totalTokens, byTeam: [...], byDay: [...], remainingToday: number }

GET /api/v2/usage/limits
  Response: { limits: UserLimits, current: { installedTaps: 5, activeTeams: 2, goalsToday: 12, tokensToday: 450000 } }
```

### Config: Setting Limits

Limits stored in environment or config:

```bash
# .env
PING_MAX_INSTALLED_TAPS=20
PING_MAX_CONCURRENT_TEAMS=3
PING_MAX_CONCURRENT_GOALS=3
PING_MAX_GOALS_PER_DAY=50
PING_MAX_TOKENS_PER_DAY=1000000
```

For multi-tenant (future): limits per user stored in MongoDB `user_limits` collection.

---

## Complete API Summary

```
# Tap Lifecycle
POST   /api/v2/taps/add            { repo: "user/repo" }              → Install
GET    /api/v2/taps                                                     → List installed
GET    /api/v2/taps/:tapId                                              → Get details
POST   /api/v2/taps/:tapId/configure { key: "value" }                  → Set userConfig
POST   /api/v2/taps/:tapId/update                                       → Git pull
POST   /api/v2/taps/:tapId/disable                                      → Soft disable
POST   /api/v2/taps/:tapId/enable                                       → Re-enable
POST   /api/v2/taps/:tapId/offboard                                     → Full removal (checks goals)
DELETE /api/v2/taps/:tapId                                              → Force delete (skips checks)

# Usage & Limits
GET    /api/v2/usage                ?from=&to=&teamId=                  → Usage records
GET    /api/v2/usage/limits                                             → Current limits + usage

# Discovery (existing)
GET    /api/registry/suggest        ?goal=<text>                        → Search plugins/agents/skills
GET    /api/registry/plugins                                            → All available plugins
```

---

## Implementation Priority

| Priority | Item | Effort |
|----------|------|--------|
| P0 | `TapService` — git clone/pull/remove + config.json | Medium |
| P1 | Install API — `POST /taps/add` with validation + limit checks | Medium |
| P2 | Multi-storage `PluginLoader` — scan built-in + taps + local | Low |
| P3 | Offboard API — `POST /taps/:id/offboard` with goal checks | Medium |
| P4 | Disable/Enable API — soft disable without removal | Low |
| P5 | Socket.IO notifications for all tap lifecycle events | Low |
| P6 | Frontend sidebar: show tapped teams + install/remove UI | Medium |
| P7 | `UserLimits` config + enforcement at install/goal/task checkpoints | Medium |
| P8 | `UsageRecord` tracking in MongoDB + usage API | Medium |
| P9 | Configure API — `POST /taps/:id/configure` for userConfig values | Low |
| P10 | Update API — `POST /taps/:id/update` with git pull + eviction | Medium |
| P11 | Meta-team integration: push created plugin to GitHub | Medium |
