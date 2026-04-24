# XML Prompt Extraction — Feature Architecture

## Overview

Extract all hardcoded prompt strings from TypeScript files into external XML files, establishing a consistent XML-based prompt management system. The planner agent already uses XML prompts (`system.xml`, `team-config.xml`) loaded via `PromptLoader`. This feature extends that pattern to cover **all** inline prompts: OrchestratorService notifications, generic worker prompt, worker capabilities/behaviors/rules, and tool descriptions.

## Current State

### What Already Uses XML

| Component | File | Status |
|-----------|------|--------|
| Planner system prompt | `agent/prompts/planner/system.xml` | ✅ XML |
| Planner team config | `agent/prompts/planner/team-config.xml` | ✅ XML |
| Worker prompts (plugin teams) | `WorkerPromptFactory.ts` → `PromptBuilder` | ⚠️ Programmatic XML assembly |

### What's Still Hardcoded (51+ strings, ~10,260 chars)

| Category | Location | Count | Chars | Priority |
|----------|----------|-------|-------|----------|
| Generic worker system prompt | `AgentManagerV2.ts:68–195` | 1 | ~2,800 | 🔴 HIGH |
| Orchestrator notifications | `OrchestratorService.ts` (6 `notifyPlanner()` calls) | 6 | ~1,260 | 🔴 HIGH |
| Worker capabilities | `prompts/worker/capabilities.ts` | 5 | ~750 | 🟠 MEDIUM |
| Worker behaviors | `prompts/worker/behaviors.ts` | 6 | ~480 | 🟠 MEDIUM |
| Worker rules | `prompts/worker/rules.ts` | 2 | ~170 | 🟠 MEDIUM |
| PlannerAgent fallback | `PlannerAgent.ts:56–63` | 1 | ~300 | 🟠 MEDIUM |
| Tool descriptions & errors | 9+ tool files | 30+ | ~4,500 | 🟡 LOW |

### Existing Infrastructure

- **`PromptLoader`** (`orchestrator/PromptLoader.ts`): Reads `system.xml` + all `.xml` files from `agent/prompts/<agentId>/`, replaces `{{variable}}` templates, strips XML comments.
- **`PromptBuilder`** (`agent/prompts/PromptBuilder.ts`): Programmatic XML assembler. Wraps sections in `<agent-identity>`, `<capabilities>`, `<behaviors>`, `<rules>` tags.
- **`WorkerPromptFactory`** (`agent/prompts/worker/WorkerPromptFactory.ts`): Composes worker prompts from capability/behavior/rule TypeScript objects via `PromptBuilder`.

---

## Prompt Audit — Full Inventory

### 1. OrchestratorService Notifications (6 messages)

All via `notifyPlanner()` in `OrchestratorService.ts`:

| Event | Line | Template String |
|-------|------|-----------------|
| Agent-created task | ~165 | `📋 Agent {{createdBy}} created task {{taskId}} for {{targetRole}}{{blocksSuffix}}. Use get_status to see updated task list.` |
| Task bounced | ~177 | `⚠️ Task {{taskId}} bounced by {{role}}: {{reason}}{{suggestedRoleSuffix}}. Use reassign_task or replan to handle this.` |
| Research complete | ~509 | `All research tasks completed. You now have the context to create a plan. Use submit_plan to create and execute the plan.` |
| All tasks complete | ~520 | `All tasks completed successfully.` |
| Research failed | ~559 | `⚠️ Research phase ended with 1+ failed tasks. You can:\n- Continue with partial results: call submit_plan\n- Retry research: call submit_research again\nUse get_status to review what succeeded and what failed.` |
| Task failed | ~576 | `❌ Task "{{description}}" ({{role}}) failed: {{error}}\nUse get_status to see current state. Options: replan, add_tasks, remove_task.` |

### 2. Generic Worker System Prompt (~128 lines)

