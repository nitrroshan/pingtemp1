# Meta-Team Plugin Builder — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)
**Plugin Ecosystem:** [Plugin Ecosystem Architecture](../feature_architecture.md)

---

## Branch
- `feature/meta-team-builder` (branches from `dev`)

## Scope

Build the meta-team — a built-in plugin whose 2 agents (Research Analyst + Plugin Author) can build other plugins. The meta-team uses existing infrastructure: DiscoveryService for search, WorkspacePlugin for file creation, PluginLoader for validation.

**What already exists:**
- `DiscoveryService` — vector search across plugins/agents/skills (packages/registry/src/discovery/)
- `PluginLoader` — reads plugin manifests, agents, skills from filesystem (packages/registry/src/loader/)
- `PluginTeamService` — projects plugins as teams, deterministic SHA256 team IDs (packages/backend/services/)
- `WorkspacePlugin` — 32 workspace tools (Read, Write, Edit, Bash, etc.)
- `AgentManagerRegistry` — lazy-loads teams on first message
- Plugin format spec — `.ping-plugin/plugin.json`, `agents/*.md`, `skills/*/SKILL.md` (documented in parent)

**What we build:**
- 2 agent definition files (`research-analyst.md`, `plugin-author.md`)
- 3 skill files (`plugin-format/SKILL.md`, `agent-design/SKILL.md`, `team-composition/SKILL.md`)
- 5 discovery tool wrappers (AI SDK `tool()` format calling DiscoveryService)
- 1 `validate_plugin` tool
- Optional `planner.md` with meta-team-specific planning instructions
- Plugin manifest (`.ping-plugin/plugin.json`)

---

## Files

### New Files (all in `packages/registry/plugins/meta-team/`)

| File | Purpose |
|------|---------|
| `.ping-plugin/plugin.json` | Plugin manifest: name, modes, settings |
| `agents/research-analyst.md` | Agent 1: discovery, gap analysis, composition planning |
| `agents/plugin-author.md` | Agent 2: file generation, validation, workspace output |
| `agents/planner.md` | Optional custom planner for meta-team-specific planning |
| `skills/plugin-format/SKILL.md` | How to write valid `.ping-plugin/` structures (all component types) |
| `skills/agent-design/SKILL.md` | How to write effective agent definitions (XML tags, tools, models) |
| `skills/team-composition/SKILL.md` | How to decompose domains into agent roles (patterns, when to specialize) |

### New Files (backend tools)

| File | Package | Purpose |
|------|---------|---------|
| `services/tools/discoveryTools.ts` | `@ping/agent-manager` | 5 AI SDK tools wrapping DiscoveryService: `search_plugins`, `search_agents`, `search_skills`, `get_item_details`, `check_duplicates` |
| `services/tools/validatePluginTool.ts` | `@ping/agent-manager` | `validate_plugin` tool — runs validation rules from plugin spec §1.10 |

### Modified Files

| File | Package | Change |
|------|---------|--------|
| `loader/PluginLoader.ts` | `@ping/registry` | Add `.ping-plugin/` path support (keep `.claude-plugin/` compat). ~3 lines |
| `services/WorkerPool.ts` | `@ping/agent-manager` | Inject discovery tools when role matches meta-team roles. Uses existing `pluginRegistry.getTools()` pattern |

---

## Implementation Steps

### Step 1: Plugin Manifest + Directory Structure
**Deps:** None

- [ ] Create `packages/registry/plugins/meta-team/.ping-plugin/plugin.json`:
  ```json
  {
    "name": "meta-team",
    "description": "Builds Ping plugins — searches existing components, creates new teams",
    "version": "1.0.0",
    "keywords": ["meta", "plugin-builder", "team-creation"],

    "ping": {
      "team": {
        "executionMode": "sequential",
        "maxConcurrency": 1
      },
      "modes": {
        "build": {
          "description": "Research and build a new plugin/team",
          "activeAgents": ["research-analyst", "plugin-author"],
          "icon": "hammer"
        }
      },
      "discovery": {
        "tags": ["meta", "plugin-builder", "team-creation"],
        "category": "operations",
        "icon": "hammer"
      }
    }
  }
  ```
- [ ] Create directory structure: `agents/`, `skills/plugin-format/`, `skills/agent-design/`, `skills/team-composition/`

**Exit:** Directory exists, manifest valid

### Step 2: Write Agent Definitions
**Deps:** Step 1

- [ ] `agents/research-analyst.md`:
  - Role: `research-analyst`
  - Tools: Read, Grep, Glob (workspace read-only) + discovery tools
  - Skills: `plugin-format`, `team-composition`
  - System prompt: `<agent-identity>` (domain analyst), `<domain-instructions>` (search-first, gap analysis, structured composition plan output), `<domain-constraints>` (never create without searching first, output JSON composition plan)

- [ ] `agents/plugin-author.md`:
  - Role: `plugin-author`
  - Tools: Read, Write, Edit, Bash, Grep, Glob (full workspace) + `validate_plugin`
  - Skills: `plugin-format`, `agent-design`
  - System prompt: `<agent-identity>` (plugin engineer), `<domain-instructions>` (read composition plan, write files, validate), `<domain-constraints>` (follow plugin spec exactly, all agents need XML tags, validate before completing)

- [ ] `agents/planner.md` (optional):
  - Role: `planner`
  - Domain-specific planning: always create 2 tasks (research → build), sequential dependency
  - Knows to pass composition plan from Task 1 output → Task 2 context

**Exit:** Agent files parse correctly via PluginLoader

### Step 3: Write Skill Files
**Deps:** Step 1

