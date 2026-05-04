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
import Markdown from 'react-markdown';
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
  // Check if there are any renderable text parts
  const hasTextParts = parts.some(p => p.type === 'text');

  if (parts.length === 0 || (!hasTextParts && fallbackContent)) {
    return (
      <div className="space-y-0.5">
        <div className="text-sm [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-1 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:my-1 [&_li]:my-0.5 [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:rounded [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:text-xs [&_strong]:font-semibold [&_a]:text-primary [&_a]:underline">
          <Markdown>{fallbackContent || ''}</Markdown>
          {isStreaming && <span className="animate-pulse text-primary">▍</span>}
        </div>
        {/* Render any tool-card parts that exist alongside fallback text */}
        {parts.filter(p => p.type === 'tool-card').map((part, idx) => (
          <ToolCard key={`tool-${(part as any).card?.toolCallId}-${idx}`} card={(part as any).card} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {parts.map((part, idx) => {
        switch (part.type) {
          case 'text':
            return (
              <div key={`text-${part.id}-${idx}`} className="text-sm [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-1 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:my-1 [&_li]:my-0.5 [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:rounded [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:text-xs [&_strong]:font-semibold [&_a]:text-primary [&_a]:underline">
                <Markdown>{part.text}</Markdown>
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
