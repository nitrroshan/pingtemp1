# Plugin Ecosystem — Feature Architecture

**Status:** Architecture Draft  
**Date:** May 1, 2026  
**ID:** H1  
**Depends on:** Plugin Taxonomy (A3), Team Registry (team-registry)  
**Feeds into:** Marketplace (team-registry v2.0), External Agent Invocation (A7)  
**Related features:** [plugin-taxonomy](../plugin-taxonomy/feature_architecture.md), [team-registry](../team-registry/feature_architecture.md), [company-templates](../company-templates/feature_architecture.md), [external-agent-invocation](../external-agent-invocation/feature_architecture.md), [ping-mcp-server](../ping-mcp-server/feature_architecture.md)

---

## Overview

**A plugin IS a team.** A Ping plugin folder contains agents + skills + an optional planner — when loaded, it becomes a team with a planner on top. Ping's format uses `.ping-plugin/` (not `.claude-plugin/`) to distinguish our plugins from Claude Code's, because Ping plugins have additional components (planner, modes, team orchestration).

### Core Equation

```
Ping Plugin  = agents + skills + MCP servers + planner (optional)
Ping Team    = Plugin + Runtime (WorkerPool, OrchestratorService, Workspace, Collab, Knowledge)
```

### Lifecycle

1. **Install** a plugin (from marketplace, GitHub, or local) → you now have a new team available
2. **Select** a team → give it a goal → planner plans → agents execute
3. **Offboard** a team → goals must finish/cancel first
4. **Create** plugins → meta-team or manual

---

## 1. Ping Plugin Format Specification

### 1.1 Standards Compliance

Ping plugins follow two standards:

1. **Agent Skills** (agentskills.io) — Open standard for skills (`SKILL.md` format). Adopted by 30+ products: Claude Code, GitHub Copilot, Cursor, OpenAI Codex, Gemini CLI, VS Code, Kiro, JetBrains Junie, Roo Code, and more. Ping follows this spec exactly for the `skills/` directory.

2. **Claude Code Plugin Format** (`.claude-plugin/`) — The most comprehensive plugin format covering agents, hooks, MCP servers, LSP servers, monitors, themes, channels, and more. No open standard exists for this broader scope. Ping supports all Claude Code components, using `.ping-plugin/` as the manifest directory while maintaining backward compatibility with `.claude-plugin/`.

### 1.2 Directory Structure

```
my-plugin/
├── .ping-plugin/                    # Ping plugin metadata (required)
│   └── plugin.json                    # Manifest (name is the only required field)
├── agents/                          # Agent definitions (required for Ping, ≥1 file)
│   ├── planner.md                     # Optional custom planner (role: planner) — Ping-specific
│   ├── backend-developer.md           # Worker agents
│   ├── frontend-developer.md
│   └── qa-engineer.md
├── skills/                          # Skills — Agent Skills standard (optional)
│   ├── api-design/
│   │   └── SKILL.md
│   ├── test-runner/
│   │   ├── SKILL.md
│   │   ├── scripts/                   # Executable scripts
│   │   ├── references/                # Reference docs
│   │   └── assets/                    # Templates, resources
│   └── security-review/
│       └── SKILL.md
├── commands/                        # Slash commands as flat .md files (optional)
│   ├── status.md
│   └── deploy.md
├── hooks/                           # Lifecycle event handlers (optional)
│   └── hooks.json
├── .mcp.json                        # MCP server configs (optional)
├── .lsp.json                        # LSP server configs (optional)
├── monitors/                        # Background monitor configs (optional)
│   └── monitors.json
├── output-styles/                   # Output style definitions (optional)
│   └── terse.md
├── themes/                          # Color theme definitions (optional)
│   └── dracula.json
├── bin/                             # Executables added to agent PATH (optional)
│   └── my-tool
├── scripts/                         # Hook and utility scripts (optional)
│   ├── format-code.sh
│   └── security-scan.py
├── settings.json                    # Default settings (optional)
├── LICENSE                          # License file (optional)
└── CHANGELOG.md                     # Version history (optional)
```

### 1.3 Component Support — Claude Code vs Ping

