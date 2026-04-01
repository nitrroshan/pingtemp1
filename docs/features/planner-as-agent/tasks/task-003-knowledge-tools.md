# Task 003: Knowledge Tools

**Status:** `not-started`
**Assignee:**
**Estimated:** 1-2 days
**Branch:** `feature/planner-as-agent`

## Description
Implement knowledge-gathering tools the planner uses during CLARIFY/RESEARCH phases. These help the planner understand the domain, decompose requirements, and assess team capabilities before planning.

## Acceptance Criteria
- [ ] `research_domain` — Internal LLM call with focused prompt (can use cheaper model)
- [ ] `analyze_requirements` — Goal decomposition into structured requirements
- [ ] `get_team_capabilities` — Query AgentFactory registry for available roles and their skills
- [ ] Extend existing `orchestrator/tools/getContext.ts` with L2 search integration (placeholder OK for V1)
- [ ] Each tool returns structured data
- [ ] Unit tests pass

## Implementation Notes
- Files: `packages/backend/orchestrator/tools/knowledgeTools.ts`, modify `getContext.ts`
- L2 integration is placeholder for V1 — return empty results with TODO marker
- `get_team_capabilities` reads from AgentFactory.getAgents() — straightforward

## Dependencies
- Task 001 (types/schemas)
- Independent of Task 002 — can be built in parallel

## Testing
- Unit: each tool returns expected structure (mock LLM)
