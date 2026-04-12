## Skill Pipeline v1.0 — Implementation Plan

### Branch
`user/sahuroshan/setupforcollabration-production` (current)

### Scope
Team-scoped file-based skills via registry plugins. Full stack: backend API, runtime injection, frontend display. Remove all DB-based skill code.

### Architecture
See [feature_architecture.md](feature_architecture.md)

### Design Principle
Skills are defined in SKILL.md files under `packages/registry/plugins/<team>/skills/<skillId>/SKILL.md`. They are:
- **Per-agent** — each agent's `.md` file declares `defaultSkills: [skill-id, ...]`; only those skills become tools for that agent
- **Team-scoped** — each team sees only its plugin's skills
- **Role-filtered** — SkillMcpServer filters tools by `context.role` using a `roleSkillMap`
- **Visible in UI** — agents call skills as tools that show up as tool cards
- **Discoverable** — frontend shows team's available skills in Settings tab

---

## Implementation Steps

### Phase 1: Backend Runtime (DONE)

- [x] Step 1: Create SkillPlugin (`packages/backend/agentManager/plugins/SkillPlugin.ts`)
  - `IPlugin` that scans `packages/registry/plugins/<team>/skills/*/SKILL.md`
  - `SkillMcpServer` exposes skills as callable AI SDK tools (visible in UI)
  - `FileBackedSkill` wraps SKILL.md content as `ISkill` (on-demand mode)

- [x] Step 2: Register SkillPlugin in AgentManagerRegistry (team-scoped, per-role)
  - Passes `teams: [team.pluginName]` to scope skills per team
  - Builds `roleSkillMap` from agent definitions (`config.skills` from `.md` defaultSkills)
  - Each role only receives its declared skills as tools

- [x] Step 3: Remove dead DB skill code (16 files, ~3,500 LOC)
  - Deleted: SkillRegistryService, EmbeddingService, seedOfficialSkills, skillsRouter, SkillResolver, SkillIntegration, SkillTools, SkillSchema, AgentSkillSchema
  - Cleaned: HttpServer, skills/index, services/index, schemas/index, package.json

- [x] Step 4: Delete remaining `packages/backend/skills/` directory
  - SkillFileReader was only exported by its own barrel (dead code)
  - Types were unreferenced outside the deleted modules

### Phase 2: Backend API (DONE)

- [x] Step 5: Add `GET /api/v2/teams/:id/skills` endpoint
  - **File:** `packages/backend/api/agentManagerHandlerV2.ts`
  - **Implementation:** Call `services.teams.getTeamSkills(teamId)` (already exists in PluginTeamService)
  - **Response:** `{ skills: [{ id, name, description }], count }`
  - **Why:** Single endpoint for frontend to get available skills for a team
  - **Note:** Per-agent skills already available via `GET /teams/:id/agents` → each agent has `skills: string[]` from defaultSkills
  - **Entry:** PluginTeamService.getTeamSkills() works but no HTTP route exposes it
  - **Exit:** Frontend can call `GET /api/v2/teams/:id/skills` and get a list

- [x] Step 6: Add `pluginName` to `GET /api/v2/teams/:id` and `GET /api/v2/teams` responses
  - **File:** `packages/backend/api/agentManagerHandlerV2.ts`
  - **Changes:**
    - `GET /teams/:id` → add `plugin: team.pluginName` to response
    - `GET /teams` → add `plugin: t.pluginName` to each team in list (already done in list handler, verify)
  - **Why:** Frontend needs pluginName for future skill management, registry lookup
  - **Entry:** GET /teams/:id returns `{ team: { id, name, goal, description, memberCount } }` — no plugin
  - **Exit:** Response includes `plugin` field

### Phase 3: Frontend (DONE)

