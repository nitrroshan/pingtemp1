# Team Registry — Feature Architecture

## Overview

When a user creates a team, agents + their skills should auto-load and be ready to run — no manual skill assignment, no seed scripts needed. A discovery layer (RAG-style search over definitions) suggests the right agents and skills when building a new team. A future "meta-team" agent uses this discovery layer to auto-compose teams.

### How Claude Code Does It (Reference Model)

Claude Code has **four primitives** that map to what we're building:

| Claude Code Primitive | What it does | Our equivalent |
|----------------------|-------------|----------------|
| **Subagent** (`.claude/agents/*.md`) | Markdown file with YAML frontmatter defining a specialized agent: name, description, tools, model, skills, hooks | **Agent definition** |
| **Agent Team** | Lead agent + teammates, shared task list, inter-agent messaging. Created at runtime via natural language. Teammates can reference subagent definitions for their role. | **Team** (our core concept) |
| **Skill** (`.claude/skills/*/SKILL.md`) | On-demand knowledge/procedure. Loaded into agent context when invoked. Progressive loading: description → body → supporting files. | **Skill** (already have this) |
| **Plugin** (`.claude-plugin/plugin.json`) | Distributable bundle of skills + agents + hooks + MCP servers. Namespaced slash commands. Marketplace installable. | **Plugin** (new — team templates as plugins) |

**Key design insights from Claude Code:**
- Agents/skills are **Markdown files with YAML frontmatter** (not pure YAML)
- Skills are **progressively loaded**: only description in context by default, full body on invocation
- Plugins are the **distribution unit**: a folder with manifest + skills/ + agents/ directories
- Teams are **runtime-only** — no "team template file". A lead agent spawns teammates from subagent definitions
- Subagent definitions can be reused as teammate roles via `tools` + `model` + body as system prompt

### Four Sub-Features

| Sub-feature | What it does |
|-------------|-------------|
| **Team Loader** | Load team → agents + skills from file-based definitions, ready to run |
| **Discovery Index** | RAG-style search to suggest agents & skills for a goal |
| **Meta-Team** | A team of agents that builds teams for users via discovery |
| **Plugin System** | Distributable bundles of team + agents + skills |

---

## Current State

**What exists:**
- `packages/registry/` — standalone Express server with MongoDB + embeddings + vector search for agent discovery. Has `AgentModel`, `AgentCapability`, `OAIEmbeddingClient`, `performVectorQuery`. Not wired into backend.
- Backend seeds have `TEAM_AGENTS` templates (hardcoded JS objects with name, role, systemPrompt per team type)
- `packages/backend/agent/agents/*.yaml` — YAML agent definitions, but only used by `AgentFactory`
- Skills are in MongoDB (`SkillModel`), assigned via `AgentSkillModel` — currently manual via UI

**Gaps:**
- No team-level definition that bundles agents + their skills together
- No auto-assignment of skills when creating a team
- Registry exists but is disconnected
- No discovery/suggestion flow in team creation
- No plugin concept for distributing team + agent + skill bundles

---

## Format Decision: YAML vs Markdown

| Format | Pros | Cons |
|--------|------|------|
| **Pure YAML** | Machine-readable, easy to parse, existing agent definitions use it | No rich content (system prompts get ugly as multiline strings), not standard |
| **Markdown + YAML frontmatter** | Claude Code standard, agentskills.io standard, VS Code Copilot standard. Body = rich instructions/system prompt. Frontmatter = structured config. | Slightly more complex parser (need to split frontmatter from body) |

**Decision: Markdown with YAML frontmatter** — aligns with Claude Code agents, Claude Code skills, and agentskills.io. The body becomes the system prompt / instructions. This makes our definitions compatible with the broader ecosystem.

---

## Architecture — Claude Code Plugin Format (Chosen)

Our plugins follow **Claude Code's exact format** with extensions for multi-agent teams. A Claude Code plugin works in Ping; a Ping plugin adds team-specific fields that Claude Code ignores.

### Plugin Structure

