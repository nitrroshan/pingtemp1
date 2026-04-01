# v1.0 Feature: Agent Workspace (L1 Task Memory)

> **Goal:** Git-based isolated workspaces for task execution with rollback, navigation, safety, and agent self-awareness  
> **Status:** ✅ COMPLETE (Phases 1-10)  
> **Priority:** 🔴 Critical — Agents need workspace isolation to function  
> **Dependencies:** None (first phase)

**Parent:** [../feature_architecture.md](../feature_architecture.md)  
**Research:** [../AGENT_WORKSPACE_RESEARCH.md](../AGENT_WORKSPACE_RESEARCH.md) — 8 competitor analyses, 4-zone model, navigation layers

---

## 1. Problem Statement

### Current State
- Agents work in-memory without file system isolation
- No rollback if task fails
- No version history of work in progress
- Artifacts scattered, not tied to task lifecycle

### Target State
- Each task gets an isolated Git branch
- Agent can create/modify files safely
- Failed tasks can be rolled back
- Successful tasks merge artifacts to team memory (L2)

---

## 2. Core Concepts

### Agent Workspace
A **temporary isolated environment** for one agent working on one task. Used uniformly for all task types — file-producing (code, docs), action-executing (email, API calls), and research.

```
workspace-{taskId}/
├── .git/                    # Git repo (branch: task-{taskId})
├── artifacts/               # Files created during task
│   ├── code/
│   ├── docs/
│   └── data/
├── activity/                # Activity log (all task types)
│   └── activity.jsonl       # Tool calls, results, decisions
├── context/                 # Pulled knowledge (read-only)
│   ├── knowledge/
│   └── dependencies/
└── workspace.json           # Metadata
```

### Task Type Handling

All tasks get the same workspace. What differs is what ends up inside:

| Task Pattern | Workspace Contains | Published to L2 |
|---|---|---|
| **File-producing** (code, docs) | `artifacts/` with files + `activity/` log | Output manifest (`.ping/outputs/{taskId}.json`) |
| **Action-executing** (email, API) | `activity/` log + optional output files | Output manifest + activity summary |
| **Research/Analysis** | `activity/` log + summary doc in `artifacts/` | Output manifest + summary |

### Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     WORKSPACE LIFECYCLE                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  1. TASK ASSIGNED                                                         │
│     └── WorkspaceManager.createWorkspace(agentId, taskId)                │
│                         │                                                 │
│  2. WORKSPACE CREATED   ▼                                                 │
│     ├── Create branch: task-{taskId}-{slug}                              │
│     ├── Initialize workspace.json                                        │
│     └── Pull knowledge context (if any)                                  │
│                         │                                                 │
│  3. AGENT WORKS         ▼                                                 │
│     ├── workspace.createFile(path, content)    [file tasks]              │
│     ├── workspace.updateFile(path, content)    [file tasks]              │
│     ├── workspace.logActivity(entry)           [all tasks — auto]        │
│     ├── workspace.commit("WIP: implemented X")                           │
│     └── Repeat until task complete                                       │
│                         │                                                 │
│  4. TASK OUTCOME        ▼                                                 │
│     ├── SUCCESS: workspace.publish() → write output manifest             │
│     │            workspace.merge() → merge branch                        │
│     │            (manifest lands in main at .ping/outputs/{taskId}.json)  │
│     │            (shared binaries via Hocuspocus — see v1.1 plan)        │
│     │                                                                     │
│     └── FAILURE: workspace.discard() → delete branch                     │
│                  OR workspace.retry() → create v2 branch                 │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Components

### 3.1 GitBranchManager

**Purpose:** Low-level Git operations for branch management

