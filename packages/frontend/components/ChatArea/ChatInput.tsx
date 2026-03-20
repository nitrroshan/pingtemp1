import React, { useRef, useEffect } from 'react';
import { Send } from 'lucide-react';

interface ChatInputProps {
  inputValue: string;
  isStreaming: boolean;
  agentName: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

const ChatInput: React.FC<ChatInputProps> = ({
  inputValue,
  isStreaming,
  agentName,
  onInputChange,
  onSubmit,
  onKeyDown
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [agentName]);

  return (
    <div className="p-4 bg-nexus-950 border-t border-nexus-800/50">
      <div className="max-w-4xl mx-auto relative group">
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Message ${agentName}...`}
          className="w-full bg-nexus-900 text-slate-200 rounded-xl pl-4 pr-12 py-3.5 focus:outline-none focus:ring-1 focus:ring-nexus-cyan/50 border border-nexus-800 transition-all resize-none shadow-lg placeholder:text-slate-600 font-mono text-sm h-14 max-h-40"
          disabled={isStreaming}
        />
        <button
          onClick={onSubmit}
          disabled={!inputValue.trim() || isStreaming}
          className={`
            absolute right-2 top-2 p-2 rounded-lg transition-all duration-200
            ${inputValue.trim() && !isStreaming 
              ? 'bg-nexus-cyan text-nexus-950 hover:bg-cyan-400 hover:shadow-[0_0_15px_rgba(6,182,212,0.4)]' 
              : 'bg-nexus-800 text-slate-600 cursor-not-allowed'}
          `}
        >
          <Send size={16} className={inputValue.trim() && !isStreaming ? 'ml-0.5' : ''} />
        </button>
      </div>
      <div className="text-center mt-2">
        <span className="text-[10px] text-slate-600">Gemini 2.5 Flash • AI can make mistakes.</span>
      </div>
    </div>
  );
};

export default ChatInput;