Ping supports **all** Claude Code plugin components, plus Ping-specific additions for team orchestration.

| Component | Claude Code | Ping | Status | Notes |
|-----------|:-----------:|:----:|:------:|-------|
| **Manifest** | `.claude-plugin/plugin.json` | `.ping-plugin/plugin.json` | ✅ Supported | Ping adds `modes`, `tags`, team `settings`. Reads `.claude-plugin/` for compat |
| **Skills** | `skills/*/SKILL.md` | `skills/*/SKILL.md` | ✅ Identical | Agent Skills open standard. Progressive disclosure. `scripts/`, `references/`, `assets/` |
| **Commands** | `commands/*.md` | `commands/*.md` | ✅ Supported | Flat .md files, slash-command style. Claude Code says "use skills/ for new plugins" |
| **Agents** | `agents/*.md` — subagents | `agents/*.md` — team members | ✅ Extended | Ping adds required `role` field, `defaultSkills`, `tags`. Body uses XML tags |
| **Hooks** | `hooks/hooks.json` | `hooks/hooks.json` | ✅ Identical | Same event types: `PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`, etc. Hook types: `command`, `http`, `mcp_tool`, `prompt`, `agent` |
| **MCP servers** | `.mcp.json` | `.mcp.json` | ✅ Identical | Supports `${CLAUDE_PLUGIN_ROOT}` / `${PING_PLUGIN_ROOT}` variable substitution |
| **LSP servers** | `.lsp.json` | `.lsp.json` | ✅ Supported | Code intelligence for agents (go-to-definition, diagnostics). Useful for code-writing agents |
| **Monitors** | `monitors/monitors.json` | `monitors/monitors.json` | ✅ Supported | Background watchers. Stdout lines → agent notifications. `when: "always"` or `"on-skill-invoke:<name>"` |
| **Themes** | `themes/*.json` | `themes/*.json` | ✅ Supported | Color themes with `base` preset + `overrides`. Applied to Ping frontend |
| **Output styles** | `output-styles/*.md` | `output-styles/*.md` | ✅ Supported | Response formatting templates |
| **Bin** | `bin/` — executables in PATH | `bin/` | ✅ Identical | Executables available to Bash tool calls |
| **Settings** | `settings.json` — default agent | `settings.json` | ✅ Extended | Ping adds team-level settings (executionMode, maxConcurrency) |
| **User config** | `userConfig` in manifest | `userConfig` in manifest | ✅ Supported | Prompted at enable time. `${user_config.*}` substitution in MCP/hooks |
| **Channels** | `channels` in manifest | `channels` in manifest | ✅ Supported | Message injection from Telegram/Slack/Discord via MCP server |
| **Dependencies** | `dependencies` array | `dependencies` array | ✅ Supported | Other plugins required, with optional semver constraints |
| **Planner** | N/A | `agents/planner.md` with `role: planner` | 🆕 Ping-only | Ping injects 20 planner tools + system prompt. See §2 |
| **Modes** | N/A | `modes` in manifest | 🆕 Ping-only | Which agents are active per mode (planning, implementation, review) |
| **Team settings** | N/A | `settings.executionMode`, `maxConcurrency` | 🆕 Ping-only | Team orchestration configuration |

### 1.4 Plugin Manifest (`plugin.json`)

```json
{
  "name": "engineering-team",
  "description": "Full-stack engineering team for web applications",
  "version": "1.0.0",
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "homepage": "...",
  "repository": "...",
  "license": "MIT",
  "keywords": ["engineering", "fullstack", "web"],

  "tags": ["engineering", "fullstack", "web"],

  "settings": {
    "executionMode": "sequential",
    "maxConcurrency": 1
  },
  "modes": {
    "planning": {
      "description": "Architecture and design discussions",
      "activeAgents": ["backend-developer", "frontend-developer"],
      "icon": "pencil"
    },
    "implementation": {
      "description": "Write and ship code",
      "activeAgents": ["backend-developer", "frontend-developer", "qa-engineer"],
      "icon": "code"
    },
    "review": {
      "description": "Code review and quality checks",
      "activeAgents": ["qa-engineer", "backend-developer"],
      "icon": "check"
    }
  },

  "userConfig": {
    "api_endpoint": {
      "type": "string",
      "title": "API endpoint",
      "description": "Your team's API endpoint"
    }
  },

  "dependencies": [
    "helper-lib",
    { "name": "secrets-vault", "version": "~2.1.0" }
  ]
}
  }
}
```