```typescript
interface GitBranchManager {
  // Configuration
  readonly repoPath: string;
  readonly mainBranch: string;  // 'main' or 'master'
  
  // Branch operations
  createBranch(branchName: string, baseBranch?: string): Promise<BranchInfo>;
  deleteBranch(branchName: string, force?: boolean): Promise<void>;
  mergeBranch(branchName: string, targetBranch?: string): Promise<MergeResult>;
  
  // Branch info
  getBranchStatus(branchName: string): Promise<BranchStatus>;
  branchExists(branchName: string): Promise<boolean>;
  getCurrentBranch(): Promise<string>;
  
  // File operations (within branch)
  checkout(branchName: string): Promise<void>;
  addFile(filePath: string): Promise<void>;
  commit(message: string, author?: string): Promise<CommitInfo>;
  
  // Recovery
  resetToCommit(commitHash: string): Promise<void>;
  getCommitHistory(branchName: string, limit?: number): Promise<CommitInfo[]>;
}

interface BranchInfo {
  name: string;
  baseBranch: string;
  createdAt: Date;
  headCommit: string;
}

interface BranchStatus {
  name: string;
  exists: boolean;
  aheadOfMain: number;
  behindMain: number;
  lastCommit?: CommitInfo;
  files: {
    added: number;
    modified: number;
    deleted: number;
  };
}

interface MergeResult {
  success: boolean;
  mergeCommit?: string;
  conflicts?: string[];  // File paths with conflicts
}
```

**Implementation Notes:**
- Uses `simple-git` library (already in dependencies)
- Branch naming: `task-{taskId}-{slug}[-v{n}]`
- All operations are async

**File:** `src/worker/memory/workspace/GitBranchManager.ts`

---

### 3.2 AgentWorkspace

**Purpose:** High-level workspace API for agent file operations

```typescript
interface AgentWorkspace {
  // Identity
  readonly id: string;           // Workspace ID
  readonly agentId: string;      // Owning agent
  readonly taskId: string;       // Associated task
  readonly branchName: string;   // Git branch
  readonly basePath: string;     // File system path
  
  // Status
  readonly status: WorkspaceStatus;
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
  
  // Initialization
  initialize(task: Task): Promise<void>;
  pullContext(knowledgeRefs: string[]): Promise<void>;
  
  // File operations
  createFile(path: string, content: string): Promise<FileInfo>;
  readFile(path: string): Promise<string>;
  updateFile(path: string, content: string): Promise<FileInfo>;
  deleteFile(path: string): Promise<void>;
  listFiles(directory?: string): Promise<FileInfo[]>;
  fileExists(path: string): Promise<boolean>;
  
  // Activity logging (all task types — tool calls, decisions, outcomes)
  logActivity(entry: ActivityEntry): Promise<void>;
  getActivityLog(): Promise<ActivityEntry[]>;
  getActivitySummary(): Promise<string>;  // LLM-friendly summary for L2 publish
  
  // Version control
  commit(message: string): Promise<CommitInfo>;
  getHistory(): Promise<CommitInfo[]>;
  revertToCommit(commitHash: string): Promise<void>;
  
  // Completion
  publish(): Promise<OutputManifest>;  // Write .ping/outputs/{taskId}.json manifest
  createBinaryFile(path: string, buffer: Buffer): Promise<void>;  // Git-tracked like any file
  merge(): Promise<MergeResult>;      // Merge branch to main
  discard(): Promise<void>;           // Delete branch, cleanup
  retry(): Promise<AgentWorkspace>;   // Create v2 branch, return new workspace
}

type WorkspaceStatus = 
  | 'initializing'   // Being created
  | 'active'         // Agent working
  | 'published'      // Artifacts extracted, ready for merge
  | 'merged'         // Successfully merged
  | 'discarded'      // Branch deleted
  | 'failed';        // Error state

interface FileInfo {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  lastModified?: Date;
}
```

**Implementation Notes:**
- Wraps `GitBranchManager` for git operations
- Provides workspace-relative paths (no escape to parent directories)
- Tracks file changes for artifact extraction
- **Activity logging** — automatically logs all tool invocations (via middleware hook into agent tool calls)
- `publish()` produces file artifacts AND activity summary
- Emits events for real-time UI updates

