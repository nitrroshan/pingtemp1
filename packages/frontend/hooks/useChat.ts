/**
 * useChat — manages per-agent chat history
 */

import { useState, useCallback } from 'react';
import type { Message } from '../types';

export function useChat() {
  const [chatHistories, setChatHistories] = useState<Record<string, Message[]>>({});

  const addMessage = useCallback((agentId: string, message: Message) => {
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
