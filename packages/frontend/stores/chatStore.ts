/**
 * chatStore — Chat histories + stream processing.
 *
 * Replaces useChat hook. Manages:
 * - Per-agent message histories
 * - Stream part processing (text, reasoning, tool cards, notifications)
 * - Message persistence (localStorage cache + backend API)
 * - Session restore from backend
 *
 * Stream processing and chat history are kept together because streaming
 * creates/updates messages directly in the history (dozens of mutations/sec).
 * Splitting would require cross-store writes on every delta.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { agentServiceV2 } from '../services/AgentServiceV2';
import type { Message, RenderedPart, ToolCardState, StreamPart, NotificationChipState } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ChatState {
  chatHistories: Record<string, Message[]>;

  // ── Stream tracking (per-agent, supports concurrent streams) ──
  /** messageId of the currently streaming message per agent */
  _streamingIds: Record<string, string>;
  /** active text part ID per agent */
  _activeTextParts: Record<string, string>;
  /** active reasoning part ID per agent */
  _activeReasoningParts: Record<string, string>;
  /** agents already loaded from backend (prevents duplicate API calls) */
  _loadedAgents: Set<string>;

  // ── Actions ──
  addMessage: (agentId: string, message: Message) => void;
  updateMessages: (agentId: string, messages: Message[] | Message) => void;
  processStreamPart: (agentId: string, part: StreamPart) => void;
  loadAgentChat: (teamId: string, agentId: string) => Promise<void>;
  clearAllHistories: () => void;
  clearForTeam: () => void;
  restoreFromServer: (
    teamId: string,
    agents: Array<{ id: string; role: string }>,
    goalId?: string,
  ) => Promise<{
    goals: any[];
    plan: any;
    tasks: any[];
    orchestratorState: string | null;
  } | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Find or create a ToolCard in streamParts */
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

/** Update streaming message's parts immutably */
function updateStreamParts(
  histories: Record<string, Message[]>,
  agentId: string,
  streamId: string,
  updater: (parts: RenderedPart[], msg: Message) => RenderedPart[],
): Record<string, Message[]> {
  const current = histories[agentId] ?? [];
  return {
    ...histories,
    [agentId]: current.map(m => {
      if (m.id !== streamId) return m;
      return { ...m, streamParts: updater([...(m.streamParts || [])], m) };
    }),
  };
}