**ActivityEntry type:**
```typescript
interface ActivityEntry {
  timestamp: Date;
  type: 'tool_call' | 'tool_result' | 'decision' | 'observation' | 'error';
  tool?: string;            // Tool name (e.g., 'send_email', 'search_web')
  input?: Record<string, any>;  // Tool input (sanitized — no secrets)
  output?: string;          // Tool result summary
  duration?: number;        // ms
  metadata?: Record<string, any>;
}
```

**Storage:** `activity/activity.jsonl` — one JSON object per line, append-only. Committed to Git on each `commit()` call.

**File:** `src/worker/memory/workspace/AgentWorkspace.ts`

---

### 3.3 WorkspaceManager

**Purpose:** Manages multiple agent workspaces

```typescript
interface WorkspaceManager {
  // Configuration
  readonly workspacesRoot: string;  // e.g., 'data/workspaces'
  
  // Workspace lifecycle
  createWorkspace(agentId: string, taskId: string): Promise<AgentWorkspace>;
  getWorkspace(taskId: string): AgentWorkspace | undefined;
  getWorkspaceByAgent(agentId: string): AgentWorkspace[];
  listWorkspaces(filter?: WorkspaceFilter): AgentWorkspace[];
  
  // Bulk operations
  cleanupCompleted(maxAge?: number): Promise<CleanupResult>;
  cleanupFailed(maxAge?: number): Promise<CleanupResult>;
  
  // Events
  on(event: 'workspace:created', handler: (ws: AgentWorkspace) => void): void;
  on(event: 'workspace:published', handler: (ws: AgentWorkspace, artifacts: Artifact[]) => void): void;
  on(event: 'workspace:merged', handler: (ws: AgentWorkspace) => void): void;
  on(event: 'workspace:discarded', handler: (ws: AgentWorkspace) => void): void;
}

interface WorkspaceFilter {
  agentId?: string;
  status?: WorkspaceStatus | WorkspaceStatus[];
  createdAfter?: Date;
  createdBefore?: Date;
}

interface CleanupResult {
  cleaned: number;
  failed: number;
  errors?: string[];
}
```

**File:** `src/worker/memory/workspace/WorkspaceManager.ts`

---

## 4. Task Type: L1 Fields

The Task type has **L1-scoped fields** for workspace state (agent-private):

```typescript
interface Task {
  // ... existing fields (id, description, assigned_role, status, etc.)
  
  // L1 fields — Agent-private workspace state
  workspaceId?: string;
  branchName?: string;
  branchVersion?: number;
  branchStatus?: 'not_created' | 'active' | 'merge_requested' | 'merged' | 'deleted';
}
```

> **Note:** `artifacts` and `knowledgeRefs` are **L2 fields** — see [v1.1 implementation plan](../v1.1/feature_implementation_planning.md).

---

## 5. Workspace Configuration

### workspace.json Schema

```typescript
interface WorkspaceMetadata {
  version: '1.0';
  
  // Identity
  workspaceId: string;
  taskId: string;
  agentId: string;
  
  // Git
  branchName: string;
  baseBranch: string;
  baseCommit: string;
  
  // Context
  knowledgeRefs: string[];     // Knowledge docs pulled
  dependencyTasks: string[];   // Task IDs whose outputs are available
  
  // Timestamps
  createdAt: string;           // ISO
  lastCommitAt?: string;       // ISO
  
  // Status
  status: WorkspaceStatus;
  retryCount: number;          // 0 for first attempt
  previousVersion?: string;    // workspace ID of previous attempt
  
  // Artifacts (populated on publish)
  publishedArtifacts?: {
    id: string;
    path: string;
    type: string;
  }[];
  
  // Activity (all task types)
  activityStats: {
    totalEntries: number;
    toolCalls: number;
    errors: number;
    firstActivity?: string;   // ISO
    lastActivity?: string;    // ISO
  };
}
```

