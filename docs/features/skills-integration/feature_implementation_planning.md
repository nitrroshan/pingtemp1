# Skills Integration — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 2 (Real-Time Experience)  
**ID:** C3

---

## Branch
- `feature/skills-integration`

## Scope
Wire existing SkillRegistry into agent tool loading. Agent YAML declares skills, runtime resolves to AI SDK `tool()` objects. User-selectable skills via UI.

## Implementation Steps

### Step 1: Create SkillResolver
**Files to create:**
- `packages/backend/skills/SkillResolver.ts` — Resolve skill names to AI SDK `tool()` objects. Handle 3 types: tool skills (Zod + execute), MCP skills (server URL + tool name), instruction skills (append to system prompt).

**Exit criteria:** `resolve(['web-search', 'code-analysis'])` returns array of AI SDK CoreTool objects

### Step 2: Update Agent YAML Schema
**Files to modify:**
- `packages/backend/agent/agents/*.yaml` — Add `skills:` field to agent definitions
- `packages/backend/agent/AgentFactory.ts` — Read skills from YAML, call SkillResolver, merge with builtin tools

**Exit criteria:** Agent YAML with `skills: ['web-search']` loads those skills as tools

### Step 3: Wire SkillResolver into Agent Initialization
**Files to modify:**
- `packages/backend/agent/internal/InternalAgent.ts` — During initialization, call `SkillResolver.resolve(config.skills)`, merge returned tools with workspace tools and lifecycle tools

**Tool merge order:** builtin workspace tools + lifecycle tools + resolved skills + MCP tools  
**Exit criteria:** Agent gets all tools at creation time

### Step 4: Add Role-Based Skill Presets
**Files to modify:**
- `packages/backend/skills/SkillRegistry.ts` — Add `getSkillsForRole(role)` method returning default skills per role type

**Standard presets:**
- researcher: `['web-search', 'read-url', 'summarize']`
- developer: `['code-analysis', 'run-command']`
- writer: `['grammar-check', 'write-copy']`

**Exit criteria:** New agents get default skills based on role

### Step 5: Implement User Skill Selection API
**Files to modify:**
- `packages/backend/api/HttpServer.ts` — Add `PUT /api/v2/agents/:agentId/skills` endpoint
- `packages/backend/api/SocketServerV2.ts` — Handle `action:update-agent-skills` event

**Exit criteria:** Frontend can add/remove skills per agent, changes take effect on next task

### Step 6: Remove Dead Code
**Files to modify:**
- `packages/backend/skills/SkillIntegration.ts` — Remove unused `enhanceAgentWithSkills()` 
- `packages/backend/skills/SkillTools.ts` — Audit and clean up unused tool functions

**Exit criteria:** No dead skill code remains

## Testing Strategy
- Unit test: SkillResolver resolves each skill type correctly
- Integration test: agent with skills executes task successfully
- Test: user adds skill via API, agent uses it on next task
- Test: invalid skill name → clear error

## Complexity
Low-Medium — 1 week.
