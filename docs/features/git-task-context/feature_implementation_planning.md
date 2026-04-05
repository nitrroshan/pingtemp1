# Git-Based Task Context — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 4 (Agent Workspace & Persistence)  
**ID:** A8

---

## Branch
- `feature/git-task-context`

## Scope
Two git repos per team: **workspace repo** (where agents do their actual work — code, docs, artifacts) and **memory repo** (per-role personal desk — identity, scratchpad, experiments, drafts, activity log, todos). Agents work directly in the workspace repo on task branches. Memory repo is the agent's personal desk — **initialized with the agent's identity** on creation, enriched with scratchpad notes, experiments, and activity as the agent works. **Team-wide knowledge** (domain expertise, patterns, lessons learned) goes to **L2** via the `collab` tool so all agents benefit. Memory repo stores **backlinks** (L2 doc IDs) to team knowledge the agent contributed to.

---

## Current Codebase Inventory

Audit of every existing file this feature touches. Each tagged:
- **STAYS** — No changes needed. Used as-is.
- **REFACTOR** — Exists, needs modification. Details of what changes.
- **NEW** — Does not exist. Must be created from scratch.

### Git / Workspace Layer

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `memory/L1/workspace/GitBranchManager.ts` | ~100 | **REFACTOR** | **Exists:** `createBranch()`, `switchBranch()`, `commit()`, `merge()`, wraps `simple-git`. Single-repo model. **Change:** Abstract into `RepoManager` pattern. Add clone support. Add worktree support for parallel branches. Keep all existing methods. |
| `memory/L1/workspace/AgentWorkspace.ts` | ~150 | **REFACTOR** | **Exists:** Creates workspace directory per team, `readFile()`, `writeFile()`, `listFiles()`, workspace initialization. **Change:** Wire to use `WorkspaceRepo` (task branch checkout before file ops). Add `getWorkingDirectory(taskId, role)` that returns the correct branch path. |
| `memory/L1/workspace/tools/workspace-tools.ts` | ~1300 | **REFACTOR** | **Exists (31 tools across 10 phases — 10 moving to memory-tools.ts):** **Stays in workspace (21 tools):** **Status & Info:** `workspace_status`, `workspace_info`. **File ops:** `workspace_create_file`, `workspace_read_file`, `workspace_write_file`, `workspace_delete_file`, `workspace_file_exists`, `workspace_list_files`. **Version control:** `workspace_commit`, `workspace_get_history`. **Lifecycle:** `workspace_publish`, `workspace_reactivate`, `workspace_discard`. **Search (Phase 5):** `workspace_grep`, `workspace_glob`, `workspace_search_and_replace`, `workspace_file_stats`. **Keyword search (Phase 8):** `keyword_search`. **Code intel (Phase 10, optional):** `get_repo_map`, `get_symbols`, `find_symbol`, `get_dependencies`, `get_file_summary`. **Moving to memory-tools.ts (10 tools — agent-personal):** **Scratchpad:** `scratch_note`, `scratch_todo`, `scratch_remember`, `scratch_file`, `promote_to_workspace`. **Identity:** `whoami`, `my_progress`, `my_tools`, `my_context`. **Activity:** `workspace_log_activity`. **Change:** Remove 10 agent-personal tools (moving to memory). `workspace_write_file` → auto-commits via WorkspaceRepo. `workspace_publish` → commits final + marks branch ready for approval. |
| `memory/L1/workspace/types.ts` | ~30 | **REFACTOR** | **Exists:** `WorkspaceConfig`, `FileOperation`. **Change:** Add `RepoType`, `BranchConfig`, `CommitConvention`, `TaskBranch`, `ScratchEntry`, `MemoryCategory`, `L2BacklinkRef`, `AgentIdentity`. |