---

## 6. File System Layout

### Single Workspace
```
data/workspaces/
  {workspaceId}/
    .git/                         # Git repository
    workspace.json                # Metadata
    
    artifacts/                    # Agent-created files
      code/
        handler.ts
        handler.test.ts
      docs/
        API.md
      data/
        output.json
    
    activity/                     # Activity log (all task types)
      activity.jsonl              # Tool calls, results, decisions
    
    context/                      # Injected context (read-only)
      knowledge/
        api-design.md            # From L3
      dependencies/
        task-001-output.json     # From prerequisite tasks
```

---

## 7. Integration with Worker

### WorkerPool Enhancement

```typescript
// WorkerPool.runTask() - enhanced
async runTask(taskId: string, role: string, input: string): Promise<TaskResult> {
  const worker = this.getOrCreateWorker(role);
  
  // Create workspace (L1)
  const workspace = await this.memoryCoordinator.workspaces?.createWorkspace(
    worker.id,
    taskId
  );
  
  if (workspace) {
    const task = this.memoryCoordinator.tasks.getTask(taskId);
    await workspace.initialize(task);
    
    if (task?.knowledgeRefs?.length) {
      await workspace.pullContext(task.knowledgeRefs);
    }
  }
  
  try {
    // Hook activity logging into agent event stream
    worker.on('tool_start', (event) => {
      workspace?.logActivity({
        timestamp: new Date(),
        type: 'tool_call',
        tool: event.toolName,
        input: event.input,
      });
    });
    worker.on('tool_result', (event) => {
      workspace?.logActivity({
        timestamp: new Date(),
        type: 'tool_result',
        tool: event.toolName,
        output: event.result,
        duration: event.duration,
      });
    });
    
    const result = await worker.execute(input, { workspace });
    
    if (workspace) {
      // Write output manifest (.ping/outputs/{taskId}.json) and merge to main
      const manifest = await workspace.publish();
      // Manifest merges with branch — discoverable via CollaborationSpace
      await workspace.merge();
    }
    
    return result;
    
  } catch (error) {
    if (workspace) {
      if (this.shouldRetry(error)) {
        const retryWorkspace = await workspace.retry();
      } else {
        await workspace.discard();
      }
    }
    throw error;
  }
}
```

### Agent Tools

```typescript
const workspaceTools = [
  {
    name: 'create_file',
    description: 'Create a new file in the workspace',
    parameters: {
      path: { type: 'string', description: 'Relative path within artifacts/' },
      content: { type: 'string', description: 'File content' },
    },
    handler: async ({ path, content }, context) => {
      await context.workspace.createFile(path, content);
      return `File created: ${path}`;
    },
  },
  {
    name: 'read_file',
    description: 'Read a file from workspace or context',
    parameters: { path: { type: 'string' } },
    handler: async ({ path }, context) => {
      return await context.workspace.readFile(path);
    },
  },
  {
    name: 'list_files',
    description: 'List files in workspace',
    parameters: { directory: { type: 'string', optional: true } },
    handler: async ({ directory }, context) => {
      const files = await context.workspace.listFiles(directory);
      return JSON.stringify(files, null, 2);
    },
  },
  {
    name: 'commit',
    description: 'Save current work with a message',
    parameters: { message: { type: 'string' } },
    handler: async ({ message }, context) => {
      const info = await context.workspace.commit(message);
      return `Committed: ${info.hash} - ${message}`;
    },
  },
];
```

---

## 8. Events

