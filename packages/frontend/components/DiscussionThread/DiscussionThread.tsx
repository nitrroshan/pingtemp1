/**
 * DiscussionThread — Renders a CRDT discussion as a chat timeline
 *
 * Subscribes to Y.Array("discussion") via HocuspocusProvider.
 * Renders agent blocks (🤖) and human blocks (👤) with role badges.
 *
 * @see docs/features/task-orchestration/markdown-tasks/diagrams/06-discussion-channels.md
 */

import React, { useEffect, useRef } from "react";
import type { DiscussionBlock, DiscussionConfig } from "../../hooks/useDiscussion";
import { DiscussionComposer } from "../DiscussionComposer/DiscussionComposer";

interface DiscussionThreadProps {
  blocks: DiscussionBlock[];
  config: DiscussionConfig | null;
  title: string;
  subtitle?: string;
  teamRoles?: string[];
  onPost: (content: string, type: DiscussionBlock["type"], mentions?: string[]) => void;
  compact?: boolean;
}

function isHumanRole(role: string): boolean {
  return role.startsWith("user:");
}

function getRoleDisplay(role: string): { icon: string; name: string; context?: string } {
  if (role.startsWith("user:")) {
    const agentRole = role.slice(5);
    return { icon: "👤", name: agentRole || "User", context: agentRole };
  }
  return { icon: "🤖", name: role };
}

function formatTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function BlockItem({ block }: { block: DiscussionBlock }) {
  const { icon, name, context } = getRoleDisplay(block.role);
  const isDecision = block.type === "decision";
  const isQuestion = block.type === "question";

  return (
    <div
      className={`px-4 py-3 border-b border-border/50 ${
        isDecision ? "bg-green-50 dark:bg-green-950/20 border-l-2 border-l-green-500" : ""
      } ${isQuestion ? "border-l-2 border-l-yellow-500" : ""}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-semibold text-foreground">
          {block.displayName || name}
        </span>
        {context && (
          <span className="text-[10px] text-muted-foreground">({context})</span>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto">
          {formatTime(block.timestamp)}
        </span>
        {isDecision && (
          <span className="text-[10px] bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded font-medium">
            ✅ DECISION
          </span>
        )}
        {isQuestion && (
          <span className="text-[10px] bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 px-1.5 py-0.5 rounded font-medium">
            ❓ QUESTION
          </span>
        )}
      </div>
      <div className="text-sm text-foreground whitespace-pre-wrap pl-6">
        {block.content}
      </div>
      {block.mentions.length > 0 && (
        <div className="flex gap-1 mt-1 pl-6">
          {block.mentions.map((m) => (
            <span
              key={m}
              className="text-[10px] bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded"
            >
              @{m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBar({ config }: { config: DiscussionConfig | null }) {
  if (!config) return null;

  const totalRounds = Object.values(config.roundsPerAgent || {}).reduce((a, b) => a + b, 0);
  const maxRoundsTotal = (config.maxRounds || 10) * Object.keys(config.roundsPerAgent || {}).length || 1;
  const tokenPercent = Math.round(((config.totalTokensUsed || 0) / (config.maxTokens || 50000)) * 100);

  return (
    <div className="px-4 py-1.5 bg-muted/50 border-t border-border text-[10px] text-muted-foreground flex items-center gap-3">
      <span>⚡ {config.mode || "auto"} mode</span>
      <span>·</span>
      <span>
        {totalRounds} rounds
      </span>
      <span>·</span>
      <span className={tokenPercent > 80 ? "text-yellow-600 dark:text-yellow-400 font-medium" : ""}>
        {(config.totalTokensUsed || 0).toLocaleString()}/{(config.maxTokens || 50000).toLocaleString()} tokens ({tokenPercent}%)
      </span>
      {config.status !== "active" && (
        <>
          <span>·</span>
          <span className="font-medium text-red-500">{config.status}</span>
        </>
      )}
    </div>
  );
}

export function DiscussionThread({
  blocks,
  config,
  title,
  subtitle,
  teamRoles = [],
  onPost,
  compact = false,
}: DiscussionThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new blocks
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [blocks.length]);

  const isClosed = config?.status === "closed" || config?.status === "escalated";

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      {!compact && (
        <div className="px-4 py-3 border-b border-border shrink-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
      )}

      {/* Blocks */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {blocks.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No discussion blocks yet
          </div>
        ) : (
          blocks.map((block) => <BlockItem key={block.id} block={block} />)
        )}
      </div>

      {/* Status bar */}
      <StatusBar config={config} />

      {/* Composer */}
      {!isClosed && (
        <DiscussionComposer
          teamRoles={teamRoles}
          onPost={onPost}
          disabled={isClosed}
        />
      )}
    </div>
  );
}
