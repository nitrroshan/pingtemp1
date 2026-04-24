# Task 008 — Extract DiscussionMessages

**Status:** ⏭️ Skipped — existing DiscussionThread works as-is. Slack-style split is UX polish, not a functional gap.  
**Phase:** 6 · **Risk:** High · **Depends on:** task-006

## Goal
Pull the messages-rendering portion out of `DiscussionThread.tsx` into a standalone `DiscussionMessages.tsx`. The new component is the **Slack-style chat surface** — header (40px) + scrollable message list + composer (48px). Nothing else.

## Files
- **NEW** `packages/frontend/components/DiscussionThread/DiscussionMessages.tsx`
- **EDIT** `packages/frontend/components/DiscussionThread/DiscussionThread.tsx` — becomes a tabs container (handled in task-009)

## DiscussionMessages contract
```tsx
type DiscussionMessagesProps = {
  blocks: DiscussionBlock[];           // from useDiscussion
  decisions: Record<string, Decision>; // for inline decision cards
  participants: string[];              // for header subtitle
  status: DiscussionStatus;            // for header dot color
  composerEnabled: boolean;            // VITE_ENABLE_DISCUSSION_COMPOSER
  onPost?: (content: string, type: 'message' | 'question', mentions?: string[]) => void;
  title: string;                       // task title
  onClose?: () => void;
};
```

## Layout
```
[40px header]  💬 {title}        [statusDot]  [✕]
               {N} participants
─────────────────────────────────────────
[scroll area]  Block list (existing BlockItem component, preserved)
               Inline decision cards interleaved by timestamp
─────────────────────────────────────────
[48px footer] DiscussionComposer (existing, gated)
```

## Removed from this component
The following are **moved to sibling tab components** (task-009), NOT rendered here:
- `StatusBar` (full lifecycle bar)
- `ParticipantBar` (avatar row)
- `AgendaBar` (checklist)
- Token / round counters

The thin header keeps **only** title + status dot + close button + "{N} participants" subtitle.

## Inline decisions
Decisions are rendered inline in the scroll area at their timestamp position — single visual element per decision (existing `InlineDecision` component preserved).

## Acceptance
- [ ] Component renders standalone in a 320px-wide DetailPanel without breaking
- [ ] Messages occupy at least 80% of vertical height when there are 3+ blocks
- [ ] Markdown rendering preserved
- [ ] Composer feature flag preserved
- [ ] Decision cards still appear inline at correct position
- [ ] CRDT connection still established (no regression in real-time updates)
