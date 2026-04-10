# Team Registry v1.0 — Implementation Planning

**Architecture**: [feature_architecture.md](../feature_architecture.md) (Option A: Plugin-Based File System)

## Branch
`feature/team-registry-v1.0`

## Scope — MVP

v1.0 delivers: **Load a team plugin → agents + skills auto-assigned → ready to run.**

| In scope | Out of scope (v1.1+) |
|----------|---------------------|
| Markdown + YAML frontmatter parser | Meta-team (team of agents building teams) |
| Plugin folder structure + loader | Team Builder UI with editable suggestions |
| Agent .md → AgentDefinition conversion | S3 hosting / remote registry |
| Skill SKILL.md loading into SkillResolver | Plugin marketplace |
| Auto-assign skills on team creation | Plugin versioning / updates |
| index.json builder (embeddings) | MCP server integration in plugins |
| Discovery API (`GET /api/registry/suggest`) | |
| Refactor POST /teams to use plugin loader | |
| 3 sample team plugins (engineering, product, research) | |

## Integration Points

```
┌────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Plugin Loader  │────▶│ AgentFactory     │────▶│ WorkerPool      │
│ (new)          │     │ (extend to       │     │ (existing)      │
│                │     │  accept .md)     │     │                 │
│ Parses .md     │     │                  │     │ setRoleAgentIdMap│
│ Reads plugin   │     │ create(def)      │     │ registerDefs    │
│ Returns defs   │     │                  │     │ runTask(...)    │
└────────────────┘     └──────────────────┘     └─────────────────┘
        │                                               │
        │                                               │
        ▼                                               ▼
┌────────────────┐                             ┌─────────────────┐
│ Skill Resolver │                             │ PluginRegistry  │
│ (existing)     │                             │ (existing)      │
│                │                             │                 │
│ skillId →      │◀────────────────────────────│ getTools()      │
│  AI SDK tool   │                             │ getSkillInstr() │
│  or prompt text│                             │                 │
└────────────────┘                             └─────────────────┘
```

## Implementation Steps

### Step 1: Frontmatter Parser Module
**Files:** `packages/registry/src/parser/frontmatterParser.ts`

Create a parser that splits `.md` files into frontmatter (YAML) + body (Markdown/system prompt).

```typescript
interface ParsedDefinition {
  frontmatter: Record<string, any>;  // YAML fields
  body: string;                       // System prompt content
  raw: string;                        // Original file content
}

function parseFrontmatter(content: string): ParsedDefinition
```

- Use `gray-matter` npm package (lightweight, well-tested)
- Export typed wrappers: `parseAgentMd()`, `parseSkillMd()`, `parsePluginJson()`
- Unit test: parse sample .md → verify frontmatter + body split

**Depends on:** Nothing  
**Tests:** Unit tests for parser with edge cases (no frontmatter, empty body, XML in body)

---

### Step 2: Agent Definition Converter
**Files:** `packages/registry/src/converter/agentConverter.ts`

Convert parsed agent `.md` files into the existing `AgentDefinition` interface that `AgentFactory` and `WorkerPool` already consume.

```typescript
function agentMdToDefinition(parsed: ParsedDefinition): AgentDefinition {
  return {
    id: parsed.frontmatter.name,
    name: parsed.frontmatter.name,
    role: parsed.frontmatter.role,
    type: 'internal',
    goal: parsed.frontmatter.description || '',
    systemPrompt: parsed.body,       // ← Markdown body becomes system prompt
    config: {
      model: parsed.frontmatter.model || { provider: 'azure-openai' },
      tools: parsed.frontmatter.tools || [],
      skills: parsed.frontmatter.defaultSkills || [],
      maxSteps: parsed.frontmatter.maxSteps || 10,
    },
    settings: { streaming: true },
  };
}
```

**Mapping:**

| .md frontmatter | AgentDefinition field |
|----------------|----------------------|
| `name` | `id`, `name` |
| `role` | `role` |
| `description` | `goal` |
| `model` | `config.model` |
| `tools` | `config.tools` |
| `defaultSkills` | `config.skills` |
| `tags` | (metadata, not in AgentDefinition — store separately for index) |
| Body (Markdown) | `systemPrompt` |

**Depends on:** Step 1  
**Tests:** Convert sample agent .md → verify AgentDefinition shape matches what WorkerPool expects

---

### Step 3: Plugin Loader
**Files:** `packages/registry/src/loader/PluginLoader.ts`

