/**
 * ToolCard — Expandable tool call card
 *
 * Shows tool lifecycle: calling → streaming-args → executing → complete/error
 *
 * Special rendering by toolName:
 *   create_plan      → "Planning…" header
 *   approve_plan     → approval context
 *   get_status       → status check indicator
 *   get_context      → context retrieval
 *   default          → generic args/output card
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import type { ToolCardState } from '../types';

interface ToolCardProps {
  card: ToolCardState;
}

const TOOL_LABELS: Record<string, string> = {
  create_plan: '📋 Creating plan…',
  approve_plan: '✅ Approving plan',
  get_status: '📊 Checking task status',
  get_context: '📂 Retrieving context',
  report_status: '📡 Reporting status',
  complete_task: '✔️ Completing task',
};

function getToolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] || toolName;
}

function StatusIcon({ status }: { status: ToolCardState['status'] }) {
  switch (status) {
    case 'calling':
    case 'streaming-args':
    case 'executing':
      return <Loader2 size={12} className="animate-spin text-primary" />;
    case 'complete':
      return <CheckCircle size={12} className="text-emerald-600 dark:text-emerald-400" />;
    case 'error':
      return <AlertCircle size={12} className="text-red-600 dark:text-red-400" />;
    default:
      return <Wrench size={12} className="text-muted-foreground" />;
  }
}

function tryParseJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

const ToolCard: React.FC<ToolCardProps> = ({ card }) => {
  const [expanded, setExpanded] = useState(false);

  const label = getToolLabel(card.toolName);
  const hasOutput = card.status === 'complete' && card.result !== undefined;
  const hasArgs = card.argsText.length > 0;

  return (
    <div className="my-1 border border-border rounded-lg bg-muted/40 text-xs overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-accent/50 transition-colors cursor-pointer"
      >
        {expanded ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
        <StatusIcon status={card.status} />
        <span className="text-foreground/80 font-medium">{label}</span>
        {card.status === 'complete' && (
          <span className="ml-auto text-[10px] text-emerald-600 dark:text-emerald-500">done</span>
        )}
        {card.status === 'error' && (
          <span className="ml-auto text-[10px] text-red-600 dark:text-red-400">error</span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border divide-y divide-border">
          {/* Args */}
          {hasArgs && (
            <div className="px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide font-semibold">Input</p>
              <pre className="text-[11px] text-foreground/70 font-mono overflow-x-auto max-h-32 whitespace-pre-wrap">
                {tryParseJson(card.argsText)}
                {card.status === 'streaming-args' && <span className="animate-pulse">▍</span>}
              </pre>
            </div>
          )}

          {/* Result */}
          {hasOutput && (
            <div className="px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide font-semibold">Output</p>
              <pre className="text-[11px] text-foreground/70 font-mono overflow-x-auto max-h-48 whitespace-pre-wrap">
                {typeof card.result === 'string'
                  ? card.result.slice(0, 500)
                  : JSON.stringify(card.result, null, 2)}
              </pre>
            </div>
          )}

          {/* Error */}
          {card.status === 'error' && card.errorMessage && (
            <div className="px-3 py-2">
              <p className="text-[11px] text-red-600 dark:text-red-400">{card.errorMessage}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ToolCard;