### Memory Layer

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `memory/MemoryCoordinator.ts` | ~100 | **REFACTOR** (minor) | **Exists:** Plugin-based L1/L2/L3 coordinator with `addPlugin()`, `getPlugin()`. **Change:** Register `MemoryRepo` as L1 plugin. Add `extractLearnings(taskId, role)` hook for post-task extraction — routes team learnings to L2 (via collab), personal notes to memory repo, stores backlinks. |
| `memory/MemoryManager.ts` | ~200 | **STAYS** | Task Map storage, task lifecycle. No changes — task data stays in MemoryManager, git handles files. |
| `memory/types/Task.types.ts` | ~50 | **STAYS** | `Task`, `TaskStatus`. No changes. |
| `memory/L2/collaboration/PlanStore.ts` | ~150 | **STAYS** | Plan storage + CRDT. No changes. |
| `memory/L2/collaboration/OutputManifest.ts` | ~100 | **STAYS** | Output tracking. No changes — workspace_publish still writes manifests. |

### Services

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `services/WorkerPool.ts` | ~300 | **REFACTOR** | **Exists:** `runTask()` with workspace tools injection, `createWorker()`, workspace publish + merge on completion. **Change:** On task assignment: checkout workspace branch `task/{taskId}/{role}`. On task completion: mark branch ready for approval + trigger `extractLearnings()` (routes team learnings → L2, personal notes → memory). On task approval: merge workspace branch to main. On task failure: preserve branch + extract failure learnings (especially valuable — team anti-patterns → L2, personal notes → memory). Auto-commit convention: `[{role}] {type}: {summary}`. |
| `util/RoleTaskQueue.ts` | ~100 | **STAYS** | Priority queue per role. No changes. |

### API Layer

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `api/SocketServerV2.ts` | ~600 | **REFACTOR** (minor) | **Exists:** Task events, plan events. **Change:** Add `task:approve_artifacts` action handler → triggers workspace branch merge. Add `task:reject_artifacts` → agent continues on same branch. Emit `workspace:branch_ready` when task completes for artifact review. |
| `api/HttpServer.ts` | ~400 | **REFACTOR** (minor) | **Exists:** REST endpoints. **Change:** Add `GET /api/v2/teams/:teamId/workspace/files` (list workspace main branch files). Add `GET /api/v2/teams/:teamId/workspace/branch/:branchName/files` (list task branch files for review). |

### Orchestrator

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `orchestrator/OrchestratorService.ts` | ~900 | **REFACTOR** (minor) | **Exists:** `handleTaskComplete()` with workspace publish. **Change:** After task complete: call `extractLearnings(taskId, role)` on MemoryCoordinator. Handle merge conflict detection → create resolution task. |

### New Files

| File | Tag | Purpose |
|------|-----|---------|
| `memory/L1/git/RepoManager.ts` | **NEW** | Generic git operations wrapper. Init, clone, branch, checkout, commit, merge, log, diff, search (`git log --grep`). Wraps `simple-git`. Shared by WorkspaceRepo and MemoryRepo. |
| `memory/L1/git/WorkspaceRepo.ts` | **NEW** | Shared team repo. `createTaskBranch(taskId, role)`, `commitWork(message)`, `mergeToMain(taskId, role)` (with squash option), `getTaskFiles(taskId, role)`, `detectConflicts()`. Auto-commit via configurable interval or operation count. |
| `memory/L1/git/MemoryRepo.ts` | **NEW** | Per-role personal desk. **Initialized with agent identity** (role, capabilities, tools) on creation. Backend service — CRUD for identity, experiments, drafts, notes, todos, tool-notes, activity log, profile, and L2 backlinks. Categories: `identity/`, `experiments/`, `drafts/`, `tool-notes/`, `scratch/`, `todos/`, `activity/`, `refs/`, `profile.md`. |
| `memory/L1/git/tools/memory-tools.ts` | **NEW** | **Agent's personal toolset** for memory repo. Includes **moved tools** from workspace (scratchpad: `scratch_note`, `scratch_todo`, `scratch_remember`, `scratch_file`, `promote_to_workspace`; identity: `whoami`, `my_progress`, `my_tools`, `my_context`; activity: `log_activity`) + **new tools** (CRUD, search, experiments, drafts, profile, L2 backlinks). ~25 tools total. See Step 3b. |
| `memory/L1/git/LearningExtractor.ts` | **NEW** | Post-task hook. Analyzes workspace branch diff + task result → routes team-relevant learnings to **L2** (via collab tool) + personal notes to **memory repo** + stores backlinks in `refs/`. Catches implicit knowledge. Uses LLM to distill. Especially valuable for failures. |
| `memory/L1/git/types.ts` | **NEW** | `RepoType`, `BranchConfig`, `CommitConvention`, `TaskBranch`, `ScratchEntry`, `MemoryCategory`, `L2BacklinkRef`, `AgentIdentity`, `LearningExtractionResult`, `ExtractionTarget` (`l2` | `memory`). |

