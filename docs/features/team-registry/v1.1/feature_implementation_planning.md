# Team Registry v1.1 — Implementation Planning

**Architecture**: [feature_architecture.md](../feature_architecture.md)  
**Depends on**: [v1.0](../v1.0/feature_implementation_planning.md) (plugin loader, discovery index, team creation)

## Branch
`feature/team-registry-v1.1`

## Scope — Meta-Team + Tool Call UI

v1.1 delivers: **Meta-team agents that discover and compose skills/agents/teams, with interactive tool call UI for reviewing and editing suggestions.**

| In scope | Out of scope (v2.0+) |
|----------|---------------------|
| Meta-team plugin (4 agents: Registry Scout, Skill Builder, Agent Builder, Team Builder) | Remote marketplace |
| Team modes system (team-level modes in plugin.json) | Community contributions |
| Mode selector UI (tabs/dropdown in chat area) | Publish/install from URL |
| Discovery-first flow (search existing → suggest → user picks) | Ratings/reviews |
| **Tool call UI** — agent tool results render as interactive components (checkboxes, search, create button) | Marketplace browse UI |
| Skill creation flow (generate SKILL.md from user input) | |
| Agent creation flow (discover skills/MCPs/hooks → compose agent .md) | |
| Team composition flow (discover agents → compose plugin → create team) | |
| Meta-team tools (search_skills, search_agents, search_mcp_servers, etc.) | |

**NOT in scope:** Code/document review UI — that belongs to [untrusted-code-review (A10)](../../untrusted-code-review/feature_architecture.md)
| Save-to-registry flow (write new files, rebuild index) | |

## Implementation Steps

### Step 1: Team Modes System
**Files:** `packages/agent-manager/src/services/WorkerPool.ts`, `packages/backend/api/agentManagerHandlerV2.ts`

Add mode support to team runtime. Modes defined in `plugin.json` control which agents are active.

```typescript
interface TeamMode {
  description: string;
  activeAgents: string[];   // Agent names that handle this mode
  icon?: string;
}

// WorkerPool gets mode awareness:
setActiveMode(modeName: string): void
// Only routes tasks to agents listed in mode.activeAgents
```

- Parse `modes` from plugin.json during team loading (uses v1.0 PluginLoader)
- WorkerPool filters active workers by current mode
- API endpoint: `POST /api/v2/teams/:teamId/mode` to switch modes

**Depends on:** v1.0 Step 3 (PluginLoader)

---

### Step 2: Mode Selector Frontend
**Files:** `packages/frontend/components/ModeSelector.tsx`, `packages/frontend/components/ChatArea.tsx`

Add mode selection UI to the chat area.

- Tabs or dropdown showing available modes for the current team
- Mode name + icon + description
- Switching mode calls backend API
- Default mode = first mode in list, or no modes = all agents active

**Depends on:** Step 1

---

### Step 3: Registry Scout Agent + Discovery Tools
**Files:** `packages/registry/plugins/meta-team/agents/registry-scout.md`, `packages/registry/src/tools/discoveryTools.ts`

Create the Registry Scout agent and its AI SDK tools that search the index.

**Agent definition (registry-scout.md):**
```markdown
---
name: registry-scout
description: Searches the registry index to find existing skills, agents, MCP servers, and hooks. Use when building skills, agents, or teams.
role: scout
model: sonnet
tools: [search_skills, search_agents, search_mcp_servers, search_hooks, get_item_details, check_duplicates]
---

<role>You are a Registry Scout...</role>
```

**Tools to implement:**

| Tool | Input | Output |
|------|-------|--------|
| `search_skills` | `{ query: string, limit?: number }` | Ranked skills with scores |
| `search_agents` | `{ query: string, limit?: number }` | Ranked agents with skills/MCPs |
| `search_mcp_servers` | `{ query: string, limit?: number }` | Ranked MCP server configs |
| `search_hooks` | `{ query: string, limit?: number }` | Ranked hooks |
| `get_item_details` | `{ type: string, name: string }` | Full .md content |
| `check_duplicates` | `{ type: string, description: string }` | Similar items with scores |

Each tool loads `index.json`, embeds the query, does cosine similarity.

**Depends on:** v1.0 Step 4 (IndexBuilder), v1.0 Step 5 (DiscoveryService)

---

### Step 4: Skill Builder Agent + Creation Tools
**Files:** `packages/registry/plugins/meta-team/agents/skill-builder.md`, `packages/registry/src/tools/skillTools.ts`

Create the Skill Builder agent and its tools for creating/editing SKILL.md files.

