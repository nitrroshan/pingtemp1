# Task 010 — Top bar plan info + polish

**Status:** ✅ Done — PlanSwitcher shows plan name + status in context bar  
**Phase:** 7 · **Risk:** Low · **Depends on:** task-004

## Goal
Show the active plan name + status badge in the context bar (top of main content column). Polish empty states.

## Files
- **EDIT** `packages/frontend/App.tsx` — context bar JSX (currently shows `activeAgent.name`)

## Visual change
Replace:
```
{activeAgent?.name ?? 'Ping'}   {role chip}   {sessionState chip}
```
With:
```
📋 {planName} ▾   {sessionStateBadge}        ←→   active agent (smaller, right-aligned)
```

The `▾` opens the PlanSwitcher popover (task-004 component, hoisted into top bar instead of being separate).

## Empty states to polish
1. **No team selected on Goal Screen** — "Pick a team to start. Or [create one]."
2. **No plans yet** — "No plans yet. Submit a goal above to begin."
3. **Plan with no tasks (still planning)** — "Planner is creating your tasks…" (existing skeleton, keep)
4. **DetailPanel with no task selected** — "Select a task in the sidebar to see details."
5. **Discussion with no posts** — "Waiting for agents to start the discussion…"

## Acceptance
- [ ] Top bar shows plan name + dropdown caret + status pill
- [ ] Clicking plan name opens PlanSwitcher popover
- [ ] All listed empty states present and have actionable CTAs where applicable
- [ ] Visual smoke test against Slack/Discord/Notion mental model — no cramped sections