| Field | Required | Claude Code | Ping | Notes |
|-------|:--------:|:-----------:|:----:|-------|
| `name` | ✅ | ✅ | ✅ | Unique identifier, kebab-case |
| `description` | Optional | Optional | Optional | Used for discovery |
| `version` | Optional | Optional | Optional | Semver. If omitted, git SHA used |
| `author` | Optional | Optional | Optional | `{ name, email?, url? }` |
| `homepage` | Optional | Optional | Optional | Documentation URL |
| `repository` | Optional | Optional | Optional | Source code URL |
| `license` | Optional | Optional | Optional | License identifier |
| `keywords` | Optional | Optional | Optional | Discovery tags (Claude Code name) |
| `tags` | — | — | Optional | Discovery tags (Ping alias for `keywords`) |
| `skills` | Optional | Optional | Optional | Custom skill path override |
| `commands` | Optional | Optional | Optional | Custom commands path override |
| `agents` | Optional | Optional | Optional | Custom agents path override |
| `hooks` | Optional | Optional | Optional | Hook config path or inline |
| `mcpServers` | Optional | Optional | Optional | MCP config path or inline |
| `lspServers` | Optional | Optional | Optional | LSP config path or inline |
| `monitors` | Optional | Optional | Optional | Monitor config path or inline |
| `outputStyles` | Optional | Optional | Optional | Output style path |
| `themes` | Optional | Optional | Optional | Theme files path |
| `userConfig` | Optional | Optional | Optional | User-configurable values prompted at enable |
| `channels` | Optional | Optional | Optional | Message injection channel declarations |
| `dependencies` | Optional | Optional | Optional | Required plugins with optional semver |
| `modes` | — | — | Optional | **Ping-only**: team mode switching |
| `settings` | — | — | Optional | **Ping-only**: `executionMode`, `maxConcurrency` |

### 1.4 Agent Definition Format (`.md`)

```markdown
---
name: backend-developer
description: Senior backend engineer for Node.js/TypeScript APIs
role: backend
model: sonnet
tools: [Read, Write, Bash, Edit, Grep, Glob]
defaultSkills: [api-design, security-review]
tags: [backend, node, typescript, api]
---

<agent-identity>
You are a senior backend engineer specializing in Node.js and TypeScript.
You have 10+ years of experience building production APIs and microservices.
</agent-identity>

<domain-instructions>
When given a coding task:
1. Analyze requirements before writing code
2. Write production-ready TypeScript with proper error handling
3. Include input validation at API boundaries
4. Follow RESTful conventions for endpoints
5. Write tests for critical paths
</domain-instructions>

<domain-constraints>
- Never expose internal errors to clients — return generic error messages
- Always validate user input at system boundaries
- Use parameterized queries — no string concatenation for SQL
- No secrets in code — use environment variables
</domain-constraints>
```

| Field | Required | Claude Code | Ping | Notes |
|-------|:--------:|:-----------:|:----:|-------|
| `name` | ✅ | ✅ | ✅ | Agent identifier |
| `description` | ✅ | ✅ | ✅ | What the agent does |
| `role` | ✅ | — | ✅ | **Ping-only**: WorkerPool key, must be unique |
| `model` | Optional | ✅ | ✅ | `sonnet`, `opus`, `haiku`, `gpt-4o`, etc. |
| `tools` | Optional | ✅ | ✅ | Tool allowlist |
| `defaultSkills` | — | — | Optional | **Ping-only**: auto-assigned skills |
| `tags` | — | — | Optional | **Ping-only**: discovery |
| `maxTurns` | Optional | ✅ | ✅ | Max agentic turns |
| `disallowedTools` | Optional | ✅ | ✅ | Tool denylist |
| `memory` | Optional | ✅ | ✅ | Persistent memory scope |
| `effort` | Optional | ✅ | ✅ | Reasoning effort level |
| `skills` | Optional | ✅ | — | Claude Code preloads skills at startup |
| `isolation` | Optional | ✅ | ✅ | `"worktree"` for git isolation |
| `hooks` | Optional | — (not in plugins) | — | Not supported in plugin agents |
| `mcpServers` | Optional | — (not in plugins) | — | Not supported in plugin agents |
| `permissionMode` | Optional | — (not in plugins) | — | Not supported in plugin agents |
| Body (system prompt) | ✅ | Free-form | XML tags required | Ping requires `<agent-identity>`, `<domain-instructions>`, `<domain-constraints>` |