```typescript
interface WorkspaceEvents {
  'workspace:created': { workspaceId: string; taskId: string; agentId: string; branchName: string };
  'workspace:file:created': { workspaceId: string; path: string };
  'workspace:file:updated': { workspaceId: string; path: string };
  'workspace:activity': { workspaceId: string; entry: ActivityEntry };
  'workspace:committed': { workspaceId: string; commitHash: string; message: string };
  'workspace:published': { workspaceId: string; artifacts: Artifact[] };
  'workspace:merged': { workspaceId: string; mergeCommit: string };
  'workspace:discarded': { workspaceId: string; reason?: string };
  'workspace:retry': { workspaceId: string; newWorkspaceId: string; retryCount: number };
}
```

---

## 9. Error Handling

```typescript
class WorkspaceError extends Error {
  constructor(
    message: string,
    public code: WorkspaceErrorCode,
    public workspaceId?: string,
  ) {
    super(message);
  }
}

type WorkspaceErrorCode = 
  | 'WORKSPACE_NOT_FOUND'
  | 'BRANCH_EXISTS'
  | 'BRANCH_NOT_FOUND'
  | 'MERGE_CONFLICT'
  | 'FILE_NOT_FOUND'
  | 'FILE_EXISTS'
  | 'INVALID_PATH'
  | 'GIT_ERROR'
  | 'WORKSPACE_LOCKED';
```

### Recovery Scenarios

| Scenario | Recovery |
|----------|----------|
| Merge conflict | Mark workspace failed, agent retries with v2 branch |
| Git error during commit | Retry commit, or discard if persistent |
| Agent crash mid-task | Workspace preserved on disk, can resume or discard |
| Server restart | Workspaces persist, can resume |
| Action task with no files | Activity log still captured, summary published as artifact |

---

## 10. Implementation Phases

### Phase 1: GitBranchManager (4 hours) ✅ COMPLETE
- [x] Create `src/worker/memory/workspace/GitBranchManager.ts`
- [x] Implement branch CRUD operations
- [x] Add tests for branch operations

### Phase 2: AgentWorkspace (4 hours) ✅ COMPLETE
- [x] Create `src/worker/memory/workspace/AgentWorkspace.ts`
- [x] Implement file operations
- [x] Implement commit/history
- [x] Implement publish/merge/discard

### Phase 3: WorkspaceManager (3 hours) ✅ COMPLETE
- [x] Create `src/worker/memory/workspace/WorkspaceManager.ts`
- [x] Implement workspace registry
- [x] Implement cleanup policies
- [x] Add event emissions

### Phase 4: Integration (3 hours) ✅ COMPLETE
- [x] Wire into `MemoryCoordinator`
- [x] Update `WorkerPool.runTask()`
- [x] Create workspace tools for agents (13 tools)
- [x] Integration tests

---

### Phase 5: Workspace Safety & Search (1-2 days) ✅ COMPLETE

**Implemented:**
- [x] `memory/workspace/SafeAgentWorkspace.ts` — composition wrapper with requireReadBeforeWrite, readOnlyPaths, maxFileSizeBytes
- [x] `memory/workspace/AgentWorkspace.ts` — `grep()`, `glob()`, `fileStats()` methods (ripgrep + fast-glob)
- [x] `memory/workspace/tools/workspace-tools.ts` — grep, glob, search_and_replace, file_stats tools
- [x] Dependencies: `@vscode/ripgrep`, `fast-glob`

---

### Phase 6: Scratchpad (Zone 1) (1-2 days) ✅ COMPLETE

**Implemented:**
- [x] `memory/workspace/Scratchpad.ts` — notes, todos, remember, files in `.scratch/` (gitignored)
- [x] `memory/workspace/AgentWorkspace.ts` — `scratchpad` property, auto-initialized
- [x] `memory/workspace/tools/workspace-tools.ts` — scratch_note, scratch_todo, scratch_remember, scratch_file, promote_to_workspace tools

---

### Phase 7: Repo Clone Support (1-2 days) ✅ COMPLETE