```
registry/                            # Local dir or S3 bucket
├── index.json                       # Embeddings for discovery
│
├── plugins/
│   ├── engineering-team/            # Plugin folder
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json          # Claude Code format: manifest here
│   │   ├── agents/
│   │   │   ├── backend-developer.md
│   │   │   ├── frontend-developer.md
│   │   │   └── qa-engineer.md
│   │   ├── skills/
│   │   │   ├── api-design/
│   │   │   │   └── SKILL.md
│   │   │   └── security-review/
│   │   │       └── SKILL.md
│   │   ├── hooks/
│   │   │   └── hooks.json           # Optional: lifecycle hooks
│   │   ├── .mcp.json                # Optional: MCP server configs
│   │   └── settings.json            # Optional: default settings
│   │
│   ├── product-team/
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json
│   │   ├── agents/
│   │   └── skills/
│   │
│   └── research-team/
│       └── ...
│
└── standalone/                      # Shared agents/skills not tied to a plugin
    ├── agents/
    │   └── data-scientist.md
    └── skills/
        └── code-review/
            └── SKILL.md
```

### Plugin Manifest (`.claude-plugin/plugin.json`)

Follows Claude Code schema exactly, with optional Ping extensions:

```json
{
  "name": "engineering-team",
  "description": "Full-stack engineering team for web applications",
  "version": "1.0.0",
  "author": {
    "name": "Ping Official"
  },
  "tags": ["engineering", "fullstack", "web"]
}
```

No `teamComposition` needed — **the folder structure IS the team**. All agents in `agents/` = team members. Each agent declares its own skills in frontmatter.

### Agent Definition (.md) — Superset of Claude Code

Our agent `.md` format includes **all Claude Code fields** plus Ping-specific extensions:

```markdown
---
# ── Claude Code standard fields ──
name: backend-developer
description: Senior backend engineer specializing in Node.js/TypeScript APIs and databases. Use for API design, database work, and server-side logic.
tools:                                # Tools the agent can use
  - Read
  - Write
  - Bash
  - Edit
  - Grep
  - Glob
disallowedTools:                      # Tools to deny (removed from inherited/specified)
  - WebBrowser
model: sonnet                         # sonnet | opus | haiku | inherit | full model ID
permissionMode: default               # default | acceptEdits | auto | plan
maxTurns: 20                          # Max agentic turns before stopping
hooks:                                # Lifecycle hooks scoped to this agent
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-command.sh"
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "./scripts/run-linter.sh"

# ── Ping extensions (ignored by Claude Code) ──
role: backend                         # Lowercase role key for WorkerPool matching
defaultSkills:                        # Skills auto-assigned when team is created
  - api-design
  - security-review
tags: [backend, node, typescript, api] # For discovery index
mcpServers:                           # MCP servers scoped to this agent
  - github
  - name: custom-db
    type: stdio
    command: npx
    args: ["-y", "@db/mcp-server"]
---

<role>
You are a senior backend engineer specializing in Node.js and TypeScript.
</role>

<instructions>
When given a coding task:
1. Analyze requirements before writing code
2. Write production-ready TypeScript with proper error handling
3. Include input validation at API boundaries
4. Follow RESTful conventions for endpoints
5. Write tests for critical paths
</instructions>

<constraints>
- Never expose internal errors to clients
- Always validate user input
- Use parameterized queries for database access
- No secrets in code — use environment variables
</constraints>
```

**Compatibility matrix:**

| Field | Claude Code | Ping | Notes |
|-------|:-----------:|:----:|-------|
| `name` | ✅ | ✅ | Required. Identifier + slash-command |
| `description` | ✅ | ✅ | Required. Used for discovery |
| `tools` | ✅ | ✅ | Tool allowlist |
| `disallowedTools` | ✅ | ✅ | Tool denylist |
| `model` | ✅ | ✅ | Model selection |
| `permissionMode` | ✅ | ✅ | Permission handling |
| `maxTurns` | ✅ | ✅ | Max agentic turns |
| `hooks` | ✅ | ✅ | Lifecycle hooks |
| `skills` | ✅ | ✅ | Skills preloaded into context |
| `mcpServers` | ✅ | ✅ | MCP server configs |
| `memory` | ✅ | ✅ | Persistent memory scope |
| `effort` | ✅ | ✅ | Effort level override |
| `background` | ✅ | ✅ | Run as background task |
| `isolation` | ✅ | ✅ | Git worktree isolation |
| `color` | ✅ | ✅ | UI display color |
| `role` | — | ✅ | Ping extension: WorkerPool key |
| `defaultSkills` | — | ✅ | Ping extension: auto-assign on team creation |
| `tags` | — | ✅ | Ping extension: discovery index |
| Body (Markdown) | System prompt | System prompt | Identical usage |

