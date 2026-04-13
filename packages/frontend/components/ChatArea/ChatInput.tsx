import React, { useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, CornerDownLeft, MessageCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ChatInputProps {
  inputValue: string;
  isStreaming: boolean;
  agentName: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onOpenDiscussions?: () => void;
  discussionUnreadCount?: number;
}

const ChatInput: React.FC<ChatInputProps> = ({
  inputValue,
  isStreaming,
  agentName,
  onInputChange,
  onSubmit,
  onKeyDown,
  onOpenDiscussions,
  discussionUnreadCount = 0,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [inputValue, adjustHeight]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [agentName]);

  const canSubmit = inputValue.trim().length > 0 && !isStreaming;

  return (
    <div className="border-t border-border bg-background/80 px-4 py-3 flex-shrink-0">
      <div className="max-w-3xl mx-auto">
        <div className={cn(
          'flex items-end gap-2 rounded-xl border bg-card transition-colors',
          canSubmit ? 'border-primary/40' : 'border-border'
        )}>
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={e => { onInputChange(e.target.value); adjustHeight(); }}
            onKeyDown={onKeyDown}
            placeholder={`Message ${agentName}…`}
            disabled={isStreaming}
            rows={1}
            className={cn(
              'flex-1 bg-transparent text-foreground text-sm resize-none px-3.5 py-2.5',
              'placeholder:text-muted-foreground focus:outline-none',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'min-h-[40px] max-h-40 font-mono leading-relaxed',
            )}
          />

          <div className="flex items-center gap-1 p-1.5 flex-shrink-0">
            {onOpenDiscussions && (
              <button
                onClick={onOpenDiscussions}
                title="Open discussions"
                className={cn(
                  'relative w-7 h-7 rounded-lg flex items-center justify-center transition-colors',
                  'text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer',
                )}
              >
                <MessageCircle size={14} />
                {discussionUnreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none px-0.5">
                    {discussionUnreadCount > 9 ? '9+' : discussionUnreadCount}
                  </span>
                )}
              </button>
            )}
            <button
              onClick={onSubmit}
              disabled={!canSubmit}
              className={cn(
                'w-7 h-7 rounded-lg flex items-center justify-center transition-colors',
                canSubmit
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              )}
            >
              {isStreaming
                ? <Loader2 size={13} className="animate-spin" />
                : <Send size={13} />
              }
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between mt-1.5 px-1">
          <span className="text-[10px] text-muted-foreground">AI can make mistakes.</span>
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <CornerDownLeft size={9} /> Enter to send
          </span>
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