---

## Summary: Stays / Refactor / New

| Category | Count | Files |
|----------|-------|-------|
| **STAYS** (no changes) | 5 | MemoryManager, Task.types, PlanStore, OutputManifest, RoleTaskQueue |
| **REFACTOR** (modify existing) | 8 | GitBranchManager, AgentWorkspace, workspace-tools (remove 10 agent-personal tools), workspace/types, MemoryCoordinator, WorkerPool, SocketServerV2, HttpServer, OrchestratorService |
| **NEW** (create from scratch) | 6 | RepoManager, WorkspaceRepo, MemoryRepo, **memory-tools.ts**, LearningExtractor, git/types.ts |

---

## Implementation Steps

### Step 1: Git Abstractions + Types
**Tag: NEW (RepoManager, types) + REFACTOR (GitBranchManager, workspace/types)**

**NEW files:**
- `memory/L1/git/types.ts` — `RepoType` (`memory` | `workspace`), `BranchConfig`, `CommitConvention`, `TaskBranch` (taskId, role, branchName, status), `ScratchEntry` (category, key, content, taskSource), `MemoryCategory` enum (`identity | experiments | drafts | tool-notes | scratch | todos | activity | refs`), `L2BacklinkRef` (docName, key, contributedAt, taskId), `AgentIdentity` (roleName, description, capabilities, assignedTools, createdAt), `LearningExtractionResult`, `ExtractionTarget` (`l2` | `memory`).
- `memory/L1/git/RepoManager.ts` — Generic git wrapper over `simple-git`: `init(path)`, `clone(url, path)`, `createBranch(name, from?)`, `checkout(branch)`, `commit(message, files?)`, `merge(source, target, squash?)`, `log(options)`, `diff(branch1, branch2)`, `search(query)` (wrapper over `git log --grep` + `git grep`), `getStatus()`, `listBranches()`.

**REFACTOR files:**
- `memory/L1/workspace/GitBranchManager.ts` — Extract generic git operations into `RepoManager`. `GitBranchManager` becomes a thin wrapper that delegates to `RepoManager`. Keep existing API for backward compatibility.

**Exit criteria:** RepoManager can create repos, clone repos, create/switch branches, commit files, merge. GitBranchManager still works via delegation.

### Step 2: Workspace Repo (Where Agents Work)
**Tag: NEW (WorkspaceRepo) + REFACTOR (AgentWorkspace)**

**NEW files:**
- `memory/L1/git/WorkspaceRepo.ts` — Shared team repo. Uses `RepoManager` internally.
  - `initialize(teamPath)` — `git init` if not exists.
  - `createTaskBranch(taskId, role)` — creates `task/{taskId}/{role}` from `main`.
  - `checkoutTaskBranch(taskId, role)` — switches to task branch.
  - `commitWork(message, files?)` — commit current changes with convention `[{role}] {type}: {summary}`.
  - `autoCommit(role)` — periodic auto-commit (configurable: every N file writes or M minutes).
  - `mergeToMain(taskId, role, squash?)` — merge task branch to main. Squash option for clean history.
  - `getTaskFiles(taskId, role)` — list files on task branch (for artifact review).
  - `getTaskDiff(taskId, role)` — diff task branch vs main (for review UI).
  - `detectConflicts(taskId, role)` — check if merge would conflict.

