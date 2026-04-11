# Team Registry v1.0 — Implementation Planning

**Architecture**: [feature_architecture.md](../feature_architecture.md)

## Branch
`feature/team-registry-v1.0`

## Scope — MVP

v1.0 delivers: **Load a team plugin → agents + skills auto-assigned → ready to run.**

| In scope | Out of scope (v1.1+) |
|----------|---------------------|
| Markdown + YAML frontmatter parser | Meta-team (team of agents building teams) |
| Plugin folder structure + loader | Team Builder UI with editable suggestions |
| Agent .md → AgentDefinition conversion | S3 hosting / remote registry |
| Skill SKILL.md loading as prompt injection | Plugin marketplace |
| Auto-assign skills on team creation | Plugin versioning / updates |
| index.json builder (embeddings) | |
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
        │
        │ Skills from SKILL.md
        │
        ├──── "instruction" skills (most) ────▶ agent.appendSystemPrompt()
        │     (conventions, patterns,          (injected into context as text,
        │      procedures, knowledge)           like Claude Code does)
        │
        └──── "executable" skills (rare) ─────▶ tool() with real execute fn
              (has scripts/ to run,             (runs scripts, calls APIs)
               not just knowledge)
```

### Skill Resolution — Claude Code Model

Claude Code skills are **prompt injection, not tools**. A skill's SKILL.md body gets injected into
the conversation context as text. The agent reads it and follows the instructions using its
existing tools (Read, Write, Bash, etc.). No fake wrapper tool needed.

**Our SkillResolver.createToolSkill() is wrong** — it wraps skill content in a `tool()` that just
returns text when called. This wastes a tool call to read documentation.

**Correct approach:**
- Most skills → `agent.appendSystemPrompt(skillBody)` — inject text into context
- Executable skills (with `scripts/`) → real `tool()` that runs the script
- MCP skills → connect MCP server at agent startup

This matches the existing `PluginRegistry.getSkillInstructions()` which already does prompt injection.

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

Convert parsed agent `.md` files into the existing `AgentDefinition` interface that `AgentFactory` and `WorkerPool` already consume. Maps ALL frontmatter fields to their corresponding config.

```typescript
function agentMdToDefinition(parsed: ParsedDefinition): AgentDefinition {
  const fm = parsed.frontmatter;
  const body = parsed.body;

  // Validate required XML tags in body
  const requiredTags = ['agent-identity', 'domain-instructions', 'domain-constraints'];
  for (const tag of requiredTags) {
    if (!body.includes(`<${tag}>`) || !body.includes(`</${tag}>`)) {
      throw new Error(`Agent ${fm.name}: missing required <${tag}> tag in system prompt`);
    }
  }

  // Determine agent type
  const agentType: AgentType = fm.type || 'internal';

  // Build config based on type
  const config: InternalConfig | ExternalConfig = agentType === 'external'
    ? buildExternalConfig(fm)
    : buildInternalConfig(fm);

  return {
    id: fm.name,
    name: fm.name,
    role: fm.role,
    description: fm.description,
    type: agentType,
    goal: fm.description || '',
    systemPrompt: body,
    config,
    settings: {
      streaming: true,
      timeout: fm.timeout || 300_000,
      retries: fm.retries || 3,
    },
  };
}

