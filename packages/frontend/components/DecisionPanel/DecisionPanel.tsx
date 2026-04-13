/**
 * DecisionPanel — Renders Y.Map("decisions") as decision cards
 *
 * Shows ✅ completed and ⏳ pending decisions with quorum progress.
 */

import React from "react";
import type { Decision } from "../../hooks/useDiscussion";

interface DecisionPanelProps {
  decisions: Record<string, Decision>;
  quorumRequired?: number;
  compact?: boolean;
}

function DecisionCard({
  decisionKey,
  decision,
  quorumRequired = 1,
}: {
  decisionKey: string;
  decision: Decision;
  quorumRequired: number;
}) {
  const isComplete = decision.agreedBy.length >= quorumRequired;
  const progress = Math.min(100, (decision.agreedBy.length / quorumRequired) * 100);

  return (
    <div
      className={`rounded-lg border p-3 ${
        isComplete ? "border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20" : "border-border"
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm">{isComplete ? "✅" : "⏳"}</span>
        <span className="text-xs font-semibold text-foreground capitalize">
          {decisionKey.replace(/-/g, " ")}
        </span>
      </div>
      <p className="text-xs text-foreground mb-2 pl-6">"{decision.decision}"</p>
      <div className="pl-6 space-y-1">
        <div className="text-[10px] text-muted-foreground">
          Decided by: <span className="font-medium text-foreground">{decision.decidedBy}</span>
        </div>
        {decision.agreedBy.length > 0 && (
          <div className="text-[10px] text-muted-foreground">
            Agreed by:{" "}
            {decision.agreedBy.map((r) => (
              <span key={r} className="inline-flex items-center gap-0.5 mr-1">
                <span className="text-green-500">✓</span> {r}
              </span>
            ))}
          </div>
        )}
        {/* Quorum progress bar */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                isComplete ? "bg-green-500" : "bg-primary"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">
            {decision.agreedBy.length}/{quorumRequired}
          </span>
        </div>
      </div>
      <div className="text-[9px] text-muted-foreground mt-1.5 pl-6">
        {new Date(decision.timestamp).toLocaleString()}
      </div>
    </div>
  );
}

export function DecisionPanel({
  decisions,
  quorumRequired = 1,
  compact = false,
}: DecisionPanelProps) {
  const entries = Object.entries(decisions);
  if (entries.length === 0) return null;

  return (
    <div className={compact ? "space-y-2" : "space-y-3 p-3"}>
      {!compact && (
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Decisions ({entries.length})
        </h4>
      )}
      {entries.map(([key, decision]) => (
        <DecisionCard
          key={key}
          decisionKey={key}
          decision={decision}
          quorumRequired={quorumRequired}
        />
      ))}
    </div>
  );
}
