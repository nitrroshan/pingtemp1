# Tools & MCP — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 5 (Tools & MCP Ecosystem)  
**ID:** A3

---

## Branch
- `feature/tools-as-mcp`

## Scope
Extract workspace tools into `@ping/workspace-tools` (npm, in-process). Build MCP servers: `@ping/mcp-collab`, `@ping/mcp-knowledge`, `@ping/mcp-skills`. Third-party MCP server integration.

## Implementation Steps

### Step 1: Create @ping/workspace-tools Package
**Files to create:**
- `packages/workspace-tools/package.json`
- `packages/workspace-tools/src/tools/file-tools.ts` — read, write, create, delete, list, grep, glob
- `packages/workspace-tools/src/tools/git-tools.ts` — commit, status, history, publish, discard
- `packages/workspace-tools/src/tools/scratchpad-tools.ts` — scratch_note, scratch_todo, promote
- `packages/workspace-tools/src/tools/activity-tools.ts` — log_activity, workspace_status, workspace_info
- `packages/workspace-tools/src/index.ts` — `createWorkspaceTools(config)` factory

**Move from:** `packages/backend/memory/L1/workspace/tools/workspace-tools.ts`  
**Exit criteria:** Package builds, exports `createWorkspaceTools()`, all 21 tools work

### Step 2: Create @ping/lifecycle-tools Package
**Files to create:**
- `packages/lifecycle-tools/package.json`
- `packages/lifecycle-tools/src/report-status.ts` — `report_status` tool
- `packages/lifecycle-tools/src/complete-task.ts` — `complete_task` tool
- `packages/lifecycle-tools/src/index.ts` — `createLifecycleTools(config)` factory

**Exit criteria:** Package builds, exports lifecycle tools

### Step 3: Create @ping/mcp-collab Server
**Files to create:**
- `packages/mcp-collab/package.json`
- `packages/mcp-collab/src/server.ts` — FastMCP server
- `packages/mcp-collab/src/tools/` — `discover_docs`, `list_docs`, `read_doc`, `write_doc`, `list_plans`, `read_plan`, `group_chat_start`, `group_chat_message`

**Exit criteria:** MCP server starts, `tools/list` returns all tools, tools execute correctly

### Step 4: Create @ping/mcp-knowledge Server
**Files to create:**
- `packages/mcp-knowledge/package.json`
- `packages/mcp-knowledge/src/server.ts` — FastMCP server
- `packages/mcp-knowledge/src/tools/` — `relevant_docs`, `role_skills`, `add_knowledge`, `search_knowledge`

**Depends on:** D1 (Knowledge Base)  
**Exit criteria:** MCP server exposes knowledge base tools

### Step 5: Create @ping/mcp-skills Server
**Files to create:**
- `packages/mcp-skills/package.json`
- `packages/mcp-skills/src/server.ts` — FastMCP server
- `packages/mcp-skills/src/tools/` — `list_available_skills`, `search_skills`, `read_skill`, `read_skill_file`, `run_skill_script`

**Exit criteria:** MCP server exposes skill registry tools

### Step 6: Update Backend to Use Packages
**Files to modify:**
- `packages/backend/agent/internal/InternalAgent.ts` — Import tools from `@ping/workspace-tools` and `@ping/lifecycle-tools`
- `packages/backend/server.ts` — Start MCP servers alongside HTTP/Socket.IO
- `packages/backend/package.json` — Add workspace deps

**Exit criteria:** Backend uses extracted packages, all existing functionality preserved

### Step 7: Third-Party MCP Server Integration
**Files to create:**
- `packages/backend/agent/mcp/McpRegistry.ts` — Registry for connected MCP servers (Brave Search, Docker, GitHub, etc.). Config-driven connection.

**Files to modify:**
- Team config — Allow specifying MCP server connections per team

**Exit criteria:** Teams can configure and use third-party MCP servers

### Step 8: Update Bun Workspace
**Files to modify:**
- Root `package.json` — Add all new packages to workspaces
- Root `tsconfig.json` — Add project references

**Exit criteria:** All packages build, workspace deps resolved

## Testing Strategy
- Each package builds and tests independently
- Integration: backend uses extracted packages correctly
- MCP servers pass `tools/list` and tool execution tests
- Third-party MCP connections work

## Complexity
High — 3-4 weeks. Many packages to extract and test.