### 1.5 Planner Definition (`planner.md`)

A planner is an agent with `role: planner`. Ping detects this and treats it specially.

```markdown
---
name: engineering-planner
role: planner
model: sonnet
description: Plans software engineering tasks with emphasis on TDD
---

<agent-identity>
You are a technical project planner specializing in agile software development.
You break goals into implementation tasks with clear acceptance criteria.
</agent-identity>

<domain-instructions>
1. Always start with a design/architecture task before implementation
2. Separate backend and frontend tasks — never combine
3. Include a testing task for every implementation task
4. Never assign more than 2 concurrent tasks to the same agent
</domain-instructions>

<domain-constraints>
- Do not create tasks that span multiple agent specialties
- Always include rollback considerations for deployment tasks
- Security review must be a prerequisite for any auth-related task
</domain-constraints>
```

**What Ping injects on top (plugin author doesn't touch):**

| Injected by Ping | Source | Purpose |
|------------------|--------|---------|
| 20 planner tools | `createPlannerTools()` | create_plan, approve_plan, get_status, update_task, add_tasks, remove_task, reprioritize, reassign_task, replan, cancel_task, ask_user, tell_user, etc. |
| Planning system prompt | `agent/prompts/planner/*.xml` | Core planning behaviors, lifecycle rules, output formats |
| Team context | Plugin manifest + agent definitions | `{{teamRoles}}`, `{{teamMembers}}` — who's on the team |
| Goal-scoped context | `GoalManager` | taskProvider, callbacks, planStore, dagResolver |

If no `planner.md` exists, Ping uses the system planner (`planner.yaml`) with team context injection.

### 1.7 Skill Definition (`SKILL.md`) — Agent Skills Open Standard

Follows the [Agent Skills specification](https://agentskills.io/specification) exactly. This is the industry standard adopted by 30+ AI products.

```markdown
---
name: api-design
description: REST API design patterns and conventions. Use when designing endpoints or reviewing API consistency.
license: Apache-2.0
compatibility: Requires Node.js 18+
metadata:
  author: engineering-team
  version: "1.0"
allowed-tools: Read Grep
---

## API Design Conventions
1. Use RESTful naming: plural nouns for resources
2. Return consistent error formats: `{ error, code }`
3. Include request validation with Zod schemas
```

| Field | Required | Notes |
|-------|:--------:|-------|
| `name` | ✅ | 1-64 chars, lowercase alphanumeric + hyphens, must match directory name |
| `description` | ✅ | 1-1024 chars. Describes what + when to use |
| `license` | Optional | License name or reference to bundled file |
| `compatibility` | Optional | Environment requirements (products, packages, network) |
| `metadata` | Optional | Arbitrary key-value mapping |
| `allowed-tools` | Optional | Space-separated pre-approved tools (experimental) |

**Progressive disclosure** (from Agent Skills spec):
1. **Discovery** (~100 tokens): `name` + `description` loaded at startup for all skills
2. **Activation** (< 5000 tokens): Full `SKILL.md` body loaded when skill matches task
3. **Execution** (as needed): `scripts/`, `references/`, `assets/` loaded on demand

Keep `SKILL.md` under 500 lines. Move detailed reference to separate files.

### 1.8 Hooks (`hooks/hooks.json`)

Same format as Claude Code. Hooks respond to lifecycle events with `command`, `http`, `mcp_tool`, `prompt`, or `agent` actions.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{ "type": "command", "command": "${PING_PLUGIN_ROOT}/scripts/format-code.sh" }]
      }
    ]
  }
}
```

**Supported hook events** (same as Claude Code):

| Event | When |
|-------|------|
| `SessionStart` | Session begins or resumes |
| `PreToolUse` | Before a tool call executes (can block) |
| `PostToolUse` | After a tool call succeeds |
| `PostToolUseFailure` | After a tool call fails |
| `PostToolBatch` | After a batch of parallel tool calls |
| `Stop` | Agent finishes responding |
| `SubagentStart` | Subagent spawned |
| `SubagentStop` | Subagent finishes |
| `TaskCreated` | Task created |
| `TaskCompleted` | Task completed |
| `Notification` | Notification sent |
| `FileChanged` | Watched file changes (matcher specifies filenames) |

### 1.9 Environment Variables

Ping provides the same variable substitution as Claude Code, plus Ping equivalents:

| Variable | Description |
|----------|-------------|
| `${PING_PLUGIN_ROOT}` | Absolute path to plugin installation directory (alias: `${CLAUDE_PLUGIN_ROOT}`) |
| `${PING_PLUGIN_DATA}` | Persistent data directory surviving updates (alias: `${CLAUDE_PLUGIN_DATA}`) |
| `${user_config.*}` | User-configured values from `userConfig` |
| `${ENV_VAR}` | Any environment variable |

Both `PING_PLUGIN_*` and `CLAUDE_PLUGIN_*` names are supported for backward compatibility.

### 1.10 Plugin Validation Rules

| Check | Rule | Severity |
|-------|------|----------|
| Manifest exists | `.ping-plugin/plugin.json` must exist | Error |
| Manifest fields | `name`, `description` required | Error |
| At least one agent | `agents/` must have ≥1 `.md` file | Error |
| Agent frontmatter | Each agent needs `name`, `role`, `description` | Error |
| Agent body tags | `<agent-identity>`, `<domain-instructions>`, `<domain-constraints>` required | Warning |
| No duplicate roles | Agent `role` fields must be unique within plugin | Error |
| Max one planner | At most one agent with `role: planner` | Error |
| Modes reference valid agents | `activeAgents` in modes must match agent names | Warning |
| Skill frontmatter | Each `SKILL.md` needs `name`, `description` | Warning |
| `defaultSkills` exist | Skills referenced in agents must exist in `skills/` | Warning |

---

## 2. Installing a Plugin → Getting a Team

### 2.1 The User Flow

```
User browses marketplace (or has a plugin path/URL)
  → Installs plugin (copies to local plugins dir)
  → Plugin appears as a new team in sidebar
  → User selects team, types a goal
  → Team initializes on first message (lazy)
  → Planner creates plan → workers execute tasks