Loads a plugin folder following Claude Code format: reads `.claude-plugin/plugin.json`, scans `agents/` for `.md` files, scans `skills/` for `SKILL.md` files.

```typescript
interface LoadedPlugin {
  manifest: PluginManifest;
  agents: AgentDefinition[];          // Converted from .md
  skills: SkillDefinition[];          // Parsed SKILL.md files
  agentSkillMap: Map<string, string[]>; // agentRole → skillIds (from each agent's defaultSkills)
  hooks?: HooksConfig;                // From hooks/hooks.json
  mcpServers?: Record<string, any>;   // From .mcp.json
}

interface PluginManifest {
  name: string;
  description: string;
  version: string;
  author?: { name: string };
  tags?: string[];                    // Ping extension
}

class PluginLoader {
  constructor(registryDir: string)
  loadPlugin(pluginDir: string): Promise<LoadedPlugin>
  loadAllPlugins(): Promise<LoadedPlugin[]>
  getPluginManifests(): PluginManifest[]   // For index building
}
```

**Flow:**
1. Detect format: check `.claude-plugin/plugin.json` (Claude Code) or `plugin.json` at root (legacy)
2. Read manifest → parse
3. Scan `agents/*.md` → `parseFrontmatter()` → `agentMdToDefinition()` for each
4. Build `agentSkillMap` from each agent's `defaultSkills` frontmatter field
5. Scan `skills/*/SKILL.md` → parse each
6. Optionally load `hooks/hooks.json` and `.mcp.json`
7. Return `LoadedPlugin` with everything resolved

**No `teamComposition`** — the folder structure IS the team. All agents in `agents/` = team members.

**Depends on:** Step 1, Step 2  
**Tests:** Load sample engineering-team plugin → verify all agents + skills resolved

---

### Step 4: Index Builder
**Files:** `packages/registry/src/index/IndexBuilder.ts`

Scans all plugins, generates embeddings for descriptions, writes `index.json`.

```typescript
interface RegistryIndex {
  version: string;
  buildTimestamp: string;
  plugins: PluginIndexEntry[];
  agents: AgentIndexEntry[];
  skills: SkillIndexEntry[];
}

interface PluginIndexEntry {
  name: string;
  description: string;
  tags: string[];
  pluginDir: string;
  embedding: number[];    // 1536-dim from text-embedding-3-small
}

// Similar for AgentIndexEntry, SkillIndexEntry

class IndexBuilder {
  constructor(registryDir: string)
  async build(): Promise<RegistryIndex>
  async save(outputPath: string): Promise<void>
  async load(indexPath: string): Promise<RegistryIndex>
}
```

