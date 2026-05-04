# Stabilization Sprint — Open Issues & Solutions

> **Status:** For Review  
> **Date:** April 30, 2026  
> **Scope:** All open issues blocking production readiness  
> **Source:** [workspace-push-issues.md](../github-connect/workspace-push-issues.md), security audit, frontend bugs  
> **Approach:** Permanent fixes only — no patches

---

## Category A: Worktree Flow (Fixed, Need E2E Testing)

These have code fixes but were blocked by Issue 18 (worktree wrong path). Issue 18 is now fixed (`path.resolve` in WorkspaceManager.ts line 65). These need end-to-end verification.

| # | Issue | Root Cause | Fix Applied | Test |
|---|---|---|---|---|
| 8 | Git commit fails in worktree | `_commitGitOps` calls `checkout(branchName)` — fails because worktree already has that branch | `skipGitInit: true` skips checkout in worktree mode | Submit goal → agent writes file → commits → verify no error |
| 11 | `pushToRemote` fails on published workspace | `assertWritable()` blocks push after `publish()` | Status check allows `"published"` in `pushToRemote()` | Complete task → verify push succeeds after publish |
| 12 | Worktree merge fails — can't checkout main | Worktrees can't checkout main (it's the primary clone's branch) | Merge uses `--no-ff` without checkout, or runs from primary clone | Complete task → verify merge to main succeeds |
| 18 | Worktree created at wrong path | `workspacesRoot` was relative, worktree paths resolved incorrectly | `path.resolve(config.repoPath)` — now absolute | Submit goal → verify `plan-{id}/task-{id}/` has `.git` file (not dir) |

**Action:** Rebuild, submit a goal with a GitHub repo, verify the full flow: clone → worktree → agent writes → commit → push → merge.

---

## Category B: Goal Routing (Fixed, Need Testing)

| # | Issue | Root Cause | Fix Applied | Test |
|---|---|---|---|---|
| 9 | GoalConfig type — `repoUrl` on GoalContext | No typed `repoUrl`/`repoBranch` on GoalContext | `GoalManager.setGoalRepo()` stores on GoalContext, injected into task context in `approvePlan()` | Verify `task.context.repoUrl` is set after plan approval |
| 14 | 429 rate limiting cascade | All workers fail simultaneously on Azure OpenAI 429 | AI SDK `wrapLanguageModel()` middleware with `Retry-After` coordination | Trigger 429 → verify workers retry with backoff, not all fail |
| 15 | goalId missing on replanned/added tasks | `add_tasks`/`replan` tools don't pass `currentGoalId` | `PlanMutationContext` includes `currentGoalId`, injected into new tasks | Call `replan` → verify new tasks have `goalId` and `repoUrl` |

---

## Category C: Frontend Bugs (Need Code)

### Issue 19: Tasks Run Autonomously — Frontend Has No Visibility

**Problem:** When `autoExecute=true` (default), tasks dispatch and complete silently. Frontend only sees stream events — no explicit "task started" / "task completed" UI update.

**Solution:** The `taskUpdate` Socket.IO events already fire (started, progress, completed, failed). Frontend `useOrchestrationStore` already handles `handleTaskUpdate()`. The issue is that the sidebar task list doesn't update in real-time because it reads from `plans` (localStorage), not from the live `tasks` store.

**Fix:** Wire `useOrchestrationStore.tasks` into sidebar `PlanTaskList` instead of (or merged with) localStorage plans.

**Files:** `packages/frontend/components/Sidebar/PlanTaskList.tsx`, `packages/frontend/App.tsx` (where allTasks is computed)

---

### Issue 23: Zustand Persist Hydration Race

**Problem:** `useUiStore.getState().selectedTeamId` returns `null` on first render because Zustand `persist` middleware hasn't hydrated from localStorage yet. Code that runs in `useState(() => ...)` initializers sees stale state.

**Solution:** Use Zustand's `onRehydrateStorage` callback, or use the `useHydrated` pattern:

```typescript
// In uiStore.ts — add hydration tracking
const useUiStore = create(persist(
  (set) => ({
    _hydrated: false,
    // ...existing state
  }),
  {
    name: 'ping:ui',
    onRehydrateStorage: () => (state) => {
      state?._hydrated && useUiStore.setState({ _hydrated: true });
    },
  },
));

// In App.tsx — wait for hydration before reading persisted values
const hydrated = useUiStore(s => s._hydrated);
if (!hydrated) return <LoadingScreen />;
```

**Files:** `packages/frontend/stores/uiStore.ts`, `packages/frontend/App.tsx`

---

### Issue 24: No Auto-Select First Team for Fresh Users

**Problem:** New users see "Select a team..." but no team is pre-selected. They must manually click the dropdown.

**Solution:** After teams load, if `selectedTeamId` is `null`, auto-select the first team:

```typescript
// In App.tsx — after agents load
useEffect(() => {
  if (agents.length > 0 && !selectedTeamId) {
    const firstTeam = agents[0];
    setSelectedTeamId(firstTeam.id);
    setActiveAgentId(firstTeam.id);
  }
}, [agents, selectedTeamId]);
```

**Files:** `packages/frontend/App.tsx`

---

### Issue 25: Team Dropdown Clipped by Sidebar

**Problem:** Sidebar team dropdown renders inside a `relative` container with `overflow-y-auto`. The absolutely positioned dropdown gets clipped.

**Solution:** Use `createPortal` to render the dropdown at `document.body` level:

```typescript
import { createPortal } from 'react-dom';

// Render dropdown via portal — positioned using getBoundingClientRect()
{isTeamDropdownOpen && createPortal(
  <div
    ref={dropdownMenuRef}
    className="fixed z-[9999] bg-popover border border-border rounded-lg shadow-lg"
    style={{
      top: buttonRef.current?.getBoundingClientRect().bottom + 4,
      left: buttonRef.current?.getBoundingClientRect().left,
      width: buttonRef.current?.getBoundingClientRect().width,
    }}
  >
    {/* team items */}
  </div>,
  document.body,
)}
```

**Files:** `packages/frontend/components/Sidebar.tsx`

---

## Category D: Infrastructure (Documented, Future)

These are not blocking but should be addressed before enterprise deployment.

| # | Issue | Description | Priority |
|---|---|---|---|
| 2 | Auth token SOLID violations | Token resolver callback chain is complex | Low — works correctly |
| 3 | Shared vs isolated mode docs | No clear documentation on when each mode activates | Low — code handles it |
| 4 | No push verification | No check that push actually succeeded (beyond error catch) | Medium — add after E2E test |
| 16 | Auth token not resolved in all cases | SQLite mode can't query `account` table | Low — MongoDB mode works |
| 20 | Stream data lost on page reload | `beforeunload` saves partial, but tool cards lost | Medium — needs stream persistence redesign |

---

## Implementation Order

| Phase | Issues | Effort | What |
|---|---|---|---|
| **A: E2E Test** | 8, 11, 12, 18 | Manual | Rebuild → submit goal with repo → verify worktree flow |
| **B: Goal Routing** | 9, 14, 15 | Manual | Test replan, 429 handling, goalId on mutations |
| **C: Frontend** | 19, 23, 24, 25 | 2 days | Task visibility, hydration, auto-select, portal dropdown |
| **D: Infrastructure** | 2, 3, 4, 16, 20 | Deferred | After sandbox, before enterprise |

**Total for A+B+C: ~3 days** (1 day testing + 2 days frontend fixes)