- [x] Step 7: Add `getTeamSkills()` to AgentServiceV2
  - **File:** `packages/frontend/services/AgentServiceV2.ts`
  - **Add method:** `async getTeamSkills(teamId: string): Promise<Skill[]>` 
  - **Calls:** `GET /api/v2/teams/${teamId}/skills`
  - **Returns:** `Skill[]` with `{ id, name, description, tags }`
  - **Entry:** No skill methods exist in AgentServiceV2
  - **Exit:** Service layer has skill fetching method

- [x] Step 8: Rewrite SkillSelector as team skill viewer with per-agent highlighting
  - **File:** `packages/frontend/components/SkillSelector.tsx`
  - **Changes:**
    - Remove all DB assignment logic (POST/DELETE calls, toggle, assignedIds)
    - Call `AgentServiceV2.getTeamSkills(teamId)` to get all team skills
    - Call `AgentServiceV2.getTeamAgents(teamId)` to get current agent's defaultSkills
    - Display skills as list with name, description, tags
    - Highlight which skills are assigned to this specific agent (from defaultSkills)
    - Keep search/filter functionality
    - Show "Defined in agent .md defaultSkills" footer
  - **Entry:** SkillSelector calls 3 non-existent endpoints (all 404)
  - **Exit:** Skill viewer showing team skills with per-agent assignment indicators

- [x] Step 9: Add `Skill` type to frontend types
  - **File:** `packages/frontend/types.ts`
  - **Add:** `interface Skill { id: string; name: string; description: string; tags: string[] }`
  - **Entry:** No Skill type exists
  - **Exit:** Type-safe skill handling in frontend

### Phase 4: Documentation (DONE)

- [x] Step 10: Update `.github/copilot-instructions.md`
  - Line 18: `skills/SkillResolver.ts` → `agentManager/plugins/SkillPlugin.ts: loads SKILL.md files from registry, scoped per team`
  - Line 202: Same reference update
  - Add key file entry for SkillPlugin
  - Update "Skills loaded per-request" convention to "Skills loaded at init from registry SKILL.md files via SkillPlugin"

- [x] Step 11: Update `CLAUDE.md`
  - Remove `bun run test:skills` (line 31)
  - Remove `/api/skills/*` from HttpServer description (line 59)
  - Update skills convention (line 90): "Skills are SKILL.md files in registry plugins. Loaded by SkillPlugin at startup, scoped per team via pluginName. No database."

---

## Files Summary

| Phase | Action | File | What |
|-------|--------|------|------|
| 1 ✅ | Created | `packages/backend/agentManager/plugins/SkillPlugin.ts` | IPlugin + MCP server + skills |
| 1 ✅ | Modified | `packages/backend/agentManager/AgentManagerRegistry.ts` | Team-scoped registration |
| 1 ✅ | Deleted | `packages/backend/skills/` (entire directory) | Dead DB code |
| 1 ✅ | Modified | `packages/backend/api/HttpServer.ts` | Removed /api/skills route |
| 1 ✅ | Modified | `packages/backend/services/mongo/schemas/index.ts` | Removed skill models |
| 1 ✅ | Modified | `packages/backend/package.json` | Removed dead scripts |
| 2 | Modify | `packages/backend/api/agentManagerHandlerV2.ts` | Add skills endpoint + pluginName in responses |
| 3 | Modify | `packages/frontend/services/AgentServiceV2.ts` | Add getTeamSkills() |
| 3 | Rewrite | `packages/frontend/components/SkillSelector.tsx` | Read-only team skill viewer |
| 3 | Modify | `packages/frontend/types.ts` | Add Skill type |
| 4 | Modify | `.github/copilot-instructions.md` | Remove SkillResolver refs |
| 4 | Modify | `CLAUDE.md` | Remove test:skills, update conventions |

## Testing
- `bun run build:backend` — must pass
- Runtime: create team with pluginName, verify `GET /api/v2/teams/:id/skills` returns team's skills
- Frontend: open Settings tab, see read-only skill list for the team
- Agent execution: send goal, verify skill tool cards appear in chat
