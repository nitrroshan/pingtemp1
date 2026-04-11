# Ping Platform — Architecture Refactor

## What This Document Covers

This is a major refactor of how Ping defines, discovers, loads, and runs **teams**, **agents**, **skills**, **hooks**, and **MCP servers**. It replaces MongoDB-based skill storage, hardcoded seed scripts, and manual skill assignment with a file-based plugin system aligned with Claude Code and agentskills.io standards.

### Scope of Change

| Area | Before (current) | After (this refactor) |
|------|------------------|----------------------|
| **Teams** | Created via LLM role discovery, agents stored in MongoDB, skills manually assigned | Loaded from plugin folders. Agents + skills auto-assigned from definitions |
| **Agents** | YAML files for internal builders only. DB records for team agents | Markdown + YAML frontmatter files. Superset of Claude Code format |
| **Skills** | MongoDB records (`SkillModel`), manual assignment via `SkillSelector` UI, fake tool wrapper (`SkillResolver`) | SKILL.md files in plugin folders. Prompt injection (not tool wrappers). Auto-assigned via `defaultSkills` |
| **Discovery** | None for teams. MongoDB vector search for skills (disconnected) | Unified `index.json` with embeddings for ALL item types |
| **External agents** | Type defined (`ExternalConfig`) but not implemented | Ping exposes one MCP server. Any tool (Claude Code, Cursor, etc.) just installs it |
| **Meta-team** | Doesn't exist | Built-in team with 3 modes (skill/agent/team building) that discovers and composes |
| **Distribution** | Seed scripts, manual setup | Claude Code-compatible plugins. Future marketplace |

### Documents

| Document | What it covers |
|----------|---------------|
| **This file** | Overall architecture, decisions, formats, migration plan |
| [v1.0 Implementation Plan](v1.0/feature_implementation_planning.md) | Plugin loader, discovery index, team creation (8 steps) |
| [v1.1 Implementation Plan](v1.1/feature_implementation_planning.md) | Meta-team, modes, Team Builder UI, code review UI (9 steps) |
| [v2.0 Implementation Plan](v2.0/feature_implementation_planning.md) | Remote marketplace, install/publish, ratings (8 steps) |
| [Ping MCP Server](../ping-mcp-server/feature_architecture.md) | Separate feature: MCP server for external agents (A11) |
| [Untrusted Code Review](../untrusted-code-review/feature_architecture.md) | Separate feature: sandbox for untrusted code (A10) |

---

## 1. Industry Research

Validated against **CrewAI**, **OpenAI Agents SDK**, **AutoGen**, and **Claude Code**.

| Aspect | Industry standard | Our approach | Status |
|--------|------------------|-------------|--------|
| Agent definition format | File-based config (CrewAI YAML, Claude Code .md) | Markdown + YAML frontmatter | ✅ Best of both |
| Skills | Prompt injection (Claude Code, agentskills.io) | SKILL.md → `appendSystemPrompt()` | ✅ Corrected from fake tool wrapper |
| Tool discovery | Deferred loading (OpenAI `ToolSearchTool`), description matching (Claude Code) | Vector search via `index.json` embeddings | ✅ Stronger than both |
| Team orchestration | Crew (CrewAI), handoffs (OpenAI), lead+task list (Claude Code) | OrchestratorService + DAG + modes | ✅ More sophisticated |
| Agent-as-tool | `agent.as_tool()` (OpenAI), subagents (Claude Code) | External agent via MCP | ✅ Standard protocol |
| Plugin distribution | Claude Code plugins | Same format + team extensions | ✅ Compatible |

**What we have that nobody else does:**
1. **Team modes** — team-level mode switching
2. **Team stacking** — recursive team composition via MCP
3. **Plugin-based team distribution** — teams as installable packages
4. **Unified discovery index** — vector search across skills, agents, MCPs, hooks

---

## 2. Migration Plan

### What We Keep (Runtime Core)

