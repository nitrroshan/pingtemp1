# Service Layer Refactoring -- Implementation Planning

**Architecture:** [feature_architecture.md](feature_architecture.md)

## Branch
`feature/service-refactoring`

---

## Phase 1: Dead service cleanup (DONE)

Completed April 12, 2026. Removed 7-service registry → 3 services, eliminated LLM role discovery, plugin branching, dead code. See git history.

- [x] Step 1: Create PluginTeamService (replaces FileTeamService + FileAgentService)
- [x] Step 2: Update ServiceRegistry (7 → 3 services)
- [x] Step 3: Clean route handler (remove branching, LLM discovery)
- [x] Step 4: Clean AgentManagerRegistry.loadTeam()
- [x] Step 5: Update barrel exports
- [x] Step 6: Update server.ts autoRegisterPluginTeams
- [x] Step 7: Fix __dirname path resolution (3 → 4 levels up)

---

## Phase 2: Storage Simplification

### Scope

| In scope | Out of scope |
|----------|-------------|
| Eliminate team store (derive ID from plugin name) | Frontend changes |
| Replace lowdb + JSONL with SQLite (local mode) | skillsRouter MongoDB refactor |
| Wire MongoGoalService in cloud mode | Auth storage changes |
| Add `settings` field to plugin.json | Conversation persistence redesign |

### Current state

```
Local:  lowdb (teams.json) + lowdb (goals/*.json) + JSONL (chats/*.jsonl)
Cloud:  lowdb (teams.json) + lowdb (goals/*.json) + MongoDB (chat only)
                              ^^^^ gaps — no cloud storage for teams/goals
```

### Target state

```
Local:  PluginLoader (teams/agents/skills) + bun:sqlite (chat, goals)
Cloud:  PluginLoader (teams/agents/skills) + MongoDB (chat, goals)
```

---

### Step 1: Derive team ID from plugin name (eliminate team store)

**Files:** `services/PluginTeamService.ts`, `services/ServiceRegistry.ts`, `server.ts`, `api/agentManagerHandlerV2.ts`

Team = plugin. No separate database record needed.

```typescript
import { v5 as uuidv5 } from "uuid";

// Fixed namespace for deterministic IDs
const TEAM_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

// "engineering-team" → always the same UUID
function pluginNameToTeamId(pluginName: string): string {
  return uuidv5(pluginName, TEAM_NAMESPACE);
}
```

Changes:
- `PluginTeamService.listTeams()` → scan plugins, return virtual team objects
- `PluginTeamService.getTeam(id)` → find plugin where `uuidv5(name) === id`
- Remove `createTeam()`, `deleteTeam()`, `updateTeam()` — teams are read-only projections of plugins
- Remove `autoRegisterPluginTeams()` from `server.ts` — no registration needed
- Remove `lowdb` dependency from PluginTeamService
- DELETE `data/teams.json`
- `POST /teams` → remove (or repurpose for creating plugins via meta-team)
- `DELETE /teams` → remove (delete the plugin folder if needed)
- Add `settings` to `plugin.json`:
  ```json
  {
    "name": "engineering-team",
    "settings": { "executionMode": "sequential", "maxConcurrency": 1 }
  }
  ```

**Migration:** Existing chat/plan files reference old random UUIDs. Need a one-time migration script to rename `data/chats/{old-uuid}.jsonl` → `data/chats/{new-deterministic-uuid}.jsonl`. Or just clear dev data.

**Depends on:** Nothing
**Risk:** Existing workspace directories use old team UUIDs. Workspace paths become `workspaces/{plugin-name}/` instead of `workspaces/{uuid}/`.

---

### Step 2: Create SQLiteChatService (replaces FileChatService)

**Files:** NEW `services/sqlite/SqliteChatService.ts`