**Implemented:**
- [x] `memory/types/index.ts` — `WorkspaceInitOptions` with repoUrl, repoBranch, localPath, sparse
- [x] `memory/workspace/AgentWorkspace.ts` — `initializeFromRepo()` with `.ping/` + `.scratch/` gitignore
- [x] `memory/workspace/GitBranchManager.ts` — `clone()` method with sparse checkout
- [x] `memory/workspace/WorkspaceManager.ts` — `createWorkspace()` accepts `WorkspaceInitOptions`

---

### Phase 8: Keyword Search Index — MiniSearch (2-3 days) ✅ COMPLETE

**Implemented:**
- [x] `memory/workspace/search/WorkspaceSearchIndex.ts` — MiniSearch wrapper with debounced auto-reindex
- [x] `memory/workspace/search/index.ts` — barrel export
- [x] `memory/workspace/AgentWorkspace.ts` — `search` property, auto-reindex on file ops
- [x] `memory/workspace/tools/workspace-tools.ts` — `keyword_search` tool
- [x] Dependency: `minisearch`

> **Note:** MiniSearch + code intel are derived indexes over L1 files. Migration to L2 (`memory/codeintel/`) is planned as part of [v1.1 L2 implementation](../v1.1/feature_implementation_planning.md) when L2 infrastructure exists.

---

### Phase 9: Identity Card (Zone 4) (1-2 days) ✅ COMPLETE

**Implemented:**
- [x] `memory/workspace/IdentityCard.ts` — Full identity management with decision log, tool manifest
- [x] `memory/workspace/AgentWorkspace.ts` — `identityCard` property + setter/getter
- [x] `memory/workspace/tools/workspace-tools.ts` — whoami, my_progress, my_tools, my_context tools
- [ ] `services/WorkerPool.ts` — Wire IdentityCard creation in `runTask()` (deferred to integration phase)

---

### Phase 10: Tree-sitter Repo Map + Symbol Search (3-5 days) ✅ COMPLETE

**Implemented:**
- [x] `memory/workspace/codeintel/TreeSitterService.ts` — WASM parser, 23 languages, per-language caching
- [x] `memory/workspace/codeintel/RepoMapBuilder.ts` — symbol extraction, cross-file reference counting, token budget
- [x] `memory/workspace/codeintel/SymbolIndex.ts` — cross-file symbol registry (exact/prefix/fuzzy search)
- [x] `memory/workspace/codeintel/index.ts` — barrel export
- [x] `memory/workspace/tools/workspace-tools.ts` — get_repo_map, get_symbols, find_symbol, get_dependencies, get_file_summary tools (gated by `codeIntel` flag)
- [x] Dependencies: `web-tree-sitter`, `tree-sitter-wasms`

> **Note:** Code intel indexes are derived data over L1 files. Migration to L2 (`memory/codeintel/`) with DB persistence, branch CoW, and `.scm` tag query support is planned as part of [v1.1 L2 implementation](../v1.1/feature_implementation_planning.md) when L2 infrastructure exists.

---

## 11. Dependencies

```json
{
  "dependencies": {
    "simple-git": "^3.x",
    "@vscode/ripgrep": "^1.x",
    "fast-glob": "^3.x",
    "minisearch": "^7.x",
    "web-tree-sitter": "^0.x",
    "tree-sitter-wasms": "^0.x"
  }
}
```

Phase 5-7: `simple-git` (existing) + `@vscode/ripgrep` (grep) + `fast-glob` (glob)
Phase 8: `minisearch` (BM25-like search, replaces `wink-bm25-text-search`)
Phase 10: `web-tree-sitter` + `tree-sitter-wasms` (WASM, replaces native `tree-sitter`)

> See [AGENT_WORKSPACE_RESEARCH.md §13](../AGENT_WORKSPACE_RESEARCH.md) for rationale behind all dependency choices.

---

## 12. Success Criteria

