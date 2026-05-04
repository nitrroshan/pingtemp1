# Meta-Team Plugin Builder — Feature Architecture

**Status:** Architecture Draft  
**Date:** May 1, 2026  
**Parent:** [Plugin Ecosystem](../feature_architecture.md)  
**Depends on:** Plugin Format Spec (H1), DiscoveryService, WorkspacePlugin  
**Code locations:** `packages/registry/plugins/meta-team/`, `packages/registry/src/discovery/DiscoveryService.ts`

---

## Problem

Users need to create Ping plugins (teams) without manually writing `.md` files, `SKILL.md` files, and `plugin.json` manifests. The meta-team is a **built-in plugin whose agents can build other plugins**. Today the meta-team has a manifest only — zero agents exist.

## Industry Research

### How Other Platforms Handle "Building Teams"

| Platform | Approach | Who creates agents? |
|----------|----------|-------------------|
| **CrewAI** | `crewai create crew <name>` CLI scaffolds YAML templates. User edits `agents.yaml` + `tasks.yaml` manually. No AI-assisted creation. | Human writes YAML |
| **Claude Code** | `plugin-dev` plugin teaches user to create plugins via skills/instructions. No AI that generates agent definitions. | Human writes .md files |
| **OpenAI Agents SDK** | No team builder. Agents defined in Python code. | Human writes code |
| **AutoGen** | No team builder. Teams defined in Python code. | Human writes code |

**Nobody has an AI team that builds other AI teams.** This is Ping's unique capability.

### What Makes Building Teams Hard

1. **Agent identity** — writing good `<agent-identity>` + `<domain-instructions>` + `<domain-constraints>` requires understanding the domain
2. **Role decomposition** — breaking "I need a marketing team" into the right set of roles (content writer, SEO specialist, social media manager, etc.)
3. **Skill assignment** — knowing which SKILL.md files each agent needs
4. **Tool selection** — which tools (Read, Write, Bash, etc.) each role requires
5. **Mode design** — which agents are active in planning vs execution vs review
6. **Planner customization** — domain-specific planning instructions

### Key Insight: Discovery-First

The meta-team shouldn't generate everything from scratch. It should:
1. **Search existing registry** for agents/skills that match the user's goal
2. **Suggest tested, proven components** before creating new ones
3. **Create new only when a gap exists** — and base new items on similar existing ones
4. **Compose** the final plugin from discovered + new components

This is like hiring: you look for qualified candidates first, then train new ones only for gaps.

---

## Architecture: Two Agents, Not Four

After research, **2 agents** are optimal, not 4. Here's why:

The original 4-agent design (registry-scout, skill-builder, agent-builder, team-builder) has a problem: the planner must create a complex dependency chain just to build one plugin. Agent Builder depends on Skill Builder's output. Team Builder depends on Agent Builder's output. Registry Scout feeds into all of them. This creates sequential bottlenecks and excessive coordination.

**Better: 2 specialized agents with clear domains.**

### Agent 1: Research Analyst

**Role:** `research-analyst`  
**Domain:** Discovery, gap analysis, requirements gathering

**What it does:**
1. Takes the user's goal ("I need a content marketing team")
2. Searches the registry via `search_plugins`, `search_agents`, `search_skills` tools
3. Analyzes what exists vs what's needed
4. Produces a **team composition recommendation**: which existing agents to reuse, which new agents to create, which skills to assign
5. Discusses the plan with the user for approval

**Tools:**
- `search_plugins` — vector search across plugin registry
- `search_agents` — find existing agent definitions by role/skill match
- `search_skills` — find existing SKILL.md files
- `get_item_details` — read full content of any agent/skill
- `check_duplicates` — verify an agent/skill doesn't already exist
- Workspace tools (Read) — read existing plugin files for reference

