# Git-Based Task Context — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 4 (Agent Workspace & Persistence)  
**ID:** A8

---

## Branch
- `feature/git-task-context`

## Scope
Two git repos per team: **workspace repo** (where agents do their actual work — code, docs, artifacts) and **memory repo** (per-role personal knowledge store — like Copilot memory). Agents work directly in the workspace repo on task branches. Memory repo is the agent's personal notebook — agents **actively save knowledge during execution** (like Copilot's "remember this") and a post-task hook extracts additional learnings they missed.

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
| `memory/L1/workspace/tools/workspace-tools.ts` | ~200 | **REFACTOR** | **Exists:** `workspace_read`, `workspace_write`, `workspace_list`, `workspace_publish` (promotes to output manifest). **Change:** `workspace_write` → auto-commits after write. `workspace_publish` → commits final + marks branch ready for approval. Add `workspace_commit(message)` for explicit commits. Add `memory_save(category, key, content)` for agents to actively save knowledge during execution (like Copilot's "remember this"). Add `memory_search(query)` for agents to recall prior knowledge. Add `memory_read(category, key?)` for agents to read specific memory entries. |
| `memory/L1/workspace/types.ts` | ~30 | **REFACTOR** | **Exists:** `WorkspaceConfig`, `FileOperation`. **Change:** Add `RepoType`, `BranchConfig`, `CommitConvention`, `TaskBranch`, `MemoryEntry`, `KnowledgeCategory`. |

### Memory Layer

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `memory/MemoryCoordinator.ts` | ~100 | **REFACTOR** (minor) | **Exists:** Plugin-based L1/L2/L3 coordinator with `addPlugin()`, `getPlugin()`. **Change:** Register `MemoryRepo` as L1 plugin. Add `extractLearnings(taskId, role)` hook for post-task knowledge extraction. |
| `memory/MemoryManager.ts` | ~200 | **STAYS** | Task Map storage, task lifecycle. No changes — task data stays in MemoryManager, git handles files. |
| `memory/types/Task.types.ts` | ~50 | **STAYS** | `Task`, `TaskStatus`. No changes. |
| `memory/L2/collaboration/PlanStore.ts` | ~150 | **STAYS** | Plan storage + CRDT. No changes. |
| `memory/L2/collaboration/OutputManifest.ts` | ~100 | **STAYS** | Output tracking. No changes — workspace_publish still writes manifests. |

### Services

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `services/WorkerPool.ts` | ~300 | **REFACTOR** | **Exists:** `runTask()` with workspace tools injection, `createWorker()`, workspace publish + merge on completion. **Change:** On task assignment: checkout workspace branch `task/{taskId}/{role}`. On task completion: mark branch ready for approval + trigger `extractLearnings()`. On task approval: merge workspace branch to main. On task failure: preserve branch + extract failure learnings to memory. Auto-commit convention: `[{role}] {type}: {summary}`. |
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
| `memory/L1/git/MemoryRepo.ts` | **NEW** | Per-role knowledge store — like Copilot memory. NOT a working area. Agents write to it actively during execution via `memory_save` tool, plus post-task hook extracts supplementary learnings. `saveLearning(category, key, content)`, `search(query)` (grep across all knowledge files), `getExpertise(topic)`, `getLessonsLearned(taskId?)`, `readEntry(category, key)`, `listEntries(category?)`. Categories: `expertise/`, `patterns/`, `tool-notes/`, `lessons-learned/`, `profile.md`. |
| `memory/L1/git/LearningExtractor.ts` | **NEW** | Post-task hook (supplementary to agent's active memory saves). Analyzes workspace branch diff + task result → extracts learnings the agent didn't explicitly save → commits to memory repo. Catches implicit knowledge. Uses LLM to distill. Especially valuable for failures. |
| `memory/L1/git/types.ts` | **NEW** | `RepoType`, `BranchConfig`, `CommitConvention`, `TaskBranch`, `MemoryEntry`, `KnowledgeCategory`, `LearningExtractionResult`. |

---

## Summary: Stays / Refactor / New

| Category | Count | Files |
|----------|-------|-------|
| **STAYS** (no changes) | 5 | MemoryManager, Task.types, PlanStore, OutputManifest, RoleTaskQueue |
| **REFACTOR** (modify existing) | 8 | GitBranchManager, AgentWorkspace, workspace-tools, workspace/types, MemoryCoordinator, WorkerPool, SocketServerV2, HttpServer, OrchestratorService |
| **NEW** (create from scratch) | 5 | RepoManager, WorkspaceRepo, MemoryRepo, LearningExtractor, git/types.ts |

---

## Implementation Steps

### Step 1: Git Abstractions + Types
**Tag: NEW (RepoManager, types) + REFACTOR (GitBranchManager, workspace/types)**

**NEW files:**
- `memory/L1/git/types.ts` — `RepoType` (`memory` | `workspace`), `BranchConfig`, `CommitConvention`, `TaskBranch` (taskId, role, branchName, status), `MemoryEntry` (category, key, content, taskSource), `KnowledgeCategory` enum (`expertise | patterns | tool-notes | lessons-learned | anti-patterns`), `LearningExtractionResult`.
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

### Step 3: Memory Repo (Knowledge Store)
**Tag: NEW (MemoryRepo)**

**NEW files:**
- `memory/L1/git/MemoryRepo.ts` — Per-role knowledge store — like Copilot memory. NOT a working area. Uses `RepoManager` internally. Agents write to it **actively during execution** via `memory_save` tool (like telling Copilot "remember this"), plus post-task hooks extract supplementary learnings.
  - `initialize(rolePath)` — Creates repo with directory structure: `expertise/`, `patterns/`, `tool-notes/`, `lessons-learned/`, `profile.md`.
  - `saveLearning(category, key, content, source?)` — Write knowledge entry, commit to main immediately. `source` tracks origin: `{ taskId, type: 'agent_saved' | 'post_task_extracted' }`. No branches needed (single-user, no conflicts).
  - `readEntry(category, key)` — Read a specific knowledge file.
  - `listEntries(category?)` — List entries in a category (or all).
  - `search(query)` — Grep across all knowledge files. Returns relevant entries with categories.
  - `getExpertise(topic?)` — Read expertise files, optionally filtered by topic search.
  - `getLessonsLearned(taskId?)` — Read lessons, optionally filtered.
  - `getProfile()` — Read role's preferences and style notes.
  - `updateProfile(updates)` — Update profile.md with new preferences.
  - `getAllKnowledge()` — Dump all knowledge (for full context injection).

**Directory structure per memory repo:**
```
expertise/            ← domain knowledge summaries
patterns/             ← "what works" for common task types
tool-notes/           ← tool preferences, quirks, tips
lessons-learned/      ← extracted from completed/failed tasks
profile.md            ← role preferences, style, approach
```

**Exit criteria:** Memory repo stores and retrieves knowledge entries. Search finds relevant prior knowledge.

### Step 4: Post-Task Learning Extraction
**Tag: NEW (LearningExtractor) + REFACTOR (MemoryCoordinator, OrchestratorService)**

This is the **supplementary** extraction — catches learnings the agent didn't explicitly save during execution. Like Copilot inferring preferences from your code, not just what you tell it.

**NEW files:**
- `memory/L1/git/LearningExtractor.ts` — Post-task hook that analyzes completed work and extracts knowledge the agent missed:
  - `extractFromCompletion(taskId, role, workspaceDiff, taskResult, existingMemory)` — Reads workspace branch diff + task output + what agent already saved to memory. Uses LLM call (cheap model, structured output) to distill: "What knowledge is in the diff that the agent didn't already save?" Avoids duplicating what agent explicitly saved. Returns `LearningExtractionResult` with categorized entries.
  - `extractFromFailure(taskId, role, workspaceDiff, errorReport, existingMemory)` — Same but focused on failure learnings. Especially valuable because agents often don't save learnings when failing. "What was attempted? Why did it fail? What should be avoided?"
  - Each extracted entry → committed to memory repo via `MemoryRepo.saveLearning(category, key, content, { taskId, type: 'post_task_extracted' })`.
  - Dedup: checks existing memory entries to avoid redundant saves.

**REFACTOR files:**
- `memory/MemoryCoordinator.ts` — Register `LearningExtractor` as post-task plugin. Add `extractLearnings(taskId, role)` method that orchestrates: get workspace diff → call extractor → save to memory.
- `orchestrator/OrchestratorService.ts` — After `handleTaskComplete()`: call `memoryCoordinator.extractLearnings(taskId, role)`. After `handleTaskFailed()`: same, with failure context.

**Exit criteria:** Every completed/failed task produces knowledge entries in the role's memory repo.

### Step 5: Wire into WorkerPool + Task Lifecycle
**Tag: REFACTOR (WorkerPool, workspace-tools)**

**REFACTOR files:**
- `services/WorkerPool.ts`:
  - On task assignment: `workspaceRepo.createTaskBranch(taskId, role)` + `workspaceRepo.checkoutTaskBranch(taskId, role)`. Set worker's working directory to the branch checkout.
  - On task completion: `workspaceRepo.commitWork('[{role}] complete: {summary}')`. Mark branch ready for approval. Emit `workspace:branch_ready` event.
  - On task approval (user approves artifacts): `workspaceRepo.mergeToMain(taskId, role, { squash: true })`. Delete branch after merge.
  - On task failure: Preserve workspace branch. Emit failure event. Trigger learning extraction.
  - Inject prior knowledge: Before task execution, search memory repo (`memoryRepo.search(taskDescription)`) → include relevant knowledge in agent's system prompt context.
- `memory/L1/workspace/tools/workspace-tools.ts`:
  - `workspace_write` → now auto-commits via `workspaceRepo.autoCommit()`.
  - `workspace_commit(message)` — NEW: explicit commit with custom message.
  - `workspace_publish` → commits final state + marks branch ready for review.
  - `memory_save(category, key, content)` — NEW: agent actively saves knowledge during execution (like Copilot's "remember this"). Categories: `expertise`, `patterns`, `tool-notes`, `lessons-learned`. Commits immediately to memory repo. Agent decides what's worth saving.
  - `memory_search(query)` — NEW: agent searches its own prior knowledge. Returns relevant entries with categories + source task.
  - `memory_read(category, key?)` — NEW: agent reads specific knowledge files. If no key, lists entries in category.
  - `memory_update_profile(updates)` — NEW: agent updates its own profile/preferences (like Copilot learning your style).

**Exit criteria:** Full lifecycle works: assign → branch created → agent works (saves knowledge actively via memory_save) → commits → completes → approval → merge. Post-task hook extracts supplementary learnings. Memory injected at start, written during execution, supplemented at end.

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
  - `GET /api/v2/teams/:teamId/memory/:role/search?q=query` — Search agent's memory repo.

**Exit criteria:** User can review task artifacts via API. Approve → merge. Reject → agent continues. Memory searchable via API.

### Step 7: Resumable Context + Memory Injection
**Tag: REFACTOR (WorkerPool)**

**REFACTOR files:**
- `services/WorkerPool.ts` — When assigning a task:
  1. Search role's memory repo for relevant knowledge: `memoryRepo.search(taskDescription)` + `memoryRepo.getExpertise()` + `memoryRepo.getLessonsLearned()`.
  2. Search workspace repo for related prior work: `workspaceRepo.search(taskDescription)` (finds relevant files in main branch).
  3. Construct context injection block: prior knowledge + relevant workspace files.
  4. Include in agent's system prompt: "Your prior knowledge on this topic: [injected]"
  5. Relevance scoring: rank memory entries by keyword overlap with task description. Include top N entries (configurable, default 5).

**Exit criteria:** Agent receives relevant prior knowledge when starting tasks. Repeated/similar tasks benefit from accumulated knowledge.

---

## Testing Strategy
- Unit test: RepoManager init/clone/branch/commit/merge operations
- Unit test: WorkspaceRepo task branch lifecycle (create → commit → merge)
- Unit test: MemoryRepo save/search/retrieve knowledge entries
- Unit test: LearningExtractor distills correct categories from diff + result
- Integration test: full task lifecycle — assign → workspace branch → agent works → commits → complete → approve → merge to main
- Integration test: post-task learning extraction → memory repo populated
- Integration test: resume context — memory repo knowledge injected for similar tasks
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
- Step 3 (memory repo): ~1.5 days
- Step 4 (learning extraction): ~2 days (LLM integration + prompt engineering)
- Step 5 (WorkerPool wiring): ~2 days
- Step 6 (API endpoints): ~1 day
- Step 7 (resumable context): ~1.5 days
