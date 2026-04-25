/**
 * useOrchestration — manages orchestration state
 *
 * Handles:
 * - Socket event subscriptions for state/output/progress/error
 * - Plan lifecycle (pending plan, approval)
 * - Task state (per-agent, real-time updates)
 * - Session state machine
 * - Auto-execute toggle
 * - Orchestration logs
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { agentServiceV2, type Task as BackendTask } from '../services/AgentServiceV2';
import type { Task, TaskStatus, OrchestrationEvent } from '../types';
import type { Agent } from '../types';

export interface OrchestrationState {
  sessionState: string | null;
  currentPlan: BackendTask[] | null;
  tasks: Record<string, Task[]>;
  autoExecuteEnabled: boolean;
  orchestrationLogs: OrchestrationEvent[];
}

/** Callback fired when an agent message arrives */
export type OnMessageCallback = (
  agentId: string,
  content: string,
  taskId?: string,
  timestamp?: number,
) => void;

/** Callback fired for stream parts */
export type OnStreamPartCallback = (
  agentId: string,
  part: any, // StreamPart
) => void;

export interface OrchestrationActions {
  handleApprovePlan: () => void;
  handleStartTask: (taskId: string) => void;
  handleCompleteTask: (taskId: string) => void;
  handleCancelTask: (taskId: string) => void;
  handleToggleAutoExecute: () => void;
  addOrchestrationLog: (source: string, message: string, type: OrchestrationEvent['type']) => void;
  setSessionState: (state: string | null) => void;
  setCurrentPlan: (plan: BackendTask[] | null) => void;
  subscribeToTeam: (
    teamId: string,
    agentsRef: MutableRefObject<Agent[]>,
    selectedTeamIdRef: MutableRefObject<string | null>,
    onMessage: OnMessageCallback,
    onStreamPart?: OnStreamPartCallback,
  ) => () => void;
}