In `AgentManagerV2.ts` → `getGenericWorkerPrompt(role)`. A comprehensive fallback prompt covering:
- Identity section
- Tool documentation (lifecycle, workspace, scratchpad, collaboration, identity)
- Context-missing guidelines
- Behavior guidelines (6 steps)

### 3. Worker Prompt Components (capabilities.ts, behaviors.ts, rules.ts)

TypeScript objects with `name` + `description` fields. Used by `WorkerPromptFactory` → `PromptBuilder`.

**Capabilities** (5): LIFECYCLE, WORKSPACE, SCRATCHPAD, COLLABORATION, IDENTITY  
**Behaviors** (6): START_BY_UNDERSTANDING, PLAN_THEN_EXECUTE, COMMIT_FREQUENTLY, COLLABORATE, REPORT_PROGRESS, FINISH_PROPERLY  
**Rules** (2): USE_ONLY_AVAILABLE_TOOLS, NO_FABRICATION

### 4. Tool Descriptions & Validation Messages (30+ strings across 9 tool files)

Files: `submitPlan.ts`, `submitResearch.ts`, `userTools.ts`, `planMutationTools.ts`, `requestApproval.ts`, `completeTaskTool.ts`, `reportStatusTool.ts`, `requestTaskTool.ts`, `bounceTaskTool.ts`, `getStatus.ts`

---

## Architecture Options

### Option A: Extend PromptLoader — Single Loader for All Prompts

**Implementation:** Extend the existing `PromptLoader` to cover all agent types. Create XML files per agent type in `agent/prompts/`. OrchestratorService notifications become a separate XML file loaded at init. Worker capabilities/behaviors/rules move from `.ts` to `.xml`.

```
agent/prompts/
├── planner/
│   ├── system.xml           (existing)
│   └── team-config.xml      (existing)
├── orchestrator/
│   └── notifications.xml    (NEW — 6 notification templates)
├── generic-worker/
│   └── system.xml           (NEW — extracted from AgentManagerV2.ts)
└── worker/
    ├── capabilities.xml     (NEW — replaces capabilities.ts)
    ├── behaviors.xml        (NEW — replaces behaviors.ts)
    └── rules.xml            (NEW — replaces rules.ts)
```

**Loading:**
- `PromptLoader.load('orchestrator')` → returns full XML, then extract individual templates by tag at runtime.
- `PromptLoader.load('generic-worker', { role })` → returns assembled prompt.
- Worker capabilities/behaviors: loaded as XML, parsed into `CapabilityDef[]` objects for `WorkerPromptFactory`.

**Pros:**
- Single loading mechanism for all prompts
- Reuses existing `PromptLoader` + `{{variable}}` templating
- Consistent with existing planner pattern
- Simple — no new dependencies

**Cons:**
- Notifications need tag-based extraction (PromptLoader returns one string)
- Worker capabilities currently need structured data (name, tools array) — XML parsing needed
- PromptLoader does simple string replacement, not structured XML parsing

**Effort:** Medium

---

### Option B: PromptLoader for System Prompts + NotificationTemplates for Messages

