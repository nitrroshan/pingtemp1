# Frontend Phase 3: Teams & Polish — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 3 (Teams & Packages)

---

## Branch
- `feature/frontend-phase3-teams`

## Scope
Multi-team experience: team switcher, team management, agent settings, chat persistence, responsive layout, dark/light theme.

## Implementation Steps

### Step 1: Team Switcher
**Files to create:**
- `packages/frontend/components/TeamSwitcher.tsx` — Dropdown at sidebar top. List teams. Switch team = disconnect socket + reconnect + reload agents/chat/tasks. "Create New Team" option.

**Exit criteria:** Switching teams loads correct context, socket reconnects

### Step 2: Team Management Page
**Files to create:**
- `packages/frontend/components/TeamManagement.tsx` — Route: `/teams`. Card grid of teams. Each card: name, agent count, goal count, status. Actions: Open, Settings. "+ New Team" button → create modal.

**Exit criteria:** Team CRUD works from UI

### Step 3: Team Settings Panel
**Files to create:**
- `packages/frontend/components/TeamSettings.tsx` — Route: `/teams/:id/settings`. Edit name, description. Manage roles (add/edit/remove). Auto-approval toggles per role. Planner model selection. Delete team (with confirmation).

**Exit criteria:** Team configuration editable, deletable

### Step 4: Agent Settings Slide-Over
**Files to create:**
- `packages/frontend/components/AgentSettings.tsx` — Triggered from sidebar agent click. Edit name, role, model dropdown, system prompt textarea, skill checkboxes (from SkillSelector). Save button.

**Exit criteria:** Agent config editable per-agent

### Step 5: Chat Persistence
**Files to create:**
- `packages/frontend/hooks/usePersistedChat.ts` — Save chat histories to `localStorage` per team. Restore on mount. Key: `ping:chats:{teamId}`.

**Exit criteria:** Page refresh preserves chat history per team

### Step 6: Responsive Layout
**Files to modify:**
- `packages/frontend/App.tsx` — Add responsive breakpoints. Desktop (>1024px): sidebar + main + optional right panel. Tablet (768-1024px): collapsible sidebar. Mobile (<768px): bottom nav (Chat/Tasks/Collaborate).

**Exit criteria:** Usable on tablet and mobile screen sizes

### Step 7: Dark/Light Theme
**Files to modify:**
- `packages/frontend/App.tsx` — Mantine `ColorSchemeScript` + `useMantineColorScheme`. Toggle in header. Auto-detect system preference.

**Exit criteria:** Theme toggles between dark/light, persists preference

## Testing Strategy
- Visual testing across viewport sizes
- Team switching preserves correct state
- Chat persistence survives refresh
- Theme toggle works consistently

## Complexity
Medium — 12-15 days.