The Skill Builder agent writes SKILL.md content directly to the registry using workspace tools. User approves or rejects the changes.

**Tools to implement:**

| Tool | Input | Output |
|------|-------|--------|
| `validate_skill` | `{ content: string }` | Checks frontmatter is well-formed (YAML parse + required fields) |

**Flow:**
1. Agent writes SKILL.md to `registry/standalone/skills/<name>/SKILL.md` using `workspace_create_file`
2. Agent calls `validate_skill` to check it's well-formed
3. Tool call UI shows MarkdownPreview with Approve/Reject
4. Approve → file stays, registry auto-reindexes (file watcher)
5. Reject → file deleted

**Depends on:** Step 3 (Registry Scout for duplicate checking)

---

### Step 5: Agent Builder Agent + Creation Tools
**Files:** `packages/registry/plugins/meta-team/agents/agent-builder.md`, `packages/registry/src/tools/agentTools.ts`

Create the Agent Builder agent and its tools. Agent Builder writes agent .md directly to registry using workspace tools. User approves or rejects.

**Tools to implement:**

| Tool | Input | Output |
|------|-------|--------|
| `customize_agent` | `{ baseName: string, addSkills[], addMcps[], removeSkills[] }` | Reads existing agent .md, applies changes, returns modified content |
| `validate_agent` | `{ content: string }` | Checks frontmatter fields + required XML tags in body |

**Flow:**
1. Agent writes .md to `registry/standalone/agents/<name>.md` using `workspace_create_file`
2. Agent calls `validate_agent` to check frontmatter + XML tags
3. Tool call UI shows MarkdownPreview with Approve/Reject
4. Approve → file stays, registry auto-reindexes
5. Reject → file deleted

- `customize_agent` is a real tool because it reads/modifies an existing registry file
- Agent Builder delegates to Skill Builder when user needs a new skill

**Depends on:** Step 3 (Registry Scout), Step 4 (Skill Builder)

---

### Step 6: Team Builder Agent + Composition Tools
**Files:** `packages/registry/plugins/meta-team/agents/team-builder.md`, `packages/registry/src/tools/teamTools.ts`

Create the Team Builder agent and its tools. Team Builder uses Agent Builder + Skill Builder + Registry Scout.

**Tools to implement:**

| Tool | Input | Output |
|------|-------|--------|
| `compose_team` | `{ agents: string[], teamName: string }` | Gathers agent .md files from registry, returns plugin folder structure preview |
| `create_runtime_team` | `{ pluginName: string }` | Creates team + agents + skills in DB (uses v1.0 team creation) |
| `validate_team` | `{ agents: AgentSummary[] }` | Checks coverage, redundancy, gaps against user's goal |

**Flow:**
1. `compose_team` reads existing agent .md files from registry — shows preview
2. User reviews team composition in tool call UI (AgentCards with checkboxes)
3. Agent writes plugin.json + copies agent files to `registry/plugins/<name>/` using workspace tools
4. Approve → files stay, registry auto-reindexes
5. `create_runtime_team` creates the actual running team from the plugin

**Depends on:** Step 3, Step 4, Step 5, v1.0 Step 6 (team creation from plugin)

---

### Step 7: Meta-Team Plugin Assembly
**Files:** `packages/registry/plugins/meta-team/`

Assemble the complete meta-team plugin folder:

```
registry/plugins/meta-team/
├── .claude-plugin/
│   └── plugin.json           # With 3 modes defined
├── agents/
│   ├── registry-scout.md
│   ├── skill-builder.md
│   ├── agent-builder.md
│   └── team-builder.md
└── skills/
    ├── skill-design/
    │   └── SKILL.md           # "How to write effective SKILL.md files"
    ├── agent-design/
    │   └── SKILL.md           # "How to compose agents with skills/MCPs/hooks"
    └── team-design/
        └── SKILL.md           # "How to build effective agent teams"
```

**plugin.json with layered modes:**
```json
{
  "name": "meta-team",
  "description": "Creates skills, agents, and teams",
  "version": "1.0.0",
  "modes": {
    "skill-building": {
      "description": "Create and discover skills",
      "activeAgents": ["registry-scout", "skill-builder"],
      "icon": "puzzle"
    },
    "agent-building": {
      "description": "Create agents with skills, MCPs, and hooks",
      "activeAgents": ["registry-scout", "skill-builder", "agent-builder"],
      "icon": "bot"
    },
    "team-building": {
      "description": "Compose teams from agents",
      "activeAgents": ["registry-scout", "skill-builder", "agent-builder", "team-builder"],
      "icon": "users"
    }
  }
}
```