```

Installing a plugin is like **hiring a team**. The marketplace is where you find teams. Once installed, the team is available for any goal.

### 2.2 Installation Sources

| Source | How | Example |
|--------|-----|---------|
| **Marketplace** | Browse + install from curated registry | `POST /api/v2/plugins/install { name: "engineering-team", marketplace: "official" }` |
| **GitHub** | Install from a GitHub repo URL | `POST /api/v2/plugins/install { source: "github", url: "https://github.com/org/my-plugin" }` |
| **Local path** | Point to a folder on disk | `POST /api/v2/plugins/install { source: "local", path: "./my-plugin" }` |
| **Built-in** | Ships with Ping | Already in `packages/registry/plugins/` |

### 2.3 What Happens on Install

```
POST /api/v2/plugins/install
  │
  ├─ 1. Resolve source → fetch plugin folder
  ├─ 2. Validate (see §1.10)
  ├─ 3. Copy to plugins directory (~/.ping/plugins/ or project-level)
  ├─ 4. PluginTeamService sees it on next listTeams()
  ├─ 5. Socket.IO broadcast: { type: "plugin:installed", teamId, name }
  ├─ 6. Frontend adds team to sidebar
  │
  ▼
  Plugin is installed. Team is NOT initialized yet.
  Initialization happens lazily on first message (see §2.4).
