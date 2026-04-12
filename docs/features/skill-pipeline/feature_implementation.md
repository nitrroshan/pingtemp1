## Skill Pipeline v1.0 — Implementation Log

### Branch
`user/sahuroshan/setupforcollabration-production`

### Phase 1: Backend Runtime (DONE)

**Step 1 — Created SkillPlugin:**
- [SkillPlugin.ts](../../packages/backend/agentManager/plugins/SkillPlugin.ts) — `IPlugin` + `SkillMcpServer` + `FileBackedSkill`
- Skills exposed as callable AI SDK tools via MCP server pattern (same as WorkspacePlugin)
- On-demand mode: agent sees short descriptions, calls tool for full instructions

**Step 2 — Registered in AgentManagerRegistry (with per-role filtering):**
- [AgentManagerRegistry.ts](../../packages/backend/agentManager/AgentManagerRegistry.ts) — builds `roleSkillMap` from agent definitions
- `backend` role → `[api-design, security-review]`, `qa` → `[test-automation]`, `frontend` → `[react-patterns]`
- SkillMcpServer filters tools by `context.role` — each agent only sees its declared skills

**Step 3 — Removed dead DB code (16 files, ~3,500 LOC):**
- Deleted: SkillRegistryService, EmbeddingService, seedOfficialSkills, skillsRouter, SkillResolver, SkillIntegration, SkillTools, SkillSchema, AgentSkillSchema, tests
- Cleaned: HttpServer (removed /api/skills), schemas/index, package.json scripts

**Step 4 — Deleted remaining `packages/backend/skills/` directory:**
- SkillFileReader + types + QUICKSTART.md — all unreferenced after step 3

### Deviation
Changed from `loadMode: "always"` (invisible system prompt) to `loadMode: "on-demand"` with `SkillMcpServer` callable tools so skill use shows as tool cards in the UI.

### Phase 2: Backend API (DONE)

**Step 5 — Added `GET /api/v2/teams/:id/skills`:**
- [agentManagerHandlerV2.ts](../../packages/backend/api/agentManagerHandlerV2.ts) — calls `services.teams.getTeamSkills(teamId)`
- Returns `{ skills: [{ id, name, description }], count }`

**Step 6 — Added `pluginName` + skills to responses:**
- `GET /teams/:id` → `plugin` field in team object
- `GET /teams/:id/agents` → `skills: string[]` per agent (from defaultSkills)

### Phase 3: Frontend (DONE)

**Step 7 — Added `getTeamSkills()` to AgentServiceV2:**
- [AgentServiceV2.ts](../../packages/frontend/services/AgentServiceV2.ts) — calls `GET /api/v2/teams/${teamId}/skills`

**Step 8 — Rewrote SkillSelector:**
- [SkillSelector.tsx](../../packages/frontend/components/SkillSelector.tsx) — read-only viewer
- Fetches team skills + agent's defaultSkills in parallel
- Shows all team skills with per-agent assignment indicator (CheckCircle2 icon)
- Removed all DB assignment logic (POST/DELETE/toggle/checkboxes)

**Step 9 — Added `Skill` type:**
- [types.ts](../../packages/frontend/types.ts) — `interface Skill { id, name, description }`

### Phase 4: Documentation (DONE)

**Step 10 — Updated copilot-instructions.md:**
- Replaced SkillResolver references → SkillPlugin
- Added key file entry for SkillPlugin

**Step 11 — Updated CLAUDE.md:**
- Removed `test:skills`, `/api/skills/*`
- Updated skills convention to file-based system

### Status
All 11 steps complete. Feature implemented end-to-end.
