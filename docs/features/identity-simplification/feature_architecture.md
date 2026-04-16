# Identity Simplification — Feature Architecture

**Date:** April 16, 2026  
**Status:** Planning — awaiting approval  
**Scope:** Replace IdentityCard class with a simple `.ping/identity.json` file

---

## Problem

IdentityCard is a 300-line class with 7 interfaces, 10 methods, and a constructor chain spanning 3 packages — all to answer "who am I?" The agent gets its task from the prompt. It gets tools from the tool list. IdentityCard bundles stale snapshots of data that's available live elsewhere.

**Current flow:**
```
WorkerPool.runTask()
  → assembles tools
  → calls wsPlugin.configureAgent({ agentDef, teamId, teamRoles, tools })
  → WorkspacePlugin creates IdentityCard(agentDef, workspace, teamContext)
  → card.setTools(tools)
  → workspace.setIdentityCard(card)
  → 4 tools query card: whoami, my_progress, my_tools, my_context
```

**Problems:**
1. Task data was snapshot at creation time → goes stale (already fixed by removing it)
2. Tool manifest is a copy of what's already in the agent's tool list
3. Team context is just `{ teamId }` — one field
4. `my_progress` queries workspace directly — doesn't need IdentityCard
5. `logDecision`, `addKnowledgeRefs`, `addDependencyOutputs` are never called by any code
6. Class spans 3 packages: workspace (IdentityCard), backend (WorkspacePlugin.configureAgent), agent-manager (WorkerPool passes data)

---

## Proposed Design: `.ping/identity.json` + Standalone Tools

### Replace IdentityCard with a file

At workspace initialization (`prepareForTask`), write a simple JSON file:

```json
// .ping/identity.json
{
  "role": "backend-dev",
  "name": "Backend Developer",
  "goal": "Build reliable backend services and APIs",
  "skills": ["typescript", "node.js", "databases"],
  "team": {
    "id": "eng-team",
    "roles": ["frontend-dev", "qa", "devops", "designer"]
  }
}
```

Agent reads it with `workspace_read_file(".ping/identity.json")` — no special tool needed.

### Refactor the 4 Identity Tools

| Current Tool | What it does | New approach |
|-------------|-------------|-------------|
| `whoami` | Returns `{identity, task}` from IdentityCard | **Remove** — agent reads `.ping/identity.json` via `workspace_read_file`. Task info is in the prompt. |
| `my_tools` | Returns tool manifest array | **Remove** — agent already has its tool list. LLMs know what tools they have. |
| `my_context` | Returns `{task, team, knowledge, deps}` from IdentityCard | **Remove** — task is in prompt, team is in identity.json, deps are in "Deliverables from Upstream Tasks" section, knowledge is in CRDT via `collab read`. |
| `my_progress` | Queries workspace: files, commits, todos, elapsed time | **Keep as standalone** — rename to `workspace_progress`. Queries `workspace.getWorkspaceStatus()`, `workspace.getHistory()`, `workspace.scratchpad`. No IdentityCard needed. |

### What Gets Deleted

| Component | File | Action |
|-----------|------|--------|
| `IdentityCard` class | `packages/workspace/src/L1/workspace/IdentityCard.ts` | Delete |
| `IdentityCard` types | Same file (7 interfaces) | Delete (keep `ProgressSnapshot` for workspace_progress) |
| `setIdentityCard` / `identityCard` getter | `AgentWorkspace.ts` lines 108-118 | Delete |
| `configureAgent` method | `WorkspacePlugin.ts` lines 194-225 | Replace with `writeIdentityFile()` |
| `configureAgent` caller | `WorkerPool.ts` lines 353-379 | Replace with simpler call |
| `WhoAmITool` class | `workspace-tools.ts` L856-880 | Delete |
| `MyToolsTool` class | `workspace-tools.ts` L905-924 | Delete |
| `MyContextTool` class | `workspace-tools.ts` L928-946 | Delete |
| `MyProgressTool` class | `workspace-tools.ts` L883-902 | Refactor to standalone `WorkspaceProgressTool` |
| Exports | `packages/workspace/src/index.ts` L14-15 | Remove IdentityCard exports |

### What Gets Created

