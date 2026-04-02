import React, { useRef, useEffect } from 'react';
import { Bot, User, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Skeleton } from '../ui/skeleton';
import type { Message } from '../../types';
import { AnimatePresence, motion } from 'framer-motion';

interface MessageListProps {
  messages: Message[];
  isStreaming: boolean;
  agentName: string;
}

// ─── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ agentName }: { agentName: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground select-none py-16">
      <div className="w-40 h-32 rounded-2xl border border-border/70 bg-card/50 p-4">
        <svg viewBox="0 0 220 140" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <rect x="16" y="20" width="188" height="98" rx="14" className="fill-muted/30 stroke-border" />
          <rect x="34" y="38" width="72" height="10" rx="5" className="fill-muted" />
          <rect x="34" y="56" width="132" height="8" rx="4" className="fill-muted/70" />
          <rect x="34" y="70" width="104" height="8" rx="4" className="fill-muted/60" />
          <circle cx="182" cy="46" r="14" className="fill-primary/20 stroke-primary/50" />
          <path d="M175 46h14M182 39v14" className="stroke-primary" strokeWidth="2" strokeLinecap="round" />
          <path d="M62 108c6-8 18-8 24 0" className="stroke-muted-foreground/60" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">Start a conversation</p>
        <p className="text-xs text-muted-foreground mt-1">Send a message to {agentName}</p>
      </div>
    </div>
  );
}

// ─── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  const isError = msg.isError;
  const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={cn('flex gap-3 max-w-3xl', isUser ? 'ml-auto flex-row-reverse' : 'mr-auto')}>
      {/* Avatar */}
      <div className={cn(
        'w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center mt-0.5',
        isUser ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
        isError && 'bg-destructive/20 text-destructive'
      )}>
        {isError
          ? <AlertTriangle size={13} />
          : isUser
            ? <User size={13} />
            : <Bot size={13} />
        }
      </div>

      {/* Bubble */}
      <div className="flex flex-col gap-1 min-w-0">
        <div className={cn(
          'px-3.5 py-2.5 rounded-xl text-sm leading-relaxed',
          isUser
            ? 'bg-primary/10 text-foreground border border-primary/20 rounded-tr-sm'
            : isError
              ? 'bg-destructive/10 text-red-300 border border-destructive/30 rounded-tl-sm'
              : 'bg-card text-foreground border border-border rounded-tl-sm'
        )}>
          <div className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed break-words">
            {msg.content}
          </div>
        </div>
        <span className={cn('text-[10px] text-muted-foreground', isUser && 'text-right')}>
          {time}
        </span>
      </div>
    </div>
  );
}

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-3 mr-auto">
      <div className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center mt-0.5">
        <Bot size={13} className="text-secondary-foreground" />
      </div>
      <div className="flex items-center gap-1 h-10 px-3.5 bg-card border border-border rounded-xl rounded-tl-sm">
        <div className="w-1.5 h-1.5 bg-primary rounded-full typing-dot" />
        <div className="w-1.5 h-1.5 bg-primary rounded-full typing-dot" />
        <div className="w-1.5 h-1.5 bg-primary rounded-full typing-dot" />
      </div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="flex gap-3">
          <Skeleton className="w-7 h-7 rounded-lg flex-shrink-0" />
          <div className="flex flex-col gap-1.5 flex-1">
            <Skeleton className="h-4 w-3/4 rounded-lg" />
            <Skeleton className="h-4 w-1/2 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── MessageList ──────────────────────────────────────────────────────────────

const MessageList: React.FC<MessageListProps> = ({ messages, isStreaming, agentName }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  if (messages.length === 0 && !isStreaming) {
    return <EmptyState agentName={agentName} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <AnimatePresence initial={false}>
        {messages.map(msg => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <MessageBubble msg={msg} />
          </motion.div>
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {isStreaming && messages[messages.length - 1]?.role === 'user' && (
          <motion.div
            key="typing"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
          >
            <TypingIndicator />
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={bottomRef} />
    </div>
  );
};

export default MessageList;
export { MessageSkeleton };