**Key output:** A structured composition plan:
```json
{
  "teamName": "content-marketing",
  "description": "Content marketing team for blog posts, social media, and SEO",
  "reuse": [
    { "type": "agent", "name": "content-writer", "source": "marketing-team", "modifications": "none" },
    { "type": "skill", "name": "seo-optimization", "source": "marketing-team" }
  ],
  "create": [
    { "type": "agent", "name": "social-media-manager", "role": "social-media", "description": "..." },
    { "type": "skill", "name": "brand-voice", "description": "..." }
  ],
  "modes": {
    "strategy": { "activeAgents": ["content-writer", "social-media-manager"] },
    "execution": { "activeAgents": ["content-writer", "social-media-manager"] }
  }
}
```

### Agent 2: Plugin Author

**Role:** `plugin-author`  
**Domain:** File generation, validation, workspace output

**What it does:**
1. Takes the composition plan from Research Analyst
2. Writes the actual files:
   - `.ping-plugin/plugin.json` manifest
   - `agents/*.md` files (new agents only — with proper XML tags)
   - `skills/*/SKILL.md` files (new skills only)
   - Optional `planner.md` with domain-specific planning instructions
3. Copies/references existing agents and skills from registry
4. Validates the complete plugin structure
5. Outputs the plugin to the workspace

**Tools:**
- Workspace tools (Read, Write, Bash, Edit, Grep, Glob) — full file creation capability
- `validate_plugin` — run validation rules against the generated plugin
- `get_item_details` — read existing agents/skills to copy or reference
- `list_models` — show available model options for agent definitions

**Key output:** Complete plugin folder written to workspace, ready to load.

### Why 2 Agents, Not 4

| 4-Agent Design | Problem |
|---------------|---------|
| Registry Scout as separate agent | Scout's output is just search results — the Research Analyst can do this directly with search tools |
| Skill Builder as separate agent | Creating SKILL.md is 10-20 lines of markdown — doesn't justify a dedicated agent. Plugin Author handles it |
| Agent Builder as separate agent | Creating agent.md is similar to SKILL.md — Plugin Author handles both |
| Team Builder as separate agent | "Composing" means writing plugin.json + copying files — Plugin Author handles it |

**With 2 agents:** Planner creates 2 tasks: "Research what we need" → "Build the plugin." Clean, simple, no coordination overhead.

**With 4 agents:** Planner creates 5-8 tasks with complex dependencies. More LLM calls, more failure points, same output.

### Why Not 1 Agent?

A single agent would work but would have a **huge system prompt** (research instructions + file generation instructions + validation rules). Splitting into 2 keeps each prompt focused:
- Research Analyst focuses on **what to build** (strategic)
- Plugin Author focuses on **how to build it** (tactical)

---

## Skills for Meta-Team Agents

The meta-team itself uses skills to be good at its job:

### `plugin-format/SKILL.md`
```
Instructions for writing valid .ping-plugin/ structures.
Covers ALL component types:
- Manifest: plugin.json schema, modes, settings, userConfig, dependencies
- Agents: .md format with YAML frontmatter + XML body tags
- Skills: SKILL.md frontmatter (Agent Skills standard), progressive disclosure
- MCP servers: .mcp.json format, ${PING_PLUGIN_ROOT} variable, server lifecycle
- LSP servers: .lsp.json format, extensionToLanguage mapping, transport options
- Hooks: hooks.json format, event types (PreToolUse, PostToolUse, etc.), hook types (command, http, mcp_tool, prompt, agent)
- Monitors: monitors.json format, when triggers, command variables
- Bin: executable scripts added to PATH
- Settings: settings.json for default agent and team config
```

### `agent-design/SKILL.md`
```
How to write effective agent definitions.
Role naming conventions, XML tag best practices,
tool selection guidelines per domain,
model selection (sonnet for most, opus for complex reasoning).
```

### `team-composition/SKILL.md`
```
How to decompose a domain into agent roles.
Common team patterns (engineering: backend/frontend/qa/devops,
marketing: content/seo/social/analytics, etc.).
When to create specialists vs generalists.
Mode design patterns.
```

