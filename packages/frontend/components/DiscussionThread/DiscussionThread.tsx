/**
 * DiscussionThread — Renders a CRDT discussion as a chat timeline
 *
 * Subscribes to Y.Array("discussion") via HocuspocusProvider.
 * Renders agent blocks (🤖) and human blocks (👤) with role badges.
 *
 * @see docs/features/task-orchestration/markdown-tasks/diagrams/06-discussion-channels.md
 */

import React, { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import type { DiscussionBlock, DiscussionConfig, Decision } from "../../hooks/useDiscussion";
import { DiscussionComposer } from "../DiscussionComposer/DiscussionComposer";

interface DiscussionThreadProps {
  blocks: DiscussionBlock[];
  decisions?: Record<string, Decision>;
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
      <div className="text-sm text-foreground pl-6 [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-1 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:my-1 [&_li]:my-0.5 [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:rounded [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:text-xs [&_strong]:font-semibold [&_a]:text-primary [&_a]:underline">
        <Markdown>{block.content}</Markdown>
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

  const tokenPercent = Math.round(((config.totalTokensUsed || 0) / (config.maxTokens || 50000)) * 100);
  const statusBadge: Record<string, string> = {
    active: "🟢 Active",
    all_posted: "🟡 Awaiting Decision",
    decided: "✅ Decided",
    closed: "⬛ Closed",
    escalated: "🔴 Escalated",
  };

  return (
    <div className="px-4 py-1.5 bg-muted/50 border-t border-border text-[10px] text-muted-foreground flex items-center gap-3">
      <span>{statusBadge[config.status] || config.status}</span>
      <span>·</span>
      <span className={tokenPercent > 80 ? "text-yellow-600 dark:text-yellow-400 font-medium" : ""}>
        {(config.totalTokensUsed || 0).toLocaleString()}/{(config.maxTokens || 50000).toLocaleString()} tokens
      </span>
    </div>
  );
}

function AgendaBar({ config }: { config: DiscussionConfig | null }) {
  const agenda = (config as any)?.agenda as Array<{ id: string; text: string; resolved: boolean }>;
  if (!agenda?.length) return null;
  const resolved = agenda.filter((a) => a.resolved).length;
  return (
    <div className="px-4 py-2 bg-muted/30 border-b border-border text-xs">
      <span className="text-[10px] font-semibold text-muted-foreground">
        📋 AGENDA ({resolved}/{agenda.length})
      </span>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
        {agenda.map((item) => (
          <span
            key={item.id}
            className={item.resolved ? "line-through text-muted-foreground" : ""}
          >
            {item.resolved ? "☑" : "☐"} {item.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function ParticipantBar({ config, blocks }: { config: DiscussionConfig | null; blocks: DiscussionBlock[] }) {
  const participants = (config as any)?.participants as string[] || [];
  if (!participants.length) return null;
  const posters = new Set(blocks.map((b) => b.role));
  return (
    <div className="px-4 py-1 text-[10px] text-muted-foreground flex gap-2 border-b border-border">
      {participants.map((p) => (
        <span key={p}>
          {posters.has(p) ? "✅" : "⏳"} {p}
        </span>
      ))}
    </div>
  );
}

function InlineDecision({ decisionKey, decision }: { decisionKey: string; decision: Decision }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-4 my-2 rounded border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 cursor-pointer"
      >
        <span>✅</span>
        <span className="font-semibold">{decisionKey.replace(/-/g, " ")}</span>
        <span className="text-muted-foreground ml-auto text-[10px]">
          {decision.agreedBy.length} agreed · {new Date(decision.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-2 text-xs border-t border-green-200 dark:border-green-800 pt-1 space-y-0.5">
          <p className="italic">"{decision.decision}"</p>
          <p className="text-[10px] text-muted-foreground">
            by {decision.decidedBy} · {decision.agreedBy.map((r) => `✓${r}`).join(" ")}
          </p>
        </div>
      )}
    </div>
  );
}

export function DiscussionThread({
  blocks,
  decisions = {},
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
  const decisionEntries = Object.entries(decisions);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header with lifecycle badge */}
      {!compact && (
        <div className="px-4 py-3 border-b border-border shrink-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
      )}

      {/* Participant status bar */}
      <ParticipantBar config={config} blocks={blocks} />

      {/* Agenda checklist */}
      <AgendaBar config={config} />

      {/* Blocks + inline decisions */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {blocks.length === 0 && decisionEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No discussion blocks yet
          </div>
        ) : (
          <>
            {blocks.map((block) => <BlockItem key={block.id} block={block} />)}
            {decisionEntries.map(([key, decision]) => (
              <InlineDecision key={key} decisionKey={key} decision={decision} />
            ))}
          </>
        )}
      </div>

      {/* Status bar */}
      <StatusBar config={config} />

      {/* Composer — feature-gated, humans are observers for now */}
      {!isClosed && import.meta.env.VITE_ENABLE_DISCUSSION_COMPOSER === "true" && (
        <DiscussionComposer
          teamRoles={teamRoles}
          onPost={onPost}
          disabled={isClosed}
        />
      )}
    </div>
  );
}