| Component | Location | Why |
|-----------|----------|-----|
| `WorkerPool` | `agent-manager/src/services/WorkerPool.ts` | Agent execution runtime |
| `AiSdkAgent` | `agent-manager/src/agent/internal/AiSdkAgent.ts` | streamText, tool loop |
| `AgentFactory` | `agent-manager/src/agent/AgentFactory.ts` | Agent creation (extend to accept .md) |
| `PluginRegistry` | `agent-manager/src/plugin/PluginRegistry.ts` | Runtime tool injection |
| `OrchestratorService` | `agent-manager/src/orchestrator/` | LLM task planning |
| `TaskStore` | `agent-manager/src/orchestrator/TaskStore.ts` | Task lifecycle, DAG |
| `SocketServerV2` | `backend/api/SocketServerV2.ts` | Real-time streaming |
| `HttpServer` | `backend/api/HttpServer.ts` | REST API |
| MongoDB (runtime) | — | Active teams, tasks, chat history |

### What We Replace

| Current | Replaced by | Why |
|---------|------------|-----|
| Seed scripts (`teams.seed.ts`, `agents.seed.ts`) | Plugin loader | File-based, not hardcoded JS |
| YAML agent defs (`agents/*.yaml`) | Markdown `.md` in plugins | Claude Code compatible |
| `SkillModel` (MongoDB) | `SKILL.md` files in plugins | Files, not DB records |
| `AgentSkillModel` (MongoDB join table) | `defaultSkills` in agent frontmatter | Auto-assign, no manual step |
| `SkillRegistryService` (MongoDB + embeddings) | `index.json` + `DiscoveryService` | File-based search |
| `SkillResolver` (fake tool wrapper) | `appendSystemPrompt()` | Prompt injection (industry standard) |
| `SkillSelector` (frontend) | Team Builder UI (v1.1) | Auto-populated from plugin |
| `packages/registry/` (standalone server) | Embedded in backend | Same logic, not separate process |

### What We Remove

| Component | Why |
|-----------|-----|
| `AgentSkillSchema` (MongoDB) | Skills in agent frontmatter |
| `SkillSchema` (MongoDB) | Skills are SKILL.md files |
| `seeds/teams.seed.ts`, `agents.seed.ts` | Teams come from plugins |
| `seedOfficialSkills.ts` | Skills bundled in plugins |
| `SkillSelector.tsx` | Replaced by Team Builder UI |

### Fallbacks (Keep Working)

- Manual skill assignment API still works — user can tweak after creation

### What Replaces LLM Role Discovery

The old `POST /teams` flow used a temporary `AgentManager` to LLM-discover roles. This is replaced by:
- **v1.0**: `pluginName` field → load agents from plugin (no LLM call)
- **v1.1**: Meta-team's Agent Builder → discovers agents from registry + composes (smarter than raw LLM role discovery because it uses tested, existing agents)

---

## 3. File Formats

### 3a. Plugin Structure (Claude Code-compatible)

```
my-team-plugin/
├── .claude-plugin/
│   └── plugin.json                  # Manifest (name, description, version, modes)
├── agents/
│   ├── backend-developer.md         # Agent definitions
│   ├── frontend-developer.md
│   └── qa-engineer.md
├── skills/
│   ├── api-design/SKILL.md          # Skill definitions
│   └── security-review/SKILL.md
├── hooks/
│   └── hooks.json                   # Lifecycle hooks (optional)
├── .mcp.json                        # MCP server configs (optional)
└── settings.json                    # Default settings (optional)
```

**Plugin = team.** All agents in `agents/` = team members. No `teamComposition` field.

**Manifest** (`.claude-plugin/plugin.json`):
```json
{
  "name": "engineering-team",
  "description": "Full-stack engineering team for web applications",
  "version": "1.0.0",
  "tags": ["engineering", "fullstack", "web"],
  "modes": {
    "planning": { "description": "Architecture discussions", "activeAgents": ["backend-developer", "frontend-developer"] },
    "implementation": { "description": "Write code", "activeAgents": ["backend-developer", "frontend-developer", "devops-engineer"] },
    "review": { "description": "Code review", "activeAgents": ["qa-engineer", "backend-developer"] }
  }
}
```

