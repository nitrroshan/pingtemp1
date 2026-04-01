# Frontend Phase 3: Teams & Polish — Feature Architecture

**Status:** New  
**Date:** April 1, 2026  
**Phase:** 3  
**Depends on:** Phase 1 & 2 (refactored + streaming frontend), Team Package (B1)

---

## Overview

Multi-team experience with full team management, agent configuration, persistent state, responsive design, and visual polish.

### Current State (after Phase 2)
- Single-team experience (hardcoded team from backend)
- Can create teams but can't edit/delete/manage
- No agent settings UI
- Refresh loses everything (in-memory state)
- Desktop-only layout
- No theme system

### Target State
- Team switcher — switch between teams instantly
- Team management page — create, edit, delete teams, manage roles
- Agent settings — edit model, skills, prompt per agent
- Chat persistence — survives refresh
- Responsive — works on tablet/mobile
- Dark/light theme

---

## Components

### Team Switcher (Sidebar Top)

```
┌──────────────────────────────────┐
│  🏢 Marketing Team          ▼   │ ← dropdown
│  ─────────────────────────────── │
│  🏢 Marketing Team         ✓    │
│  ⚙️ Engineering Team            │
│  📊 Research Team                │
│  ────────────────────────────    │
│  + Create New Team               │
└──────────────────────────────────┘
```

Switching teams: disconnects socket, connects to new team, loads agents/chat/tasks for that team.

### Team Management Page (`/teams`)

```
┌─────────────────────────────────────────────────────────────┐
│  Teams                                        [+ New Team]  │
│                                                              │
│  ┌──────────────────────┐  ┌──────────────────────┐        │
│  │ 🏢 Marketing Team    │  │ ⚙️ Engineering       │        │
│  │                       │  │                       │        │
│  │ 3 agents · 2 goals   │  │ 5 agents · 4 goals   │        │
│  │ Active: 1 running    │  │ Active: none          │        │
│  │                       │  │                       │        │
│  │ [Open]  [Settings]   │  │ [Open]  [Settings]   │        │
│  └──────────────────────┘  └──────────────────────┘        │
│                                                              │
│  ┌──────────────────────┐                                    │
│  │ 📊 Research           │                                    │
│  │                       │                                    │
│  │ 2 agents · 0 goals   │                                    │
│  │ Active: none          │                                    │
│  │                       │                                    │
│  │ [Open]  [Settings]   │                                    │
│  └──────────────────────┘                                    │
└─────────────────────────────────────────────────────────────┘
```

### Team Settings Panel (`/teams/:id/settings`)

```
┌─────────────────────────────────────────────────────────────┐
│  ⬅ Marketing Team — Settings                                │
│                                                              │
│  Name:  [Marketing Team___________________________]          │
│  Desc:  [Q1 campaign execution_____________________]         │
│                                                              │
│  ── Roles ──────────────────────────────────────────         │
│  📎 researcher    [Edit] [Remove]                            │
│  📎 writer        [Edit] [Remove]                            │
│  📎 designer      [Edit] [Remove]                            │
│  [+ Add Role]                                                │
│                                                              │
│  ── Auto-Approval ──────────────────────────────────         │
│  ☐ Auto-approve researcher tasks                             │
│  ☐ Auto-approve writer artifacts                             │
│  ☐ Auto-approve all (dangerous)                              │
│                                                              │
│  ── Planner ────────────────────────────────────────         │
│  Model: [azure/gpt-4o_____▼]                                │
│                                                              │
│  [Save]  [Delete Team]                                       │
└─────────────────────────────────────────────────────────────┘
```

### Agent Settings (Slide-Over Panel)

Triggered by clicking an agent in the sidebar:

```
┌──────────────────────────────────────────┐
│  📎 Market Researcher — Settings    [✕]  │
│                                          │
│  Name:   [Market Researcher____]         │
│  Role:   [researcher___________]         │
│  Model:  [azure/gpt-4o________▼]        │
│                                          │
│  System Prompt:                          │
│  ┌──────────────────────────────────┐    │
│  │ You are a market research...     │    │
│  │                                   │    │
│  └──────────────────────────────────┘    │
│                                          │
│  Skills:                                 │
│  ✅ web-search                           │
│  ✅ read-url                             │
│  ✅ summarize                            │
│  ☐  academic-search                      │
│                                          │
│  [Save Changes]                          │
└──────────────────────────────────────────┘
```

### Chat Persistence

```typescript
// hooks/usePersistedChat.ts
// Save to localStorage on every message, restore on mount

const STORAGE_KEY = 'ping:chats';

function usePersistedChat(teamId: string) {
  const [histories, setHistories] = useState<Record<string, Message[]>>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}:${teamId}`);
    return saved ? JSON.parse(saved) : {};
  });

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}:${teamId}`, JSON.stringify(histories));
  }, [histories, teamId]);

  return [histories, setHistories];
}
```

### Responsive Layout

- **Desktop (>1024px):** Sidebar + Main + Optional Right Panel (current)
- **Tablet (768-1024px):** Collapsible sidebar (hamburger), full-width main
- **Mobile (<768px):** Bottom nav (Chat/Tasks/Collaborate), no sidebar, full-screen chat

### Dark/Light Theme

```typescript
// Mantine ColorSchemeScript + toggle
import { MantineProvider, useMantineColorScheme } from '@mantine/core';

// Auto-detect system preference, user can override
// Toggle in header: ☀️ / 🌙
```

---

## Implementation Checklist

| Component | Status | Effort |
|---|---|---|
| Team Switcher (sidebar dropdown) | ❌ | 1-2 days |
| Team Management page (`/teams`) | ❌ | 2-3 days |
| Team Settings panel | ❌ | 2 days |
| Agent Settings slide-over | ❌ | 2 days |
| Chat Persistence (localStorage) | ❌ | 1 day |
| Responsive breakpoints | ❌ | 2-3 days |
| Dark/Light theme toggle | ❌ | 1 day |
| Mobile bottom nav | ❌ | 1 day |

**Total effort:** ~12-15 days frontend work
