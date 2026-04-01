# Task 006: Planner Agent Definition

**Status:** `not-started`
**Assignee:**
**Estimated:** 1 day
**Branch:** `feature/planner-as-agent`

## Description
Create the planner agent YAML definition and initialization wrapper. The planner is created via `AgentFactory.createById('planner')` — same pattern as existing agents, not a custom class.

## Acceptance Criteria
- [ ] `agent/agents/planner.yaml` — model config, tool list, system prompt
- [ ] System prompt includes cognitive workflow: CLARIFY → RESEARCH → ANALYSE → DISCUSS → ASSESS TEAM → REASON → PLAN → SUSPEND/WAKE
- [ ] `orchestrator/PlannerAgent.ts` — initialize via `AgentFactory.createById('planner')`, customize system prompt with team roles (same pattern as `OrchestratorService.initialize()`)
- [ ] Planner agent initializes successfully
- [ ] Planner receives goal and follows cognitive workflow

## Implementation Notes
- Follow existing YAML agent pattern in `packages/backend/agent/agents/`
- System prompt is the key deliverable — it defines the planner's behavior
- Tool list references all tools from Tasks 002-005
- Build step must copy YAML to dist (`copy:agents`)

## Dependencies
- Tasks 001-005 (all tool schemas — planner references them in YAML)

## Testing
- Integration: agent initializes, receives goal, produces structured output
