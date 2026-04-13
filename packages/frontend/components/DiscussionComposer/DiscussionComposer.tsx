/**
 * DiscussionComposer — Text input for human participation in discussions
 *
 * Features:
 * - @mention autocomplete from team roles
 * - Type selector: message | question | decision
 * - Enter to send, Shift+Enter for newline
 * - Disabled when discussion is closed
 */

import React, { useState, useRef, useCallback } from "react";
import { Send } from "lucide-react";
import type { DiscussionBlock } from "../../hooks/useDiscussion";

interface DiscussionComposerProps {
  teamRoles?: string[];
  onPost: (content: string, type: DiscussionBlock["type"], mentions?: string[]) => void;
  disabled?: boolean;
}

const TYPE_OPTIONS: { value: DiscussionBlock["type"]; label: string; icon: string }[] = [
  { value: "message", label: "Message", icon: "💬" },
  { value: "question", label: "Question", icon: "❓" },
  { value: "decision", label: "Decision", icon: "✅" },
];

function parseMentions(text: string): string[] {
  const matches = text.match(/@(\w[\w-]*)/g);
  return matches ? matches.map((m) => m.slice(1)) : [];
}

export function DiscussionComposer({
  teamRoles = [],
  onPost,
  disabled = false,
}: DiscussionComposerProps) {
  const [content, setContent] = useState("");
  const [type, setType] = useState<DiscussionBlock["type"]>("message");
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredRoles = teamRoles.filter((r) =>
    r.toLowerCase().includes(mentionFilter.toLowerCase()),
  );

  const handleSend = useCallback(() => {
    const trimmed = content.trim();
    if (!trimmed || disabled) return;

    const mentions = parseMentions(trimmed);
    onPost(trimmed, type, mentions);
    setContent("");
    setType("message");
    textareaRef.current?.focus();
  }, [content, type, disabled, onPost]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "@") {
        setShowMentions(true);
        setMentionFilter("");
      }
      if (e.key === "Escape") {
        setShowMentions(false);
      }
    },
    [handleSend],
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);

    // Update mention filter
    const lastAt = val.lastIndexOf("@");
    if (lastAt !== -1 && showMentions) {
      setMentionFilter(val.slice(lastAt + 1));
    }
  }, [showMentions]);

  const insertMention = useCallback((role: string) => {
    const lastAt = content.lastIndexOf("@");
    const before = lastAt >= 0 ? content.slice(0, lastAt) : content;
    setContent(`${before}@${role} `);
    setShowMentions(false);
    textareaRef.current?.focus();
  }, [content]);

  return (
    <div className="border-t border-border bg-background">
      {/* Mention dropdown */}
      {showMentions && filteredRoles.length > 0 && (
        <div className="border-b border-border bg-popover p-1 max-h-32 overflow-y-auto">
          {filteredRoles.map((role) => (
            <button
              key={role}
              onClick={() => insertMention(role)}
              className="w-full text-left px-2 py-1 text-xs hover:bg-accent rounded cursor-pointer flex items-center gap-1.5"
            >
              <span>🤖</span>
              <span>{role}</span>
            </button>
          ))}
        </div>
      )}

      {/* Controls row */}
      <div className="flex items-center gap-1 px-3 pt-2">
        {/* Type selector */}
        <div className="flex gap-0.5">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setType(opt.value)}
              className={`px-2 py-0.5 text-[10px] rounded cursor-pointer transition-colors ${
                type === opt.value
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title={opt.label}
            >
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input row */}
      <div className="flex items-end gap-2 p-2">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "Discussion closed" : "Type your response... (@ to mention)"}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ minHeight: "36px", maxHeight: "120px" }}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !content.trim()}
          className="shrink-0 p-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