**Implementation:** Two-tier approach:
1. System prompts (planner, worker, generic-worker) → XML files via `PromptLoader` (same as today).
2. Notification templates → new `NotificationTemplates` module that loads from XML and provides named template access with variable substitution.
3. Worker capabilities/behaviors stay as TypeScript objects (they're structured data, not prose prompts).

```
agent/prompts/
├── planner/
│   ├── system.xml           (existing)
│   └── team-config.xml      (existing)
├── generic-worker/
│   └── system.xml           (NEW — extracted from AgentManagerV2.ts)
├── worker/
│   ├── capabilities.ts      (KEEP — structured data)
│   ├── behaviors.ts         (KEEP — structured data)
│   └── rules.ts             (KEEP — structured data)
└── notifications/
    ├── task-lifecycle.xml    (NEW — task created/bounced/completed/failed)
    └── plan-lifecycle.xml   (NEW — research complete, all done)
```

**New class: `NotificationTemplates`**
```typescript
class NotificationTemplates {
  private templates: Map<string, string>;  // id → template string
  
  static load(category: string): NotificationTemplates;
  render(id: string, vars: Record<string, string>): string;
}
```

**Pros:**
- Clean separation: prose prompts in XML, structured data in TypeScript
- Named template access (no parsing XML at runtime to find a section)
- PromptLoader stays simple — no changes needed
- Worker capabilities remain type-safe TypeScript objects

**Cons:**
- Two loading mechanisms (PromptLoader + NotificationTemplates)
- capabilities/behaviors/rules stay as TypeScript (partial extraction)

**Effort:** Medium

---

### Option C: Full XML Migration — Everything in XML, Parsed at Init

**Implementation:** Move ALL prompt content to XML, including tool descriptions and error messages. Use a richer XML parser (or tag-based extraction) to support structured data in XML.

```
agent/prompts/
├── planner/
│   ├── system.xml
│   └── team-config.xml
├── orchestrator/
│   └── notifications.xml
├── generic-worker/
│   └── system.xml
├── worker/
│   ├── system.xml           (NEW — full worker template with all sections)
│   ├── capabilities.xml     (NEW — replaces .ts)
│   ├── behaviors.xml        (NEW — replaces .ts)        
│   └── rules.xml            (NEW — replaces .ts)
└── tools/
    ├── planner-tools.xml    (NEW — submit_plan, research, etc. descriptions)
    ├── worker-tools.xml     (NEW — complete_task, report_status, etc.)
    └── errors.xml           (NEW — validation messages)
```

**Pros:**
- 100% prompt content in XML — single source of truth
- Easy for non-developers to edit prompts
- Could support prompt versioning (swap XML files for A/B testing)

**Cons:**
- Tool descriptions are tightly coupled to Zod schemas in TypeScript — separation adds fragility
- Need XML parsing for structured fields (capabilities with tool arrays)
- Over-engineering for error messages (they're code, not prompts)
- High effort, many files to change

**Effort:** High

---

## Recommendation

**Option C: Full XML Migration — Everything in XML, Parsed at Init**

### Why Option C over Option B

1. **Templating is already universal** — `PromptLoader` does `{{variable}}` replacement. Creating a separate `NotificationTemplates` class duplicates this logic. Better to extend `PromptLoader` with tag-based extraction so everything uses one system.
2. **Long-term maintainability** — One place to edit all prompts (XML files) vs. hunting across 15+ TypeScript files. Non-developers can review/edit prompt content.
3. **Prompt versioning** — Swap XML files for A/B testing, per-team customization, or iterative prompt tuning without code changes.
4. **Consistency** — Planner already uses XML. Workers and orchestrator should follow the same pattern.
5. **Separation of concerns** — Tool *descriptions* (prose for the LLM) belong in XML. Tool *schemas* (Zod types) stay in TypeScript. These are genuinely separate things.

### How to Handle Structured Data in XML

The concern about capabilities needing "structured data" (tool arrays) is solved with a simple XML format:

```xml
<capability name="workspace">
  <description>Git-based workspace for file operations. Commit frequently.</description>
  <tools>workspace_create_file, workspace_write_file, workspace_read_file, ...</tools>
</capability>
```

`PromptLoader` parses `<tools>` as a comma-separated list → `string[]`. Types stay in TypeScript as interfaces; XML provides the data.

### Phased Rollout

| Phase | Scope | Risk |
|-------|-------|------|
| **Phase 1** | System prompts: generic-worker, planner fallback | Low — direct extraction |
| **Phase 2** | Notifications: 6 OrchestratorService messages | Low — simple templates |
| **Phase 3** | Worker components: capabilities, behaviors, rules | Medium — structured XML parsing |
| **Phase 4** | Tool descriptions (decouple from Zod definitions) | Medium — many files |

### Phase 1 — System Prompts

| Source | Target XML | Variables |
|--------|-----------|-----------|
| `AgentManagerV2.ts` → `getGenericWorkerPrompt()` | `agent/prompts/generic-worker/system.xml` | `{{role}}` |
| `PlannerAgent.ts` → fallback team config | `agent/prompts/planner/team-config-fallback.xml` | `{{teamRoles}}` |

### Phase 2 — Notifications

| Source | Target XML | Variables |
|--------|-----------|-----------|
| `OrchestratorService.ts` → 6 `notifyPlanner()` calls | `agent/prompts/orchestrator/notifications.xml` | `{{taskId}}`, `{{role}}`, `{{error}}`, `{{createdBy}}`, `{{targetRole}}`, `{{reason}}`, `{{description}}` |

XML format with named templates:
```xml
<notifications>
  <template id="task-created">
    📋 Agent {{createdBy}} created task {{taskId}} for {{targetRole}}{{blocksSuffix}}.
    Use get_status to see updated task list.
  </template>
  <template id="task-failed">
    ❌ Task "{{description}}" ({{role}}) failed: {{error}}
    Use get_status to see current state. Options: replan, add_tasks, remove_task.
  </template>
  <!-- ... -->
</notifications>
```

### Phase 3 — Worker Components

| Source | Target XML | Parsing |
|--------|-----------|---------|
| `capabilities.ts` (5 defs) | `agent/prompts/worker/capabilities.xml` | `<capability name="" tools="">` → `CapabilityDef[]` |
| `behaviors.ts` (6 defs) | `agent/prompts/worker/behaviors.xml` | `<behavior name="">` → `BehaviorDef[]` |
| `rules.ts` (2 defs) | `agent/prompts/worker/rules.xml` | `<rule name="">` → `RuleDef[]` |

TypeScript interfaces (`CapabilityDef`, `BehaviorDef`, `RuleDef`) are kept — XML provides the data, TS provides the types.

### Phase 4 — Tool Descriptions

| Source | Target XML | Approach |
|--------|-----------|----------|
| 9+ tool files → `description` fields | `agent/prompts/tools/planner-tools.xml` + `worker-tools.xml` | Tool defs load description from XML, keep Zod schema in TS |
| Validation/error messages | `agent/prompts/tools/errors.xml` | Named error templates |

---

## Final Folder Structure

```
agent/prompts/
├── planner/
│   ├── system.xml                (existing — planner identity, capabilities, behaviors)
│   ├── team-config.xml           (existing — runtime injection)
│   └── team-config-fallback.xml  (NEW — Phase 1)
├── generic-worker/
│   └── system.xml                (NEW — Phase 1, extracted from AgentManagerV2.ts)
├── orchestrator/
│   └── notifications.xml         (NEW — Phase 2, 6 notification templates)
├── worker/
│   ├── capabilities.xml          (NEW — Phase 3, replaces capabilities.ts)
│   ├── behaviors.xml             (NEW — Phase 3, replaces behaviors.ts)
│   └── rules.xml                 (NEW — Phase 3, replaces rules.ts)
└── tools/
    ├── planner-tools.xml         (NEW — Phase 4, tool descriptions)
    ├── worker-tools.xml          (NEW — Phase 4, tool descriptions)
    └── errors.xml                (NEW — Phase 4, validation messages)
```

---

## PromptLoader Enhancements

`PromptLoader` needs 2 new capabilities (beyond existing `load()`):

```typescript
class PromptLoader {
  // EXISTING: Load and assemble full system prompt from XML files
  static load(agentId: string, variables?: Record<string, string>): string;
  
  // NEW Phase 2: Load a named template from an XML file with <template id="..."> elements
  static loadTemplate(agentId: string, templateId: string, variables?: Record<string, string>): string;
  
  // NEW Phase 3: Load structured definitions from XML (capabilities, behaviors, rules)
  static loadDefinitions<T>(agentId: string, fileName: string, parser: (el: Element) => T): T[];
}
```

### Template extraction (Phase 2)
Simple regex-based: extract content between `<template id="task-created">...</template>`. No XML parser dependency needed — same approach as current comment stripping.

### Structured parsing (Phase 3)
Regex-based extraction of attributes and content from `<capability name="..." tools="...">`. Returns typed objects matching existing interfaces.

---

## Data Flow

### Current Flow (Planner — unchanged)
```
PlannerAgent.initialize()
  → PromptLoader.load('planner', { teamId, teamRoles, teamMembers })
  → Reads system.xml + team-config.xml → replaces variables → strips comments
  → Passed to AiSdkAgent as systemPrompt
```

### Phase 1 Flow (Generic Worker)
```
WorkerPool.createWorker() [no plugin teams]
  → PromptLoader.load('generic-worker', { role })
  → Reads system.xml → replaces {{role}}
  → Passed to AiSdkAgent as systemPrompt
```

### Phase 2 Flow (Notifications)
```
OrchestratorService.initialize()
  → PromptLoader is available (already imported)

notifyPlanner (on task event)
  → PromptLoader.loadTemplate('orchestrator', 'task-created', { taskId, createdBy, ... })
  → Extracts <template id="task-created"> content → replaces variables
  → Returns message string
```

### Phase 3 Flow (Worker Components)
```
WorkerPromptFactory.buildWorkerPrompt()
  → PromptLoader.loadDefinitions('worker', 'capabilities.xml', parseCapability)
  → Returns CapabilityDef[] (same interface as today)
  → PromptBuilder assembles XML prompt (unchanged)
```

---

## Impact Analysis

| Component | Phase | Change |
|-----------|-------|--------|
| `PromptLoader` | 2–3 | Add `loadTemplate()` and `loadDefinitions()` methods |
| `PromptBuilder` | — | No changes |
| `WorkerPromptFactory` | 3 | Load from XML instead of TS imports |
| `OrchestratorService` | 2 | Replace 6 inline strings with `PromptLoader.loadTemplate()` calls |
| `AgentManagerV2` | 1 | Replace `getGenericWorkerPrompt()` with `PromptLoader.load()` |
| `PlannerAgent` | 1 | Replace fallback string with `PromptLoader.load()` |
| `capabilities.ts` | 3 | Delete (data moves to XML) |
| `behaviors.ts` | 3 | Delete (data moves to XML) |
| `rules.ts` | 3 | Delete (data moves to XML) |
| Tool files (9+) | 4 | Load descriptions from XML |
| Frontend | — | No changes |
| Database | — | No changes |

---

## File Changes Summary

### New XML Files (10)
- `agent/prompts/generic-worker/system.xml` — Phase 1
- `agent/prompts/planner/team-config-fallback.xml` — Phase 1
- `agent/prompts/orchestrator/notifications.xml` — Phase 2
- `agent/prompts/worker/capabilities.xml` — Phase 3
- `agent/prompts/worker/behaviors.xml` — Phase 3
- `agent/prompts/worker/rules.xml` — Phase 3
- `agent/prompts/tools/planner-tools.xml` — Phase 4
- `agent/prompts/tools/worker-tools.xml` — Phase 4
- `agent/prompts/tools/errors.xml` — Phase 4

### Modified TypeScript Files
- `PromptLoader.ts` — add `loadTemplate()`, `loadDefinitions()`
- `OrchestratorService.ts` — replace 6 inline strings
- `AgentManagerV2.ts` — replace `getGenericWorkerPrompt()`
- `PlannerAgent.ts` — replace fallback string
- `WorkerPromptFactory.ts` — load from XML (Phase 3)
- 9+ tool files — load descriptions from XML (Phase 4)
- `agent/prompts/index.ts` — updated exports

### Deleted Files (Phase 3)
- `capabilities.ts` → replaced by `capabilities.xml`
- `behaviors.ts` → replaced by `behaviors.xml`
- `rules.ts` → replaced by `rules.xml`