### 3b. Agent Definition (.md) — Superset of Claude Code

The agent `.md` file has two parts: YAML frontmatter (config) and body (system prompt with **required XML tags**).

**System Prompt XML Schema:**

The body uses XML tags that align with our existing `PromptBuilder` system. At runtime, the plugin body is merged with `WorkerPromptFactory`'s generated sections (capabilities, behaviors, rules) — so the body provides **identity + domain knowledge**, while the system injects **operational instructions**.

| Tag | Required | Purpose | Runtime merge |
|-----|:--------:|---------|:-----------:|
| `<agent-identity>` | ✅ | Who the agent is — expertise, specialization, backstory | Replaces default identity |
| `<domain-instructions>` | ✅ | Domain-specific procedures for this agent's specialty | Appended to behaviors |
| `<domain-constraints>` | ✅ | Domain-specific rules (security, compliance, etc.) | Appended to rules |
| `<output-formats>` | Optional | How to format responses (code style, structure) | Appended to output-formats |
| `<context>` | Optional | Background knowledge the agent should always consider | Prepended to prompt |
| `<examples>` | Optional | Example inputs/outputs demonstrating expected behavior | Appended after instructions |
| `<collaboration>` | Optional | How to interact with teammates | Appended to behaviors |
| `<tools-guidance>` | Optional | When and how to use specific tools | Appended to capabilities |

**Note:** Generic capabilities (`<lifecycle>`, `<workspace>`, `<scratchpad>`), behaviors (`<start-by-understanding>`, `<commit-frequently>`, `<report-progress>`), and rules (`<use-only-available-tools>`, `<no-fabrication>`) are injected by `WorkerPromptFactory` at runtime — NOT in the .md file.

**Example:**

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
- Use parameterized queries for database access — no string concatenation
- No secrets in code — use environment variables
- Do not modify files outside the assigned workspace
</domain-constraints>

<output-formats>
- Write TypeScript with explicit types (no `any`)
- Include brief inline comments for non-obvious logic
- One function per concern — keep functions under 50 lines
</output-formats>

<collaboration>
- If a task requires frontend changes, report status "blocked" and note the dependency
- Share API contracts with frontend-developer via collab_write
- Request security-review skill for auth-related code
</collaboration>

<tools-guidance>
- Use workspace_read_file before modifying any file
- Run tests with Bash after every code change
- Use workspace_commit after each logical unit of work
</tools-guidance>
```

**Full frontmatter field compatibility:**

| Field | Claude Code | Ping | Notes |
|-------|:-----------:|:----:|-------|
| `name` | ✅ | ✅ | Required |
| `description` | ✅ | ✅ | Required. Used for discovery |
| `tools` | ✅ | ✅ | Tool allowlist (capabilities) |
| `disallowedTools` | ✅ | ✅ | Tool denylist |
| `model` | ✅ | ✅ | sonnet/opus/haiku/inherit/full ID |
| `permissionMode` | ✅ | ✅ | default/acceptEdits/auto/plan |
| `maxTurns` | ✅ | ✅ | Max agentic turns |
| `hooks` | ✅ | ✅ | Lifecycle hooks |
| `skills` | ✅ | ✅ | Preloaded into context at startup |
| `mcpServers` | ✅ | ✅ | Per-agent MCP servers |
| `memory` | ✅ | ✅ | Persistent memory scope |
| `effort` | ✅ | ✅ | Effort level override |
| `background` | ✅ | — | Removed: use team stacking instead |
| `isolation` | ✅ | ✅ | Git worktree isolation |
| `color` | ✅ | ✅ | UI display color |
| `role` | — | ✅ | Ping: WorkerPool key |
| `defaultSkills` | — | ✅ | Ping: auto-assign on team creation |
| `tags` | — | ✅ | Ping: discovery index |
| Body | System prompt | System prompt | Identical |

### 3c. Skill Definition (SKILL.md) — agentskills.io Standard

```markdown
---
name: api-design
description: REST API design patterns. Use when designing endpoints or reviewing API consistency.
argument-hint: '[endpoint-path]'
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep
tags: [api, rest, design]
---

