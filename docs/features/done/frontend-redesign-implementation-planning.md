# Frontend Redesign v1.0 — Implementation Planning

## Branch
`feature/frontend-redesign-v1.0`

## Scope
Design system foundation + layout shell + component redesign for all 13 existing components. This creates the **visual foundation** that Phases 2-7 build on. No new features — only modernizing what exists with a system that scales.

**Out of scope (deferred to their own phases):**
- Streaming renderer, tool cards, reasoning sections (Phase 2)
- Team switcher, team management, agent settings (Phase 3)
- Knowledge wiki, artifact browser, workspace viewer (Phase 4)
- Admin dashboards, MCP dashboard (Phase 5-7)

---

## Implementation Steps

### Phase A: Foundation (design system + tooling)
- [ ] **Step 1: Install Tailwind CSS properly** — Replace CDN `<script>` in `index.html` with PostCSS-based Tailwind. Create `tailwind.config.ts`, `postcss.config.js`, `globals.css`. This is prerequisite for shadcn/ui.
- [ ] **Step 2: Setup shadcn/ui** — Init via CLI. Configure `components.json` with zinc theme. Install deps: `tailwind-merge`, `clsx`, `class-variance-authority`, `@radix-ui/react-slot`. Create `lib/utils.ts` with `cn()` helper.
- [ ] **Step 3: Design tokens** — CSS variables in `globals.css` for zinc dark theme (see architecture doc). Configure Inter + JetBrains Mono fonts. Custom keyframe animations. Status color palette. This becomes the single source of truth for all styling.

### Phase B: Layout Shell (structure that scales to 10+ views)
- [ ] **Step 4: AppLayout component** — 3-column: resizable sidebar (240px, collapsible to 48px) + main area (flex-1) + optional detail panel (320px Sheet). Bottom StatusBar. Replace current tab-bar + inline layout in App.tsx.
- [ ] **Step 5: Sidebar redesign** — Linear-style with sections: Team Switcher (placeholder for Phase 3), Navigation (Chat/Tasks/Collaborate + future: Knowledge/Artifacts/Workspace/Admin), Agents (team hierarchy tree), Quick Actions (+New Team, +Add Agent). Keyboard nav support.
- [ ] **Step 6: Status bar** — Bottom: connection dot (🟢/🔴), active agent count, team name, session state badge (idle/planning/executing/completed). Uses agentServiceV2 connection state.

### Phase C: Core View Components
- [ ] **Step 7: Chat view redesign** — Modern message bubbles (user right-aligned with subtle bg, AI in elevated cards with agent avatar). Rich ChatInput with subtle border + Cmd+Enter hint. Goal progress banner at top during orchestration. Message structure ready to host Phase 2 rich cards (tool cards, reasoning, notifications) without refactor.
- [ ] **Step 8: Task dashboard redesign** — Kanban columns by status (Ready → In Progress → Completed + Pending/Failed). Task cards with agent avatar, priority dot, dependency lines. Summary bar: total/completion%/active count. Filter by agent/status/priority.
- [ ] **Step 9: Plan approval redesign** — shadcn Dialog with backdrop blur. Task list as cards with drag handles for reorder. Dependency visualization. Risk indicators. Keyboard shortcuts (Enter=approve, Esc=dismiss). Structure ready for Phase 2 `create_plan` tool card integration.

### Phase D: Supporting Components
- [ ] **Step 10: Modal system** — Migrate AgentModal → shadcn Dialog. AgentManagerPanel → shadcn Sheet (slide-in from right, reusable for Phase 3 agent settings). Proper focus trapping, escape handling, backdrop blur.
- [ ] **Step 11: Toast upgrade** — Replace custom Toast with Sonner. Minimal stacked notifications. Auto-dismiss. Types: success/error/warning/info.
- [ ] **Step 12: Command palette** — Install `cmdk`. Cmd+K opens search overlay. Actions: navigate agents, switch views, create team, search tasks, toggle panels. Extensible for Phase 3+ commands.

### Phase E: Polish
- [ ] **Step 13: Empty states** — SVG illustrations + CTAs for: no messages ("Start a conversation"), no tasks ("Submit a goal"), no teams ("Create your first team"). These set the visual tone.
- [ ] **Step 14: Loading states** — Skeleton screens for: message list, task cards, sidebar agent tree, dashboard summary. Uses shadcn Skeleton component.
- [ ] **Step 15: Transitions** — Framer Motion for: page view transitions (fade+slide), modal enter/exit, sidebar collapse, list item mount/unmount with AnimatePresence.
- [ ] **Step 16: Responsive layout** — Sidebar becomes drawer on <768px. Detail panel stacks below on tablet. Touch-friendly targets (44px min). Mobile bottom nav for primary views.

---

## Future-Proofing Notes

The design system must accommodate these Phase 2-7 components without layout refactors:

| Future Component | Design System Requirement |
|-----------------|--------------------------|
| StreamMessage (P2) | Message bubble must support mixed content (text + cards + chips) |
| ToolCard (P2) | Card component with lifecycle states (calling → complete) |
| PlanCard (P2) | Interactive card with embedded DAG visualization |
| SkillSelector (P2) | Checkbox list component in Sheet panel |
| TeamSwitcher (P3) | Dropdown component in sidebar top slot |
| TeamManagement (P3) | Full page with card grid layout |
| AgentSettings (P3) | Sheet panel with form fields |
| KnowledgeWiki (P4) | Split pane: tree nav + markdown viewer |
| ArtifactBrowser (P4) | List with status badges + preview modals |
| AdminSettings (P5) | Form-based settings page |
| WorkerHealth (P6) | Data table with status indicators |
| QualityGrade (P7) | Badge component on messages |

## Dependencies Between Steps
```
Step 1 (Tailwind) → Step 2 (shadcn) → Step 3 (tokens) → Step 4 (layout)
Step 4 → Step 5 (sidebar), Step 6 (status bar), Step 7 (chat), Step 8 (tasks), Step 9 (plan)
Step 2 → Step 10 (modals), Step 11 (toasts), Step 12 (cmd palette)
Step 7+8 → Step 13 (empty), Step 14 (loading)
Step 4 → Step 15 (transitions), Step 16 (responsive)
```

## Testing Strategy
- Build verification: `bun run build` after each step
- Visual: screenshot before/after each component
- Smoke test: connect → create team → add agents → submit goal → approve → chat
- Responsive: 320px, 768px, 1024px, 1440px
- Accessibility: keyboard nav, screen reader

## Rollback
Each step independently revertable. No backend changes = zero data risk.