- [ ] `skills/plugin-format/SKILL.md`:
  - Name: `plugin-format`
  - Description: "Instructions for writing valid .ping-plugin/ structures"
  - Body: plugin.json schema, agent .md format (YAML frontmatter + XML body), SKILL.md format (Agent Skills standard), .mcp.json, hooks.json, modes, settings, validation rules
  - Keep under 500 lines (progressive disclosure — move reference tables to `references/` if needed)

- [ ] `skills/agent-design/SKILL.md`:
  - Name: `agent-design`
  - Description: "How to write effective agent definitions"
  - Body: role naming (lowercase, kebab-case), XML tag best practices (`<agent-identity>`, `<domain-instructions>`, `<domain-constraints>`), tool selection per domain, model selection guidance (sonnet default, opus for complex reasoning, haiku for simple), `defaultSkills` assignment

- [ ] `skills/team-composition/SKILL.md`:
  - Name: `team-composition`
  - Description: "How to decompose a domain into agent roles"
  - Body: common team patterns (engineering: backend/frontend/qa/devops, marketing: content/seo/social, support: triage/specialist/escalation), when to create specialists vs generalists, mode design patterns, planner customization guidelines

**Exit:** Skills load via PluginLoader, display in skill list

### Step 4: Discovery Tools
**Deps:** None (parallel with Steps 2-3)

- [ ] Create `services/tools/discoveryTools.ts` with 5 AI SDK tools:
  - `search_plugins` — `tool({ inputSchema: z.object({ query: z.string() }), execute: async ({ query }) => discoveryService.suggest(query, { type: "plugins" }) })`
  - `search_agents` — same pattern, `type: "agents"`
  - `search_skills` — same pattern, `type: "skills"`
  - `get_item_details` — `tool({ inputSchema: z.object({ type: z.enum(["plugin","agent","skill"]), name: z.string() }), execute: async ({ type, name }) => pluginLoader.loadItem(type, name) })`
  - `check_duplicates` — searches with threshold, returns boolean + matches

- [ ] Wire tools into PluginRegistry or WorkspacePlugin so they're available to meta-team roles
  - Option A: Create a MetaTeamPlugin that implements IPlugin, registers discovery tools as MCP server tools
  - Option B: Add discovery tools directly in SkillPlugin when team is meta-team (simpler, less generic)
  - **Recommended: Option A** — clean separation, follows existing plugin pattern

**Exit:** Tools callable by meta-team agents during task execution

### Step 5: Validate Plugin Tool
**Deps:** Step 3 (needs plugin format spec for validation rules)

- [ ] Create `services/tools/validatePluginTool.ts`:
  - Input: `z.object({ pluginPath: z.string() })` — path to plugin directory in workspace
  - Runs validation rules from plugin spec §1.10:
    - Manifest exists (`.ping-plugin/plugin.json`)
    - Required fields (`name`, `description`)
    - At least one agent in `agents/`
    - Agent frontmatter has `name`, `role`, `description`
    - Agent body has XML tags (warning)
    - No duplicate roles
    - Max one planner
    - Modes reference valid agent names
    - Skill frontmatter has `name`, `description`
    - `defaultSkills` reference existing skills
  - Returns: `{ valid: boolean, errors: string[], warnings: string[] }`

**Exit:** Tool validates plugin structure and returns actionable feedback

### Step 6: `.ping-plugin/` Support in PluginLoader
**Deps:** None (parallel)

- [ ] Modify `PluginLoader.hasManifest()`: add `.ping-plugin/plugin.json` as primary path, keep `.claude-plugin/` and root fallbacks
- [ ] Modify `PluginLoader.loadManifest()`: read from `.ping-plugin/` first
- [ ] ~3-5 lines of code change

**Exit:** PluginLoader reads `.ping-plugin/` manifests. Existing `.claude-plugin/` plugins still work

### Step 7: End-to-End Test
**Deps:** Steps 1-6

- [ ] Test: User sends "I need a content marketing team" to meta-team
  - Planner creates 2 tasks (research → build)
  - Research Analyst searches registry, produces composition plan
  - Plugin Author writes plugin files to workspace
  - `validate_plugin` passes on generated output
- [ ] Test: User sends "Add a QA agent to engineering-team"
  - Research Analyst reads existing plugin, searches for QA agents
  - Plugin Author creates `agents/qa-engineer.md`, updates modes in `plugin.json`
  - Validation passes
- [ ] Test: Validation catches errors
  - Missing manifest → error
  - Duplicate roles → error
  - Missing XML tags → warning

**Exit:** Meta-team produces valid plugins from natural language goals

---

## Complexity Estimate

| Step | Estimate | Notes |
|------|----------|-------|
| Step 1: Manifest + dirs | 0.25 day | JSON + mkdir |
| Step 2: Agent definitions | 1 day | 2-3 agent .md files with careful system prompts |
| Step 3: Skill files | 1 day | 3 SKILL.md files, detailed but concise |
| Step 4: Discovery tools | 1 day | 5 tool wrappers + MetaTeamPlugin |
| Step 5: Validate plugin tool | 0.5 day | Validation logic from spec |
| Step 6: `.ping-plugin/` support | 0.25 day | 3-5 lines in PluginLoader |
| Step 7: E2E test | 1 day | Integration testing with LLM |

**Total: ~5 days**

---

## What's NOT in Scope (Future)

- Marketplace publish API (separate feature: team-registry v2.0)
- Plugin dependency resolution (P13 in plugin-ecosystem)
- Hooks engine execution (P4)
- MCP server launch from `.mcp.json` (P5)
- Channel message injection (P11)