## API Design Conventions
1. Use RESTful naming: plural nouns for resources
2. Return consistent error formats: `{ error, code }`
3. Include request validation with Zod schemas
```

**Skills are prompt injection, not tools.** SKILL.md body → `agent.appendSystemPrompt()`. Only skills with `scripts/` become real executable tools.

### 3d. Hooks, MCP, Settings

| File | Format | Scope |
|------|--------|-------|
| `hooks/hooks.json` | Claude Code format. `PreToolUse`, `PostToolUse` events | Plugin-level (shared) or agent-level (frontmatter override) |
| `.mcp.json` | Claude Code format. `{ name: { type, command, args } }` | Plugin-level (shared) or agent-level (frontmatter override) |
| `settings.json` | `{ "agent": "default-agent-name" }` | Plugin defaults |

Per-agent config in frontmatter takes priority over plugin-level files.

---

## 4. Discovery Index (`index.json`)

Pre-built search index with embeddings for **every discoverable item type**:

```json
{
  "version": "1.0",
  "buildTimestamp": "2026-04-11T10:00:00Z",
  "skills": [{ "name": "...", "description": "...", "tags": [], "embedding": [] }],
  "agents": [{ "name": "...", "description": "...", "tags": [], "defaultSkills": [], "mcpServers": [], "embedding": [] }],
  "mcpServers": [{ "name": "...", "description": "...", "tags": [], "config": {}, "embedding": [] }],
  "hooks": [{ "name": "...", "description": "...", "event": "PreToolUse", "embedding": [] }],
  "plugins": [{ "name": "...", "description": "...", "tags": [], "embedding": [] }]
}
```

- Built once when plugins change (not every startup). 1536-dim embeddings from `text-embedding-3-small`
- API: `GET /api/registry/suggest?goal=<text>` → cosine similarity → ranked results

---

## 5. Team Modes

Any team can define modes in `plugin.json`. User selects mode → only `activeAgents` handle the conversation.

```json
"modes": {
  "planning": { "description": "Design discussions", "activeAgents": ["backend", "frontend"], "icon": "pencil" },
  "implementation": { "description": "Write code", "activeAgents": ["backend", "frontend", "devops"], "icon": "code" }
}
```

Frontend: tabs/dropdown in chat area. Backend: WorkerPool filters active workers by mode.

---

## 6. Meta-Team

Built-in team (always in sidebar). **Discovery-first**: search existing → suggest tested items → create new only if gap.

### Modes (layered)

| Mode | Active agents | Flow |
|------|--------------|------|
| **Skill Building** | Scout, Skill Builder | Find existing skills → suggest → create only if gap |
| **Agent Building** | Scout, Skill Builder, Agent Builder | Find agents → suggest with skills/MCPs/hooks → customize or create |
| **Team Building** | Scout, Skill Builder, Agent Builder, Team Builder | Find agents → compose team → create runtime team |

### Agents (4)

| Agent | Domain |
|-------|--------|
| **Registry Scout** | Searches `index.json` across all item types |
| **Skill Builder** | Creates/discovers SKILL.md files |
| **Agent Builder** | Creates agent .md with discovered skills/MCPs/hooks |
| **Team Builder** | Composes plugin from agents → creates runtime team |

Each owns its full domain. Modes layer them: skill mode = 2 agents, agent mode = 3, team mode = 4.

### Mode 1: Skill Building

```
User: "I need a skill for PCI compliance auditing"
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│  REGISTRY SCOUT searches existing skills:        │
│                                                  │
│  Found 3 matches:                                │
│  ├── security-review     (score: 0.88)          │
│  │   "Reviews code for OWASP vulnerabilities"    │
│  ├── compliance-checker  (score: 0.82)          │
│  │   "SOC2 and ISO compliance checks"            │
│  └── data-privacy        (score: 0.71)          │
│      "GDPR data handling patterns"               │
│                                                  │
│  Gap detected: No PCI-specific skill exists      │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
         User sees suggestions:
         ✅ security-review (close match)
         ✅ compliance-checker (partial)
         ⚠️ No exact PCI skill found
         
         Options:
         [Use existing] [Create new] [Use existing + Create new]
                   │
                   ▼ (user chooses "Create new")