### Skill Definition (SKILL.md) — agentskills.io Standard

Identical to Claude Code. No changes needed:

```markdown
---
name: api-design
description: REST API design patterns and conventions. Use when designing endpoints, defining request/response schemas, or reviewing API consistency.
argument-hint: '[endpoint-path]'
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep
tags: [api, rest, design]
---

## API Design Conventions

When designing or reviewing APIs:
1. Use RESTful naming: plural nouns for resources
2. Return consistent error formats: `{ error: string, code: number }`
3. Include request validation with Zod schemas
4. Version APIs via URL prefix (`/api/v2/`)

## Reference
- See [openapi-template.yaml](./openapi-template.yaml) for schema template
```

### Hooks (`hooks/hooks.json`)

Same format as Claude Code:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "./scripts/validate-command.sh" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "./scripts/run-linter.sh" }
        ]
      }
    ]
  }
}
```

### MCP Servers (`.mcp.json`)

Same format as Claude Code:

```json
{
  "github": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"]
  }
}
```

### Discovery Flow

1. On startup (or rebuild command): scan all plugins → generate embeddings for descriptions → write `index.json`
2. `GET /api/registry/suggest?goal="build e-commerce"` → embed goal → cosine similarity against index → return ranked plugins + agents + skills
3. User edits suggestions in Team Builder UI → confirms → backend loads plugin files → creates runtime team with agents + skills auto-assigned

**Why this approach:**
- **Claude Code compatible** — their plugins work in Ping (skills fully, agents with adapter)
- **Superset, not subset** — our agents have all Claude Code fields plus `role`, `defaultSkills`, `tags`
- **No `teamComposition`** — folder structure IS the team (all agents in `agents/` = members)
- **No database for catalog** — files + index.json only
- Plugins are the natural distribution unit (git repo, npm package, S3 folder)
- Skills follow agentskills.io SKILL.md standard
- Hooks, MCP servers, LSP servers supported in the format

---

## Team Modes — A General Concept

Modes are a **team-level capability**, not specific to the meta-team. Any team can define modes in its plugin manifest. The user selects the mode — the team doesn't auto-route.

### How Modes Work

A mode changes what the team focuses on — which agents are active, what tools are available, how the team behaves. Defined in `plugin.json`:

```json
{
  "name": "meta-team",
  "description": "Creates skills, agents, and teams",
  "version": "1.0.0",
  "modes": {
    "skill-building": {
      "description": "Create and discover skills",
      "activeAgents": ["skill-builder", "registry-scout"],
      "icon": "puzzle"
    },
    "agent-building": {
      "description": "Create agents with skills, MCPs, and hooks",
      "activeAgents": ["agent-builder", "registry-scout"],
      "icon": "bot"
    },
    "team-building": {
      "description": "Compose teams from agents",
      "activeAgents": ["team-builder", "registry-scout"],
      "icon": "users"
    }
  }
}
```

**Frontend**: Mode selector appears as tabs or a dropdown in the chat area. User picks the mode before chatting. Switching modes changes which agents handle the conversation.

**Any team can have modes**, not just the meta-team:

```json
// engineering-team plugin.json
{
  "name": "engineering-team",
  "modes": {
    "planning": {
      "description": "Architecture and design discussions",
      "activeAgents": ["backend-developer", "frontend-developer"]
    },
    "implementation": {
      "description": "Write code and build features",
      "activeAgents": ["backend-developer", "frontend-developer", "devops-engineer"]
    },
    "review": {
      "description": "Code review and quality checks",
      "activeAgents": ["qa-engineer", "backend-developer"]
    }
  }
}
```

---

## Meta-Team Architecture

The Meta-Team is a **built-in creation engine**. It's the first team every user interacts with — always available in the sidebar. The **user selects the mode** (skill / agent / team building).

### Three Modes

| Mode | User selects | What happens |
|------|-------------|-------------|
| **Skill Building** | "Create a skill for Stripe webhooks" | Searches existing skills for overlap → generates SKILL.md → saves to registry |
| **Agent Building** | "Create a backend agent for fintech" | Discovers skills + MCP servers + hooks → composes agent .md → saves to registry |
| **Team Building** | "Build a team for e-commerce" | Discovers agents (already equipped) → composes plugin folder → creates runtime team |

Each mode builds on the previous — skills compose into agents, agents compose into teams:

```
Skills + MCPs + Hooks → Agent .md → Team plugin
```

### The Team Composition

```
Meta-Team (built-in, always available)
├── Skill Builder                — Creates/discovers skills, checks for duplicates
├── Agent Builder                — Creates agents, discovers skills/MCPs/hooks for them
├── Team Builder                 — Composes teams from agents, validates completeness
└── Registry Scout               — Searches the index across all item types
```

No Architect agent — the user selects the mode, and the right agents activate.
├── Agent Builder                — Creates agents, discovers skills/MCPs/hooks for them
├── Team Builder                 — Composes teams from agents, validates completeness
└── Registry Scout               — Searches the index across all item types
```

