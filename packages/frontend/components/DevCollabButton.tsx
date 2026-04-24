/**
 * DevCollabButton — floating dev-only button for collaboration inspection.
 *
 * SECURITY: This component is gated by `import.meta.env.DEV` which is a
 * **compile-time constant**. Vite completely eliminates the code from
 * production bundles via dead-code elimination. The component, its imports,
 * and all associated logic are stripped at build time — they don't exist
 * in the production JS bundle at all. No runtime flag, localStorage key,
 * or devtools manipulation can re-enable it.
 */

import React, { useState, useCallback, lazy, Suspense } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Lazy-load CollaborativeEditor only when the panel is opened (dev only)
const CollaborativeEditor = lazy(() => import('./CollaborativeEditor'));

interface DevCollabButtonProps {
  /** Current team ID — used to build the collab doc ID */
  teamId?: string | null;
  /** Current plan/goal ID */
  goalId?: string | null;
}

/**
 * Returns null in production. In dev, renders a floating button that
 * opens a collab inspector overlay.
 */
export function DevCollabButton({ teamId, goalId }: DevCollabButtonProps) {
  // Double-guard: compile-time + runtime. The runtime check is redundant
  // but makes the intent crystal clear for anyone reading the code.
  if (!import.meta.env.DEV) return null;

  return <DevCollabButtonInner teamId={teamId} goalId={goalId} />;
}

function DevCollabButtonInner({ teamId, goalId }: DevCollabButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [docId, setDocId] = useState('');

  const computedDocId = docId || (teamId && goalId
    ? `${teamId}/${goalId}/doc-collab-inspector`
    : teamId
      ? `${teamId}/doc-scratch`
      : 'doc-dev-scratch');

  const toggle = useCallback(() => setIsOpen(v => !v), []);

  return (
    <>
      {/* Floating trigger button — bottom-left corner */}
      <motion.button
        onClick={toggle}
        className="fixed bottom-14 left-4 z-[9999] flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium shadow-lg border transition-colors cursor-pointer"
        style={{
          background: isOpen
            ? 'rgba(239, 68, 68, 0.15)'
            : 'rgba(59, 130, 246, 0.15)',
          borderColor: isOpen
            ? 'rgba(239, 68, 68, 0.3)'
            : 'rgba(59, 130, 246, 0.3)',
          color: isOpen ? '#ef4444' : '#3b82f6',
        }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title="Dev: Collab Inspector"
      >
        {isOpen ? <EyeOff size={14} /> : <Eye size={14} />}
        <span>Collab</span>
        <span className="px-1 py-0.5 rounded bg-amber-500/20 text-amber-500 text-[9px] font-bold uppercase tracking-wider">
          DEV
        </span>
      </motion.button>

      {/* Inspector overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="fixed bottom-24 left-4 z-[9998] w-[480px] max-h-[60vh] rounded-xl border border-border bg-background shadow-2xl flex flex-col overflow-hidden"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/50 shrink-0">
              <div className="flex items-center gap-2">
                <Eye size={14} className="text-blue-400" />
                <span className="text-xs font-semibold text-foreground">Collab Inspector</span>
                <span className="px-1 py-0.5 rounded bg-amber-500/20 text-amber-500 text-[9px] font-bold uppercase">DEV ONLY</span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            {/* Doc ID input */}
            <div className="px-3 py-2 border-b border-border bg-card/30 shrink-0">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Document ID</label>
              <input
                type="text"
                value={computedDocId}
                onChange={e => setDocId(e.target.value)}
                placeholder="team/goal/doc-name"
                className="mt-1 w-full px-2 py-1 rounded-md text-xs bg-muted border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
              />
              <div className="mt-1 text-[10px] text-muted-foreground/60">
                {teamId ? `Team: ${teamId}` : 'No team selected'}
                {goalId ? ` · Goal: ${goalId}` : ''}
              </div>
            </div>

            {/* Editor */}
            <div className="flex-1 min-h-[200px] overflow-auto">
              <Suspense fallback={
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  Loading editor…
                </div>
              }>
                <CollaborativeEditor
                  docId={computedDocId}
                  userName="dev-inspector"
                  userColor="#3b82f6"
                />
              </Suspense>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default DevCollabButton;