**REFACTOR files:**
- `memory/L1/workspace/AgentWorkspace.ts` — Wire file operations through `WorkspaceRepo`. `writeFile()` triggers auto-commit. `getWorkingDirectory(taskId, role)` returns correct branch checkout path. Keep existing `readFile()`, `listFiles()` API.

**Exit criteria:** Agents work directly on workspace task branches. File writes auto-commit. Branch per task+role isolated.

### Step 3a: Memory Repo Backend (Agent's Personal Desk)
**Tag: NEW (MemoryRepo)**

**NEW files:**
- `memory/L1/git/MemoryRepo.ts` — Per-role personal desk. NOT a working area (that's workspace repo), NOT the team knowledge base (that's L2). Uses `RepoManager` internally. **Initialized with agent identity on creation.** Provides the backend API that memory tools call into.
  - `initialize(rolePath, identity: AgentIdentity)` — Creates repo with directory structure: `identity/`, `experiments/`, `drafts/`, `tool-notes/`, `scratch/`, `todos/`, `activity/`, `refs/`, `profile.md`. **Seeds identity files:**
    - `identity/role.md` — role name, description, capabilities (from AgentIdentity)
    - `identity/tools.md` — assigned tools, skills, permissions
    - `profile.md` — initial preferences (empty, agent fills in over time)
  - **Identity operations** (read by `whoami`, `my_progress`, `my_tools`, `my_context`):
    - `getIdentity()` — Read role identity (cached, rarely changes).
    - `updateIdentity(updates)` — Update identity if tools/skills change.
    - `getProgress(taskContext?)` — Read activity log + current task progress.
  - **Activity logging** (replaces `workspace_log_activity`):
    - `logActivity(taskId, entry)` — Append to `activity/{taskId}.md`. "Called 5 tools, produced 2 files."
    - `getActivityLog(taskId?)` — Read activity for a task or all tasks.
  - **CRUD operations** (parallel to workspace file ops):
    - `writeEntry(category, key, content)` — Create or update a scratchpad entry.
    - `readEntry(category, key)` — Read a specific entry.
    - `deleteEntry(category, key)` — Remove stale experiments/drafts.
    - `entryExists(category, key)` — Check if an entry exists.
    - `listEntries(category?)` — List entries in a category (or all).
  - **Search & retrieval:**
    - `search(query)` — Full-text grep across all memory files. Returns relevant entries with categories.
    - `searchByTask(taskId)` — Find all entries created during a specific task.
  - **L2 backlink management:**
    - `writeRef(l2DocName, l2Key, taskId)` — Store a backlink to an L2 doc the agent contributed to.
    - `listRefs()` — List all L2 backlinks.
    - `getRef(l2DocName)` — Get details of a specific L2 backlink.
  - **Profile & preferences:**
    - `getProfile()` — Read role's personal preferences and approach notes.
    - `updateProfile(updates)` — Update profile.md with new preferences.
  - **Status & history:**
    - `getHistory(category?, key?)` — Git log for entry evolution.
    - `getStatus()` — Overview: category counts, last updated, total entries.
    - `getAllEntries()` — Dump all entries (for full context injection).
  - All writes auto-commit to `main` immediately (single-user repo, no branches needed).

**Directory structure per memory repo:**
```
identity/             ← SEEDED on creation: role name, capabilities, tools
experiments/          ← trial-and-error, prototype approaches
drafts/               ← work-in-progress not ready for workspace
tool-notes/           ← personal tool preferences, quirks, tips
scratch/              ← quick notes, ideas, temporary thoughts
todos/                ← things to investigate, learn, try later
activity/             ← per-task activity log (moved from workspace)
refs/                 ← backlinks to L2 docs agent contributed to
profile.md            ← personal preferences, style, approach
```

**Exit criteria:** MemoryRepo initializes with identity seed. Identity tools can read role/tools/capabilities. Activity logging works. CRUD operations work. Search finds relevant entries. L2 backlinks can be stored and listed.

### Step 3b: Memory Tools (Agent's Personal Toolset)
**Tag: NEW (memory-tools.ts)**

