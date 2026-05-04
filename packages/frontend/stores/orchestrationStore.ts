/**
 * orchestrationStore — Plan, task, and session state.
 *
 * Replaces useOrchestration hook. Single source of truth for:
 * - Session state machine (ready → planning → executing → completed)
 * - Task list (flat array, keyed by assignedRole — no cross-store dependency)
 * - Plan lifecycle (propose, approve, complete)
 * - Auto-execute toggle
 * - Orchestration logs (capped ring buffer)
 * - Goal/plan summaries for sidebar
 *
 * Task deduplication: currentPlan is REMOVED — derived via getAllTasks().
 * Tasks stored as flat array, per-agent view derived at read time.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { agentServiceV2 } from '../services/AgentServiceV2';
import type { Task, TaskStatus, OrchestrationEvent, PlanSummary } from '../types';
import type { Task as BackendTask } from '../services/AgentServiceV2';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface OrchestrationState {
  /** Per-goal session state — keyed by goalId */
  goalSessionStates: Record<string, string | null>;
  /** Active goal — selectors read from this goal's state */
  activeGoalId: string | null;
  /** Computed: session state for the active goal (backward compatible) */
  sessionState: string | null;
  /** Flat task list — single source of truth (replaces currentPlan + tasks) */
  tasks: Task[];
  autoExecuteEnabled: boolean;
  orchestrationLogs: OrchestrationEvent[];
  /** Goal/plan summaries for sidebar plan list */
  plans: PlanSummary[];

  // ── Actions ──
  setSessionState: (state: string | null, goalId?: string) => void;
  setActiveGoalId: (goalId: string | null) => void;
  setAutoExecuteEnabled: (enabled: boolean) => void;

  /** Handle `state` Socket.IO event — updates tasks + session state */
  handleStateEvent: (data: any) => void;
  /** Handle `goal:stateChange` Socket.IO event */
  handleGoalStateChange: (data: any) => void;

  /** Approve the pending plan */
  approvePlan: () => void;
  /** Start a task */
  startTask: (taskId: string) => void;
  /** Complete a task */
  completeTask: (taskId: string) => void;
  /** Cancel a task */
  cancelTask: (taskId: string) => void;
  /** Toggle auto-execute */
  toggleAutoExecute: () => void;

  /** Add orchestration log entry */
  addLog: (source: string, message: string, type?: OrchestrationEvent['type']) => void;
  /** Clear all state (call on team switch) */
  resetForTeam: () => void;

  /** Set tasks from restore endpoint (replaces setCurrentPlan) */
  setTasksFromPlan: (plan: BackendTask[]) => void;

  // ── Selectors ──
  /** Get all tasks (replaces currentPlan) */
  getAllTasks: () => Task[];
  /** Get tasks for a specific agent by its role */
  getTasksByRole: (role: string) => Task[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useOrchestrationStore = create<OrchestrationState>()(devtools((set, get) => ({
  goalSessionStates: {},
  activeGoalId: null,
  sessionState: null, // Derived — kept in sync by setSessionState and setActiveGoalId
  tasks: [],
  autoExecuteEnabled: false,
  orchestrationLogs: [],
  plans: [],

  setSessionState: (state, goalId) => {
    const gid = goalId ?? get().activeGoalId;
    if (gid) {
      const updated = { ...get().goalSessionStates, [gid]: state };
      set({
        goalSessionStates: updated,
        // Re-derive sessionState if this is the active goal
        ...(gid === get().activeGoalId ? { sessionState: state } : {}),
      });
    }
  },
  setActiveGoalId: (goalId) => {
    set({
      activeGoalId: goalId,
      // Re-derive sessionState from new goal
      sessionState: goalId ? (get().goalSessionStates[goalId] ?? null) : null,
    });
  },
  setAutoExecuteEnabled: (enabled) => set({ autoExecuteEnabled: enabled }),

  handleStateEvent: (data) => {
    if (data.plan && Array.isArray(data.plan)) {
      // Plan update — merge by task ID (incoming tasks take priority, others kept)
      const incomingTasks: Task[] = data.plan.map((bt: any) => ({
        id: bt.id,
        title: bt.title,
        description: bt.description,
        status: (bt.status || 'pending') as TaskStatus,
        assignedRole: bt.assignedRole,
        priority: bt.priority,
        dependencies: bt.dependencies,
        completed: bt.status === 'completed',
        createdAt: Date.now(),
        goalId: bt.goalId || undefined,
      }));

      set(prev => {
        // Keep existing tasks not in incoming set, add all incoming
        const incomingIds = new Set(incomingTasks.map(t => t.id));
        const kept = prev.tasks.filter(t => !incomingIds.has(t.id));
        return { tasks: [...kept, ...incomingTasks] };
      });
    }

    if (data.tasks && Array.isArray(data.tasks)) {
      // Incremental task status updates
      set(prev => ({
        tasks: prev.tasks.map(t => {
          const update = data.tasks.find((u: any) => u.id === t.id);
          if (!update) return t;
          return {
            ...t,
            status: update.status as TaskStatus,
            completed: update.status === 'completed',
          };
        }),
      }));
    }

    if (data.autoExecute !== undefined) {
      set({ autoExecuteEnabled: data.autoExecute });
    }
    if (data.sessionState) {
      const goalId = data.goalId ?? get().activeGoalId;
      if (goalId) {
        set(prev => ({
          goalSessionStates: { ...prev.goalSessionStates, [goalId]: data.sessionState },
        }));
      }
    }
  },

  handleGoalStateChange: (data) => {
    if (data?.allGoals) {
      set({ plans: data.allGoals });
    }
  },

  approvePlan: () => {
    agentServiceV2.approvePlan();
    get().addLog('SYSTEM', 'Plan approved, starting execution...', 'success');
    get().setSessionState('executing');
  },

  startTask: (taskId) => {
    agentServiceV2.startTask(taskId);
    get().addLog('SYSTEM', `Starting task: ${taskId}`, 'info');
  },

  completeTask: (taskId) => {
    agentServiceV2.completeTask(taskId);
    get().addLog('SYSTEM', `Completing task: ${taskId}`, 'success');
  },

  cancelTask: (taskId) => {
    agentServiceV2.cancelTask(taskId);
    get().addLog('SYSTEM', `Cancelling task: ${taskId}`, 'warning');
  },

  toggleAutoExecute: () => {
    const newVal = !get().autoExecuteEnabled;
    agentServiceV2.autoExecute(newVal);
    get().addLog('SYSTEM', `Auto-execute ${newVal ? 'enabled' : 'disabled'}`, 'info');
    set({ autoExecuteEnabled: newVal });
  },

  addLog: (source, message, type = 'info') => {
    set(prev => ({
      orchestrationLogs: [...prev.orchestrationLogs.slice(-199), {
        id: uuidv4(),
        timestamp: Date.now(),
        type,
        message,
        source,
      }],
    }));
  },

  resetForTeam: () => {
    set({
      goalSessionStates: {},
      activeGoalId: null,
      tasks: [],
      autoExecuteEnabled: false,
      orchestrationLogs: [],
      plans: [],
    });
  },

  setTasksFromPlan: (plan) => {
    const tasks: Task[] = plan.map((bt: any) => ({
      id: bt.id,
      title: bt.title,
      description: bt.description,
      status: (bt.status || 'pending') as TaskStatus,
      assignedRole: bt.assignedRole,
      priority: bt.priority,
      dependencies: bt.dependencies,
      completed: bt.status === 'completed',
      createdAt: Date.now(),
      goalId: bt.goalId || undefined,
    }));
    set({ tasks });
  },

  getAllTasks: () => get().tasks,
  getTasksByRole: (role) => get().tasks.filter(t => t.assignedRole?.toLowerCase() === role.toLowerCase()),
}), { name: 'OrchestrationStore' }));