**Flow:**
1. `PluginLoader.loadAllPlugins()` → get all manifests
2. Concatenate `name + description + tags` for each plugin/agent/skill
3. Batch embed via `TryGenerateBatchEmbeddings()` (reuse registry's OAI client)
4. Write `index.json` to registry dir

**Depends on:** Step 3  
**Tests:** Build index from sample plugins → verify embeddings present, file written

---

### Step 5: Discovery API
**Files:** `packages/registry/src/discovery/DiscoveryService.ts`, `packages/backend/api/registryRouter.ts`

Vector search over `index.json` to suggest plugins/agents/skills for a goal.

```typescript
class DiscoveryService {
  constructor(index: RegistryIndex)
  
  async suggest(goal: string, options?: { limit?: number }): Promise<Suggestion>
}

interface Suggestion {
  plugins: Array<{ name, description, score, agents: AgentSuggestion[] }>
  standaloneAgents: AgentSuggestion[]
  standaloneSkills: SkillSuggestion[]
}

interface AgentSuggestion {
  name: string;
  description: string;
  score: number;
  suggestedSkills: string[];
}
```

**API Endpoint:** `GET /api/registry/suggest?goal=<text>&limit=5`

**Flow:**
1. Embed goal text → query embedding
2. Cosine similarity against all index entries
3. Return top N ranked results with scores

**Depends on:** Step 4  
**Tests:** Query sample index with "build web app" → verify engineering team ranked highest

---

### Step 6: Team Creation from Plugin
**Files:** Modify `packages/backend/api/agentManagerHandlerV2.ts`

Refactor `POST /api/v2/teams` to support a new `pluginName` field. When provided, skip LLM role discovery and load directly from plugin.

```typescript
// NEW: Create team from plugin
POST /api/v2/teams
{
  name: "My Team",
  goal: "Build an e-commerce app",
  pluginName?: "engineering-team"    // ← NEW FIELD (optional)
}
```

**Flow when `pluginName` is provided:**
1. `PluginLoader.loadPlugin(pluginName)` → get agents + skills + mapping
2. Create team in DB via `services.teams.createTeam()`
3. For each agent in plugin:
   a. Create agent in DB via `services.agents.addAgent()`
   b. Auto-assign skills: `skillRegistry.assignSkillToAgent(agentId, skillId)` for each mapped skill
4. Register agent definitions in WorkerPool: `workerPool.registerDefinitions()`
5. Set role→agentId map: `workerPool.setRoleAgentIdMap()`
6. Return team + agents + skills (ready to run)

**Fallback:** If no `pluginName`, fall back to existing LLM-based role discovery.

**Depends on:** Step 3  
**Tests:** Create team via plugin → verify agents in DB, skills assigned, WorkerPool ready

---

### Step 7: Sample Team Plugins
**Files:** `packages/registry/plugins/engineering-team/`, `product-team/`, `research-team/`

Create 3 sample plugins matching current seed data but in the new format.

**Engineering Team plugin:**
```
plugins/engineering-team/
├── plugin.json
├── agents/
│   ├── backend-developer.md
│   ├── frontend-developer.md
│   ├── devops-engineer.md
│   └── qa-engineer.md
└── skills/
    ├── api-design/SKILL.md
    ├── security-review/SKILL.md
    ├── react-patterns/SKILL.md
    └── test-automation/SKILL.md
```

Each agent `.md` has:
- YAML frontmatter: name, role, description, defaultSkills, tags
- Body: system prompt with XML tags (`<role>`, `<instructions>`, `<constraints>`)

**Depends on:** Step 1, Step 2  
**Tests:** Load each plugin → verify all agents/skills parse correctly

---

### Step 8: Wire into Backend Startup
**Files:** Modify `packages/backend/server.ts` or `api/AgentManagerAPI.ts`

On backend startup:
1. Initialize `PluginLoader` with registry directory path
2. Load `index.json` (or rebuild if missing)
3. Initialize `DiscoveryService` with loaded index
4. Mount `/api/registry/*` routes

```typescript
// In server startup:
const pluginLoader = new PluginLoader(REGISTRY_DIR);
const index = await IndexBuilder.load(INDEX_PATH);
const discoveryService = new DiscoveryService(index);
app.use('/api/registry', createRegistryRouter(discoveryService, pluginLoader));
```

**Depends on:** Step 5, Step 6  
**Tests:** Start backend → hit `/api/registry/suggest?goal=web app` → get results

---

## File Summary

| New files | Purpose |
|-----------|---------|
| `packages/registry/src/parser/frontmatterParser.ts` | Parse .md → frontmatter + body |
| `packages/registry/src/converter/agentConverter.ts` | .md → AgentDefinition |
| `packages/registry/src/loader/PluginLoader.ts` | Load plugin folder → resolved agents + skills |
| `packages/registry/src/index/IndexBuilder.ts` | Build index.json with embeddings |
| `packages/registry/src/discovery/DiscoveryService.ts` | Vector search for suggestions |
| `packages/backend/api/registryRouter.ts` | REST API for registry endpoints |
| `packages/registry/plugins/engineering-team/*` | Sample plugin (3 total) |
| `packages/registry/plugins/product-team/*` | Sample plugin |
| `packages/registry/plugins/research-team/*` | Sample plugin |

| Modified files | Change |
|---------------|--------|
| `packages/backend/api/agentManagerHandlerV2.ts` | Add `pluginName` to POST /teams |
| `packages/backend/server.ts` or `api/AgentManagerAPI.ts` | Initialize registry on startup |
| `packages/registry/package.json` | Add `gray-matter` dependency |

## Dependencies (npm)

| Package | Purpose | Size |
|---------|---------|------|
| `gray-matter` | Parse Markdown frontmatter | ~5KB |

## Testing Strategy

1. **Unit tests (Steps 1-2):** Parser + converter with edge cases
2. **Integration tests (Steps 3-5):** Plugin loading, index building, discovery queries
3. **E2E test (Steps 6-8):** Create team from plugin via API → verify agents + skills in DB → verify WorkerPool ready

## Rollback

- Feature-flagged: `REGISTRY_ENABLED=true` (default false)
- Existing team creation (LLM role discovery) remains the fallback
- No database schema changes — uses existing Agent + AgentSkill models
- Plugin files are additive — no existing files modified except the team creation endpoint
