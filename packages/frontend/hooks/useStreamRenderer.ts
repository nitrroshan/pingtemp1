/**
 * useStreamRenderer — Process `stream` Socket.IO events into StreamState
 *
 * Listens to the single `stream` channel and accumulates typed parts
 * into a structured StreamState for rendering by StreamMessage.
 *
 * Returns:
 *   - streamStates: Map<messageId, StreamState>
 *   - activeStreamId: ID of the currently streaming message (or null)
 *   - clearStream: remove a completed stream from state
 */

import { useState, useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { StreamState, StreamPayload, StreamPart, ToolCardState, RenderedPart } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Initial state helpers
// ─────────────────────────────────────────────────────────────────────────────

function createStreamState(messageId: string): StreamState {
  return {
    messageId,
    parts: [],
    textParts: new Map(),
    reasoningParts: new Map(),
    toolCards: new Map(),
    isFinished: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useStreamRenderer() {
  const [streamStates, setStreamStates] = useState<Map<string, StreamState>>(new Map());
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);

  // Use ref for mutable state to avoid stale closures in the event handler
  const streamStatesRef = useRef<Map<string, StreamState>>(new Map());

  const updateState = useCallback((updater: (prev: Map<string, StreamState>) => Map<string, StreamState>) => {
    const next = updater(streamStatesRef.current);
    streamStatesRef.current = next;
    setStreamStates(new Map(next));
  }, []);

  /**
   * Process a single stream payload from Socket.IO.
   * Call this in a socket.on('stream', handler).
   */
  const processStreamPayload = useCallback((payload: StreamPayload) => {
    const { part, agentId } = payload;
    processPart(part, agentId, updateState, setActiveStreamId);
  }, [updateState]);

  /**
   * Clear a finished stream state (call after message is committed to history).
   */
  const clearStream = useCallback((messageId: string) => {
    updateState(prev => {
      const next = new Map(prev);
      next.delete(messageId);
      return next;
    });
    setActiveStreamId(prev => (prev === messageId ? null : prev));
  }, [updateState]);

  return {
    streamStates,
    activeStreamId,
    processStreamPayload,
    clearStream,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Part processor
// ─────────────────────────────────────────────────────────────────────────────

let currentMessageId = '';

function processPart(
  part: StreamPart,
  agentId: string,
  updateState: (updater: (prev: Map<string, StreamState>) => Map<string, StreamState>) => void,
  setActiveStreamId: Dispatch<SetStateAction<string | null>>,
): void {
  switch (part.type) {
    // ── Session lifecycle ────────────────────────────────────────────────────
    case 'start': {
      currentMessageId = part.messageId;
      setActiveStreamId(part.messageId);
      updateState(prev => {
        const next = new Map(prev);
        next.set(part.messageId, createStreamState(part.messageId));
        return next;
      });
      break;
    }

    case 'finish': {
      updateState(prev => {
        const next = new Map(prev);
        const state = next.get(currentMessageId);
        if (state) {
          // Mark all active text/reasoning parts as done
          state.textParts.forEach(p => { p.done = true; });
          state.reasoningParts.forEach(p => { p.done = true; });
          state.isFinished = true;
          if (part.usage) state.usage = part.usage;
          next.set(currentMessageId, { ...state });
        }
        return next;
      });
      setActiveStreamId(null);
      break;
    }

    case 'abort': {
      updateState(prev => {
        const next = new Map(prev);
        const state = next.get(currentMessageId);
        if (state) {
          state.isFinished = true;
          next.set(currentMessageId, { ...state });
        }
        return next;
      });
      setActiveStreamId(null);
      break;
    }

    // ── Text streaming ───────────────────────────────────────────────────────
    case 'text-start': {
      updateState(prev => {
        const next = new Map(prev);
        const state = next.get(currentMessageId);
        if (!state) return next;
        const textPart: RenderedPart & { type: 'text' } = {
          type: 'text', id: part.id, text: '', done: false,
        };
        state.textParts.set(part.id, textPart);
        state.parts.push(textPart);
        next.set(currentMessageId, { ...state });
        return next;
      });
      break;
    }

    case 'text-delta': {
      updateState(prev => {
        const next = new Map(prev);
        const state = next.get(currentMessageId);
        if (!state) return next;
        let textPart = state.textParts.get(part.id);
        if (!textPart) {
          // Auto-create text part if text-start was missed
          textPart = { type: 'text', id: part.id, text: '', done: false };
          state.textParts.set(part.id, textPart);
          state.parts.push(textPart);
        }
        textPart.text += part.delta;
        next.set(currentMessageId, { ...state });
        return next;
      });
      break;
    }

    case 'text-end': {
      updateState(prev => {
        const next = new Map(prev);
        const state = next.get(currentMessageId);
        if (!state) return next;
        const textPart = state.textParts.get(part.id);
        if (textPart) textPart.done = true;
        next.set(currentMessageId, { ...state });
        return next;
      });
      break;
    }

    // ── Reasoning ────────────────────────────────────────────────────────────
    case 'reasoning-start': {
      updateState(prev => {
        const next = new Map(prev);
        const state = next.get(currentMessageId);
        if (!state) return next;
        const reasoningPart: RenderedPart & { type: 'reasoning' } = {
          type: 'reasoning', id: part.id, text: '', done: false,
        };
        state.reasoningParts.set(part.id, reasoningPart);
        state.parts.push(reasoningPart);
        next.set(currentMessageId, { ...state });
        return next;
      });
      break;
    }

    case 'reasoning-delta': {
      updateState(prev => {
        const next = new Map(prev);
        const state = next.get(currentMessageId);
        if (!state) return next;
        let reasoningPart = state.reasoningParts.get(part.id);
        if (!reasoningPart) {
          reasoningPart = { type: 'reasoning', id: part.id, text: '', done: false };
          state.reasoningParts.set(part.id, reasoningPart);
          state.parts.push(reasoningPart);
        }
        reasoningPart.text += part.delta;
        next.set(currentMessageId, { ...state });
        return next;
      });
      break;
    }

    case 'reasoning-end': {
      updateState(prev => {
        const next = new Map(prev);
        const state = next.get(currentMessageId);
        if (!state) return next;
        const rp = state.reasoningParts.get(part.id);
        if (rp) rp.done = true;
        next.set(currentMessageId, { ...state });
        return next;
      });
      break;
    }

    // ── Tool calls ───────────────────────────────────────────────────────────
    case 'tool-input-start': {
      updateState(prev => {
        const next = new Map(prev);
        const state = next.get(currentMessageId);
        if (!state) return next;
        const card: ToolCardState = {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          status: 'streaming-args',
          argsText: '',
        };
        state.toolCards.set(part.toolCallId, card);
        state.parts.push({ type: 'tool-card', card });
        next.set(currentMessageId, { ...state });
        return next;
      });
      break;
    }

    case 'tool-input-delta': {
      updateState(prev => {
        const next = new Map(prev);
        const state = next.get(currentMessageId);
        if (!state) return next;
        const card = state.toolCards.get(part.toolCallId);
        if (card) {
          card.argsText += part.delta;
          card.status = 'streaming-args';
        }
        next.set(currentMessageId, { ...state });
        return next;
      });
      break;
    }

    case 'tool-input-available': {
      updateState(prev => {
        const next = new Map(prev);
        const state = next.get(currentMessageId);
        if (!state) return next;
        let card = state.toolCards.get(part.toolCallId);
        if (!card) {
          card = {
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            status: 'executing',
            argsText: JSON.stringify(part.input, null, 2),
            args: part.input,
          };
          state.toolCards.set(part.toolCallId, card);
          state.parts.push({ type: 'tool-card', card });
        } else {
          card.status = 'executing';
          card.args = part.input;
          card.argsText = JSON.stringify(part.input, null, 2);
        }
        next.set(currentMessageId, { ...state });
        return next;
      });
      break;
    }

    case 'tool-output-available': {
      updateState(prev => {
        const next = new Map(prev);
        const state = next.get(currentMessageId);
        if (!state) return next;
        const card = state.toolCards.get(part.toolCallId);
        if (card) {
          card.status = 'complete';
          card.result = part.output;
        }
        next.set(currentMessageId, { ...state });
        return next;
      });
      break;
    }

    // ── Notifications ────────────────────────────────────────────────────────
    case 'task-started':
    case 'task-completed':
    case 'task-failed':
    case 'plan-proposed':
    case 'plan-approved': {
      // Use currentMessageId if valid, otherwise create a standalone notification stream
      const notifId = currentMessageId || `notif-${agentId}`;
      updateState(prev => {
        const next = new Map(prev);
        const state = next.get(notifId) ?? createStreamState(notifId);
        const chip: RenderedPart = {
          type: 'notification',
          chip: {
            type: part.type,
            ...('taskId' in part ? { taskId: part.taskId } : {}),
            ...('role' in part ? { role: (part as any).role } : {}),
            ...('error' in part ? { error: (part as any).error } : {}),
          },
        };
        state.parts.push(chip);
        next.set(state.messageId, { ...state });
        return next;
      });
      break;
    }

    // ── Errors ───────────────────────────────────────────────────────────────
    case 'error': {
      updateState(prev => {
        const next = new Map(prev);
        const state = next.get(currentMessageId);
        if (state) {
          state.parts.push({
            type: 'notification',
            chip: { type: 'task-failed', taskId: '', role: '', error: part.error },
          });
          state.isFinished = true;
          next.set(currentMessageId, { ...state });
        }
        return next;
      });
      setActiveStreamId(null);
      break;
    }

    default:
      break;
  }
}
