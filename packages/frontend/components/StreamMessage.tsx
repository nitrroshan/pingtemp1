/**
 * StreamMessage — Renders a streaming or completed message with rich content
 *
 * Renders RenderedPart[] in order:
 *   text        → incremental text with typing cursor
 *   reasoning   → ReasoningSection (collapsible)
 *   tool-card   → ToolCard (expandable)
 *   notification→ NotificationChip (inline)
 *
 * For completed (non-streaming) messages, falls back to plain text rendering.
 */

import React from 'react';
import type { RenderedPart } from '../types';
import ReasoningSection from './ReasoningSection';
import ToolCard from './ToolCard';
import NotificationChip from './NotificationChip';

interface StreamMessageProps {
  parts: RenderedPart[];
  isStreaming: boolean;
  /** Fallback plain text for non-streaming messages */
  fallbackContent?: string;
}

const StreamMessage: React.FC<StreamMessageProps> = ({ parts, isStreaming, fallbackContent }) => {
  if (parts.length === 0) {
    return (
      <div className="whitespace-pre-wrap font-mono text-[13px]">
        {fallbackContent || ''}
        {isStreaming && <span className="animate-pulse text-primary">▍</span>}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {parts.map((part, idx) => {
        switch (part.type) {
          case 'text':
            return (
              <div key={`text-${part.id}-${idx}`} className="whitespace-pre-wrap font-mono text-[13px]">
                {part.text}
                {!part.done && isStreaming && (
                  <span className="animate-pulse text-primary">▍</span>
                )}
              </div>
            );

          case 'reasoning':
            return (
              <ReasoningSection
                key={`reasoning-${part.id}-${idx}`}
                text={part.text}
                done={part.done}
              />
            );

          case 'tool-card':
            return (
              <ToolCard
                key={`tool-${part.card.toolCallId}-${idx}`}
                card={part.card}
              />
            );

          case 'notification':
            return (
              <div key={`chip-${idx}`} className="flex">
                <NotificationChip chip={part.chip} />
              </div>
            );

          default:
            return null;
        }
      })}
    </div>
  );
};

export default StreamMessage;