---

## Flows

### Flow 1: Create New Plugin

```
User: "I need a team for content marketing - blog posts, social media, SEO"

1. PLANNER receives goal
   → Creates 2 tasks:
     Task 1: "Research existing agents/skills for content marketing" → research-analyst
     Task 2: "Build the content-marketing plugin" → plugin-author (depends on Task 1)

2. RESEARCH ANALYST executes Task 1:
   → search_agents("content marketing")
     Found: content-writer (marketing-team), copywriter (product-team)
   → search_skills("SEO content social media")
     Found: seo-optimization (marketing-team), social-media-strategy (marketing-team)
   → Gap analysis: no social-media-manager agent, no brand-voice skill
   → Produces composition plan (JSON)
   → Reports: "Found 2 reusable agents, 2 skills. Need to create 1 new agent + 1 new skill."

3. PLUGIN AUTHOR executes Task 2:
   → Reads composition plan from Task 1 output
   → Copies content-writer.md from marketing-team (with modifications)
   → Creates social-media-manager.md (new)
   → Copies seo-optimization/SKILL.md from marketing-team
   → Creates brand-voice/SKILL.md (new)
   → Writes .ping-plugin/plugin.json with modes
   → Writes planner.md with content marketing planning strategy
   → Runs validate_plugin → all checks pass
   → Reports: "Plugin 'content-marketing' created with 2 agents, 2 skills, 1 planner"

4. Plugin folder is in workspace → user reviews → loads into Ping
```

### Flow 2: Modify Existing Plugin (Add/Update Components)

The same 2 agents handle modifications to installed plugins. The planner interprets the user's goal as a modification task, not a creation task.

```
User: "Add Stripe MCP server to the engineering-team plugin"

1. PLANNER receives goal
   → Creates 2 tasks:
     Task 1: "Research Stripe MCP server configuration" → research-analyst
     Task 2: "Add Stripe MCP server to engineering-team" → plugin-author (depends on Task 1)

2. RESEARCH ANALYST executes Task 1:
   → search_skills("stripe payment integration MCP")
   → Reads existing engineering-team plugin structure (get_item_details)
   → Checks if .mcp.json already exists in the plugin
   → Reports: "Plugin has no .mcp.json. Stripe MCP server: @stripe/mcp-server via npx.
     Also found stripe-webhooks skill that pairs well."

3. PLUGIN AUTHOR executes Task 2:
   → Reads existing engineering-team plugin folder
   → Creates .mcp.json:
     {
       "mcpServers": {
         "stripe": {
           "command": "npx",
           "args": ["-y", "@stripe/mcp-server"],
           "env": { "STRIPE_API_KEY": "${user_config.stripe_key}" }
         }
       }
     }
   → Updates plugin.json to add userConfig for stripe_key
   → Optionally adds stripe-webhooks skill to skills/ and updates agent defaultSkills
   → Runs validate_plugin → pass
   → Reports: "Added Stripe MCP server + userConfig for API key"
```

**Modification scenarios the Plugin Author handles:**

| User request | Research Analyst does | Plugin Author does |
|-------------|----------------------|-------------------|
| "Add Stripe MCP server" | Finds MCP server config, checks existing `.mcp.json` | Creates/updates `.mcp.json` |
| "Add TypeScript LSP" | Finds LSP config for typescript-language-server | Creates/updates `.lsp.json` |
| "Add linting hook on file save" | Finds hook pattern for PostToolUse + Write matcher | Creates/updates `hooks/hooks.json` |
| "Add a new SEO skill" | Searches existing SEO skills for reference | Creates `skills/seo/SKILL.md` + updates agent `defaultSkills` |
| "Add a QA engineer agent" | Searches existing QA agents, analyzes team gaps | Creates `agents/qa-engineer.md`, updates modes in `plugin.json` |
| "Change planner to use opus" | Reads current planner.md | Edits `agents/planner.md` frontmatter: `model: opus` |
| "Add deploy monitoring" | Finds monitor patterns for deployment watchers | Creates `monitors/monitors.json` |
| "Add a CLI tool to bin/" | Checks what scripts exist | Creates `bin/my-tool` script, marks executable |
| "Update agent instructions" | Reads current agent, compares with goal | Edits `agents/<name>.md` body (XML tags) |
| "Add a new mode" | Analyzes current modes and agent capabilities | Updates `plugin.json` modes section |

