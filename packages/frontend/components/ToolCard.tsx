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
  ask_user: '💬 Question for you',
  tell_user: '📢 Update',
  discuss_approach: '🤔 Decision needed',
  submit_plan: '📋 Submitting plan',
  request_approval: '✅ Requesting approval',
  research_domain: '🔍 Researching',
  analyze_requirements: '📐 Analyzing requirements',
  get_team_capabilities: '👥 Checking team',
  cancel_task: '⛔ Cancelling task',
  get_blocked: '🚫 Checking blocked tasks',
  get_critical_path: '📈 Critical path',
  search_agents: '🔎 Searching agents',
  update_task: '✏️ Updating task',
  add_tasks: '➕ Adding tasks',
  remove_task: '🗑️ Removing task',
  reprioritize: '🔄 Reprioritizing',
  reassign_task: '↪️ Reassigning task',
  replan: '🔄 Replanning',
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

/** Tools that should auto-expand and show user-friendly content */
const USER_INTERACTION_TOOLS = new Set(['ask_user', 'tell_user', 'discuss_approach']);

/** Extract question/message from tool args JSON */
function extractUserContent(toolName: string, argsText: string): string | null {
  if (!USER_INTERACTION_TOOLS.has(toolName)) return null;
  try {
    const args = JSON.parse(argsText);
    if (toolName === 'ask_user') return args.question;
    if (toolName === 'tell_user') return args.message;
    if (toolName === 'discuss_approach') {
      let text = args.summary || '';
      if (args.options?.length) {
        text += '\n\n' + args.options.map((o: any, i: number) =>
          `${i + 1}. **${o.label}**${o.description ? `: ${o.description}` : ''}`
        ).join('\n');
      }
      if (args.recommendation) text += `\n\n_Recommendation: ${args.recommendation}_`;
      return text;
    }
  } catch {
    // Args still streaming, try partial parse
    const match = argsText.match(/"(?:question|message|summary)"\s*:\s*"([^"]*)/);
    if (match) return match[1] + (argsText.endsWith('"') ? '' : '…');
  }
  return null;
}

const ToolCard: React.FC<ToolCardProps> = ({ card }) => {
  const isUserTool = USER_INTERACTION_TOOLS.has(card.toolName);
  const [expanded, setExpanded] = useState(isUserTool); // Auto-expand user interaction tools

  const label = getToolLabel(card.toolName);
  const hasOutput = card.status === 'complete' && card.result !== undefined;
  const hasArgs = card.argsText.length > 0;
  const userContent = extractUserContent(card.toolName, card.argsText);

  return (
    <div className={`my-1 border rounded-lg text-xs overflow-hidden ${
      isUserTool
        ? 'border-primary/30 bg-primary/5'
        : 'border-border bg-muted/40'
    }`}>
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
          {/* User interaction tools: show question/message as readable text */}
          {isUserTool && userContent && (
            <div className="px-3 py-2">
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {userContent}
                {card.status === 'streaming-args' && <span className="animate-pulse ml-1">▍</span>}
              </p>
              {card.toolName === 'ask_user' && card.status !== 'complete' && (
                <p className="text-[10px] text-muted-foreground mt-2 italic">
                  Type your answer in the chat input below
                </p>
              )}
            </div>
          )}

          {/* Non-user tools OR user tools without parsed content: show raw args */}
          {!isUserTool && hasArgs && (
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
