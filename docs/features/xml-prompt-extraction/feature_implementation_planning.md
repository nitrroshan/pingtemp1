## Version 1.0 — All 4 Phases Complete

Parent: [feature_architecture.md](../feature_architecture.md)

## Branch
`user/nitrroshan/tasksmd`

## Scope
Full XML prompt extraction — system prompts, notifications, worker components, and tool descriptions.

## Implementation Steps

### Phase 1 — System Prompts

- [x] Step 1: Create `agent/prompts/generic-worker/system.xml`
  - Extracted 128-line prompt into XML with `{{role}}` variable
  - `AgentManagerV2.ts` already calls `PromptLoader.load("generic-worker", { role })`

- [x] Step 2: Create `agent/prompts/planner/team-config-fallback.xml`
  - Variables: `{{teamId}}`, `{{teamRoles}}`
  - Updated `PlannerAgent.ts` fallback to use `PromptLoader.loadFile()`

### Phase 2 — Notifications

- [x] Step 3: Add `loadTemplate()` and `loadFile()` methods to `PromptLoader.ts`
  - `loadTemplate(agentId, templateId, vars)` — extracts `<template id="...">` from XML
  - `loadFile(agentId, fileName, vars)` — loads a single XML file (no auto-append)
  - Graceful fallback: returns `[templateId]` if template not found

- [x] Step 4: Create `agent/prompts/orchestrator/notifications.xml`
  - 6 templates: task-created, task-bounced, research-complete, all-complete, research-failed, task-failed
  - `OrchestratorService.ts` already calls `PromptLoader.loadTemplate()` at all 6 sites

### Phase 3 — Worker Components

- [x] Step 5: Add `loadDefinitions()` method to `PromptLoader.ts`
  - Generic XML parser: `loadDefinitions<T>(agentId, fileName, tagName, parser)`
  - Extracts attributes + content from repeated XML elements

- [x] Step 6: Create XML files for worker data
  - `agent/prompts/worker/capabilities.xml` — 5 capability definitions
  - `agent/prompts/worker/behaviors.xml` — 6 behavior definitions
  - `agent/prompts/worker/rules.xml` — 2 rule definitions

- [x] Step 7: Update `capabilities.ts`, `behaviors.ts`, `rules.ts`
  - Replaced hardcoded objects with `PromptLoader.loadDefinitions()` calls
  - Interfaces (`CapabilityDef`, `BehaviorDef`, `RuleDef`) kept in TypeScript
  - `DEFAULT_WORKER_*` arrays now loaded from XML at module init

### Phase 4 — Tool Descriptions

- [x] Step 8: Create tool description XML files
  - `agent/prompts/tools/planner-tools.xml` — 18 planner tool descriptions
  - `agent/prompts/tools/worker-tools.xml` — 4 worker tool descriptions

- [x] Step 9: Update all tool files to load descriptions from XML
  - `executionTools.ts` — 4 tools (cancel_task, get_blocked, get_critical_path, search_agents)
  - `knowledgeTools.ts` — 3 tools (research_domain, analyze_requirements, get_team_capabilities)
  - `submitPlan.ts` — 1 tool
  - `submitResearch.ts` — 1 tool
  - `getStatus.ts` — 1 tool
  - `getContext.ts` — 1 tool
  - `requestApproval.ts` — 1 tool
  - `planMutationTools.ts` — 6 tools (update, add, remove, reprioritize, reassign, replan)
  - `userTools.ts` — 3 tools (ask_user, tell_user, discuss_approach)
  - `completeTaskTool.ts` — 1 tool
  - `reportStatusTool.ts` — 1 tool
  - `requestTaskTool.ts` — 1 tool (with `{{maxTasks}}` variable)
  - `bounceTaskTool.ts` — 1 tool

## Testing
- Build: `cd packages/agent-manager && npx tsc --noEmit` — passes clean
- Runtime: Start backend, create team, trigger plan — verify prompts load correctly

## Files Changed

### New XML Files (8)
- `agent/prompts/generic-worker/system.xml`
- `agent/prompts/planner/team-config-fallback.xml`
- `agent/prompts/orchestrator/notifications.xml`
- `agent/prompts/worker/capabilities.xml`
- `agent/prompts/worker/behaviors.xml`
- `agent/prompts/worker/rules.xml`
- `agent/prompts/tools/planner-tools.xml`
- `agent/prompts/tools/worker-tools.xml`

### Modified TypeScript Files (18)
- `orchestrator/PromptLoader.ts` — added `loadFile()`, `loadTemplate()`, `loadDefinitions()`
- `orchestrator/PlannerAgent.ts` — fallback uses `loadFile()` instead of inline string
- `agent/prompts/worker/capabilities.ts` — data from XML
- `agent/prompts/worker/behaviors.ts` — data from XML
- `agent/prompts/worker/rules.ts` — data from XML
- `orchestrator/tools/executionTools.ts` — descriptions from XML
- `orchestrator/tools/knowledgeTools.ts` — descriptions from XML
- `orchestrator/tools/submitPlan.ts` — description from XML
- `orchestrator/tools/submitResearch.ts` — description from XML
- `orchestrator/tools/getStatus.ts` — description from XML
- `orchestrator/tools/getContext.ts` — description from XML
- `orchestrator/tools/requestApproval.ts` — description from XML
- `orchestrator/tools/planMutationTools.ts` — descriptions from XML
- `orchestrator/tools/userTools.ts` — descriptions from XML
- `agent/internal/tools/completeTaskTool.ts` — description from XML
- `agent/internal/tools/reportStatusTool.ts` — description from XML
- `agent/internal/tools/requestTaskTool.ts` — description from XML
- `agent/internal/tools/bounceTaskTool.ts` — description from XML
