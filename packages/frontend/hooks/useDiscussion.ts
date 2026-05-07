/**
 * Discussion Types & Hook — Shared types for the discussion UI system
 *
 * @see docs/features/task-orchestration/markdown-tasks/diagrams/05-discussion-event-flow.md
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { HocuspocusProvider } from "@hocuspocus/provider";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface DiscussionBlock {
  id: string;
  role: string;              // "architect", "frontend-dev", "user:backend-dev"
  userId?: string;           // for human blocks
  displayName?: string;      // for human blocks
  timestamp: string;         // ISO 8601
  content: string;           // markdown text
  mentions: string[];        // ["frontend-dev", "planner"]
  replyTo?: string;
  type: "message" | "decision" | "question";
  tokens: number;
}

export interface Decision {
  decision: string;
  decidedBy: string;
  agreedBy: string[];
  timestamp: string;
}

export interface DiscussionConfig {
  maxRounds: number;
  maxTokens: number;
  timeoutMinutes: number;
  totalTokensUsed: number;
  roundsPerAgent: Record<string, number>;
  mode: "auto" | "manual";
  status: "active" | "all_posted" | "decided" | "wrapping-up" | "closed" | "escalated";
  lastActivity: string;
}

export interface DiscussionThread {
  docName: string;           // e.g., "task-003/discussion"
  taskId: string;
  title: string;
  participants: string[];
  blockCount: number;
  status: "active" | "resolved";
  unreadCount: number;
  lastActivity: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook: useDiscussion — connects to a single discussion CRDT doc
// ═══════════════════════════════════════════════════════════════════════════════

interface UseDiscussionOptions {
  serverUrl?: string;
  teamId: string;
  goalId: string;
  taskId: string;
  token?: string;
}

interface UseDiscussionReturn {
  blocks: DiscussionBlock[];
  decisions: Record<string, Decision>;
  config: DiscussionConfig | null;
  status: "connecting" | "connected" | "error";
  postBlock: (content: string, type: DiscussionBlock["type"], mentions?: string[]) => void;
  postDecision: (key: string, decision: string) => void;
  provider: HocuspocusProvider | null;
}

export function useDiscussion({
  serverUrl = import.meta.env.VITE_HOCUSPOCUS_URL || "ws://localhost:1234",
  teamId,
  goalId,
  taskId,
  token,
}: UseDiscussionOptions): UseDiscussionReturn {
  const [blocks, setBlocks] = useState<DiscussionBlock[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [config, setConfig] = useState<DiscussionConfig | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);

  const docName = `${teamId}/${goalId}/${taskId}/discussion`;

  useEffect(() => {
    let cancelled = false;
    setStatus("connecting");

    const p = new HocuspocusProvider({
      url: serverUrl,
      name: docName,
      token: token || undefined,
      onStatus: ({ status: s }) => {
        if (!cancelled && s === "connected") setStatus("connected");
      },
      onDisconnect: () => {
        // Suppress "WebSocket closed before connection established" during StrictMode cleanup
      },
    });

    providerRef.current = p;
    setProvider(p);

    // Safe observer wrapper — catches Yjs "mismatched transaction" from stale state
    const safeObserve = <T,>(fn: () => T): T | undefined => {
      try { return fn(); } catch (err) {
        if (err instanceof RangeError && String(err).includes('mismatched')) {
          console.warn('[useDiscussion] Yjs mismatched transaction — stale state, clearing local cache');
          return undefined;
        }
        throw err;
      }
    };

    // Subscribe to discussion Y.Array
    const discussion = p.document.getArray("discussion");
    const updateBlocks = () => {
      if (cancelled) return;
      safeObserve(() => setBlocks(discussion.toJSON() as DiscussionBlock[]));
    };
    discussion.observe(updateBlocks);
    p.on("synced", updateBlocks);
    updateBlocks();

    // Subscribe to decisions Y.Map
    const decisionsMap = p.document.getMap("decisions");
    const updateDecisions = () => {
      if (cancelled) return;
      safeObserve(() => {
        const json = decisionsMap.toJSON();
        const { _meta, ...rest } = json;
        setDecisions(rest as Record<string, Decision>);
      });
    };
    decisionsMap.observe(updateDecisions);
    updateDecisions();

    // Subscribe to config Y.Map
    const configMap = p.document.getMap("config");
    const updateConfig = () => {
      if (cancelled) return;
      safeObserve(() => setConfig(configMap.toJSON() as DiscussionConfig));
    };
    configMap.observe(updateConfig);
    updateConfig();

    // Timeout
    const timeout = setTimeout(() => {
      if (!cancelled) setStatus((prev) => (prev === "connecting" ? "error" : prev));
    }, 8000);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      discussion.unobserve(updateBlocks);
      decisionsMap.unobserve(updateDecisions);
      configMap.unobserve(updateConfig);
      p.destroy();
      providerRef.current = null;
    };
  }, [docName, serverUrl, token]);

  const postBlock = useCallback(
    (content: string, type: DiscussionBlock["type"], mentions: string[] = []) => {
      if (!providerRef.current) return;
      const discussion = providerRef.current.document.getArray("discussion");
      discussion.push([
        {
          id: crypto.randomUUID(),
          role: "user", // Will be set by caller with proper role
          timestamp: new Date().toISOString(),
          content,
          mentions,
          type,
          tokens: Math.ceil(content.length / 4),
        },
      ]);
    },
    [],
  );

  const postDecision = useCallback(
    (key: string, decision: string) => {
      if (!providerRef.current) return;
      const decisionsMap = providerRef.current.document.getMap("decisions");
      decisionsMap.set(key, {
        decision,
        decidedBy: "user",
        agreedBy: ["user"],
        timestamp: new Date().toISOString(),
      });
    },
    [],
  );

  return { blocks, decisions, config, status, postBlock, postDecision, provider };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook: useDiscussionNotifications — Socket.IO badge counts
// ═══════════════════════════════════════════════════════════════════════════════

export interface MentionNotification {
  fromRole: string;
  toRole: string;
  taskId: string;
  blockId: string;
  timestamp: string;
}

interface UseDiscussionNotificationsReturn {
  unreadCount: number;
  mentions: MentionNotification[];
  markRead: (docName: string) => void;
}

export function useDiscussionNotifications(
  agentService: any,
): UseDiscussionNotificationsReturn {
  const [unreadCount, setUnreadCount] = useState(0);
  const [mentions, setMentions] = useState<MentionNotification[]>([]);

  useEffect(() => {
    if (!agentService) return;

    const unsubActivity = agentService.onDiscussionActivity?.((data: any) => {
      setUnreadCount((prev) => prev + 1);
    });

    const unsubMention = agentService.onDiscussionMention?.((data: MentionNotification) => {
      setMentions((prev) => [...prev, data]);
      setUnreadCount((prev) => prev + 1);
    });

    return () => {
      unsubActivity?.();
      unsubMention?.();
    };
  }, [agentService]);

  const markRead = useCallback((docName: string) => {
    setUnreadCount((prev) => Math.max(0, prev - 1));
    setMentions((prev) => prev.filter((m) => m.taskId !== docName));
  }, []);

  return { unreadCount, mentions, markRead };
}
