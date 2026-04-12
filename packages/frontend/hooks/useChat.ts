/**
 * useChat -- manages per-agent chat history with streaming support
 *
 * Source of truth: backend API (MongoDB/file-based ChatService)
 * localStorage: write-through cache for current session (fast reload)
 *
 * Flow:
 * 1. On agent select: load history from API, merge with localStorage cache
 * 2. During streaming: update localStorage in real-time
 * 3. On stream finish: backend saves the message (via SocketServerV2)
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { agentServiceV2 } from '../services/AgentServiceV2';
import type { Message, RenderedPart, ToolCardState, StreamPart, NotificationChipState } from '../types';

export function useChat() {
  const [chatHistories, setChatHistories] = useState<Record<string, Message[]>>(() => {
    try {
      // Load from localStorage cache for instant display on refresh
      const stored = localStorage.getItem('ping:chatHistories');
      if (!stored) return {};
      const parsed = JSON.parse(stored) as Record<string, Message[]>;
      // Fix messages that were interrupted mid-stream
      return Object.fromEntries(
        Object.entries(parsed).map(([agentId, messages]) => [
          agentId,
          messages.map(m => m.isStreaming ? { ...m, isStreaming: false } : m),
        ])
      );
    } catch {
      return {};
    }
  });
  /** Track the current streaming message ID per agent */
  const streamingMessageIds = useRef<Record<string, string>>({});

  // Persist chat histories to localStorage on every change
  useEffect(() => {
    try {
      localStorage.setItem('ping:chatHistories', JSON.stringify(chatHistories));
    } catch {
      // Storage quota exceeded or unavailable — silently ignore
    }
  }, [chatHistories]);
  /** Track active text/reasoning part IDs per streaming message */
  const activeTextParts = useRef<Record<string, string>>({});
  const activeReasoningParts = useRef<Record<string, string>>({});

  /** Helper: update a streaming message's streamParts */
  const updateStreamingMessage = useCallback((agentId: string, updater: (parts: RenderedPart[], msg: Message) => RenderedPart[]) => {
    const streamId = streamingMessageIds.current[agentId];
    if (!streamId) return;

    setChatHistories(prev => {
      const current = prev[agentId] ?? [];
      return {
        ...prev,
        [agentId]: current.map(m => {
          if (m.id !== streamId) return m;
          const newParts = updater([...(m.streamParts || [])], m);
          return { ...m, streamParts: newParts };
        }),
      };
    });
  }, []);

  /** Helper: find or create a ToolCardState in streamParts */
  const getOrCreateToolCard = (parts: RenderedPart[], toolCallId: string, toolName: string): { parts: RenderedPart[]; card: ToolCardState } => {
    const existing = parts.find(p => p.type === 'tool-card' && p.card.toolCallId === toolCallId);
    if (existing && existing.type === 'tool-card') {
      return { parts, card: existing.card };
    }
    const card: ToolCardState = {
      toolCallId,
      toolName,
      status: 'calling',
      argsText: '',
    };
    return { parts: [...parts, { type: 'tool-card', card }], card };
  };

  /**
   * Process a stream part from the backend.
   * Creates/updates streaming messages with rich streamParts.
   */
  const processStreamPart = useCallback((agentId: string, part: StreamPart) => {
    // Debug: trace all stream parts
    if (part.type === 'start' || part.type === 'finish' || part.type === 'tool-input-available' || part.type === 'tool-output-available') {
      // Process stream part into chat message
    }
    switch (part.type) {
      case 'start': {
        // Create a new streaming message
        const msgId = part.messageId;
        streamingMessageIds.current[agentId] = msgId;
        activeTextParts.current[agentId] = '';
        activeReasoningParts.current[agentId] = '';

        const streamMsg: Message = {
          id: msgId,
          role: 'model',
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
          streamParts: [],
        };
        setChatHistories(prev => ({
          ...prev,
          [agentId]: [...(prev[agentId] ?? []), streamMsg],
        }));
        break;
      }

      case 'text-start': {
        activeTextParts.current[agentId] = part.id;
        updateStreamingMessage(agentId, (parts) => {
          return [...parts, { type: 'text' as const, id: part.id, text: '', done: false }];
        });
        break;
      }

      case 'text-delta': {
        const streamId = streamingMessageIds.current[agentId];
        if (!streamId) {
          // No start event received — create streaming message on-the-fly
          const fallbackId = `msg-${agentId}-${Date.now()}`;
          streamingMessageIds.current[agentId] = fallbackId;
          const textId = part.id || `text-${fallbackId}`;
          activeTextParts.current[agentId] = textId;
          const streamMsg: Message = {
            id: fallbackId,
            role: 'model',
            content: part.delta,
            timestamp: Date.now(),
            isStreaming: true,
            streamParts: [{ type: 'text', id: textId, text: part.delta, done: false }],
          };
          setChatHistories(prev => ({
            ...prev,
            [agentId]: [...(prev[agentId] ?? []), streamMsg],
          }));
          break;
        }

        // Append delta to both content (fallback) and the active text part
        setChatHistories(prev => {
          const current = prev[agentId] ?? [];
          return {
            ...prev,
            [agentId]: current.map(m => {
              if (m.id !== streamId) return m;
              const oldParts = m.streamParts || [];
              const exists = oldParts.some(p => p.type === 'text' && p.id === part.id);
              // Fully immutable: create new array with new objects (React StrictMode safe)
              const newParts = exists
                ? oldParts.map(p =>
                    p.type === 'text' && p.id === part.id
                      ? { ...p, text: p.text + part.delta }
                      : p
                  )
                : [...oldParts, { type: 'text' as const, id: part.id, text: part.delta, done: false }];
              if (!exists) activeTextParts.current[agentId] = part.id;
              return { ...m, content: m.content + part.delta, streamParts: newParts };
            }),
          };
        });
        break;
      }

      case 'text-end': {
        updateStreamingMessage(agentId, (parts) => {
          return parts.map(p =>
            p.type === 'text' && p.id === part.id ? { ...p, done: true } : p
          );
        });
        activeTextParts.current[agentId] = '';
        break;
      }

      case 'reasoning-start': {
        activeReasoningParts.current[agentId] = part.id;
        updateStreamingMessage(agentId, (parts) => {
          return [...parts, { type: 'reasoning' as const, id: part.id, text: '', done: false }];
        });
        break;
      }

      case 'reasoning-delta': {
        updateStreamingMessage(agentId, (parts) => {
          const exists = parts.some(p => p.type === 'reasoning' && p.id === part.id);
          if (!exists) {
            activeReasoningParts.current[agentId] = part.id;
            return [...parts, { type: 'reasoning' as const, id: part.id, text: part.delta, done: false }];
          }
          return parts.map(p =>
            p.type === 'reasoning' && p.id === part.id
              ? { ...p, text: p.text + part.delta }
              : p
          );
        });
        break;
      }

      case 'reasoning-end': {
        updateStreamingMessage(agentId, (parts) => {
          const rp = parts.find(p => p.type === 'reasoning' && p.id === part.id);
          return parts.map(p =>
            p.type === 'reasoning' && p.id === part.id ? { ...p, done: true } : p
          );
        });
        activeReasoningParts.current[agentId] = '';
        break;
      }

      case 'tool-input-start': {
        updateStreamingMessage(agentId, (parts) => {
          const { parts: newParts } = getOrCreateToolCard(parts, part.toolCallId, part.toolName);
          return newParts.map(p =>
            p.type === 'tool-card' && p.card.toolCallId === part.toolCallId
              ? { ...p, card: { ...p.card, status: 'streaming-args' as const } }
              : p
          );
        });
        break;
      }

      case 'tool-input-delta': {
        updateStreamingMessage(agentId, (parts) => {
          return parts.map(p =>
            p.type === 'tool-card' && p.card.toolCallId === part.toolCallId
              ? { ...p, card: { ...p.card, argsText: p.card.argsText + part.delta, status: 'streaming-args' as const } }
              : p
          );
        });
        break;
      }

      case 'tool-input-available': {
        updateStreamingMessage(agentId, (parts) => {
          const { parts: newParts } = getOrCreateToolCard(parts, part.toolCallId, part.toolName);
          return newParts.map(p =>
            p.type === 'tool-card' && p.card.toolCallId === part.toolCallId
              ? { ...p, card: { ...p.card, status: 'executing' as const, args: part.input, argsText: JSON.stringify(part.input, null, 2) } }
              : p
          );
        });
        break;
      }

      case 'tool-output-available': {
        updateStreamingMessage(agentId, (parts) => {
          return parts.map(p =>
            p.type === 'tool-card' && p.card.toolCallId === part.toolCallId
              ? { ...p, card: { ...p.card, status: 'complete' as const, result: part.output } }
              : p
          );
        });
        break;
      }

      case 'finish': {
        const streamId = streamingMessageIds.current[agentId];
        if (streamId) {
          delete streamingMessageIds.current[agentId];
          delete activeTextParts.current[agentId];
          delete activeReasoningParts.current[agentId];

          setChatHistories(prev => {
            const current = prev[agentId] ?? [];
            return {
              ...prev,
              [agentId]: current.map(m => {
                if (m.id !== streamId) return m;
                // Mark all parts as done
                const parts = (m.streamParts || []).map(p => {
                  if (p.type === 'text' || p.type === 'reasoning') return { ...p, done: true };
                  return p;
                });
                return { ...m, isStreaming: false, streamParts: parts };
              }),
            };
          });
        }
        break;
      }

      case 'error': {
        const streamId = streamingMessageIds.current[agentId];
        if (streamId) {
          delete streamingMessageIds.current[agentId];
          updateStreamingMessage(agentId, (parts, msg) => {
            return [...parts, {
              type: 'notification' as const,
              chip: { type: 'task-failed' as const, taskId: '', role: agentId, error: part.error },
            }];
          });
          setChatHistories(prev => ({
            ...prev,
            [agentId]: (prev[agentId] ?? []).map(m =>
              m.id === streamId ? { ...m, isStreaming: false } : m,
            ),
          }));
        }
        break;
      }

      // Notification parts — may arrive outside a streaming message
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

        const streamId = streamingMessageIds.current[agentId];
        if (streamId) {
          // Active stream — append inline
          updateStreamingMessage(agentId, (parts) => [...parts, notifPart]);
        } else {
          // No active stream — create a standalone notification message
          const notifMsg: Message = {
            id: `notif-${agentId}-${Date.now()}`,
            role: 'model',
            content: '',
            timestamp: Date.now(),
            isStreaming: false,
            streamParts: [notifPart],
          };
          setChatHistories(prev => ({
            ...prev,
            [agentId]: [...(prev[agentId] ?? []), notifMsg],
          }));
        }
        break;
      }

      default:
        break;
    }
  }, [updateStreamingMessage]);

  const addMessage = useCallback((agentId: string, message: Message) => {
    // Non-delta message: finalize any in-progress stream
    const streamId = streamingMessageIds.current[agentId];
    if (streamId) {
      delete streamingMessageIds.current[agentId];
      setChatHistories(prev => {
        const current = prev[agentId] ?? [];
        const streamMsgExists = current.some(m => m.id === streamId);
        if (streamMsgExists) {
          // Stream was active — finalize it with the complete content and mark done
          return {
            ...prev,
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
          };
        }
        // Stale streamId — fall through to add normally
        return { ...prev, [agentId]: [...current, message] };
      });
      return;
    }

    setChatHistories(prev => ({
      ...prev,
      [agentId]: [...(prev[agentId] ?? []), message],
    }));
  }, []);

  const updateMessages = useCallback((agentId: string, messagesOrSingle: Message[] | Message) => {
    setChatHistories(prev => {
      const current = prev[agentId] ?? [];
      const newMessages = Array.isArray(messagesOrSingle)
        ? messagesOrSingle
        : [...current, messagesOrSingle];
      return { ...prev, [agentId]: newMessages };
    });
  }, []);

  const clearHistory = useCallback((agentId: string) => {
    setChatHistories(prev => ({ ...prev, [agentId]: [] }));
  }, []);

  const getMessages = useCallback((agentId: string): Message[] => {
    return chatHistories[agentId] ?? [];
  }, [chatHistories]);

  /**
   * Load chat history from backend API for an agent.
   * Backend is the source of truth. Merges with any localStorage cache.
   */
  const loadedAgents = useRef(new Set<string>());
  const loadAgentChat = useCallback(async (teamId: string, agentId: string) => {
    // Skip if already loaded this session
    if (loadedAgents.current.has(agentId)) return;
    loadedAgents.current.add(agentId);

    try {
      const response = await fetch(
        `${agentServiceV2.getBaseUrl()}/api/v2/teams/${teamId}/agents/${agentId}/messages?limit=50`
      );
      if (!response.ok) return;

      const { messages } = await response.json();

      // Backend is source of truth — if empty, clear localStorage cache for this agent
      if (!messages?.length) {
        setChatHistories(prev => {
          if (!prev[agentId]?.length) return prev;
          const next = { ...prev };
          delete next[agentId];
          return next;
        });
        return;
      }

      // Convert backend messages to frontend Message format
      const backendMessages: Message[] = messages.map((m: any) => ({
        id: m.id,
        role: m.role === 'assistant' ? 'model' : m.role,
        content: m.content,
        timestamp: new Date(m.timestamp).getTime(),
        isStreaming: false,
        streamParts: m.streamParts ? JSON.parse(m.streamParts) : undefined,
      }));

      // Replace localStorage cache with backend data
      setChatHistories(prev => ({
        ...prev,
        [agentId]: backendMessages,
      }));
    } catch {
      // API unavailable -- use localStorage cache as fallback
    }
  }, []);

  /** Clear all chat histories (e.g., after DB reset) */
  const clearAllHistories = useCallback(() => {
    setChatHistories({});
    localStorage.removeItem('ping:chatHistories');
    loadedAgents.current.clear();
  }, []);

  return {
    chatHistories,
    addMessage,
    processStreamPart,
    updateMessages,
    clearHistory,
    clearAllHistories,
    getMessages,
    loadAgentChat,
  };
}