### Mode 1: Skill Building

```
User: "Create a skill for PCI compliance auditing"
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│  User selects: SKILL BUILDING mode               │
│  Active agents: Skill Builder + Registry Scout  │
└──────────────────┬──────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
┌──────────────┐    ┌─────────────────┐
│ REGISTRY     │    │ SKILL BUILDER    │
│ SCOUT        │    │                  │
│              │    │ Generates:       │
│ Searches for │    │ - SKILL.md with  │
│ existing     │    │   frontmatter    │
│ "pci" or     │    │ - description    │
│ "compliance" │    │ - body with      │
│ skills       │    │   procedures     │
│              │    │ - tags           │
│ Found:       │    │ - supporting     │
│ security-    │    │   files list     │
│ review       │    │                  │
│ (partial     │    │ Avoids overlap   │
│  overlap)    │    │ with existing    │
└──────┬───────┘    └────────┬────────┘
       │                     │
       └──────────┬──────────┘
                  ▼
        User reviews SKILL.md
        Edits if needed → save
```

**Output:** A new `skills/pci-compliance/SKILL.md` in the registry.

### Mode 2: Agent Building

```
User: "Create a backend agent for fintech payment processing"
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│  User selects: AGENT BUILDING mode               │
│  Active agents: Agent Builder + Registry Scout  │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  REGISTRY SCOUT searches for:                    │
│                                                  │
│  Skills matching "fintech backend":              │
│  ├── api-design          (score: 0.92)          │
│  ├── security-review     (score: 0.88)          │
│  ├── pci-compliance      (score: 0.85)          │
│  └── stripe-webhooks     (score: 0.81)          │
│                                                  │
│  MCP servers matching "payment":                 │
│  ├── @stripe/mcp-server  (score: 0.90)          │
│  └── @db/postgres-mcp    (score: 0.75)          │
│                                                  │
│  Hooks matching "backend security":              │
│  ├── validate-sql.sh     (score: 0.82)          │
│  └── run-linter.sh       (score: 0.70)          │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  AGENT BUILDER composes agent .md:               │
│                                                  │
│  ---                                             │
│  name: fintech-backend                           │
│  description: Backend engineer for fintech...    │
│  role: backend                                   │
│  model: sonnet                                   │
│  tools: [Read, Write, Bash, Edit]                │
│  defaultSkills:                                  │
│    - api-design                                  │
│    - security-review                             │
│    - pci-compliance                              │
│    - stripe-webhooks                             │
│  mcpServers:                                     │
│    - stripe:                                     │
│        type: stdio                               │
│        command: npx                              │
│        args: ["-y", "@stripe/mcp-server"]        │
│  hooks:                                          │
│    PreToolUse:                                   │
│      - matcher: "Bash"                           │
│        hooks:                                    │
│          - type: command                         │
│            command: "./scripts/validate-sql.sh"  │
│  ---                                             │
│  <role>You are a fintech backend engineer...</>  │
│                                                  │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
         User reviews agent .md
         Edits skills/MCPs/hooks → save
```

