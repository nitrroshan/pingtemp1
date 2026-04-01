import React, { useRef, useEffect } from 'react';
import { Bot, User } from 'lucide-react';
import { Message } from '../../types';

interface MessageListProps {
  messages: Message[];
  isStreaming: boolean;
  agentName: string;
}

const MessageList: React.FC<MessageListProps> = ({ messages, isStreaming, agentName }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50 select-none">
        <Bot size={64} className="mb-4 stroke-1" />
        <p className="text-lg font-light">Start a conversation with {agentName}</p>
      </div>
    );
  }

  return (
    <>
      {messages.map((msg) => (
        <div 
          key={msg.id} 
          className={`flex gap-4 max-w-4xl mx-auto ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
        >
          <div className={`
            w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center
            ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-nexus-cyan text-nexus-950'}
          `}>
            {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
          </div>

          <div className={`
            group relative px-4 py-3 rounded-2xl text-sm leading-relaxed max-w-[85%] shadow-lg
            ${msg.role === 'user' 
              ? 'bg-nexus-800 text-slate-100 rounded-tr-sm border border-nexus-700' 
              : msg.isError 
                ? 'bg-red-900/20 text-red-200 border border-red-800 rounded-tl-sm'
                : 'bg-slate-900 text-slate-300 rounded-tl-sm border border-nexus-800'}
          `}>
            <div className="whitespace-pre-wrap font-mono text-[13px]">{msg.content}</div>
            <div className="opacity-0 group-hover:opacity-100 absolute -bottom-5 right-0 text-[10px] text-slate-600 transition-opacity">
              {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
            </div>
          </div>
        </div>
      ))}
      
      {isStreaming && messages[messages.length - 1]?.role === 'user' && (
        <div className="flex gap-4 max-w-4xl mx-auto">
          <div className="w-8 h-8 rounded-lg bg-nexus-cyan text-nexus-950 flex-shrink-0 flex items-center justify-center">
            <Bot size={16} />
          </div>
          <div className="flex items-center gap-1 h-10 px-4 bg-slate-900 rounded-2xl rounded-tl-sm border border-nexus-800">
            <div className="w-1.5 h-1.5 bg-nexus-cyan rounded-full typing-dot"></div>
            <div className="w-1.5 h-1.5 bg-nexus-cyan rounded-full typing-dot"></div>
            <div className="w-1.5 h-1.5 bg-nexus-cyan rounded-full typing-dot"></div>
          </div>
        </div>
      )}
      
      <div ref={messagesEndRef} />
    </>
  );
};

export default MessageList;