| Component | Where | What |
|-----------|-------|------|
| `writeIdentityFile()` | `WorkspacePlugin.ts` or `AgentWorkspace.ts` | Writes `.ping/identity.json` at workspace init |
| `WorkspaceProgressTool` | `workspace-tools.ts` | Standalone tool — queries workspace directly, no IdentityCard |

---

## Implementation Steps

### Step 1: Create `writeIdentityFile()` in `prepareForTask()`

In `WorkspacePlugin.prepareForTask()`, after workspace creation, write `.ping/identity.json`:

```typescript
// In WorkspacePlugin.prepareForTask() — after workspace.initialize()
const identity = {
  role: toolContext.role,
  name: agentDef?.name || toolContext.role,
  goal: agentDef?.goal || `Execute ${toolContext.role} tasks`,
  skills: agentDef?.skills || [],
  team: {
    id: this.teamId,
    roles: this.teamRoles || [],
  },
};
await workspace.writeFile(".ping/identity.json", JSON.stringify(identity, null, 2));
```

**Depends on:** WorkspacePlugin having access to agentDef and teamRoles. Currently it gets `role` and `taskId` from `ToolContext`. Need to pass `agentDef` via extended context or look up from a registry.

### Step 2: Refactor `my_progress` to standalone tool

```typescript
class WorkspaceProgressTool extends StructuredTool {
  name = "workspace_progress";
  description = "See what you've accomplished: files created, commits, scratchpad notes, elapsed time.";
  schema = z.object({});

  constructor(private workspace: AgentWorkspace) { super(); }

  async _call(): Promise<string> {
    const status = await this.workspace.getWorkspaceStatus();
    const history = await this.workspace.getHistory(50);
    const todos = this.workspace.scratchpad.listTodos();
    const scratchFiles = await this.workspace.scratchpad.listFiles();
    return JSON.stringify({
      filesCreated: status.files.map(f => f.path),
      scratchFiles,
      commits: history.map(c => ({ hash: c.hash, message: c.message })),
      todosCompleted: todos.filter(t => t.completed).length,
      todosTotal: todos.length,
    }, null, 2);
  }
}
```

### Step 3: Remove 3 identity tools from `createWorkspaceTools()`

Remove `WhoAmITool`, `MyToolsTool`, `MyContextTool` from the tool array. Keep `WorkspaceProgressTool` (renamed).

### Step 4: Remove IdentityCard from AgentWorkspace

Delete `_identityCard` field, `setIdentityCard()`, `identityCard` getter.

### Step 5: Remove `configureAgent()` from WorkspacePlugin

Replace the method with identity file writing (done in Step 1's `prepareForTask`).

### Step 6: Remove `configureAgent` call from WorkerPool

Delete the entire block at lines 353-379. Identity is written at `prepareForTask` time, not after tool assembly.

### Step 7: Delete IdentityCard.ts

Remove the file. Update exports in `index.ts` files.

### Step 8: Update worker prompt and SKILL.md

- Remove references to `whoami`, `my_context`, `my_tools` from worker prompt
- Update SKILL.md: "Use `workspace_read_file('.ping/identity.json')` to see your role and team"
- Keep `workspace_progress` (renamed from `my_progress`) documented

---

## Migration Risk

| Risk | Mitigation |
|------|-----------|
| Agent prompt references `whoami`, `my_context` | Search and update all prompts (AgentManagerV2, capabilities.ts, behaviors.ts) |
| `toSystemPromptBlock()` used somewhere | Search confirms it's never called externally — IdentityCard was meant to inject into prompt but this never shipped |
| `logDecision`, `addKnowledgeRefs` called somewhere | Search confirms these are never called — dead code |
| `my_tools` useful for discovery | LLMs already know their tools from the tool list. Redundant. |
| Break `workspace_info` or other tools | `workspace_info` uses workspace metadata, not IdentityCard. No impact. |

---

## Effort Estimate

| Step | Effort |
|------|--------|
| 1: writeIdentityFile | 0.5 day |
| 2: Standalone progress tool | 0.5 day |
| 3-7: Deletions | 0.5 day |
| 8: Prompt/SKILL updates | 0.5 day |
| **Total** | **2 days** |

---

## Decision Required

Proceed with this plan? Key question: should `writeIdentityFile` happen in:
- **`prepareForTask()`** — earlier (before tools assembled, some data may not be available yet)
- **A new `configureAgent()` replacement** — same timing as current, but just writes a file instead of creating a class