**Output:** A new `agents/fintech-backend.md` in the registry — fully wired with skills, MCPs, and hooks.

### Mode 3: Team Building

```
User: "Build a team for e-commerce"
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│  User selects: TEAM BUILDING mode                │
│  Active agents: Team Builder + Registry Scout   │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  REGISTRY SCOUT searches for agents:             │
│                                                  │
│  ├── backend-developer   (score: 0.91)          │
│  │   skills: api-design, security-review         │
│  │   mcp: @db/postgres-mcp                       │
│  ├── frontend-developer  (score: 0.88)          │
│  │   skills: react-patterns, accessibility       │
│  ├── fintech-backend     (score: 0.85)          │
│  │   skills: pci-compliance, stripe-webhooks     │
│  │   mcp: @stripe/mcp-server                     │
│  └── devops-engineer     (score: 0.78)          │
│      skills: ci-cd, cloud-deployment             │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  TEAM BUILDER composes plugin:                   │
│                                                  │
│  e-commerce-team/                                │
│  ├── .claude-plugin/plugin.json                  │
│  ├── agents/                                     │
│  │   ├── backend-developer.md    (from registry) │
│  │   ├── frontend-developer.md   (from registry) │
│  │   ├── fintech-backend.md      (from registry) │
│  │   └── devops-engineer.md      (from registry) │
│  ├── skills/     (all defaultSkills gathered)    │
│  ├── hooks/      (merged from all agents)        │
│  └── .mcp.json   (merged from all agents)        │
│                                                  │
│  Each agent already has its skills, MCPs, hooks  │
│  wired from when it was built in Mode 2          │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
         User reviews team composition
         Add/remove agents → Create Team → DONE
```

**Output:** A full plugin folder → runtime team with everything auto-assigned.

### Registry Index Must Cover All Item Types

The `index.json` needs entries for **every discoverable thing** — not just plugins:

```json
{
  "version": "1.0",
  "skills": [
    { "name": "api-design", "description": "...", "tags": [...], "embedding": [...] },
    { "name": "pci-compliance", "description": "...", "tags": [...], "embedding": [...] }
  ],
  "agents": [
    { "name": "backend-developer", "description": "...", "tags": [...], "embedding": [...],
      "defaultSkills": ["api-design", "security-review"],
      "mcpServers": ["@db/postgres-mcp"],
      "hooks": ["validate-sql.sh"] }
  ],
  "mcpServers": [
    { "name": "@stripe/mcp-server", "description": "Stripe API integration", "tags": ["payment", "stripe"], "embedding": [...],
      "config": { "type": "stdio", "command": "npx", "args": ["-y", "@stripe/mcp-server"] } }
  ],
  "hooks": [
    { "name": "validate-sql", "description": "Blocks SQL write operations in read-only contexts", "tags": ["security", "sql"], "embedding": [...],
      "event": "PreToolUse", "matcher": "Bash" }
  ],
  "plugins": [
    { "name": "engineering-team", "description": "...", "tags": [...], "embedding": [...] }
  ]
}
```

### Meta-Team Tools (AI SDK)

| Tool | Used by | What it does |
|------|---------|-------------|
| **Discovery tools** | | |
| `search_skills` | Registry Scout | Vector search for skills |
| `search_agents` | Registry Scout | Vector search for agents |
| `search_mcp_servers` | Registry Scout | Vector search for MCP server configs |
| `search_hooks` | Registry Scout | Vector search for hooks |
| `get_item_details` | Registry Scout | Load full content for any item type |
| **Creation tools** | | |
| `generate_skill_md` | Skill Builder | Generate SKILL.md from requirements |
| `generate_agent_md` | Agent Builder | Generate agent .md with skills/MCPs/hooks |
| `generate_plugin` | Team Builder | Generate plugin folder from agents |
| `save_to_registry` | All builders | Write files to registry, update index.json |
| **Validation tools** | | |
| `check_duplicates` | Registry Scout | Check if similar item already exists |
| `validate_agent` | Agent Builder | Verify agent .md is well-formed |
| `validate_team` | Team Builder | Check coverage, redundancy, gaps |
| **Lifecycle tools** | | |
| `create_team` | Team Builder | Create runtime team from plugin |

