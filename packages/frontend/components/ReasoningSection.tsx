/**
 * ReasoningSection — Collapsible thinking/reasoning block
 *
 * Shows the agent's chain-of-thought streamed from AI SDK reasoning.
 * Collapsed by default. Streams incrementally.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Brain } from 'lucide-react';

interface ReasoningSectionProps {
  text: string;
  done: boolean;
}

const ReasoningSection: React.FC<ReasoningSectionProps> = ({ text, done }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1 border border-nexus-800 rounded-lg bg-nexus-950/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Brain size={12} className="text-purple-400" />
        <span className="font-medium">
          {done ? 'Thought process' : 'Thinking…'}
        </span>
        {!done && (
          <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse ml-1" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-nexus-800">
          <p className="text-[11px] text-slate-500 font-mono whitespace-pre-wrap leading-relaxed mt-2">
            {text}
            {!done && <span className="animate-pulse">▍</span>}
          </p>
        </div>
      )}
    </div>
  );
};

export default ReasoningSection;