```typescript
import { Database } from "bun:sqlite";

export class SqliteChatService implements IChatService {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        teamId TEXT NOT NULL,
        agentId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        goalId TEXT,
        taskId TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        streamParts TEXT,
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_team ON messages(teamId);
      CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(teamId, agentId);
      CREATE INDEX IF NOT EXISTS idx_messages_goal ON messages(teamId, goalId);
    `);
  }

  async addMessage(msg) {
    this.db.run(`INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...]);
  }

  async getMessages(teamId, options?) {
    return this.db.query(`SELECT * FROM messages WHERE teamId = ? ORDER BY timestamp DESC LIMIT ?`)
      .all(teamId, options?.limit ?? 50);
  }

  async getAgentMessages(teamId, agentId, options?) {
    return this.db.query(`SELECT * FROM messages WHERE teamId = ? AND agentId = ? ORDER BY timestamp DESC LIMIT ?`)
      .all(teamId, agentId, options?.limit ?? 50);
  }

  async getGoalMessages(teamId, goalId, options?) {
    return this.db.query(`SELECT * FROM messages WHERE teamId = ? AND goalId = ? ORDER BY timestamp DESC LIMIT ?`)
      .all(teamId, goalId, options?.limit ?? 50);
  }
}
```

**Depends on:** Nothing (can be done in parallel with Step 1)

---

### Step 3: Create SqliteGoalService (replaces FileGoalService)

**Files:** NEW `services/sqlite/SqliteGoalService.ts`

```typescript
export class SqliteGoalService implements IGoalService {
  constructor(private db: Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        teamId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        planId TEXT,
        result TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_goals_team ON goals(teamId);
    `);
  }
}
```

Both chat and goals share the same `data/ping.db` file.

**Depends on:** Nothing (parallel with Step 1 and 2)

---

### Step 4: Update ServiceRegistry

**Files:** `services/ServiceRegistry.ts`

```typescript
// Local mode: SQLite for chat + goals
const db = new Database(path.join(dataDir, "ping.db"), { create: true });
const chatService = new SqliteChatService(db);
const goalService = new SqliteGoalService(db);

// Cloud mode: MongoDB for chat + goals
const chatService = new MongoChatService();
const goalService = new MongoGoalService();  // ← already exists, just wire it

// Teams: no store needed
const teamService = new PluginTeamService(pluginLoader);  // no lowdb, no file path
```

```typescript
export interface ServiceRegistry {
  teams: PluginTeamService;   // read-only projection from plugins
  chat: IChatService;         // SQLite (local) / MongoDB (cloud)
  goals: IGoalService;        // SQLite (local) / MongoDB (cloud)
  mode: "local" | "cloud";
}
```

**Depends on:** Steps 1, 2, 3

---

### Step 5: Delete dead storage files

**Delete:**
- `services/file/FileTeamService.ts` — replaced by PluginTeamService (no DB)
- `services/file/FileGoalService.ts` — replaced by SqliteGoalService
- `services/file/FileChatService.ts` — replaced by SqliteChatService
- `services/file/lowdb-helpers.ts` — no more lowdb consumers
- `services/mongo/MongoTeamService.ts` — teams derived from plugins
- `services/contracts/ITeamService.ts` — PluginTeamService has its own interface
- `services/types/Team.ts` — team is a projection, not a stored record

**Keep:**
- `services/mongo/MongoChatService.ts` — cloud chat
- `services/mongo/MongoGoalService.ts` — cloud goals

**Depends on:** Step 4

---

### Step 6: Add settings to plugin.json

**Files:** All `packages/registry/plugins/*/. claude-plugin/plugin.json`

Add default settings to each plugin manifest:

```json
{
  "name": "engineering-team",
  "description": "...",
  "version": "1.0.0",
  "settings": {
    "executionMode": "sequential",
    "maxConcurrency": 1
  }
}
```

Update `PluginManifest` type in `PluginLoader.ts` to include `settings?`.

**Depends on:** Step 1

---

## File Summary

| New files | Purpose |
|-----------|---------|
| `services/sqlite/SqliteChatService.ts` | Local chat via bun:sqlite |
| `services/sqlite/SqliteGoalService.ts` | Local goals via bun:sqlite |
| `services/sqlite/index.ts` | Barrel export |

| Modified files | Change |
|---------------|--------|
| `services/PluginTeamService.ts` | Remove lowdb, derive IDs from plugin names |
| `services/ServiceRegistry.ts` | Wire SQLite local / MongoDB cloud, remove lowdb |
| `api/agentManagerHandlerV2.ts` | Remove POST/DELETE /teams (or repurpose) |
| `server.ts` | Remove autoRegisterPluginTeams |
| `registry/src/loader/PluginLoader.ts` | Add `settings` to PluginManifest type |
| All `plugin.json` files | Add `settings` field |

| Deleted files | Count |
|--------------|-------|
| File services (3) | FileTeamService, FileGoalService, FileChatService |
| Helpers (1) | lowdb-helpers.ts |
| Mongo services (1) | MongoTeamService |
| Contracts (1) | ITeamService |
| Types (1) | Team.ts |
| **Total** | **7 files deleted** |

## Dependencies to remove from package.json

- `lowdb` — no longer used (SQLite replaces it)

## Testing

- `GET /teams` returns teams derived from plugin folders
- `GET /teams/:id` returns team with deterministic UUID matching plugin name
- Chat messages persist in SQLite, survive restart
- Goals persist in SQLite, survive restart
- Cloud mode: chat + goals both use MongoDB
- No data/teams.json created on startup