**Depends on:** Steps 3-6

---

### Step 8: Team Builder UI
**Files:** `packages/frontend/components/TeamBuilder/`

Frontend component shown when meta-team tool calls produce results. Uses the **tool call UI** pattern — tool results render as interactive components inline in the chat, not a separate page.

**Tool → UI Component mapping:**

| Tool call | Renders as | User interaction |
|-----------|-----------|-----------------|
| `search_agents` result | `AgentCard` list with checkboxes | Toggle agents on/off |
| `search_skills` result | `SkillChip` list per agent | Toggle skills on/off |
| `search_mcp_servers` result | MCP badge list | Toggle MCPs on/off |
| `compose_team` result | Team summary with "Create Team" button | Confirm or edit |
| `workspace_create_file` (writing .md) | Inline diff/content view with Accept/Reject | Like Claude Code file edits |

**Components:**
- `ToolResultCard.tsx` — Generic wrapper that routes tool results to specific renderers
- `AgentCard.tsx` — Agent with checkbox, skill list, MCP badges
- `SkillChip.tsx` — Toggleable skill chip
- `McpBadge.tsx` — MCP server indicator
- `RegistrySearch.tsx` — Search bar that calls `search_*` tools
- `CreateTeamButton.tsx` — Confirms and triggers `create_runtime_team`

File write approvals use the **existing tool card** pattern — content shown inline with Accept/Reject, same as Claude Code handles file edits. No separate MarkdownPreview component needed.

**Flow:**
1. User chats with meta-team → agent calls tools (`search_agents`, `compose_team`, etc.)
2. Frontend receives `tool-result` stream events
3. `ToolResultCard` routes each result to the matching interactive component
4. User interacts (toggles checkboxes, clicks "Create Team")
5. Interactions trigger follow-up tool calls or final actions

**Depends on:** Step 7 (meta-team produces tool calls), existing `StreamMessage` / `ToolCard` components

---

### Step 9: Auto-Reindex on Registry Changes
**Files:** `packages/registry/src/index/IndexBuilder.ts` (modify from v1.0)

File watcher on registry directory. When any `.md` or `plugin.json` file changes, automatically rebuild the affected entries in `index.json`.

- Watch `registry/` directory for file create/update/delete events
- Debounce: wait 500ms after last change before rebuilding (batch rapid changes)
- Incremental rebuild: only re-embed changed/new items, not entire index
- Uses AI SDK `embed()` for single-item re-embedding
- On delete: remove entry from index

```typescript
// File watcher (chokidar or fs.watch)
watcher.on('change', debounce(async (path) => {
  if (path.endsWith('.md') || path.endsWith('plugin.json')) {
    await indexBuilder.rebuildEntry(path);
  }
}, 500));
```

**Depends on:** v1.0 Step 4 (IndexBuilder)

---

## File Summary

| New files | Purpose |
|-----------|---------|
| `packages/registry/plugins/meta-team/*` | Meta-team plugin (4 agents + 3 skills) |
| `packages/registry/src/tools/discoveryTools.ts` | Search tools for Registry Scout |
| `packages/registry/src/tools/skillTools.ts` | SKILL.md generation/save tools |
| `packages/registry/src/tools/agentTools.ts` | Agent .md generation/save tools |
| `packages/registry/src/tools/teamTools.ts` | Plugin composition/team creation tools |
| `packages/frontend/components/ModeSelector.tsx` | Mode tabs/dropdown UI |
| `packages/frontend/components/ToolResultCard.tsx` | Routes tool results to interactive components |
| `packages/frontend/components/registry/*` | AgentCard, SkillChip, McpBadge, RegistrySearch, CreateTeamButton |

| Modified files | Change |
|---------------|--------|
| `packages/agent-manager/src/services/WorkerPool.ts` | Add mode filtering for active agents |
| `packages/backend/api/agentManagerHandlerV2.ts` | Add mode switch endpoint |
| `packages/registry/src/index/IndexBuilder.ts` | Add incremental rebuild |
| `packages/frontend/components/ChatArea.tsx` | Add ModeSelector |
| `packages/frontend/components/StreamMessage.tsx` | Route tool results to ToolResultCard |

## Testing Strategy

1. **Unit tests (Steps 3-6):** Each tool individually (search, generate, save, validate)
2. **Integration tests (Step 7):** Meta-team plugin loads correctly, modes activate right agents
3. **E2E tests (Steps 8-9):** User flow: select mode → chat → get interactive tool results → review → create