**Phase 1-4 (Foundation) ✅ COMPLETE:**
- [x] Agent can create/read/update files during task
- [x] All changes tracked in Git with commit history
- [x] Failed tasks leave no artifacts (clean rollback)
- [x] Successful tasks merge to main branch
- [x] Retry creates new branch (v2, v3, etc.)
- [x] Workspaces survive server restart
- [x] UI can show workspace activity (via events)

**Phase 5-10 (Enhancements) ✅ COMPLETE:**
- [x] Agent cannot overwrite files it hasn't read (requireReadBeforeWrite)
- [x] Agent can grep and glob across workspace files
- [x] Agent has private scratchpad for research and experiments
- [x] Workspace supports cloning a git repo when URL is provided
- [x] BM25 keyword search returns relevance-ranked results
- [x] Agent knows its own identity, progress, and capabilities
- [x] Code agents get compressed codebase overview (repo map)
- [x] Code agents can search symbols across the entire workspace (`find_symbol`)

> **Deferred to v1.1:** Code intel + search migration to L2 (DB persistence, branch CoW, `.scm` tag queries) will be planned and implemented alongside L2 infrastructure. See [v1.1 plan](../v1.1/feature_implementation_planning.md).

---

## 13. Phase Summary & Timeline

| Phase | What | Status | Effort | Dependencies |
|-------|------|--------|--------|-------------|
| 1 | GitBranchManager | ✅ Complete | 4h | — |
| 2 | AgentWorkspace | ✅ Complete | 4h | Phase 1 |
| 3 | WorkspaceManager | ✅ Complete | 3h | Phase 2 |
| 4 | Integration | ✅ Complete | 3h | Phase 3 |
| 5 | Safety & Search (grep/glob) | ✅ Complete | 1-2d | Phase 4 |
| 6 | Scratchpad (Zone 1) | ✅ Complete | 1-2d | Phase 4 |
| 7 | Repo Clone Support | ✅ Complete | 1-2d | Phase 5 |
| 8 | Keyword Search (MiniSearch) | ✅ Complete | 2-3d | Phase 5 |
| 9 | Identity Card (Zone 4) | ✅ Complete | 1-2d | Phase 4 |
| 10 | Tree-sitter Code Intel | ✅ Complete | 2-3d | Phase 5 |

**Dependency graph:**
```
Phase 1-4 (done) ─┬─► Phase 5 (done) ─┬─► Phase 7 (done)
                   │                    ├─► Phase 8 (done)
                   │                    └─► Phase 10 (done)
                   ├─► Phase 6 (done)
                   └─► Phase 9 (done)
```

**v1.0 COMPLETE.** All 10 phases implemented. Code intel + search live in L1 for now.
Migration to L2 (DB persistence, branch CoW, `.scm` tag queries) deferred to v1.1 when L2 infrastructure is built.

---

## 14. Future (Not This Version)

These are researched but deferred to later versions:

| Feature | Why Deferred | Version |
|---------|-------------|---------|
| **LSP Integration** (Layer 5) | Complex lifecycle management, 5+ days, needs stable workspace first | v1.0.1 or separate feature |
| **Semantic Search** (Layer 4) | Needs embedding model config, vector store — shares infra with L3 knowledge base | v2.0 Phase 6 |
| **Hybrid Search** (BM25 + vector) | Depends on both BM25 (v1.0 Phase 8) and semantic search (v2.0 Phase 6) | v2.0 Phase 6 |
| **Custom Workspace Templates** | Premature — user can restructure workspace later | Future |
| **Cloud Workspace Providers** (S3/GCS) | Premature — local is fine for now | v2.0+ |
| **Multi-stakeholder Visibility** | Audience-specific views — tie into frontend work | v1.1 (L2 collab) |
| **CLI Tool Sandbox** (Zone 3 tier 3) | Sandboxed shell access — needs security review | Separate feature |
| **Skills System** (Mastra-inspired) | Reusable instruction packages — needs design | Separate feature |