### Meta-Team as a Plugin

The Meta-Team is itself a plugin:

```
registry/plugins/meta-team/
├── .claude-plugin/
│   └── plugin.json
├── agents/
│   ├── skill-builder.md
│   ├── agent-builder.md
│   ├── team-builder.md
│   └── registry-scout.md
└── skills/
    ├── skill-design/
    │   └── SKILL.md          # "How to write effective SKILL.md files"
    ├── agent-design/
    │   └── SKILL.md          # "How to compose agents with skills/MCPs/hooks"
    └── team-design/
        └── SKILL.md          # "How to build effective agent teams"
```

Self-hosting: the Meta-Team uses the same format it creates.

---

## Marketplace Vision

The registry evolves into a **marketplace** where agents, skills, and team templates are all independently publishable and discoverable. The meta-team agent searches across everything to find the best combination — mixing and matching from different contributors.

### What's in the Marketplace

| Item type | What it is | Example |
|-----------|-----------|---------|
| **Agent** | A single agent `.md` definition | `@community/stripe-integrator` — knows Stripe APIs |
| **Skill** | A single `SKILL.md` knowledge pack | `@security/owasp-review` — OWASP checklist |
| **Team template** | A plugin bundling agents + skills | `@official/engineering-team` — full-stack team |

All three are independently searchable. The meta-team doesn't just find team templates — it composes new teams from individual agents and skills across the entire marketplace.

### How the Meta-Team Uses the Marketplace

```
User: "Build a fintech payment processing system"
                    │
                    ▼
        Meta-Team searches marketplace for:
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
 TEAM TEMPLATES   AGENTS          SKILLS
 that match       that match      that match
                    │
 "fintech-team"   "stripe-dev"    "pci-compliance"
 (score: 0.85)    "payment-api"   "fraud-detection"
 — has 3 agents   "security-eng"  "financial-audit"
   but missing    "data-analyst"  "stripe-webhooks"
   compliance                     
                    │
                    ▼
        Meta-Team COMPOSES best team:
        ┌─────────────────────────┐
        │ Take fintech-team base  │
        │ + Add security-eng      │  ← from standalone agents
        │ + Add pci-compliance    │  ← from standalone skills
        │ + Add fraud-detection   │  ← from standalone skills
        │ - Remove generic QA     │  ← replaced by better match
        └─────────────────────────┘
```

The meta-team doesn't just pick a template — it **remixes** across the whole catalog.

### Version Roadmap

| Version | What | Marketplace scope |
|---------|------|-------------------|
| **v1.0** | Local plugins, discovery API, plugin-based team creation | Built-in plugins only |
| **v1.1** | Meta-team agents, Team Builder UI | Search local registry |
| **v2.0** | Remote marketplace, publish/install, ratings | Community contributions |
| **v2.1** | Marketplace search in meta-team, cross-source composition | Mix local + remote |
| **v3.0** | Marketplace UI, contributor accounts, versioning, reviews | Full marketplace experience |

### Marketplace Index Structure

The `index.json` evolves to support multiple sources:

```json
{
  "version": "2.0",
  "sources": [
    { "name": "builtin", "type": "local", "path": "./plugins/" },
    { "name": "official", "type": "remote", "url": "https://registry.ping.dev/index.json" },
    { "name": "community", "type": "remote", "url": "https://marketplace.ping.dev/index.json" }
  ],
  "agents": [
    { "name": "backend-developer", "source": "builtin", "embedding": [...], "score": 4.8 },
    { "name": "stripe-integrator", "source": "community", "embedding": [...], "score": 4.5 }
  ],
  "skills": [...],
  "plugins": [...]
}
```

The meta-team's `search_agents` and `search_skills` tools query across all sources, ranked by relevance score + community rating.