export function useOrchestration(): OrchestrationState & OrchestrationActions {
  const [sessionState, setSessionState] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState<BackendTask[] | null>(null);
  const [tasks, setTasks] = useState<Record<string, Task[]>>({});
  const [autoExecuteEnabled, setAutoExecuteEnabled] = useState(false);
  const [orchestrationLogs, setOrchestrationLogs] = useState<OrchestrationEvent[]>([]);

  const addOrchestrationLog = useCallback((
    source: string,
    message: string,
    type: OrchestrationEvent['type'] = 'info',
  ) => {
    setOrchestrationLogs(prev => [...prev.slice(-199), {
      id: uuidv4(),
      timestamp: Date.now(),
      type,
      message,
      source,
    }]);
  }, []);

  const handleApprovePlan = useCallback(() => {
    agentServiceV2.approvePlan();
    addOrchestrationLog('SYSTEM', 'Plan approved, starting execution...', 'success');
    setSessionState('executing');
  }, [addOrchestrationLog]);

  const handleStartTask = useCallback((taskId: string) => {
    agentServiceV2.startTask(taskId);
    addOrchestrationLog('SYSTEM', `Starting task: ${taskId}`, 'info');
  }, [addOrchestrationLog]);

  const handleCompleteTask = useCallback((taskId: string) => {
    agentServiceV2.completeTask(taskId);
    addOrchestrationLog('SYSTEM', `Completing task: ${taskId}`, 'success');
  }, [addOrchestrationLog]);

  const handleCancelTask = useCallback((taskId: string) => {
    agentServiceV2.cancelTask(taskId);
    addOrchestrationLog('SYSTEM', `Cancelling task: ${taskId}`, 'warning');
  }, [addOrchestrationLog]);

  const handleToggleAutoExecute = useCallback(() => {
    setAutoExecuteEnabled(prev => {
      const newVal = !prev;
      agentServiceV2.autoExecute(newVal);
      addOrchestrationLog('SYSTEM', `Auto-execute ${newVal ? 'enabled' : 'disabled'}`, 'info');
      return newVal;
    });
  }, [addOrchestrationLog]);

  /**
   * Subscribe to V2 socket events for a given team.
   * Returns an unsubscribe function for cleanup.
   */
  const subscribeToTeam = useCallback((
    teamId: string,
    agentsRef: MutableRefObject<Agent[]>,
    selectedTeamIdRef: MutableRefObject<string | null>,
    onMessage: OnMessageCallback,
    onStreamPart?: OnStreamPartCallback,
  ) => {
    const findAgentByRole = (roleName: string, searchTeamId: string | null): Agent | undefined => {
      const normalized = roleName.toLowerCase();
      if (searchTeamId) {
        const team = agentsRef.current.find(a => a.id === searchTeamId);
        const match = team?.subAgents?.find(s => s.role.toLowerCase() === normalized);
        if (match) return match;
      }
      const flat = (list: Agent[]): Agent | undefined => {
        for (const a of list) {
          if (a.role.toLowerCase() === normalized) return a;
          const found = a.subAgents ? flat(a.subAgents) : undefined;
          if (found) return found;
        }
      };
      return flat(agentsRef.current);
    };

    const unsubMessage = agentServiceV2.onMessage((data) => {
      let content = data.content;
      try {
        const parsed = JSON.parse(data.content);
        if (typeof parsed.response === 'string') content = parsed.response;
      } catch { /* not JSON */ }

      // Skip empty messages (agent made tool calls with no text output)
      if (!content) return;

      addOrchestrationLog(data.agentId, content.length > 100 ? content.substring(0, 100) + '...' : content, 'info');

      const targetAgentId = data.agentId === 'manager'
        ? teamId
        : (findAgentByRole(data.agentId, selectedTeamIdRef.current)?.id ?? data.agentId);

      onMessage(targetAgentId, content, data.taskId, data.timestamp);
    });

    const unsubState = agentServiceV2.onState((data) => {
      addOrchestrationLog('SYSTEM', `State: ${data.sessionState}`, 'info');

      if (data.plan) {
        setCurrentPlan(data.plan);

        const tasksByAgent: Record<string, Task[]> = {};
        data.plan.forEach((bt) => {
          const agent = findAgentByRole(bt.assignedRole, selectedTeamIdRef.current);
          if (!agent) return;
          const ft: Task = {
            id: bt.id,
            title: bt.title,
            description: bt.description,
            status: (bt.status || 'pending') as TaskStatus,
            assignedRole: bt.assignedRole,
            priority: bt.priority,
            dependencies: bt.dependencies,
            completed: bt.status === 'completed',
            createdAt: Date.now(),
          };
          tasksByAgent[agent.id] = [...(tasksByAgent[agent.id] ?? []), ft];
        });
        setTasks(tasksByAgent);
      }

      if (data.tasks && Array.isArray(data.tasks)) {
        setTasks(prev => {
          const updated = { ...prev };
          data.tasks!.forEach((tu: any) => {
            for (const aid in updated) {
              const idx = updated[aid].findIndex(t => t.id === tu.id);
              if (idx >= 0) {
                updated[aid] = [...updated[aid]];
                updated[aid][idx] = {
                  ...updated[aid][idx],
                  status: tu.status as TaskStatus,
                  completed: tu.status === 'completed',
                };
                break;
              }
            }
          });
          return updated;
        });
      }

      if (data.autoExecute !== undefined) setAutoExecuteEnabled(data.autoExecute);
      if (data.sessionState) setSessionState(data.sessionState);
    });

    const unsubOutput = agentServiceV2.onOutput((data) => {
      const outputPreview = data.output.content.length > 100 ? data.output.content.substring(0, 100) + '...' : data.output.content;
      addOrchestrationLog(data.agentId, `Output: ${outputPreview}`, 'success');
    });

    const unsubError = agentServiceV2.onError((data) => {
      addOrchestrationLog('ERROR', data.error, 'error');
    });

    // Stream events (Phase 2 — AI SDK streaming)
    // Routes ALL stream parts through onStreamPart for rich rendering
    const unsubStream = agentServiceV2.onStream((payload: any) => {
      if (!payload?.part) return;
      const { part, agentId: streamAgentId } = payload;

      // Handle ChatAgent responses (agentId = "chat-{role}")
      // Route to separate chat history key "chat:{mongoId}" to keep ChatAgent R1 chat
      // separate from worker streams
      if (streamAgentId?.startsWith('chat-')) {
        const role = streamAgentId.replace('chat-', '');
        const resolved = findAgentByRole(role, selectedTeamIdRef.current);
        if (resolved && onStreamPart) {
          onStreamPart(`chat:${resolved.id}`, part);
        }
        return;
      }

      // Map role-based agentId to MongoDB agent ID
      const isOrchestrator = streamAgentId === 'manager' || streamAgentId === 'orchestrator' || streamAgentId === 'planner';
      const resolved = isOrchestrator ? null : findAgentByRole(streamAgentId, selectedTeamIdRef.current);

      // Skip events from unknown agent roles (e.g. legacy "worker" fallback)
      if (!isOrchestrator && !resolved) return;

      const targetAgentId = isOrchestrator ? teamId : resolved!.id;

      // Route through rich stream part processor
      if (onStreamPart) {
        onStreamPart(targetAgentId, part);
      }
    });

    // Channel B: task_update events (started/progress/tool_milestone/completed/failed)
    const TASK_UPDATE_LOG: Record<string, { fmt: (u: any) => string; type: string }> = {
      started:        { fmt: (u) => `${u.taskId}: Started`,                                    type: 'info' },
      progress:       { fmt: (u) => `${u.taskId}: ${u.note || `Step ${u.stepIdx}`}`,            type: 'info' },
      tool_milestone: { fmt: (u) => `${u.taskId}: ${u.tool} — ${u.summary?.slice(0, 100) || 'done'}`, type: 'info' },
      completed:      { fmt: (u) => `${u.taskId}: Completed — ${u.summary?.slice(0, 100) || ''}`, type: 'success' },
      failed:         { fmt: (u) => `${u.taskId}: Failed — ${u.error?.slice(0, 100) || ''}`,     type: 'error' },
      blocked:        { fmt: (u) => `${u.taskId}: Blocked — ${u.reason?.slice(0, 100) || ''}`,   type: 'warning' },
    };

    const unsubTaskUpdate = agentServiceV2.onTaskUpdate((update: any) => {
      if (!update?.taskId) return;
      const config = TASK_UPDATE_LOG[update.type] || { fmt: () => update.type, type: 'info' };
      addOrchestrationLog(`${update.taskId} [${update.role || 'worker'}]`, config.fmt(update), config.type as any);
    });

    return () => {
      unsubMessage();
      unsubState();
      unsubOutput();
      unsubError();
      unsubStream();
      unsubTaskUpdate();
    };
  }, [addOrchestrationLog]);

  return {
    sessionState,
    currentPlan,
    tasks,
    autoExecuteEnabled,
    orchestrationLogs,
    handleApprovePlan,
    handleStartTask,
    handleCompleteTask,
    handleCancelTask,
    handleToggleAutoExecute,
    addOrchestrationLog,
    setSessionState,
    setCurrentPlan,
    subscribeToTeam,
  };
}