function buildInternalConfig(fm: Record<string, any>): InternalConfig {
  return {
    // ── Model Configuration ──
    model: resolveModelConfig(fm.model),

    // ── Tool Configuration ──
    tools: (fm.tools || []).map((t: string | ToolConfig) =>
      typeof t === 'string'
        ? { name: t, type: 'builtin' as const }  // String shorthand: "Read" → { name: "Read", type: "builtin" }
        : t
    ),

    // ── Skills ──
    skills: fm.defaultSkills || fm.skills || [],

    // ── Memory ──
    memory: fm.memory ? {
      shortTerm: true,
      checkpoint: fm.memory === 'project' || fm.memory === 'user',
      longTerm: fm.memory === 'user',
    } : undefined,

    // ── Loop Control ──
    maxSteps: fm.maxTurns || fm.maxSteps || 0,       // 0 = autonomous (unlimited)
    maxTotalTokens: fm.maxTotalTokens || 500_000,

    // ── Extended Thinking ──
    thinking: fm.thinking || (fm.effort ? {
      enabled: true,
      reasoningEffort: fm.effort,   // "low" | "medium" | "high"
    } : undefined),

    // ── Structured Output (Builder mode) ──
    responseFormat: fm.responseFormat,
  };
}

function resolveModelConfig(model: any): ModelConfig {
  // String shorthand: "sonnet" → { provider: "anthropic", model: "claude-sonnet-4-..." }
  if (typeof model === 'string') {
    const MODEL_ALIASES: Record<string, ModelConfig> = {
      'sonnet':  { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      'opus':    { provider: 'anthropic', model: 'claude-opus-4-20250514' },
      'haiku':   { provider: 'anthropic', model: 'claude-haiku-4-20250414' },
      'gpt-4o':  { provider: 'azure-openai', deployment: 'gpt-4o-2' },
      'o3':      { provider: 'azure-openai', deployment: 'o3' },
      'inherit': { provider: 'azure-openai' },  // Use env defaults
    };
    return MODEL_ALIASES[model] || { provider: 'azure-openai' };
  }

  // Object: pass through with defaults
  if (typeof model === 'object' && model !== null) {
    return {
      provider: model.provider || 'azure-openai',
      model: model.model,
      deployment: model.deployment,
      baseUrl: model.baseUrl,
      temperature: model.temperature,
      maxTokens: model.maxTokens,
    };
  }

  // Default: Azure OpenAI from env
  return { provider: 'azure-openai' };
}

function buildExternalConfig(fm: Record<string, any>): ExternalConfig {
  return {
    endpoint: fm.endpoint || '',
    healthEndpoint: fm.healthEndpoint,
    auth: fm.auth ? {
      type: fm.auth.type || 'bearer',
      token: fm.auth.token,
      tokenEnvVar: fm.auth.tokenEnvVar,
    } : undefined,
    // Periodic health check, NOT a hard timeout
    healthCheck: {
      intervalMs: fm.healthCheckInterval || 30_000,    // Check every 30s (default)
      maxMissedChecks: fm.maxMissedChecks || 3,        // Kill after 3 missed checks (90s unresponsive)
    },
    retries: fm.retries || 3,
  };
}
```

**Required XML tags in system prompt body** (aligned with existing `PromptBuilder` / `WorkerPromptFactory`):

| Tag | Required | Purpose | Merges with |
|-----|:--------:|---------|-------------|
| `<agent-identity>` | ✅ | Who the agent is | Replaces default identity |
| `<domain-instructions>` | ✅ | Domain-specific procedures | Appended to `<behaviors>` |
| `<domain-constraints>` | ✅ | Domain-specific rules | Appended to `<rules>` |
| `<output-formats>` | Optional | Response formatting | Appended to `<output-formats>` |
| `<context>` | Optional | Background knowledge | Prepended to prompt |
| `<examples>` | Optional | Example I/O pairs | After instructions |
| `<collaboration>` | Optional | How to work with teammates | Appended to `<behaviors>` |
| `<tools-guidance>` | Optional | When/how to use tools | Appended to `<capabilities>` |

At runtime, `WorkerPromptFactory` injects generic operational tags (`<lifecycle>`, `<workspace>`, `<start-by-understanding>`, `<commit-frequently>`, `<no-fabrication>`, etc.) — these are NOT in the .md file.

**Full frontmatter → AgentDefinition mapping:**

| .md frontmatter | AgentDefinition field | Notes |
|----------------|----------------------|-------|
| `name` | `id`, `name` | Required |
| `role` | `role` | Required. Lowercase for WorkerPool |
| `description` | `goal`, `description` | Required |
| `type` | `type` | `internal` (default) / `external` / `agentic-ui` |
| `model` | `config.model` | String alias (`sonnet`/`opus`/`haiku`) or full ModelConfig object |
| `tools` | `config.tools` | String array (`[Read, Bash]`) auto-expanded to ToolConfig |
| `defaultSkills` | `config.skills` | Skills auto-assigned on team creation |
| `maxTurns` / `maxSteps` | `config.maxSteps` | 0 = autonomous (default) |
| `maxTotalTokens` | `config.maxTotalTokens` | Default: 500,000 |
| `thinking` | `config.thinking` | `{ enabled, budgetTokens?, reasoningEffort? }` |
| `effort` | `config.thinking.reasoningEffort` | Shorthand: `effort: high` → enables thinking |
| `memory` | `config.memory` | `project` / `user` → maps to shortTerm/checkpoint/longTerm |
| `responseFormat` | `config.responseFormat` | Makes agent a Builder (structured output mode) |
| `timeout` | `settings.timeout` | ms, default 300,000 |
| `retries` | `settings.retries` | Default 3 |
| `tags` | *(index metadata)* | Not in AgentDefinition — stored separately for discovery |
| `hooks` | *(plugin metadata)* | Loaded separately by PluginLoader |
| `mcpServers` | *(plugin metadata)* | Loaded separately by PluginLoader |
| Body (XML tags) | `systemPrompt` | Full body with XML tags |

**Depends on:** Step 1  
**Tests:** Convert sample agent .md → verify AgentDefinition shape matches what WorkerPool expects

---

### Step 3: Plugin Loader
**Files:** `packages/registry/src/loader/PluginLoader.ts`

Loads a plugin folder following Claude Code format: reads `.claude-plugin/plugin.json`, scans `agents/` for `.md` files, scans `skills/` for `SKILL.md` files.

```typescript
interface LoadedPlugin {
  manifest: PluginManifest;
  agents: AgentDefinition[];          // Converted from .md (each has config.skills)
  skills: SkillDefinition[];          // Parsed SKILL.md files
  modes?: Record<string, TeamMode>;   // From plugin.json "modes" field
  hooks?: HooksConfig;                // From hooks/hooks.json
  mcpServers?: Record<string, any>;   // From .mcp.json
  settings?: Record<string, any>;     // From settings.json
}

interface TeamMode {
  description: string;
  activeAgents: string[];             // Agent names active in this mode
  icon?: string;
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
4. Scan `skills/*/SKILL.md` → parse each
5. Optionally load `hooks/hooks.json` and `.mcp.json`
6. Return `LoadedPlugin` with everything resolved

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
3. Batch embed via AI SDK's `embedMany()` from `@ai-sdk/openai`
4. Write `index.json` to registry dir

```typescript
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';

const { embeddings } = await embedMany({
  model: openai.embedding('text-embedding-3-small'),
  values: descriptions,  // Array of "name + description + tags" strings
});
```

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
1. Embed goal text via AI SDK: `const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: goal })`
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
1. `PluginLoader.loadPlugin(pluginName)` → get agents + skills
2. Create team in DB via `services.teams.createTeam()`
3. For each agent in plugin:
   a. Create agent in DB via `services.agents.addAgent()`
   b. Skills come from agent's `config.skills` (from `defaultSkills` frontmatter)
4. Register agent definitions in WorkerPool: `workerPool.registerDefinitions()`
5. Set role→agentId map: `workerPool.setRoleAgentIdMap()`
6. Return team + agents + skills (ready to run)

**Fallback:** If no `pluginName`, fall back to existing LLM-based role discovery (until v1.1 meta-team replaces it).

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
- Body: system prompt with XML tags (`<agent-identity>`, `<domain-instructions>`, `<domain-constraints>`)

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
