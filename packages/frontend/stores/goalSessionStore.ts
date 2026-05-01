/**
 * goalSessionStore — Unified goal-scoped state.
 *
 * Single store that owns ALL state for the active goal:
 *   - Messages (replaces chatStore.chatHistories)
 *   - Tasks + session state (replaces orchestrationStore)
 *   - Goal/plan identity (replaces uiStore.activeGoalId/activePlanId/selectedTaskId)
 *   - Plan summaries (replaces sessionStorage ping:plans:{teamId})
 *   - Stream processing (migrated from chatStore.processStreamPart)
 *
 * switchGoal() is the ONLY write path for goal transitions.
 * No useEffects. No side-channels. No coordination layer.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { agentServiceV2 } from '../services/AgentServiceV2';
import type {
  Message, RenderedPart, ToolCardState, StreamPart,
  NotificationChipState, Task, TaskStatus, PlanSummary, OrchestrationEvent,
  SessionState,
} from '../types';
import type { Task as BackendTask } from '../services/AgentServiceV2';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type AgentRef = { id: string; role: string };

interface GoalSessionState {
  // ── Goal-scoped identity ──
  activeGoalId: string | null;
  activePlanId: string | null;
  selectedTaskId: string | null;

  // ── Session state ──
  sessionState: SessionState;
  autoExecuteEnabled: boolean;
  /** Per-goal session state cache (for multi-goal context) */
  goalSessionStates: Record<string, string | null>;

  // ── Messages (keyed by chatKey for efficient lookup) ──
  chatHistories: Record<string, Message[]>;

  // ── Tasks ──
  tasks: Task[];

  // ── Plan summaries (replaces sessionStorage) ──
  plans: PlanSummary[];

  // ── Orchestration logs ──
  orchestrationLogs: OrchestrationEvent[];

  // ── Stream tracking (internal) ──
  _streamingIds: Record<string, string>;
  _activeTextParts: Record<string, string>;
  _activeReasoningParts: Record<string, string>;

  // ── Actions ──
  /** Switch to a different goal — atomic operation. THE only write path for goal transitions. */
  switchGoal: (teamId: string, goalId: string, planId: string, agents: AgentRef[]) => Promise<void>;
  /** Restore team on initial load or team switch. urlPlanId resolves goal from server goals. */
  restoreTeam: (teamId: string, agents: AgentRef[], urlPlanId?: string) => Promise<RestoreResult>;
  /** Create a new goal — sets identity + adds plan + user message + subscribes room. */
  newGoal: (teamId: string, goalId: string, planId: string, goalText: string) => void;
  /** Clear active goal (back to goals screen). */
  clearGoal: () => void;
  /** Send a user message — routes to the correct chat key based on context. */
  sendUserMessage: (opts: {
    teamId: string;
    agentId: string;
    goalId: string | null;
    taskId: string | null;
    isChatAgent: boolean;
    isTeamView: boolean;
    content: string;
  }) => void;
  /** Process a stream part for a chat key */
  processStreamPart: (chatKey: string, part: StreamPart) => void;
  /** Add a finalized message to a chat key */
  addMessage: (chatKey: string, message: Message) => void;
  /** Handle state Socket.IO event */
  handleStateEvent: (data: any) => void;
  /** Handle goal:stateChange Socket.IO event */
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
  /** Clear all goal state (team switch) */
  resetForTeam: () => void;
  /** Set session state directly (for plan dismissal) */
  setSessionState: (state: string | null) => void;
  /** Get messages for a specific chat key */
  getMessages: (chatKey: string) => Message[];
}

