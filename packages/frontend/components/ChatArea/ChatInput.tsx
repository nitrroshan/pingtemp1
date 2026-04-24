import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Send, Loader2, CornerDownLeft, MessageCircle, ChevronDown, Check, Zap, Hand, Bot } from 'lucide-react';
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
  autoExecuteEnabled?: boolean;
  onToggleAutoExecute?: () => void;
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
  autoExecuteEnabled = false,
  onToggleAutoExecute,
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

        {/* VS Code-style bottom bar: mode selector + model selector */}
        <div className="flex items-center justify-between mt-1.5 px-1">
          <div className="flex items-center gap-1.5">
            {/* Mode selector (Auto/Manual) */}
            {onToggleAutoExecute && (
              <ModeSelector
                autoEnabled={autoExecuteEnabled}
                onToggle={onToggleAutoExecute}
              />
            )}

            {/* Model selector */}
            <ModelSelector />
          </div>
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <CornerDownLeft size={9} /> Enter to send
          </span>
        </div>
      </div>
    </div>
  );
};

// ── Mode Selector (Auto / Manual) — VS Code Copilot style dropdown ──

function ModeSelector({ autoEnabled, onToggle }: { autoEnabled: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
      >
        {autoEnabled ? <Zap size={10} className="text-emerald-500" /> : <Hand size={10} />}
        <span>{autoEnabled ? 'Auto' : 'Manual'}</span>
        <ChevronDown size={9} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-48 bg-popover border border-border rounded-lg shadow-xl z-50 py-1">
          <button
            onClick={() => { if (!autoEnabled) onToggle(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-popover-foreground hover:bg-accent transition-colors cursor-pointer"
          >
            <Zap size={12} className="text-emerald-500" />
            <div className="flex-1 text-left">
              <div className="font-medium">Auto</div>
              <div className="text-[10px] text-muted-foreground">Tasks execute automatically</div>
            </div>
            {autoEnabled && <Check size={12} className="text-primary" />}
          </button>
          <button
            onClick={() => { if (autoEnabled) onToggle(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-popover-foreground hover:bg-accent transition-colors cursor-pointer"
          >
            <Hand size={12} />
            <div className="flex-1 text-left">
              <div className="font-medium">Manual</div>
              <div className="text-[10px] text-muted-foreground">Review and approve each task</div>
            </div>
            {!autoEnabled && <Check size={12} className="text-primary" />}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Model Selector — dropdown for choosing LLM model ──

const MODELS = [
  { id: 'azure-gpt-4o', label: 'GPT-4o', provider: 'Azure', recommended: true },
  { id: 'azure-gpt-4o-mini', label: 'GPT-4o Mini', provider: 'Azure' },
  { id: 'claude-sonnet-4', label: 'Sonnet 4', provider: 'Anthropic' },
  { id: 'claude-opus-4', label: 'Opus 4', provider: 'Anthropic' },
];

function ModelSelector() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(MODELS[0]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
      >
        <Bot size={10} />
        <span>{selected.label}</span>
        <ChevronDown size={9} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-52 bg-popover border border-border rounded-lg shadow-xl z-50 py-1">
          {MODELS.map(model => (
            <button
              key={model.id}
              onClick={() => { setSelected(model); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-popover-foreground hover:bg-accent transition-colors cursor-pointer"
            >
              <Bot size={12} />
              <div className="flex-1 text-left">
                <div className="font-medium">
                  {model.label}
                  {model.recommended && (
                    <span className="ml-1 text-[9px] text-primary">recommended</span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">{model.provider}</div>
              </div>
              {selected.id === model.id && <Check size={12} className="text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ChatInput;