Memory tools are the agent's interface to its personal desk — **all agent-personal tools live here**, separate from workspace tools (deliverables) and L2 collab (team knowledge). Includes tools **moved from workspace** (scratchpad, identity, activity) + **new memory-specific** tools.

**NEW files:**
- `memory/L1/git/tools/memory-tools.ts` — Full toolset for memory repo (~25 tools):

  **Identity (moved from workspace → backed by memory `identity/`):**
  - `whoami()` — Agent's identity: role name, description, capabilities. Reads from `identity/role.md` (seeded on creation).
  - `my_tools()` — Agent's assigned tools and skills. Reads from `identity/tools.md`.
  - `my_progress(taskId?)` — Agent's progress: activity log + current task context. Reads from `activity/` + task state.
  - `my_context()` — Agent's full context: identity + progress + personal notes + open todos. Composite view.

  **Scratchpad (moved from workspace → persists to memory repo):**
  - `scratch_note(content, category?)` — Quick note during execution. Persists to `scratch/` in memory repo (survives across tasks, unlike workspace ephemeral scratch).
  - `scratch_todo(item, priority?)` — Track things to do/investigate. Persists to `todos/`. Survives across tasks.
  - `scratch_remember(key, content)` — Remember a fact for later. Persists to `scratch/{key}`.
  - `scratch_file(name, content)` — Save a scratch file (prototype code, rough data). Persists to `drafts/`.
  - `promote_to_workspace(memoryPath, workspacePath)` — Move content from memory repo to workspace repo. "This draft is ready — make it a deliverable."

  **Activity (moved from workspace → backed by memory `activity/`):**
  - `log_activity(entry)` — Log what the agent did. Appends to `activity/{currentTaskId}.md`. Auto-tagged with timestamp.

  **File CRUD (new — mirrors workspace file tools → memory repo):**
  - `memory_read(category, key)` — Read a specific entry. Like `workspace_read_file` but for memory repo.
  - `memory_write(category, key, content)` — Create or update an entry. Auto-commits. Like `workspace_write_file`.
  - `memory_delete(category, key)` — Remove stale experiments/drafts. Like `workspace_delete_file`.
  - `memory_exists(category, key)` — Check if an entry exists. Like `workspace_file_exists`.
  - `memory_list(category?)` — List entries in a category or all categories. Like `workspace_list_files`.

  **Search (new — mirrors workspace search tools → memory repo):**
  - `memory_search(query)` — Full-text search across memory. Like `workspace_grep` but for memory.
  - `memory_search_by_task(taskId)` — Find all entries created during a specific task.

  **Scratchpad-specific (new — higher-level convenience tools):**
  - `memory_experiment(name, content)` — Save an experiment/trial result. Goes to `experiments/`.
  - `memory_draft(name, content)` — Save a work-in-progress draft. Goes to `drafts/`.

  **L2 backlinks:**
  - `memory_ref(l2DocName, l2Key?, notes?)` — Store a backlink to an L2 doc the agent contributed to.

  **Profile & preferences:**
  - `memory_profile(action?, updates?)` — Read or update agent's personal preferences.

  **Status & history:**
  - `memory_status()` — Overview of memory: categories, entry counts, last updated, total entries.
  - `memory_history(category?, key?)` — How entries evolved over time.

**Three-way tool separation:**
```
Workspace tools (21) → operate on workspace repo (shared team deliverables)
  workspace_read_file("src/index.ts")     → reads project code
  workspace_grep("TODO")                  → searches project files
  workspace_commit("added pricing data")  → commits deliverables

Memory tools (~25) → operate on memory repo (agent's personal desk)
  whoami()                                → "I'm the researcher, I can search + analyze"
  my_progress()                           → "T-001: searched 5 sources, found 3 leads"
  log_activity("searched competitor docs") → activity log
  scratch_note("this API needs lowercase") → personal note (persists across tasks)
  scratch_todo("test batch rate limits")   → persistent todo
  memory_experiment("batch-test", "...")    → experiment result
  promote_to_workspace("drafts/report", "report.md") → draft → deliverable
  memory_ref("expertise-pricing")          → backlink to L2 team knowledge

L2 collab tool (1) → operate on L2 CRDT docs (team-wide knowledge)
  collab({ action: "write", docName: "expertise-pricing", ... })  → team knowledge
  collab({ action: "read", docName: "lessons-api-limits", ... })  → any agent reads
```