interface RestoreResult {
  success: boolean;
  error?: string;
  goals?: any[];
  activeGoalId?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (migrated from chatStore)
// ─────────────────────────────────────────────────────────────────────────────

function getOrCreateToolCard(
  parts: RenderedPart[],
  toolCallId: string,
  toolName: string,
): { parts: RenderedPart[]; card: ToolCardState } {
  const existing = parts.find(p => p.type === 'tool-card' && p.card.toolCallId === toolCallId);
  if (existing && existing.type === 'tool-card') {
    return { parts, card: existing.card };
  }
  const card: ToolCardState = { toolCallId, toolName, status: 'calling', argsText: '' };
  return { parts: [...parts, { type: 'tool-card', card }], card };
}

function updateStreamParts(
  histories: Record<string, Message[]>,
  chatKey: string,
  streamId: string,
  updater: (parts: RenderedPart[], msg: Message) => RenderedPart[],
): Record<string, Message[]> {
  const current = histories[chatKey] ?? [];
  return {
    ...histories,
    [chatKey]: current.map(m => {
      if (m.id !== streamId) return m;
      return { ...m, streamParts: updater([...(m.streamParts || [])], m) };
    }),
  };
}

function mapServerMessage(m: any): Message {
  let parsedParts: RenderedPart[] | undefined;
  if (m.streamParts) {
    try {
      parsedParts = JSON.parse(m.streamParts);
    } catch {
      console.warn('[goalSessionStore] Malformed streamParts for message', m.id);
    }
  }
  return {
    id: m.id,
    role: m.role === 'assistant' ? 'model' : m.role,
    content: m.content,
    timestamp: new Date(m.timestamp).getTime(),
    isStreaming: false,
    streamParts: parsedParts,
  };
}

function mapBackendTask(bt: any): Task {
  return {
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
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useGoalSessionStore = create<GoalSessionState>()(devtools((set, get) => ({
  activeGoalId: null,
  activePlanId: null,
  selectedTaskId: null,
  sessionState: null,
  autoExecuteEnabled: false,
  goalSessionStates: {},
  chatHistories: {},
  tasks: [],
  plans: [],
  orchestrationLogs: [],
  _streamingIds: {},
  _activeTextParts: {},
  _activeReasoningParts: {},

  // ────────────────────────────────────────────────────────────────────────
  // switchGoal — THE atomic goal transition
  // ────────────────────────────────────────────────────────────────────────

  switchGoal: async (teamId, goalId, planId, agents) => {
    // 1. Optimistic UI update
    set({
      activeGoalId: goalId,
      activePlanId: planId,
      selectedTaskId: null,
    });

    // 2. Subscribe Socket.IO room (server leaves previous room automatically)
    agentServiceV2.subscribeToGoal(teamId, goalId);

    // 3. Load from server (single API call)
    try {
      const data = await agentServiceV2.restoreSession(teamId, goalId);
      if (!data) {
        set({ sessionState: null });
        return;
      }

      // 4. Map server data → store format
      const restored: Record<string, Message[]> = {};

      if (data.conversations) {
        for (const [agentId, msgs] of Object.entries(data.conversations)) {
          if (!(msgs as any[])?.length) continue;
          let key = agentId;
          if (agentId.startsWith('chat-')) {
            const role = agentId.replace('chat-', '');
            const agent = agents.find(a => a.role?.toLowerCase() === role);
            key = agent ? `chat:${agent.id}` : agentId;
          } else if (agentId === 'manager' || agentId === 'orchestrator' || agentId === 'planner') {
            key = `${teamId}:goal:${goalId}`;
          }
          const mapped = (msgs as any[]).map(mapServerMessage);
          restored[key] = [...(restored[key] ?? []), ...mapped];
        }
      }

      for (const key of Object.keys(restored)) {
        restored[key].sort((a, b) => a.timestamp - b.timestamp);
      }

      if (data.workerMessages?.length) {
        for (const m of data.workerMessages) {
          // Resolve role-based agentId to frontend agentId (must match live stream keys)
          const resolvedAgent = agents.find(a => a.role?.toLowerCase() === m.agentId?.toLowerCase());
          const resolvedId = resolvedAgent?.id ?? m.agentId;
          const key = m.taskId ? `${resolvedId}:task:${m.taskId}` : resolvedId;
          if (!restored[key]) restored[key] = [];
          restored[key].push(mapServerMessage(m));
        }
      }

      // 5. Atomic state update
      const tasks = (data.plan ?? data.tasks ?? []).map(mapBackendTask);
      set({
        chatHistories: restored,
        tasks,
        sessionState: data.orchestratorState as SessionState,
        goalSessionStates: {
          ...get().goalSessionStates,
          [goalId]: data.orchestratorState,
        },
        plans: data.allGoalSummaries ?? get().plans,
        _streamingIds: {},
        _activeTextParts: {},
        _activeReasoningParts: {},
      });
    } catch (err) {
      console.error('[goalSessionStore] switchGoal restore failed:', err);
      set({ sessionState: null });
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  // restoreTeam — initial team load (single API call)
  // ────────────────────────────────────────────────────────────────────────

  restoreTeam: async (teamId, agents, urlPlanId) => {
    try {
      const goalIdForRestore = get().activeGoalId ?? undefined;
      const data = await agentServiceV2.restoreSession(teamId, goalIdForRestore);
      if (!data) return { success: false, error: 'Session restore returned null' };

      // URL planId takes priority — if present, resolve its goalId from server data
      // allGoalSummaries has planId (set during plan approval), goals may not.
      let resolvedGoalId: string | null = null;
      let resolvedPlanId: string | null = null;

      if (urlPlanId) {
        // 1. Try allGoalSummaries first (has planId field)
        const summaryMatch = (data.allGoalSummaries ?? []).find(
          (g: any) => g.planId === urlPlanId,
        );
        if (summaryMatch?.goalId) {
          resolvedGoalId = summaryMatch.goalId;
          resolvedPlanId = urlPlanId;
        }

        // 2. Fall back to goals list (planId or id match)
        if (!resolvedGoalId && data.goals?.length) {
          const goalMatch = data.goals.find(
            (g: any) => (g.planId || g.id || g._id) === urlPlanId,
          );
          if (goalMatch?.goalId) {
            resolvedGoalId = goalMatch.goalId;
            resolvedPlanId = urlPlanId;
          }
        }
      }

      // Fall back to server's activeGoalId if URL didn't resolve
      if (!resolvedGoalId && data.activeGoalId) {
        resolvedGoalId = data.activeGoalId;
      }

      if (resolvedGoalId) {
        set({ activeGoalId: resolvedGoalId });
        if (resolvedPlanId) set({ activePlanId: resolvedPlanId });
      }

      // Map messages
      const restored: Record<string, Message[]> = {};
      const activeGoal = resolvedGoalId || get().activeGoalId;

      if (data.conversations) {
        for (const [agentId, msgs] of Object.entries(data.conversations)) {
          if (!(msgs as any[])?.length) continue;
          let key = agentId;
          if (agentId.startsWith('chat-')) {
            const role = agentId.replace('chat-', '');
            const agent = agents.find(a => a.role?.toLowerCase() === role);
            key = agent ? `chat:${agent.id}` : agentId;
          } else if (agentId === 'manager' || agentId === 'orchestrator' || agentId === 'planner') {
            key = activeGoal ? `${teamId}:goal:${activeGoal}` : teamId;
          }
          const mapped = (msgs as any[]).map(mapServerMessage);
          restored[key] = [...(restored[key] ?? []), ...mapped];
        }
      }

      for (const key of Object.keys(restored)) {
        restored[key].sort((a, b) => a.timestamp - b.timestamp);
      }

      if (data.workerMessages?.length) {
        for (const m of data.workerMessages) {
          // Resolve role-based agentId to frontend agentId (must match live stream keys)
          const resolvedAgent = agents.find(a => a.role?.toLowerCase() === m.agentId?.toLowerCase());
          const resolvedId = resolvedAgent?.id ?? m.agentId;
          const key = m.taskId ? `${resolvedId}:task:${m.taskId}` : resolvedId;
          if (!restored[key]) restored[key] = [];
          restored[key].push(mapServerMessage(m));
        }
      }

      // Hydrate tasks and state
      if (data.plan?.length || data.tasks?.length) {
        const tasks = (data.plan ?? data.tasks ?? []).map(mapBackendTask);
        set({ tasks });
        if (data.orchestratorState) {
          const goalId = activeGoal;
          set(prev => ({
            sessionState: data.orchestratorState as SessionState,
            goalSessionStates: goalId
              ? { ...prev.goalSessionStates, [goalId]: data.orchestratorState }
              : prev.goalSessionStates,
          }));
        }
      }

      // Merge messages (preserves local streamParts during active streams)
      if (Object.keys(restored).length > 0) {
        set(prev => {
          const merged = { ...prev.chatHistories };
          for (const [key, serverMsgs] of Object.entries(restored)) {
            const localMsgs = merged[key];
            if (!localMsgs || localMsgs.length === 0) {
              merged[key] = serverMsgs;
            } else {
              const msgMap = new Map(localMsgs.map(m => [m.id, m]));
              for (const serverMsg of serverMsgs) {
                const local = msgMap.get(serverMsg.id);
                msgMap.set(serverMsg.id, {
                  ...local,
                  ...serverMsg,
                  streamParts: serverMsg.streamParts ?? local?.streamParts,
                });
              }
              merged[key] = Array.from(msgMap.values()).sort((a, b) => a.timestamp - b.timestamp);
            }
          }
          return { chatHistories: merged };
        });
      }

      // Update plan summaries
      if (data.allGoalSummaries?.length) {
        set({ plans: data.allGoalSummaries });
      }

      // If URL resolved a specific goal, do a full goal switch to load its data
      if (resolvedGoalId && resolvedPlanId) {
        await get().switchGoal(teamId, resolvedGoalId, resolvedPlanId, agents);
      }

      return {
        success: true,
        goals: data.goals,
        activeGoalId: data.activeGoalId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[goalSessionStore] restoreTeam failed:', message);
      return { success: false, error: message };
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  // newGoal — create a new goal (atomic identity + plan + room subscription)
  // ────────────────────────────────────────────────────────────────────────

  newGoal: (teamId, goalId, planId, goalText) => {
    set(prev => ({
      activeGoalId: goalId,
      activePlanId: planId,
      selectedTaskId: null,
      plans: [{
        goalId, title: goalText, state: 'gathering' as const,
        taskCount: 0, completedCount: 0, planId, createdAt: Date.now(),
      }, ...prev.plans],
    }));
    agentServiceV2.subscribeToGoal(teamId, goalId);
  },

  // ────────────────────────────────────────────────────────────────────────
  // clearGoal — return to goal screen (no active goal)
  // ────────────────────────────────────────────────────────────────────────

  clearGoal: () => {
    set({ activeGoalId: null, activePlanId: null, selectedTaskId: null });
  },

  // ────────────────────────────────────────────────────────────────────────
  // sendUserMessage — routes to correct chat key based on context
  // ────────────────────────────────────────────────────────────────────────

  sendUserMessage: ({ teamId, agentId, goalId, taskId, isChatAgent, isTeamView, content }) => {
    const key = isChatAgent && !taskId
      ? `chat:${agentId}`
      : isTeamView && goalId
        ? `${teamId}:goal:${goalId}`
        : taskId
          ? `${agentId}:task:${taskId}`
          : agentId;
    get().addMessage(key, {
      id: uuidv4(), role: 'user', content, timestamp: Date.now(),
    });
  },

  // ────────────────────────────────────────────────────────────────────────
  // processStreamPart — migrated from chatStore (identical logic)
  // ────────────────────────────────────────────────────────────────────────

  processStreamPart: (chatKey, part) => {
    set(prev => {
      const streamId = prev._streamingIds[chatKey];
      const histories = prev.chatHistories;

      switch (part.type) {
        case 'start': {
          const msgId = part.messageId;
          const streamMsg: Message = {
            id: msgId, role: 'model', content: '', timestamp: Date.now(),
            isStreaming: true, streamParts: [],
          };
          return {
            _streamingIds: { ...prev._streamingIds, [chatKey]: msgId },
            _activeTextParts: { ...prev._activeTextParts, [chatKey]: '' },
            _activeReasoningParts: { ...prev._activeReasoningParts, [chatKey]: '' },
            chatHistories: {
              ...histories,
              [chatKey]: [...(histories[chatKey] ?? []), streamMsg],
            },
          };
        }

        case 'text-start': {
          if (!streamId) return prev;
          return {
            _activeTextParts: { ...prev._activeTextParts, [chatKey]: part.id },
            chatHistories: updateStreamParts(histories, chatKey, streamId, (parts) =>
              [...parts, { type: 'text' as const, id: part.id, text: '', done: false }],
            ),
          };
        }

        case 'text-delta': {
          if (!streamId) {
            const fallbackId = `msg-${chatKey}-${Date.now()}`;
            const textId = part.id || `text-${fallbackId}`;
            const streamMsg: Message = {
              id: fallbackId, role: 'model', content: part.delta, timestamp: Date.now(),
              isStreaming: true,
              streamParts: [{ type: 'text', id: textId, text: part.delta, done: false }],
            };
            return {
              _streamingIds: { ...prev._streamingIds, [chatKey]: fallbackId },
              _activeTextParts: { ...prev._activeTextParts, [chatKey]: textId },
              chatHistories: {
                ...histories,
                [chatKey]: [...(histories[chatKey] ?? []), streamMsg],
              },
            };
          }
          const current = histories[chatKey] ?? [];
          return {
            _activeTextParts: { ...prev._activeTextParts, [chatKey]: part.id },
            chatHistories: {
              ...histories,
              [chatKey]: current.map(m => {
                if (m.id !== streamId) return m;
                const oldParts = m.streamParts || [];
                const exists = oldParts.some(p => p.type === 'text' && p.id === part.id);
                const newParts = exists
                  ? oldParts.map(p => p.type === 'text' && p.id === part.id ? { ...p, text: p.text + part.delta } : p)
                  : [...oldParts, { type: 'text' as const, id: part.id, text: part.delta, done: false }];
                return { ...m, content: m.content + part.delta, streamParts: newParts };
              }),
            },
          };
        }

        case 'text-end': {
          if (!streamId) return prev;
          return {
            _activeTextParts: { ...prev._activeTextParts, [chatKey]: '' },
            chatHistories: updateStreamParts(histories, chatKey, streamId, (parts) =>
              parts.map(p => p.type === 'text' && p.id === part.id ? { ...p, done: true } : p),
            ),
          };
        }

        case 'reasoning-start': {
          if (!streamId) return prev;
          return {
            _activeReasoningParts: { ...prev._activeReasoningParts, [chatKey]: part.id },
            chatHistories: updateStreamParts(histories, chatKey, streamId, (parts) =>
              [...parts, { type: 'reasoning' as const, id: part.id, text: '', done: false }],
            ),
          };
        }

        case 'reasoning-delta': {
          if (!streamId) return prev;
          return {
            chatHistories: updateStreamParts(histories, chatKey, streamId, (parts) => {
              const exists = parts.some(p => p.type === 'reasoning' && p.id === part.id);
              if (!exists) return [...parts, { type: 'reasoning' as const, id: part.id, text: part.delta, done: false }];
              return parts.map(p =>
                p.type === 'reasoning' && p.id === part.id ? { ...p, text: p.text + part.delta } : p,
              );
            }),
          };
        }

        case 'reasoning-end': {
          if (!streamId) return prev;
          return {
            _activeReasoningParts: { ...prev._activeReasoningParts, [chatKey]: '' },
            chatHistories: updateStreamParts(histories, chatKey, streamId, (parts) =>
              parts.map(p => p.type === 'reasoning' && p.id === part.id ? { ...p, done: true } : p),
            ),
          };
        }

        case 'tool-input-start': {
          if (!streamId) return prev;
          return {
            chatHistories: updateStreamParts(histories, chatKey, streamId, (parts) => {
              const { parts: newParts } = getOrCreateToolCard(parts, part.toolCallId, part.toolName);
              return newParts.map(p =>
                p.type === 'tool-card' && p.card.toolCallId === part.toolCallId
                  ? { ...p, card: { ...p.card, status: 'streaming-args' as const } } : p,
              );
            }),
          };
        }

        case 'tool-input-delta': {
          if (!streamId) return prev;
          return {
            chatHistories: updateStreamParts(histories, chatKey, streamId, (parts) =>
              parts.map(p =>
                p.type === 'tool-card' && p.card.toolCallId === part.toolCallId
                  ? { ...p, card: { ...p.card, argsText: p.card.argsText + part.delta, status: 'streaming-args' as const } } : p,
              ),
            ),
          };
        }

        case 'tool-input-available': {
          if (!streamId) return prev;
          return {
            chatHistories: updateStreamParts(histories, chatKey, streamId, (parts) => {
              const { parts: newParts } = getOrCreateToolCard(parts, part.toolCallId, part.toolName);
              return newParts.map(p =>
                p.type === 'tool-card' && p.card.toolCallId === part.toolCallId
                  ? { ...p, card: { ...p.card, status: 'executing' as const, args: part.input, argsText: JSON.stringify(part.input, null, 2) } } : p,
              );
            }),
          };
        }

        case 'tool-output-available': {
          if (!streamId) return prev;
          return {
            chatHistories: updateStreamParts(histories, chatKey, streamId, (parts) =>
              parts.map(p =>
                p.type === 'tool-card' && p.card.toolCallId === part.toolCallId
                  ? { ...p, card: { ...p.card, status: 'complete' as const, result: part.output } } : p,
              ),
            ),
          };
        }

        case 'finish': {
          if (!streamId) return prev;
          const { [chatKey]: _si, ...restStreaming } = prev._streamingIds;
          const { [chatKey]: _tp, ...restText } = prev._activeTextParts;
          const { [chatKey]: _rp, ...restReasoning } = prev._activeReasoningParts;
          const current = histories[chatKey] ?? [];
          return {
            _streamingIds: restStreaming,
            _activeTextParts: restText,
            _activeReasoningParts: restReasoning,
            chatHistories: {
              ...histories,
              [chatKey]: current.map(m => {
                if (m.id !== streamId) return m;
                const parts = (m.streamParts || []).map(p =>
                  (p.type === 'text' || p.type === 'reasoning') ? { ...p, done: true } : p,
                );
                return { ...m, isStreaming: false, streamParts: parts };
              }),
            },
          };
        }

        case 'error': {
          if (!streamId) return prev;
          const { [chatKey]: _si, ...restStreaming } = prev._streamingIds;
          const current = histories[chatKey] ?? [];
          const errorPart: RenderedPart = {
            type: 'notification' as const,
            chip: { type: 'task-failed' as const, taskId: '', role: chatKey, error: part.error },
          };
          return {
            _streamingIds: restStreaming,
            chatHistories: {
              ...histories,
              [chatKey]: current.map(m => {
                if (m.id !== streamId) return m;
                return { ...m, isStreaming: false, streamParts: [...(m.streamParts || []), errorPart] };
              }),
            },
          };
        }

        case 'task-started':
        case 'task-completed':
        case 'task-failed':
        case 'plan-proposed':
        case 'plan-approved': {
          const chip = {
            type: part.type as NotificationChipState['type'],
            ...('taskId' in part ? { taskId: (part as any).taskId } : {}),
            ...('role' in part ? { role: (part as any).role } : {}),
            ...('error' in part ? { error: (part as any).error } : {}),
          };
          const notifPart: RenderedPart = { type: 'notification' as const, chip };

          if (streamId) {
            return { chatHistories: updateStreamParts(histories, chatKey, streamId, (parts) => [...parts, notifPart]) };
          }
          const notifMsg: Message = {
            id: `notif-${chatKey}-${Date.now()}`, role: 'model', content: '',
            timestamp: Date.now(), isStreaming: false, streamParts: [notifPart],
          };
          return {
            chatHistories: { ...histories, [chatKey]: [...(histories[chatKey] ?? []), notifMsg] },
          };
        }

        default:
          return prev;
      }
    });
  },

  // ────────────────────────────────────────────────────────────────────────
  // addMessage — add a finalized message
  // ────────────────────────────────────────────────────────────────────────

  addMessage: (chatKey, message) => {
    set(prev => {
      const streamId = prev._streamingIds[chatKey];
      if (streamId) {
        const current = prev.chatHistories[chatKey] ?? [];
        const streamExists = current.some(m => m.id === streamId);
        const { [chatKey]: _si, ...restStreaming } = prev._streamingIds;
        const { [chatKey]: _tp, ...restText } = prev._activeTextParts;
        const { [chatKey]: _rp, ...restReasoning } = prev._activeReasoningParts;

        if (streamExists) {
          return {
            _streamingIds: restStreaming,
            _activeTextParts: restText,
            _activeReasoningParts: restReasoning,
            chatHistories: {
              ...prev.chatHistories,
              [chatKey]: current.map(m =>
                m.id === streamId
                  ? {
                      ...m,
                      content: message.content || m.content,
                      isStreaming: false,
                      streamParts: (m.streamParts || []).map(p =>
                        (p.type === 'text' || p.type === 'reasoning') ? { ...p, done: true } : p,
                      ),
                    }
                  : m,
              ),
            },
          };
        }
        return {
          _streamingIds: restStreaming,
          _activeTextParts: restText,
          _activeReasoningParts: restReasoning,
          chatHistories: { ...prev.chatHistories, [chatKey]: [...current, message] },
        };
      }

      return {
        chatHistories: {
          ...prev.chatHistories,
          [chatKey]: [...(prev.chatHistories[chatKey] ?? []), message],
        },
      };
    });
  },

  // ────────────────────────────────────────────────────────────────────────
  // handleStateEvent — migrated from orchestrationStore
  // ────────────────────────────────────────────────────────────────────────

  handleStateEvent: (data) => {
    // Goal-scope guard: if the update carries a goalId that doesn't match
    // the active goal, only update the goalSessionStates cache — don't
    // mutate the active tasks/sessionState.
    const incomingGoalId = data.goalId as string | undefined;
    const activeGoal = get().activeGoalId;
    // Goal-scope guard: task/plan/session updates MUST include goalId to mutate active state.
    // Missing goalId = unscoped broadcast → only update autoExecute (global), not tasks/state.
    const isForActiveGoal = incomingGoalId ? incomingGoalId === activeGoal : false;

    if (data.plan && Array.isArray(data.plan) && isForActiveGoal) {
      const incomingTasks: Task[] = data.plan.map(mapBackendTask);
      set(prev => {
        const incomingIds = new Set(incomingTasks.map(t => t.id));
        const kept = prev.tasks.filter(t => !incomingIds.has(t.id));
        return { tasks: [...kept, ...incomingTasks] };
      });
    }

    if (data.tasks && Array.isArray(data.tasks) && isForActiveGoal) {
      set(prev => ({
        tasks: prev.tasks.map(t => {
          const update = data.tasks.find((u: any) => u.id === t.id);
          if (!update) return t;
          return { ...t, status: update.status as TaskStatus, completed: update.status === 'completed' };
        }),
      }));
    }

    if (data.autoExecute !== undefined) {
      set({ autoExecuteEnabled: data.autoExecute });
    }

    if (data.sessionState) {
      const goalId = incomingGoalId ?? activeGoal;
      if (goalId) {
        set(prev => ({
          // Only update visible sessionState if this is the active goal
          ...(isForActiveGoal ? { sessionState: data.sessionState as SessionState } : {}),
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
    set({ sessionState: 'executing' });
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

  setSessionState: (state) => {
    set({ sessionState: state as SessionState });
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
      activeGoalId: null,
      activePlanId: null,
      selectedTaskId: null,
      sessionState: null,
      autoExecuteEnabled: false,
      goalSessionStates: {},
      chatHistories: {},
      tasks: [],
      plans: [],
      orchestrationLogs: [],
      _streamingIds: {},
      _activeTextParts: {},
      _activeReasoningParts: {},
    });
  },

  getMessages: (chatKey) => get().chatHistories[chatKey] ?? [],
}), { name: 'GoalSessionStore' }));
