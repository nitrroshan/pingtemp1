import { v4 as uuidv4 } from 'uuid';
import { useAgentStore } from './agentStore';
import { useGoalSessionStore } from './goalSessionStore';
import { useUiStore } from './uiStore';
import { useDiscussionStore } from './discussionStore';
import type { Agent } from '../types';
import type { AgentServiceV2 } from '../services/AgentServiceV2';
import type { StreamPart } from '../types';

const TASK_UPDATE_LOG: Record<string, { fmt: (u: any) => string; type: 'info' | 'success' | 'warning' | 'error' }> = {
  started:        { fmt: (u) => `${u.taskId}: Started`, type: 'info' },
  progress:       { fmt: (u) => `${u.taskId}: ${u.note || `Step ${u.stepIdx}`}`, type: 'info' },
  tool_milestone: { fmt: (u) => `${u.taskId}: ${u.tool} - ${u.summary?.slice(0, 100) || 'done'}`, type: 'info' },
  completed:      { fmt: (u) => `${u.taskId}: Completed - ${u.summary?.slice(0, 100) || ''}`, type: 'success' },
  failed:         { fmt: (u) => `${u.taskId}: Failed - ${u.error?.slice(0, 100) || ''}`, type: 'error' },
  blocked:        { fmt: (u) => `${u.taskId}: Blocked - ${u.reason?.slice(0, 100) || ''}`, type: 'warning' },
};

function findAgentByRole(roleName: string, teamId: string): Agent | undefined {
  return useAgentStore.getState().findAgentByRole(roleName, teamId);
}

function resolveChatKey(teamId: string, payload: { agentId?: string; taskId?: string; goalId?: string; part: StreamPart }): string | null {
  const streamAgentId = payload.agentId;
  const streamTaskId = payload.taskId;
  const streamGoalId = payload.goalId;

  if (!streamAgentId) return null;

  if (streamAgentId.startsWith('chat-')) {
    const role = streamAgentId.replace('chat-', '');
    const resolved = findAgentByRole(role, teamId);
    return resolved ? `chat:${resolved.id}` : null;
  }

  const isOrchestrator = streamAgentId === 'manager' || streamAgentId === 'orchestrator' || streamAgentId === 'planner';
  const resolved = isOrchestrator ? null : findAgentByRole(streamAgentId, teamId);

  if (!isOrchestrator && !resolved) {
    return streamTaskId ? `${streamAgentId}:task:${streamTaskId}` : streamAgentId;
  }

  const targetAgentId = isOrchestrator ? teamId : resolved!.id;
  if (isOrchestrator && streamGoalId) return `${teamId}:goal:${streamGoalId}`;
  if (!isOrchestrator && streamTaskId) return `${targetAgentId}:task:${streamTaskId}`;
  return targetAgentId;
}

export function bindSocketMiddleware(agentService: AgentServiceV2, teamId: string): () => void {
  const unsubMessage = agentService.onMessage((data) => {
    const content = data.content;
    if (!content) return;

    const goalStore = useGoalSessionStore.getState();
    goalStore.addLog(data.agentId, content.length > 100 ? `${content.substring(0, 100)}...` : content, 'info');

    const isManager = data.agentId === 'manager' || data.agentId === 'orchestrator' || data.agentId === 'planner';
    const targetAgentId = isManager
      ? (data.goalId ? `${teamId}:goal:${data.goalId}` : teamId)
      : (findAgentByRole(data.agentId, teamId)?.id ?? data.agentId);

    goalStore.addMessage(targetAgentId, {
      id: uuidv4(),
      role: 'model',
      content,
      timestamp: data.timestamp ?? Date.now(),
    });

    if (data.taskId && useUiStore.getState().activeAgentId !== targetAgentId) {
      useUiStore.getState().setActiveAgentId(targetAgentId);
    }
  });

  const unsubState = agentService.onState((data) => {
    const goalStore = useGoalSessionStore.getState();
    goalStore.addLog('SYSTEM', `State: ${data.sessionState}`, 'info');
    goalStore.handleStateEvent(data);
  });

  const unsubOutput = agentService.onOutput((data) => {
    const preview = data.output.content.length > 100 ? `${data.output.content.substring(0, 100)}...` : data.output.content;
    useGoalSessionStore.getState().addLog(data.agentId, `Output: ${preview}`, 'success');
  });

  const unsubError = agentService.onError((data) => {
    useGoalSessionStore.getState().addLog('ERROR', data.error, 'error');
  });

  const unsubStream = agentService.onStream((payload: any) => {
    if (!payload?.part) return;
    const chatKey = resolveChatKey(teamId, payload);
    if (!chatKey) return;
    useGoalSessionStore.getState().processStreamPart(chatKey, payload.part);
  });

  const unsubTaskUpdate = agentService.onTaskUpdate((update: any) => {
    if (!update?.taskId) return;
    const config = TASK_UPDATE_LOG[update.type] || { fmt: () => update.type, type: 'info' as const };
    useGoalSessionStore.getState().addLog(`${update.taskId} [${update.role || 'worker'}]`, config.fmt(update), config.type);

    if (update.type === 'started' && !useGoalSessionStore.getState().selectedTaskId) {
      useGoalSessionStore.setState({ selectedTaskId: update.taskId });
    }
  });

  const unsubGoalState = agentService.onGoalStateChange((data: any) => {
    useGoalSessionStore.getState().handleGoalStateChange(data);
  });

  const unsubGoalCreated = agentService.onGoalCreated(({ goalId }) => {
    agentService.subscribeToGoal(teamId, goalId);
  });

  const unsubDiscussionActivity = agentService.onDiscussionActivity((data: any) => {
    useDiscussionStore.getState().recordActivity(data);
  });

  return () => {
    unsubMessage();
    unsubState();
    unsubOutput();
    unsubError();
    unsubStream();
    unsubTaskUpdate();
    unsubGoalState();
    unsubGoalCreated();
    unsubDiscussionActivity();
  };
}