**Exit criteria:** All ~25 memory tools implemented and tested. Each tool correctly routes to MemoryRepo (not AgentWorkspace). Tools are a separate export from `memory-tools.ts`, injected alongside workspace tools by WorkerPool.

### Step 4: Post-Task Learning Extraction (Routes to L2 + Memory)
**Tag: NEW (LearningExtractor) + REFACTOR (MemoryCoordinator, OrchestratorService)**

This is the **supplementary** extraction — catches learnings the agent didn't explicitly save or share. Key difference from previous framing: **team-relevant learnings go to L2** (via collab), **personal notes go to memory repo**, and **backlinks connect them**.

**NEW files:**
- `memory/L1/git/LearningExtractor.ts` — Post-task hook that analyzes completed work and routes learnings:
  - `extractFromCompletion(taskId, role, workspaceDiff, taskResult, existingMemory, l2Plugin)` — Reads workspace branch diff + task output + what agent already saved. Uses LLM call (cheap model, structured output) to classify each learning:
    - **Team-relevant** (expertise, patterns, lessons, anti-patterns) → writes to **L2** via `l2Plugin.collab({ action: "write", ... })`. Stores **backlink** in memory `refs/`.
    - **Personal** (tool quirks, approach notes, personal observations) → writes to **memory repo** (`tool-notes/`, `scratch/`).
    - Avoids duplicating what agent explicitly saved/shared. Returns `LearningExtractionResult`.
  - `extractFromFailure(taskId, role, workspaceDiff, errorReport, existingMemory, l2Plugin)` — Same but focused on failure learnings. Failures produce **anti-patterns** (→ L2, team should know) + **personal notes** (→ memory, what the agent tried).
  - Dedup: checks existing L2 docs + memory entries to avoid redundant saves.

**REFACTOR files:**
- `memory/MemoryCoordinator.ts` — Register `LearningExtractor` as post-task plugin. Add `extractLearnings(taskId, role)` method that orchestrates: get workspace diff → call extractor → team learnings → L2 + personal notes → memory + backlinks stored.
- `orchestrator/OrchestratorService.ts` — After `handleTaskComplete()`: call `memoryCoordinator.extractLearnings(taskId, role)`. After `handleTaskFailed()`: same, with failure context.

**Exit criteria:** Every completed/failed task produces: team learnings in L2 (accessible to all agents) + personal notes in memory repo + backlinks connecting them.

### Step 5: Wire into WorkerPool + Task Lifecycle
**Tag: REFACTOR (WorkerPool, workspace-tools)**

**REFACTOR files:**
- `services/WorkerPool.ts`:
  - On task assignment: `workspaceRepo.createTaskBranch(taskId, role)` + `workspaceRepo.checkoutTaskBranch(taskId, role)`. Set worker's working directory to the branch checkout.
  - On task completion: `workspaceRepo.commitWork('[{role}] complete: {summary}')`. Mark branch ready for approval. Emit `workspace:branch_ready` event.
  - On task approval (user approves artifacts): `workspaceRepo.mergeToMain(taskId, role, { squash: true })`. Delete branch after merge.
  - On task failure: Preserve workspace branch. Emit failure event. Trigger learning extraction (team learnings → L2, personal notes → memory).
  - **Inject all three tool layers:** workspace tools (21, deliverables only) + memory tools (~25 from Step 3b, agent-personal) + L2 collab (existing 1). All injected into agent's tool array but backed by different repos/services.
  - Inject prior context: Before task execution, search memory repo (`memoryRepo.search(taskDescription)`) for personal experiments/notes + read identity (`memoryRepo.getIdentity()`) + search L2 for team knowledge → include relevant context in agent's system prompt.