┌─────────────────────────────────────────────────┐
│  SKILL BUILDER generates SKILL.md:               │
│  - Uses security-review as reference             │
│  - Adds PCI-specific procedures                  │
│  - Tags: [pci, compliance, payment, security]    │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
         User reviews SKILL.md → save to registry
```

### Mode 2: Agent Building

```
User: "I need a backend agent for fintech payment processing"
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│  REGISTRY SCOUT searches existing agents:        │
│                                                  │
│  Found 2 agent matches:                          │
│  ├── backend-developer   (score: 0.91)          │
│  │   skills: api-design, security-review         │
│  │   mcp: @db/postgres-mcp                       │
│  │   "General backend engineer"                  │
│  └── payment-engineer    (score: 0.87)          │
│      skills: stripe-webhooks, api-design         │
│      mcp: @stripe/mcp-server                     │
│      "Payment processing specialist"             │
│                                                  │
│  Also found relevant skills not on these agents: │
│  ├── pci-compliance      (score: 0.85)          │
│  └── fraud-detection     (score: 0.78)          │
│                                                  │
│  And MCP servers:                                │
│  └── @stripe/mcp-server  (score: 0.90)          │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
         User sees suggestions:
         
         "Use existing agent?"
         ○ backend-developer (add pci-compliance skill?)
         ○ payment-engineer (already has Stripe, add pci?)
         ○ Create new agent
         
         "Add these skills?"
         ☑ pci-compliance
         ☑ fraud-detection
         ☐ stripe-webhooks (already on payment-engineer)
         
         "Add these MCPs?"
         ☑ @stripe/mcp-server
                   │
                   ▼ (user picks payment-engineer + adds pci-compliance)
┌─────────────────────────────────────────────────┐
│  AGENT BUILDER customizes:                       │
│  - Takes payment-engineer as base                │
│  - Adds pci-compliance to defaultSkills          │
│  - Adds fraud-detection to defaultSkills         │
│  - Saves as fintech-backend.md (new variant)     │
│    OR updates payment-engineer.md in place        │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
         User reviews agent .md → save to registry
```

### Mode 3: Team Building

```
User: "Build a team for e-commerce"
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│  REGISTRY SCOUT searches existing agents:        │
│                                                  │
│  Suggested team (all tested, existing agents):   │
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
│                                                  │
│  Each agent already has tested skills + MCPs     │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
         User sees team composition:
         
         ☑ backend-developer    [3 skills, 1 MCP]
         ☑ frontend-developer   [2 skills]
         ☑ fintech-backend      [2 skills, 1 MCP]
         ☑ devops-engineer      [2 skills]
         ☐ qa-engineer          [not suggested, but available]
         
         [+ Search for more agents]
         [Create Team]
                   │
                   ▼ (user adds qa-engineer, removes devops)
┌─────────────────────────────────────────────────┐
│  TEAM BUILDER creates plugin + runtime team:     │
│  - All agents are existing tested definitions    │
│  - Skills already assigned per agent             │
│  - MCPs already configured per agent             │
│  - No generation needed — just composition       │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
         Team created → appears in sidebar → ready to use