```

### 2.4 The Lazy-Loading Pattern (Team Initialization)

Teams are **NOT** initialized at server startup. They're created **on first message** via `AgentManagerRegistry`:

```
User sends first message to a team via Socket.IO
  │
  ▼
SocketServerV2: agentManagerRegistry.getForTeam(teamId)
  │
  ├─ Cache hit? → return cached AgentManager (fast path)
  │
  ├─ Already loading? → wait on existing Promise (race prevention)
  │
  └─ Cache miss → loadTeam(teamId)
       │
       ▼
     [Step 1] PluginTeamService.getTeam(teamId)
       → Reverse-maps teamId to pluginName (SHA-256 deterministic hash)
       → pluginNameToTeamId("engineering-team") → "a1b2c3d4-..."
       │
       ▼
     [Step 2] PluginTeamService.getTeamAgentDefinitions(teamId)
       → PluginLoader.loadPlugin(pluginName)
         → Reads .ping-plugin/plugin.json (manifest)
         → Parses agents/*.md → frontmatterParser → agentConverter → AgentDefinition[]
         → Parses skills/*/SKILL.md → SkillDefinition[]
       → Returns AgentDefinition[] with full systemPrompt + config
       │
       ▼
     [Step 3] Build teamRoles from AgentDefinitions
       → [{ role: "backend", name: "Backend Developer", systemPrompt: "...", pluginConfig: "{model:...}" }]
       │
       ▼
     [Step 4] new AgentManager()
       │
       ▼
     [Step 5] Register 4 runtime plugins:
       → WorkspacePlugin  (L1: git branches per task, 32 workspace tools)
       → SkillPlugin      (loads SKILL.md files, per-role filtering via roleSkillMap)
       → CollaborationPlugin (L2: CRDT shared memory, collab tool)
       → KnowledgePlugin     (L3: team knowledge base)
       │
       ▼
     [Step 6] manager.initializeOrchestrator(teamId, roles, roleAgentIdMap, agentData)
       │
       │  6a. pluginRegistry.initializeAll()
       │      → Each plugin runs initialize() (start CRDT server, scan skills, etc.)
       │
       │  6b. Build AgentDefinition[] for each role:
       │      → Has plugin data (systemPrompt, pluginConfig)? → Use custom definition
       │      → No plugin data? → Fall back to generic worker prompt
       │
       │  6c. workerPool.registerDefinitions(definitions)
       │      → Map<role, AgentDefinition> — definitions cached, NOT instantiated
       │
       │  6d. workerPool.setPluginRegistry(pluginRegistry)
       │      → Workers can now resolve tools + skills at task time
       │
       │  6e. Create OrchestratorService with:
       │      → WorkerPool, TaskStore, DependencyResolver
       │      → createPlanner factory (PlannerAgent per goal)
       │      → createChatAgent factory (ChatAgent per goal)
       │      → Callbacks (streaming, task updates)
       │
       │  6f. workerPool.setTaskServices(taskStore, dagResolver, teamRoles)
       │
       ▼
     [Step 7] Cache in AgentManagerRegistry.managers Map
       → TEAM IS READY
```

### 2.2 Worker Instantiation (Per-Task, Not Per-Team)

Workers are **NOT** created when the team loads. `registerDefinitions()` only stores definitions. Actual agent instances are created per-task:

```
Planner creates plan → task assigned to role "backend"
  │
  ▼
WorkerPool.runTask(taskId, role, message)
  │
  ├─ definition = definitions.get("backend")           // cached from step 6c
  ├─ agent = new AiSdkAgent(definition)                 // NEW instance per task
  ├─ tools = assembleLifecycleTools()                   // report_status, complete_task, etc.
  │         + pluginRegistry.getTools(ctx)               // workspace, collab, knowledge tools
  │         + pluginRegistry.getSkillInstructions(ctx)   // SKILL.md bodies → system prompt
  ├─ agent.setTools(tools)
  ├─ agent.execute(message)                             // AI SDK streamText() loop
  │     → yields AgentEvent (stream_part, message, done)
  │     → forwarded via Socket.IO to frontend
  ├─ On success: pluginRegistry.onTaskComplete(taskId)
  └─ On failure: pluginRegistry.onTaskFailed(taskId)
