# Task 006: Git Branch Manager + Memory System Enhancements

**Status:** `not-started`
**Assignee:** 
**Estimated:** 3-4 days
**Priority:** 🟠 High
**Branch:** `feature/git-branch-memory`

## Description

Combined task merging **Git Branch Manager** (task isolation via branches) with **Memory System Enhancements** (plan persistence, artifact tracking, rollback). Both features work together for complete task lifecycle management.

## Context

The orchestration system needs:
1. **Branch Isolation**: Each task runs in its own git branch for safe rollback
2. **Plan Persistence**: Store pending/approved plans for review and revision
3. **Artifact Registry**: Track files created per task for context and rollback
4. **Memory Integration**: Branch state stored in MemoryManager task metadata

These are tightly coupled:
- Branch manager needs task context from MemoryManager
- Rollback needs artifact registry to know what files to remove
- Plan store needs to track which branches belong to which plan

## Acceptance Criteria

### Part A: Git Branch Manager
- [ ] Create `src/worker/agentManager/workspace/GitBranchManager.ts`
- [ ] `createBranch(taskId: string)` - Create branch for task
- [ ] `deleteBranch(taskId: string)` - Delete branch (cancel/reject)
- [ ] `mergeBranch(taskId: string)` - Merge to parent branch
- [ ] `getBranchStatus(taskId: string)` - Check branch state
- [ ] Handle merge conflicts with user notification
- [ ] Branch versioning (retry creates v2 branch)
- [ ] Integrate with WorkspaceManager

### Part B: Memory System Enhancements
- [ ] Create `src/worker/orchestrator/PlanStore.ts` - Plan persistence
- [ ] `savePendingPlan(teamId, plan)` - Store pending plan
- [ ] `approvePlan(teamId)` - Move pending → approved, archive revision
- [ ] `getPendingPlan(teamId)` / `getApprovedPlan(teamId)`
- [ ] `getRevisions(teamId)` - Plan revision history
- [ ] Create `src/worker/orchestrator/ArtifactRegistry.ts` - File tracking
- [ ] `register(artifact)` - Track file created by task
- [ ] `getByTask(taskId)` - Files for rollback
- [ ] `remove(artifactId)` - Cleanup on rollback

### Part C: Integration
- [ ] Store `branchName` in Task metadata via MemoryManager
- [ ] Update `Task.types.ts` with branch fields: `branchName`, `branchVersion`, `branchStatus`
- [ ] Wire branch lifecycle to task lifecycle:
  - Task created → Branch created
  - Task completed → Request merge
  - Task cancelled → Delete branch
- [ ] Rollback flow: delete branch + remove artifacts via registry
- [ ] Orchestrator tools: `create_branch`, `merge_branch`, `delete_branch`

## Implementation Notes

### File Structure
```
src/worker/
  agentManager/
    workspace/
      GitBranchManager.ts    # NEW: Branch operations
      WorkspaceManager.ts    # MODIFY: Integrate branch manager
    tools/
      branchTools.ts         # NEW: Orchestrator tools
  orchestrator/
    PlanStore.ts             # NEW: Plan persistence
    ArtifactRegistry.ts      # NEW: File tracking
  memoryManager/
    types/Task.types.ts      # MODIFY: Add branch fields
```

### Branch Naming Convention
```
task-{taskId}-{brief-name}
task-{taskId}-{brief-name}-v2  (retry)
```

### Plan File Structure
```
plans/
  {teamId}/
    pending-plan.json
    approved-plan.json
    revisions/
      plan-v1.json
      plan-v2.json
```

### Enhanced Task Type
```typescript
interface Task {
  // Existing fields...
  id: string;
  description: string;
  assigned_role: string;
  status: TaskStatus;
  
  // NEW: Branch fields
  branchName?: string;
  branchVersion?: number;
  branchStatus?: 'not_created' | 'active' | 'merge_requested' | 'merged' | 'deleted';
  
  // NEW: Artifact tracking
  artifacts?: string[];  // File paths created
}
```

### Key Interfaces
```typescript
interface GitBranchManager {
  createBranch(taskId: string, baseBranch?: string): Promise<BranchInfo>;
  deleteBranch(taskId: string): Promise<void>;
  mergeBranch(taskId: string): Promise<MergeResult>;
  getBranchStatus(taskId: string): Promise<BranchStatus>;
  retryWithNewBranch(taskId: string): Promise<BranchInfo>;
}

interface PlanStore {
  savePendingPlan(teamId: string, plan: TaskPlan): Promise<void>;
  getPendingPlan(teamId: string): Promise<TaskPlan | null>;
  approvePlan(teamId: string): Promise<void>;
  getApprovedPlan(teamId: string): Promise<TaskPlan | null>;
  getRevisions(teamId: string): Promise<TaskPlan[]>;
}

interface ArtifactRegistry {
  register(artifact: Artifact): void;
  getByTask(taskId: string): Artifact[];
  getAll(): Artifact[];
  remove(artifactId: string): void;
}
```

## Testing

**Unit tests:**
- Branch creation with correct naming
- Branch deletion cleanup
- Merge success/conflict cases
- Plan save/load/approve flow
- Artifact registration and rollback

**Integration tests:**
- Full lifecycle: create branch → work → merge
- Cancel flow: create → work → delete branch + artifacts
- Retry flow: create → fail → create v2 → merge
- Plan revision history preservation

## Dependencies

- Task-003: Orchestrator (uses branch/plan tools)
- Task-004: AgentManager (exposes merge/cancel operations)
- Existing: `simple-git` for git operations
- Existing: `WorkspaceManager` in `src/worker/agentManager/workspace/`

## Notes

This combined task provides complete "undo" capability:
- Cancel task = delete branch (no changes to main)
- Rollback = delete branch + remove registered artifacts
- Retry = create v2 branch, re-execute

The branch manager should be stateless where possible - branch info stored in MemoryManager with task metadata.

---

**Related Tasks:**
- Task-003: Orchestrator (uses branch tools)
- Task-004: AgentManager (exposes merge/cancel operations)
- Task-005: Chat Mode + UI (may show branch status)
