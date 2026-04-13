/**
 * DiscussionListPanel — 5th tab in DetailPanel showing active/resolved discussions
 *
 * Lists all discussion threads with status badges, participant info, and unread counts.
 * "Open Thread" → full view (Mode A), "Pin" → split pane (Mode B).
 */

import React from "react";
import type { DiscussionThread as DiscussionThreadType } from "../../hooks/useDiscussion";

interface DiscussionListPanelProps {
  threads: DiscussionThreadType[];
  onOpenThread: (thread: DiscussionThreadType) => void;
  onPinThread?: (thread: DiscussionThreadType) => void;
}

function StatusDot({ status }: { status: "active" | "resolved" }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${
        status === "active" ? "bg-red-500" : "bg-green-500"
      }`}
    />
  );
}

function ThreadCard({
  thread,
  onOpen,
  onPin,
}: {
  thread: DiscussionThreadType;
  onOpen: () => void;
  onPin?: () => void;
}) {
  return (
    <div className="border border-border rounded-lg p-3 hover:bg-accent/50 transition-colors">
      <div className="flex items-center gap-2 mb-1">
        <StatusDot status={thread.status} />
        <span className="text-xs font-semibold text-foreground truncate flex-1">
          {thread.title}
        </span>
        {thread.unreadCount > 0 && (
          <span className="text-[10px] bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-300 px-1.5 py-0.5 rounded-full font-medium">
            {thread.unreadCount} new
          </span>
        )}
      </div>
      <div className="text-[10px] text-muted-foreground mb-1.5 pl-4">
        {thread.docName} · {thread.participants.join(" ↔ ")}
      </div>
      <div className="text-[10px] text-muted-foreground pl-4 mb-2">
        {thread.blockCount} blocks · {thread.status === "resolved" ? "resolved" : "awaiting input"}
      </div>
      <div className="flex gap-1.5 pl-4">
        <button
          onClick={onOpen}
          className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer font-medium"
        >
          Open Thread
        </button>
        {onPin && (
          <button
            onClick={onPin}
            className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground hover:bg-accent cursor-pointer"
          >
            📌 Pin
          </button>
        )}
      </div>
    </div>
  );
}

export function DiscussionListPanel({
  threads,
  onOpenThread,
  onPinThread,
}: DiscussionListPanelProps) {
  const active = threads.filter((t) => t.status === "active");
  const resolved = threads.filter((t) => t.status === "resolved");

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4">
      {/* Active */}
      {active.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            📌 Active ({active.length})
          </h4>
          <div className="space-y-2">
            {active.map((thread) => (
              <ThreadCard
                key={thread.docName}
                thread={thread}
                onOpen={() => onOpenThread(thread)}
                onPin={onPinThread ? () => onPinThread(thread) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {/* Resolved */}
      {resolved.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            ✅ Resolved ({resolved.length})
          </h4>
          <div className="space-y-2">
            {resolved.map((thread) => (
              <ThreadCard
                key={thread.docName}
                thread={thread}
                onOpen={() => onOpenThread(thread)}
              />
            ))}
          </div>
        </div>
      )}

      {threads.length === 0 && (
        <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
          No active discussions
        </div>
      )}
    </div>
  );
}
