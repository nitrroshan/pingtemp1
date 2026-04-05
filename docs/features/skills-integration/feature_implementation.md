# Skills Integration — Implementation Log

**Status:** ✅ Complete (April 6, 2026)

## Branch
`pr/copilot-swe-agent/9` (Phase 2 PR)

## What Was Built

### Backend
1. **SkillResolver** (`packages/backend/skills/SkillResolver.ts`) — Resolves skill IDs to AI SDK `tool()` objects. Supports tool/MCP/instruction skill types.
2. **Per-request DB skill loading** (`packages/backend/services/WorkerPool.ts`) — On each `runTask()`:
   - Looks up agent MongoDB ID via `roleAgentIdMap`
   - Fetches DB-assigned skills via `teamService.getAgentSkills()`
   - Merges YAML skills + DB skills (deduplicated)
   - Resolves via `skillResolver.resolve(allSkillIds)`
   - `refreshSkillTools()` runs on EVERY request (not just first)
3. **Role→AgentId mapping** — `AgentManagerRegistry` passes `roleAgentIdMap` through `AgentManagerV2` → `WorkerPool.setRoleAgentIdMap()`
4. **Seed script** — `bun run seed` creates 10 official skills (Security Review, Code Review, Performance Analysis, API Testing, etc.)

### Frontend
1. **SkillSelector** (`packages/frontend/components/SkillSelector.tsx`) — Checkbox panel showing all available skills, with assigned skills pre-checked. Fetches from `/api/skills` + `/api/v2/teams/:id/agents/:agentId/skills`.
2. **Wired into DetailPanel** — Settings tab shows SkillSelector when an agent is selected. Props: `agentId`, `teamId` passed from App.tsx.

### API Endpoints (pre-existing, verified working)
- `GET /api/skills` — list all skills
- `GET /api/v2/teams/:id/agents/:agentId/skills` — get agent's assigned skills
- `POST /api/v2/teams/:id/agents/:agentId/skills` — assign skill
- `DELETE /api/v2/teams/:id/agents/:agentId/skills/:skillId` — remove skill

## Skill Types Supported
1. **Tool skills** — AI SDK `tool()` wrapping skill content
2. **Instruction skills** — Appended to system prompt (no tool object)
3. **MCP skills** — Falls back to instruction for now (MCP wiring in Phase 3)

## Architecture Decision: Per-Request vs Cached
Current: DB query on every `runTask()`. Planned: Event-driven push (API route → `workerPool.addSkill()`) with in-memory cache. See `docs/features/skills-integration/live-skill-refresh/`.

## Status
✅ End-to-end: User toggles skill in UI → saved to DB → next agent message loads skill tools from DB → agent has access to skill tools.