- `memory/L1/workspace/tools/workspace-tools.ts`:
  - **Remove 10 agent-personal tools** (moved to memory-tools.ts): scratchpad (`scratch_note`, `scratch_todo`, `scratch_remember`, `scratch_file`, `promote_to_workspace`), identity (`whoami`, `my_progress`, `my_tools`, `my_context`), activity (`workspace_log_activity`).
  - Remaining 21 tools stay unchanged. They operate on the **workspace repo** only.
  - `workspace_write_file` → now auto-commits via `workspaceRepo.autoCommit()`.
  - `workspace_publish` → commits final state + marks branch ready for review.

**Tool injection summary:**
```
WorkerPool.createWorker(role, task):
  │
  ├── Workspace tools (21) → backed by AgentWorkspace + WorkspaceRepo
  │   workspace_read_file, workspace_write_file, workspace_grep, ...
  │   workspace_commit, workspace_publish, workspace_status, ...
  │   get_repo_map, get_symbols, find_symbol, ...
  │   (purely about shared deliverables — no agent-personal tools)
  │
  ├── Memory tools (~25) → backed by MemoryRepo  ← AGENT'S PERSONAL DESK
  │   IDENTITY (moved from workspace):
  │     whoami, my_tools, my_progress, my_context
  │   SCRATCHPAD (moved from workspace → now persists across tasks):
  │     scratch_note, scratch_todo, scratch_remember, scratch_file
  │     promote_to_workspace (cross-repo: memory → workspace)
  │   ACTIVITY (moved from workspace):
  │     log_activity
  │   MEMORY CRUD (new):
  │     memory_read, memory_write, memory_delete, memory_exists, memory_list
  │   SEARCH (new):
  │     memory_search, memory_search_by_task
  │   EXPERIMENTS/DRAFTS (new):
  │     memory_experiment, memory_draft
  │   L2 BACKLINKS (new):
  │     memory_ref
  │   PROFILE/STATUS (new):
  │     memory_profile, memory_status, memory_history
  │
  └── L2 collab tool (1) → backed by PlanStore + CRDT  ← TEAM KNOWLEDGE
      collab (discover, list, read, write, write-block, read-block)
      → agent writes team expertise/patterns/lessons HERE
      → ALL agents can access via collab
```

**Exit criteria:** Full lifecycle works: assign → workspace branch created → agent works with all three toolsets (workspace for deliverables, memory for identity/scratchpad/activity/experiments, L2 for team knowledge) → completes → approval → merge. Agent knows who it is (`whoami`), can track its activity (`log_activity`), persists notes across tasks (`scratch_note`/`scratch_todo`). Post-task hook routes team learnings to L2 + personal notes to memory. Context injected from both sources at task start.

### Step 6: API Endpoints for Artifact Review
**Tag: REFACTOR (SocketServerV2, HttpServer)**

**REFACTOR files:**
- `api/SocketServerV2.ts`:
  - Add `task:approve_artifacts` action → triggers `workspaceRepo.mergeToMain()`.
  - Add `task:reject_artifacts` action → worker continues on same branch (or planner decides).
  - Emit `workspace:branch_ready` when task completes → frontend shows artifact review.
  - Emit `workspace:merged` when artifacts approved → frontend updates workspace view.
- `api/HttpServer.ts`:
  - `GET /api/v2/teams/:teamId/workspace/files` — List files on workspace main branch.
  - `GET /api/v2/teams/:teamId/workspace/branch/:branchName/files` — List files on task branch (for review).
  - `GET /api/v2/teams/:teamId/workspace/diff/:branchName` — Get diff of task branch vs main (for review UI).
  - `GET /api/v2/teams/:teamId/memory/:role/search?q=query` — Search agent's personal memory (scratchpad).
  - `GET /api/v2/teams/:teamId/memory/:role/refs` — List agent's L2 backlinks (what team knowledge it contributed to).

**Exit criteria:** User can review task artifacts via API. Approve → merge. Reject → agent continues. Memory scratchpad browsable. L2 backlinks visible.

