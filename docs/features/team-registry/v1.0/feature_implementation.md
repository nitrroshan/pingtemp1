# Team Registry v1.0 — Implementation

**Architecture**: [feature_architecture.md](../feature_architecture.md) | **Branch**: `user/sahuroshan/setupforcollabration-production`

## Completed (all 8 steps)

### Step 1: Frontmatter Parser
- **File**: `packages/registry/src/parser/frontmatterParser.ts`
- `parseFrontmatter()`, `parseAgentMd()`, `parseSkillMd()`, `parsePluginJson()`
- Uses `gray-matter` package (installed as dependency)

### Step 2: Agent Converter
- **File**: `packages/registry/src/converter/agentConverter.ts`
- `agentMdToDefinition(parsed)` → `AgentDefinition`
- Model aliases: sonnet/opus/haiku/gpt-4o/o3/inherit
- Validates required XML tags: `<agent-identity>`, `<domain-instructions>`, `<domain-constraints>`
- Maps all frontmatter fields per architecture spec

### Step 3: Plugin Loader
- **File**: `packages/registry/src/loader/PluginLoader.ts`
- `PluginLoader.loadPlugin(name)`, `loadAllPlugins()`, `getPluginManifests()`
- Supports `.claude-plugin/plugin.json` (Claude Code) and `plugin.json` (root) formats
- Loads agents from `agents/*.md`, skills from `skills/*/SKILL.md`

### Step 4: Index Builder
- **File**: `packages/registry/src/index/IndexBuilder.ts`
- `IndexBuilder.build(loader)` — generates embeddings via AI SDK `embedMany()`
- Uses `text-embedding-3-small` model
- `IndexBuilder.save()` / `IndexBuilder.load()` for persistence

### Step 5: Discovery Service + API
- **Files**: `packages/registry/src/discovery/DiscoveryService.ts`, `packages/backend/api/registryRouter.ts`
- `DiscoveryService.suggest(goal, { limit })` — cosine similarity search
- API: `GET /api/registry/suggest?goal=<text>&limit=5`
- API: `GET /api/registry/plugins`, `GET /api/registry/plugins/:name`

### Step 6: Team Creation from Plugin
- **File**: Modified `packages/backend/api/agentManagerHandlerV2.ts`
- `POST /api/v2/teams` now accepts optional `pluginName` field
- When `pluginName` provided: loads from plugin, skips LLM role discovery
- Stores `systemPrompt`, `goal`, and `pluginConfig` (JSON) in DB agent records
- Legacy LLM discovery preserved as fallback

### Step 7: Sample Team Plugins (4)
- `packages/registry/plugins/engineering-team/` — 4 agents, 4 skills, 3 modes
- `packages/registry/plugins/product-team/` — 3 agents, 1 skill
- `packages/registry/plugins/research-team/` — 2 agents, 1 skill
- `packages/registry/plugins/marketing-team/` — 3 agents, 1 skill, 3 modes

### Step 8: Backend Startup Wiring
- Modified `packages/backend/api/HttpServer.ts`
- Lazy-mounted registry routes at `/api/registry`
- Added `@ping/registry` as workspace dependency
- Registry package.json updated with explicit exports

### Step 9: End-to-End Runtime Wiring (Critical Fix)
- **Problem**: Plugin systemPrompts and configs were stored in DB but lost at runtime
- **Root cause**: `initializeOrchestrator()` only accepted role names, created hardcoded generic prompts
- **Fix**: Extended `Agent` type with `systemPrompt`, `goal`, `pluginConfig` fields
- Modified `AgentManagerRegistry.loadTeam()` to pass full agent data to `initializeOrchestrator()`
- Modified `AgentManagerV2.initializeOrchestrator()` to accept `agentData` parameter
- When plugin data exists: uses custom systemPrompt + parsed pluginConfig (model, tools, skills)
- When no plugin data: falls back to generic worker prompt (backward compatible)
- Updated `MongoAgentService` and `AgentRoleSchema` to store/return `pluginConfig`
- Extracted generic prompt into `getGenericWorkerPrompt()` function

## Key Decisions
- Registry tsconfig extended root (switched from `bundler` to `nodenext` resolution)
- All internal imports use `.js` extensions for nodenext compatibility
- HttpServer uses lazy initialization — registry modules loaded on first request
- AgentDefinition types duplicated in converter (avoids cross-package import issues)
- Plugin config serialized as JSON string in `pluginConfig` field (avoids schema changes for future config fields)

## What's Next (v1.1)
- Meta-team (4 agents: Registry Scout, Skill Builder, Agent Builder, Team Builder)
- Team modes system + Mode Selector UI
- Discovery tools (search_skills, search_agents, etc.)
- Tool call UI for interactive suggestions
- Auto-reindex on registry file changes