```

### Registry Index Covers All Item Types

The `index.json` needs entries for **every discoverable thing**:

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
| **Registry tools** | | |
| `customize_agent` | Agent Builder | Read existing agent, apply skill/MCP changes |
| `compose_team` | Team Builder | Gather agent .md files into plugin structure preview |
| `create_team` | Team Builder | Create runtime team from plugin |
| **Validation tools** | | |
| `check_duplicates` | Registry Scout | Check if similar item already exists |
| `validate_skill` | Skill Builder | Check SKILL.md frontmatter is well-formed |
| `validate_agent` | Agent Builder | Check agent .md frontmatter + required XML tags |
| `validate_team` | Team Builder | Check coverage, redundancy, gaps |

Agents write directly to registry using workspace tools. User approves or rejects changes (like accepting code changes). **Registry auto-reindexes** on file changes (file watcher).

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

The registry evolves into a **marketplace** where agents, skills, and team templates are all independently publishable and discoverable. The meta-team doesn't just find team templates — it **remixes** across the whole catalog.

### What's in the Marketplace

| Item type | What it is | Example |
|-----------|-----------|---------|
| **Agent** | A single agent `.md` definition | `@community/stripe-integrator` — knows Stripe APIs |
| **Skill** | A single `SKILL.md` knowledge pack | `@security/owasp-review` — OWASP checklist |
| **Team template** | A plugin bundling agents + skills | `@official/engineering-team` — full-stack team |

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

### Marketplace Index (v2.0+)

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

---

## 7. External Agents — Ping MCP Server

> **Full architecture:** [docs/features/ping-mcp-server/feature_architecture.md](../ping-mcp-server/feature_architecture.md)  
> **Implementation plan:** [docs/features/ping-mcp-server/feature_implementation_planning.md](../ping-mcp-server/feature_implementation_planning.md)  
> **Feature flag:** `PING_MCP_SERVER_ENABLED`

**Decision: Ping exposes ONE MCP server. Every external tool just installs it.**

```
Claude Code  → adds Ping MCP → gets tasks, executes, reports back
Cursor       → adds Ping MCP → same
Windsurf     → adds Ping MCP → same
OpenClaw     → adds Ping MCP → same
Another Ping → adds Ping MCP → same (team stacking)
```

**Config for any MCP client:**
```json
{ "ping": { "type": "http", "url": "http://localhost:3002/mcp" } }
```

**Key principles:**
- **Complement, don't replace** — external agents use their own superior tools (Read, Write, Bash); Ping only serves coordination, collaboration, context, skills
- **Capability negotiation** — Ping detects what agent already has, serves only what's missing
- **Same bounds** — external agents have same maxTurns, permissions, hooks, DAG constraints as internal agents
- **Workers, not tools** — external agents are assigned tasks by orchestrator, same `AgentEvent` stream

See [Ping MCP Server architecture](../ping-mcp-server/feature_architecture.md) for full tool list, security model, and team stacking details.

---

## 8. Version Roadmap

| Version | What | Plan |
|---------|------|------|
| **v1.0** | Plugin loader, discovery index, team creation from plugin, 3 sample plugins | [8 steps](v1.0/feature_implementation_planning.md) |
| **v1.1** | Meta-team (4 agents, 3 modes), tool call UI, mode selector | [9 steps](v1.1/feature_implementation_planning.md) |
| **v2.0** | Remote marketplace, plugin install/publish, ratings, Claude Code adapter | [8 steps](v2.0/feature_implementation_planning.md) |
| **v2.1** | Cross-source meta-team search, mix local + remote | — |
| **v3.0** | Marketplace UI, contributor accounts, reviews | — |

### Feature Flags

| Flag | Default | What it controls |
|------|---------|-----------------|
| `REGISTRY_ENABLED` | `false` | v1.0: plugin loader + discovery API |
| `META_TEAM_ENABLED` | `false` | v1.1: meta-team + modes |
| `MARKETPLACE_ENABLED` | `false` | v2.0: remote install/publish |