### Step 7: Resumable Context — Memory + L2 Injection
**Tag: REFACTOR (WorkerPool)**

**REFACTOR files:**
- `services/WorkerPool.ts` — When assigning a task, gather context from **two sources** + identity:
  1. **Agent identity** (from memory repo): `memoryRepo.getIdentity()` → role name, description, capabilities, assigned tools.
  2. **L2 team knowledge** (accessible to all agents): Search L2 CRDT docs for relevant team expertise, patterns, lessons learned via `l2Plugin.searchDocs(taskDescription)`.
  3. **Personal memory** (private to this role): Search memory repo for personal experiments, notes, drafts: `memoryRepo.search(taskDescription)` + `memoryRepo.listEntries("experiments")` + `memoryRepo.listEntries("todos")` + `memoryRepo.getActivityLog()`.
  4. **Workspace repo** for related prior work: `workspaceRepo.search(taskDescription)` (finds relevant files in main branch).
  5. Construct context injection block:
     - "You are: [identity — role, capabilities, tools]"
     - "Team knowledge on this topic: [L2 entries]"
     - "Your personal notes: [memory experiments, drafts, todos, activity]"
     - "Related workspace files: [workspace search results]"
  6. Include in agent's system prompt.
  7. Relevance scoring: rank entries by keyword overlap with task description. Include top N entries per source (configurable, default 5 L2 + 5 memory).

**Exit criteria:** Agent receives identity + team knowledge (L2) + personal experiments/notes (memory) when starting tasks. `whoami` reflects real identity from memory repo. Repeated/similar tasks benefit from both accumulated team knowledge and personal experience.

---

## Testing Strategy
- Unit test: RepoManager init/clone/branch/commit/merge operations
- Unit test: WorkspaceRepo task branch lifecycle (create → commit → merge)
- Unit test: MemoryRepo identity initialization — seeds `identity/role.md`, `identity/tools.md`, `profile.md`
- Unit test: MemoryRepo CRUD: experiments, drafts, notes, todos, refs, profile
- Unit test: MemoryRepo L2 backlinks: writeRef, listRefs, getRef
- Unit test: Identity tools (`whoami`, `my_tools`, `my_progress`, `my_context`) read from memory repo
- Unit test: Scratchpad tools (`scratch_note`, `scratch_todo`, `scratch_remember`, `scratch_file`) persist to memory repo
- Unit test: `promote_to_workspace` moves content from memory repo to workspace repo
- Unit test: `log_activity` writes to `activity/{taskId}.md` in memory repo
- Unit test: LearningExtractor routes team learnings to L2 + personal notes to memory
- Unit test: Memory tools correctly route to MemoryRepo (not AgentWorkspace)
- Integration test: full task lifecycle — assign → workspace branch → agent works → commits → complete → approve → merge to main
- Integration test: agent identity available from first tool call (`whoami` works immediately)
- Integration test: agent writes team knowledge to L2 via collab + stores backlink in memory refs/
- Integration test: post-task learning extraction → team learnings in L2 + personal notes in memory + backlinks stored
- Integration test: resume context — identity + L2 team knowledge + memory personal notes injected for similar tasks
- Integration test: parallel tasks on different workspace branches don't conflict
- Integration test: merge conflict detection → creates resolution task

## Rollback Plan
- Existing single-workspace model preserved behind `GIT_MODEL=dual|single` env flag
- When `single`: skip workspace branching, skip memory repo, use current `AgentWorkspace` directly
- When `dual` (default after rollout): full two-repo model

## Complexity
High — 2-3 weeks:
- Step 1 (git abstractions): ~2 days
- Step 2 (workspace repo): ~2 days
- Step 3a (memory repo backend): ~1 day
- Step 3b (memory tools): ~1.5 days
- Step 4 (learning extraction): ~2 days (LLM integration + prompt engineering)
- Step 5 (WorkerPool wiring + tool injection): ~2 days
- Step 6 (API endpoints): ~1 day
- Step 7 (resumable context): ~1.5 days