/** Cap histories for localStorage persistence */
function capHistories(histories: Record<string, Message[]>, max: number): Record<string, Message[]> {
  return Object.fromEntries(
    Object.entries(histories).map(([key, msgs]) => [key, msgs.slice(-max)]),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useChatStore = create<ChatState>()(devtools((set, get) => {
  // Load initial state from localStorage cache
  let initialHistories: Record<string, Message[]> = {};
  try {
    const stored = localStorage.getItem('ping:chatHistories');
    if (stored) {
      const cacheTs = localStorage.getItem('ping:chatHistories:ts');
      if (!cacheTs || Date.now() - Number(cacheTs) < 24 * 60 * 60 * 1000) {
        const parsed = JSON.parse(stored) as Record<string, Message[]>;
        // Fix interrupted streams
        initialHistories = Object.fromEntries(
          Object.entries(parsed).map(([agentId, messages]) => [
            agentId,
            messages.map(m => m.isStreaming ? { ...m, isStreaming: false } : m),
          ]),
        );
      } else {
        localStorage.removeItem('ping:chatHistories');
        localStorage.removeItem('ping:chatHistories:ts');
      }
    }
  } catch { /* ignore */ }

  // Persist to localStorage on changes (debounced via subscribe)
  let persistTimeout: ReturnType<typeof setTimeout> | null = null;
  const schedulePersist = () => {
    if (persistTimeout) return;
    persistTimeout = setTimeout(() => {
      persistTimeout = null;
      try {
        const capped = capHistories(get().chatHistories, 50);
        localStorage.setItem('ping:chatHistories', JSON.stringify(capped));
        localStorage.setItem('ping:chatHistories:ts', String(Date.now()));
      } catch { /* storage quota exceeded */ }
    }, 500);
  };

  return {
    chatHistories: initialHistories,
    _streamingIds: {},
    _activeTextParts: {},
    _activeReasoningParts: {},
    _loadedAgents: new Set<string>(),

    addMessage: (agentId, message) => {
      set(prev => {
        const streamId = prev._streamingIds[agentId];
        if (streamId) {
          // Finalize active stream with the complete content
          const current = prev.chatHistories[agentId] ?? [];
          const streamExists = current.some(m => m.id === streamId);
          const { [agentId]: _si, ...restStreaming } = prev._streamingIds;
          const { [agentId]: _tp, ...restText } = prev._activeTextParts;
          const { [agentId]: _rp, ...restReasoning } = prev._activeReasoningParts;

          if (streamExists) {
            return {
              _streamingIds: restStreaming,
              _activeTextParts: restText,
              _activeReasoningParts: restReasoning,
              chatHistories: {
                ...prev.chatHistories,
                [agentId]: current.map(m =>
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
            chatHistories: { ...prev.chatHistories, [agentId]: [...current, message] },
          };
        }

        return {
          chatHistories: {
            ...prev.chatHistories,
            [agentId]: [...(prev.chatHistories[agentId] ?? []), message],
          },
        };
      });
      schedulePersist();
    },

    updateMessages: (agentId, messagesOrSingle) => {
      set(prev => {
        const current = prev.chatHistories[agentId] ?? [];
        const newMessages = Array.isArray(messagesOrSingle) ? messagesOrSingle : [...current, messagesOrSingle];
        return { chatHistories: { ...prev.chatHistories, [agentId]: newMessages } };
      });
      schedulePersist();
    },

    processStreamPart: (agentId, part) => {
      set(prev => {
        const streamId = prev._streamingIds[agentId];
        const histories = prev.chatHistories;

        switch (part.type) {
          case 'start': {
            const msgId = part.messageId;
            const streamMsg: Message = {
              id: msgId, role: 'model', content: '', timestamp: Date.now(),
              isStreaming: true, streamParts: [],
            };
            return {
              _streamingIds: { ...prev._streamingIds, [agentId]: msgId },
              _activeTextParts: { ...prev._activeTextParts, [agentId]: '' },
              _activeReasoningParts: { ...prev._activeReasoningParts, [agentId]: '' },
              chatHistories: {
                ...histories,
                [agentId]: [...(histories[agentId] ?? []), streamMsg],
              },
            };
          }

          case 'text-start': {
            if (!streamId) return prev;
            return {
              _activeTextParts: { ...prev._activeTextParts, [agentId]: part.id },
              chatHistories: updateStreamParts(histories, agentId, streamId, (parts) =>
                [...parts, { type: 'text' as const, id: part.id, text: '', done: false }],
              ),
            };
          }

          case 'text-delta': {
            if (!streamId) {
              // No start event — create streaming message on-the-fly
              const fallbackId = `msg-${agentId}-${Date.now()}`;
              const textId = part.id || `text-${fallbackId}`;
              const streamMsg: Message = {
                id: fallbackId, role: 'model', content: part.delta, timestamp: Date.now(),
                isStreaming: true,
                streamParts: [{ type: 'text', id: textId, text: part.delta, done: false }],
              };
              return {
                _streamingIds: { ...prev._streamingIds, [agentId]: fallbackId },
                _activeTextParts: { ...prev._activeTextParts, [agentId]: textId },
                chatHistories: {
                  ...histories,
                  [agentId]: [...(histories[agentId] ?? []), streamMsg],
                },
              };
            }
            const current = histories[agentId] ?? [];
            return {
              _activeTextParts: { ...prev._activeTextParts, [agentId]: part.id },
              chatHistories: {
                ...histories,
                [agentId]: current.map(m => {
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
              _activeTextParts: { ...prev._activeTextParts, [agentId]: '' },
              chatHistories: updateStreamParts(histories, agentId, streamId, (parts) =>
                parts.map(p => p.type === 'text' && p.id === part.id ? { ...p, done: true } : p),
              ),
            };
          }

          case 'reasoning-start': {
            if (!streamId) return prev;
            return {
              _activeReasoningParts: { ...prev._activeReasoningParts, [agentId]: part.id },
              chatHistories: updateStreamParts(histories, agentId, streamId, (parts) =>
                [...parts, { type: 'reasoning' as const, id: part.id, text: '', done: false }],
              ),
            };
          }

          case 'reasoning-delta': {
            if (!streamId) return prev;
            return {
              chatHistories: updateStreamParts(histories, agentId, streamId, (parts) => {
                const exists = parts.some(p => p.type === 'reasoning' && p.id === part.id);
                if (!exists) {
                  return [...parts, { type: 'reasoning' as const, id: part.id, text: part.delta, done: false }];
                }
                return parts.map(p =>
                  p.type === 'reasoning' && p.id === part.id ? { ...p, text: p.text + part.delta } : p,
                );
              }),
            };
          }

          case 'reasoning-end': {
            if (!streamId) return prev;
            return {
              _activeReasoningParts: { ...prev._activeReasoningParts, [agentId]: '' },
              chatHistories: updateStreamParts(histories, agentId, streamId, (parts) =>
                parts.map(p => p.type === 'reasoning' && p.id === part.id ? { ...p, done: true } : p),
              ),
            };
          }

          case 'tool-input-start': {
            if (!streamId) return prev;
            return {
              chatHistories: updateStreamParts(histories, agentId, streamId, (parts) => {
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
              chatHistories: updateStreamParts(histories, agentId, streamId, (parts) =>
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
              chatHistories: updateStreamParts(histories, agentId, streamId, (parts) => {
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
              chatHistories: updateStreamParts(histories, agentId, streamId, (parts) =>
                parts.map(p =>
                  p.type === 'tool-card' && p.card.toolCallId === part.toolCallId
                    ? { ...p, card: { ...p.card, status: 'complete' as const, result: part.output } } : p,
                ),
              ),
            };
          }

          case 'finish': {
            if (!streamId) return prev;
            const { [agentId]: _si, ...restStreaming } = prev._streamingIds;
            const { [agentId]: _tp, ...restText } = prev._activeTextParts;
            const { [agentId]: _rp, ...restReasoning } = prev._activeReasoningParts;
            const current = histories[agentId] ?? [];
            return {
              _streamingIds: restStreaming,
              _activeTextParts: restText,
              _activeReasoningParts: restReasoning,
              chatHistories: {
                ...histories,
                [agentId]: current.map(m => {
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
            const { [agentId]: _si, ...restStreaming } = prev._streamingIds;
            const current = histories[agentId] ?? [];
            const errorPart: RenderedPart = {
              type: 'notification' as const,
              chip: { type: 'task-failed' as const, taskId: '', role: agentId, error: part.error },
            };
            return {
              _streamingIds: restStreaming,
              chatHistories: {
                ...histories,
                [agentId]: current.map(m => {
                  if (m.id !== streamId) return m;
                  return {
                    ...m, isStreaming: false,
                    streamParts: [...(m.streamParts || []), errorPart],
                  };
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
              return { chatHistories: updateStreamParts(histories, agentId, streamId, (parts) => [...parts, notifPart]) };
            }
            // No active stream — standalone notification message
            const notifMsg: Message = {
              id: `notif-${agentId}-${Date.now()}`, role: 'model', content: '',
              timestamp: Date.now(), isStreaming: false, streamParts: [notifPart],
            };
            return {
              chatHistories: { ...histories, [agentId]: [...(histories[agentId] ?? []), notifMsg] },
            };
          }

          default:
            return prev;
        }
      });
      schedulePersist();
    },

    loadAgentChat: async (teamId, agentId) => {
      const loaded = get()._loadedAgents;
      if (loaded.has(agentId)) return;
      set(prev => ({ _loadedAgents: new Set([...prev._loadedAgents, agentId]) }));

      try {
        const response = await fetch(
          `${agentServiceV2.getBaseUrl()}/api/v2/teams/${teamId}/agents/${agentId}/messages?limit=50`,
          { credentials: 'include' },
        );
        if (!response.ok) return;
        const { messages } = await response.json();

        if (!messages?.length) {
          set(prev => {
            if (!prev.chatHistories[agentId]?.length) return prev;
            const next = { ...prev.chatHistories };
            delete next[agentId];
            return { chatHistories: next };
          });
          return;
        }

        const backendMessages: Message[] = messages.map((m: any) => ({
          id: m.id, role: m.role === 'assistant' ? 'model' : m.role,
          content: m.content, timestamp: new Date(m.timestamp).getTime(),
          isStreaming: false,
          streamParts: m.streamParts ? JSON.parse(m.streamParts) : undefined,
        }));

        set(prev => ({
          chatHistories: { ...prev.chatHistories, [agentId]: backendMessages },
        }));
      } catch { /* API unavailable — use localStorage cache */ }
    },

    clearAllHistories: () => {
      set({ chatHistories: {}, _loadedAgents: new Set() });
      localStorage.removeItem('ping:chatHistories');
    },

    clearForTeam: () => {
      set({
        chatHistories: {},
        _streamingIds: {},
        _activeTextParts: {},
        _activeReasoningParts: {},
        _loadedAgents: new Set(),
      });
    },

    restoreFromServer: async (teamId, agents, goalId) => {
      try {
        const data = await agentServiceV2.restoreSession(teamId, goalId);
        if (!data) return null;

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
              key = goalId ? `${teamId}:goal:${goalId}` : teamId;
            }
            const mapped: Message[] = (msgs as any[]).map((m: any) => ({
              id: m.id, role: m.role === 'assistant' ? 'model' : m.role,
              content: m.content, timestamp: new Date(m.timestamp).getTime(),
              isStreaming: false,
              streamParts: m.streamParts ? JSON.parse(m.streamParts) : undefined,
            }));
            restored[key] = [...(restored[key] ?? []), ...mapped];
          }
        }

        // Sort merged conversations by timestamp
        for (const key of Object.keys(restored)) {
          restored[key].sort((a, b) => a.timestamp - b.timestamp);
        }

        // Worker messages
        if (data.workerMessages?.length) {
          const workerByAgent: Record<string, any[]> = {};
          for (const m of data.workerMessages) {
            const key = m.agentId;
            if (!workerByAgent[key]) workerByAgent[key] = [];
            workerByAgent[key].push(m);
          }
          for (const [agentId, msgs] of Object.entries(workerByAgent)) {
            restored[agentId] = msgs.map((m: any) => ({
              id: m.id, role: m.role === 'assistant' ? 'model' : m.role,
              content: m.content, timestamp: new Date(m.timestamp).getTime(),
              isStreaming: false,
              streamParts: m.streamParts ? JSON.parse(m.streamParts) : undefined,
            }));
          }
        }

        if (Object.keys(restored).length > 0) {
          set(prev => ({ chatHistories: { ...prev.chatHistories, ...restored } }));
          // Mark all restored agents as loaded
          set(prev => ({
            _loadedAgents: new Set([...prev._loadedAgents, ...Object.keys(restored)]),
          }));
        }

        return {
          goals: data.goals ?? [],
          plan: data.plan ?? null,
          tasks: data.tasks ?? [],
          orchestratorState: data.orchestratorState ?? null,
        };
      } catch (err) {
        console.error('[chatStore] restoreFromServer failed:', err);
        return null;
      }
    },
  };
}, { name: 'ChatStore' }));