```

### 2.3 Planner Creation (Per-Goal)

```
User sends goal → OrchestratorService receives message
  │
  ▼
GoalManager.createPlanner(goalId)
  │
  ├─ new PlannerAgent({ agentFactory, teamRoles, teamId })
  ├─ planner.initialize()
  │     → agentFactory.createById("planner")    // loads planner.yaml (system)
  │     → Load XML system prompt with {{teamRoles}}, {{teamMembers}}
  ├─ Inject 20 planner tools via createPlannerTools()
  │     → Plan CRUD, knowledge, execution, mutation tools
  ├─ planner.setTools(tools)
  │
  ▼
  PlannerAgent ready — receives user goal, generates plan
```

**For Option C (planner in plugin):** Step would change to load from plugin's `planner.md` AgentDefinition instead of `planner.yaml`.

### 2.4 What Changes for `.ping-plugin/` (Migration from `.claude-plugin/`)

Currently `PluginLoader.hasManifest()` looks for `.claude-plugin/plugin.json` with fallback to `plugin.json`. Needs:

```typescript
// PluginLoader changes (3 lines)
private async hasManifest(pluginPath: string): Promise<boolean> {
  const pingPath = `${pluginPath}/.ping-plugin/plugin.json`;   // NEW — primary
  const claudePath = `${pluginPath}/.claude-plugin/plugin.json`; // Keep for backward compat
  const rootPath = `${pluginPath}/plugin.json`;                  // Fallback
  return (await this.storage.exists(pingPath))
      || (await this.storage.exists(claudePath))
      || (await this.storage.exists(rootPath));
}
```

Existing `.claude-plugin/` plugins continue to work. New plugins use `.ping-plugin/`.

---

## 3. Offboard a Team (Unload Plugin)

### 3.1 Offboard Rules

A team can only be offboarded when:
1. All active goals are **completed** or **cancelled**
2. No tasks are **in_progress**
3. User confirms the action

### 3.2 Offboard Flow

```
POST /api/v2/plugins/:pluginId/offboard
  │
  ├─ Check active goals → 409 if running
  ├─ Check in-progress tasks → 409 if any
  │
  ▼ (all clear)
  1. AgentManagerRegistry.remove(teamId)  → calls manager.dispose()
  2. WorkerPool stops all workers
  3. PluginRegistry disposes all plugins (workspace cleanup, CRDT shutdown)
  4. Socket.IO: { type: "plugin:offboarded", teamId }
  5. Frontend removes team from sidebar
```

### 3.3 Soft Disable vs Hard Remove

| Action | API | Effect |
|--------|-----|--------|
| **Disable** | `POST /plugins/:id/disable` | Hidden from sidebar, no new goals, existing goals continue |
| **Offboard** | `POST /plugins/:id/offboard` | Full removal — requires no active goals |
| **Delete files** | `DELETE /plugins/:id?deleteFiles=true` | Offboard + delete plugin folder |

---

## 4. Create Plugins

### 4.1 Via Meta-Team

The meta-team (`packages/registry/plugins/meta-team/`) has Team Building mode:

```
User selects Ping team → Team Building mode → describes what team they need
  → Registry Scout searches existing agents/skills
  → Team Builder composes .ping-plugin/ folder
  → Plugin written to registry/plugins/
  → Auto-available on next team access
```

### 4.2 Manual Creation

```bash
# 1. Create structure
mkdir -p my-team/.ping-plugin my-team/agents my-team/skills

# 2. Write manifest
cat > my-team/.ping-plugin/plugin.json << 'EOF'
{
  "name": "my-team",
  "description": "My custom team",
  "version": "1.0.0"
}
EOF

# 3. Write agent (see §1.4 for full format)
# 4. Write skills (see §1.6)
# 5. Copy to plugins dir
cp -r my-team packages/registry/plugins/
```

---

## 5. Plugin Installation API

### 5.1 Endpoints

```
POST /api/v2/plugins/install
  Body: { source: "marketplace", name: "engineering-team" }
  Body: { source: "github", url: "https://github.com/org/my-plugin" }
  Body: { source: "local", path: "/path/to/my-plugin" }
  Response: { teamId, pluginId, name, agents: [...], skills: [...] }

