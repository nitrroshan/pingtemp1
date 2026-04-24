# Task 006 — TabBar primitive

**Status:** ✅ Done — implemented as `TabRow` generic component in DetailPanel  
**Phase:** 5 · **Risk:** Low · **Depends on:** none

## Goal
Reusable horizontal tab strip used by both DetailPanel and DiscussionTab.

## Files
- **NEW** `packages/frontend/components/ui/TabBar.tsx`

## Component contract
```tsx
type Tab = {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: number | string;       // small chip on the right
  disabled?: boolean;
};

type TabBarProps = {
  tabs: Tab[];
  activeId: string;
  onSelect: (id: string) => void;
  size?: 'sm' | 'md';            // sm for nested (Discussion sub-tabs), md for DetailPanel
  className?: string;
};
```

## Visual
- Horizontal flex, underline-style indicator (matches existing tab style in DetailPanel)
- Active tab: `text-foreground border-b-2 border-primary`
- Inactive: `text-muted-foreground hover:text-foreground`
- Badge: `bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px]`

## Acceptance
- [ ] Component renders, supports keyboard arrow navigation
- [ ] Used by task-007 (DetailPanel) and task-009 (Discussion sub-tabs) — same component
- [ ] Storybook-style sandbox not required; visual smoke test in DetailPanel is sufficient