---

## Tools: RegistryPlugin (Standalone, Not Meta-Team-Specific)

The tools the meta-team needs are **not custom to the meta-team**. They're general-purpose registry tools that any team could use. They belong in a standalone `RegistryPlugin` — same pattern as `WorkspacePlugin`, `CollaborationPlugin`, `KnowledgePlugin`.

### RegistryPlugin

A new runtime plugin (`IPlugin`) that provides registry/discovery tools via `getMcpServers()`.

| Tool | What it does | Wraps |
|------|-------------|-------|
| `search_plugins` | Vector search across plugins | `DiscoveryService.suggest(goal, { type: "plugins" })` |
| `search_agents` | Find agent definitions by role/domain | `DiscoveryService.suggest(goal, { type: "agents" })` |
| `search_skills` | Find SKILL.md files by topic | `DiscoveryService.suggest(goal, { type: "skills" })` |
| `get_item_details` | Read full content of any agent/skill/plugin | `PluginLoader.loadPlugin(name)` |
| `check_duplicates` | Check if similar item already exists | `DiscoveryService.suggest(name)` + threshold |
| `validate_plugin` | Run validation rules on a plugin folder | Validation rules from plugin format spec |
| `list_models` | Return supported model aliases | Static list (sonnet, opus, haiku, gpt-4o, etc.) |

**Registration:** `AgentManagerRegistry.loadTeam()` registers `RegistryPlugin` alongside the other 4 plugins — but only for teams that need it (meta-team, or any team with `tools: [search_plugins, ...]` in agent definitions).

**Reusable:** Any team can use these tools. An engineering team agent could use `search_skills` to find relevant skills. A DevOps agent could use `search_agents` to find helper agents. The meta-team just happens to use all of them.

### What Already Exists

| Component | Status |
|-----------|--------|
| `DiscoveryService` (vector search via OpenAI embeddings) | ✅ Ready |
| `PluginLoader` (read any plugin's agents/skills) | ✅ Ready |
| `WorkspacePlugin` (32 file manipulation tools) | ✅ Ready — Plugin Author uses these |
| `PluginTeamService` (project plugins as teams) | ✅ Ready |
| `IPlugin` interface + `PluginRegistry` | ✅ Ready — RegistryPlugin implements this |

### What Needs Building

1. **`RegistryPlugin`** — new `IPlugin` implementation wrapping DiscoveryService + PluginLoader (one file, ~200 lines)
2. **2 agent `.md` files** — `research-analyst.md` + `plugin-author.md` in `meta-team/agents/`
3. **3 skill files** — `plugin-format/SKILL.md`, `agent-design/SKILL.md`, `team-composition/SKILL.md` in `meta-team/skills/`
4. **Optional `planner.md`** — meta-team-specific planning instructions

---

## Implementation Priority

| Priority | Item | Effort |
|----------|------|--------|
| P0 | `RegistryPlugin` — IPlugin with 7 tools wrapping DiscoveryService + PluginLoader | Medium |
| P1 | Write `research-analyst.md` agent definition | Low |
| P1 | Write `plugin-author.md` agent definition | Low |
| P2 | Write 3 skill SKILL.md files (plugin-format, agent-design, team-composition) | Low |
| P3 | Register RegistryPlugin for meta-team in AgentManagerRegistry | Low |
| P4 | Test end-to-end: user goal → meta-team → valid plugin folder | Medium |