GET /api/v2/plugins
  Response: [{ id, name, version, teamId, status, agentCount, skillCount }]

GET /api/v2/plugins/:pluginId
  Response: { id, name, manifest, agents, skills, status }

POST /api/v2/plugins/:pluginId/reload
  Response: { changes: { added: [...], removed: [...], modified: [...] } }

DELETE /api/v2/plugins/:pluginId
  → Offboard flow (see §3)
```

### 5.2 Installation Scopes

Where the plugin is stored determines who can use it:

| Scope | Location | Visibility |
|-------|----------|------------|
| **User** | `~/.ping/plugins/` | Available across all projects for this user |
| **Project** | `./.ping/plugins/` | Shared with team via version control |
| **Built-in** | `packages/registry/plugins/` | Ships with Ping |

### 5.3 Architecture Fit

The architecture already supports runtime installation — `AgentManagerRegistry` is lazy-loading. Installing a plugin just means making the folder visible to `PluginLoader`. The first message to the team triggers full initialization.

---

## 6. Dependency Map

```
plugin-ecosystem (H1)
    ├── depends on ──► plugin-taxonomy (A3): IPlugin interface, PluginRegistry
    ├── depends on ──► team-registry: PluginLoader, PluginTeamService, meta-team
    ├── correlates ──► company-templates (A11): template = dehydrated plugin
    ├── correlates ──► external-agent-invocation (A7): McpBridgePlugin for MCP tools
    ├── correlates ──► ping-mcp-server: Ping team exposed AS an MCP server
    └── feeds into ──► team-registry v2.0: marketplace, install/publish
```

---

## 7. Implementation Priority

| Priority | Component | What | Effort |
|----------|-----------|------|--------|
| P0 | `.ping-plugin/` support | Add `.ping-plugin/` path to PluginLoader (keep `.claude-plugin/` compat) | Trivial |
| P1 | Planner-in-plugin | Detect `role: planner`, wire into `createPlanner()`, merge prompts | Medium |
| P2 | Plugin validation API | Strict validation per Agent Skills spec + Ping rules (see §1.10) | Low |
| P3 | Commands support | Load `commands/*.md` as flat skill files | Low |
| P4 | Hooks engine | Process `hooks/hooks.json` events during agent lifecycle | Medium |
| P5 | MCP server launch | Start `.mcp.json` servers on plugin load, inject tools | Medium |
| P6 | LSP server launch | Start `.lsp.json` servers, feed diagnostics to agents | Medium |
| P7 | Monitors | Start background processes from `monitors/monitors.json` | Medium |
| P8 | Install API | `POST /plugins/install` from marketplace/GitHub/local + Socket.IO notification | Medium |
| P9 | Offboard API | `POST /plugins/:id/offboard` with goal checks | Medium |
| P10 | User config | Parse `userConfig`, prompt user, substitute `${user_config.*}` | Medium |
| P11 | Channels | Message injection from external platforms via MCP | High |
| P12 | Themes/Output styles | Apply plugin themes to frontend, output style templates | Low |
| P13 | Dependencies | Plugin dependency resolution with semver constraints | Medium |
| P14 | Rename existing plugins | Rename `.claude-plugin/` → `.ping-plugin/` in registry/plugins/ | Trivial |

### Decisions Made

- **Format:** `.ping-plugin/plugin.json` as primary. Backward compat with `.claude-plugin/` and root `plugin.json`.
- **Standards:** Skills follow Agent Skills open standard (agentskills.io). All other components follow Claude Code format.
- **Full compatibility:** All 16 Claude Code plugin components supported — no "Not supported" gaps.
- **Planner:** Option C — planner as agent in plugin. Ping injects 20 tools + system prompt + team context.
- **Ping additions:** `modes` (team mode switching), `role` on agents, `defaultSkills`, team `settings`.
- **Loading:** Lazy — `AgentManagerRegistry` creates team on first message.
- **Workers:** Per-task instantiation — `WorkerPool` stores definitions, creates `AiSdkAgent` per task.
