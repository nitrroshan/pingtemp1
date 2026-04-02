/**
 * useChat — manages per-agent chat history
 */

import { useState, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Message } from '../types';

const STREAM_DELTA_PREFIX = '__stream_delta__:';

export function useChat() {
  const [chatHistories, setChatHistories] = useState<Record<string, Message[]>>({});
  /** Track the current streaming message ID per agent */
  const streamingMessageIds = useRef<Record<string, string>>({});

  const addMessage = useCallback((agentId: string, message: Message) => {
    // Handle streaming delta accumulation
    if (message.role === 'model' && message.content.startsWith(STREAM_DELTA_PREFIX)) {
      const delta = message.content.slice(STREAM_DELTA_PREFIX.length);
      let streamId = streamingMessageIds.current[agentId];

      setChatHistories(prev => {
        const current = prev[agentId] ?? [];

        if (!streamId) {
          // Create a new streaming message
          streamId = uuidv4();
          streamingMessageIds.current[agentId] = streamId;
          const streamMsg: Message = {
            id: streamId,
            role: 'model',
            content: delta,
            timestamp: message.timestamp,
            isStreaming: true,
          };
          return { ...prev, [agentId]: [...current, streamMsg] };
        }

        // Append delta to existing streaming message
        return {
          ...prev,
          [agentId]: current.map(m =>
            m.id === streamId
              ? { ...m, content: m.content + delta }
              : m,
          ),
        };
      });
      return;
    }

    // Non-delta message: finalize any in-progress stream first
    const streamId = streamingMessageIds.current[agentId];
    if (streamId) {
      delete streamingMessageIds.current[agentId];
      setChatHistories(prev => ({
        ...prev,
        [agentId]: (prev[agentId] ?? []).map(m =>
          m.id === streamId ? { ...m, isStreaming: false } : m,
        ),
      }));
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

  return {
    chatHistories,
    addMessage,
    updateMessages,
    clearHistory,
    getMessages,
  };
}
