# Frontend Redesign - Shell Alignment Plan

## Purpose
Align the implemented frontend shell with the promised architecture in [docs/features/frontend-redesign-architecture.md](docs/features/frontend-redesign-architecture.md): command bar, sidebar-first navigation, context/detail panels, status bar, and routing-first layout.

## Current Gap Summary
- Command palette component exists but is not mounted in app shell.
- Status bar component exists but is not mounted in app shell.
- Legacy AgentManager panel is still used instead of unified detail panel behavior.
- Top tab bar behavior still drives primary navigation in parts of the shell.
- Routing-first layout (`/teams/:id/chat`, `/teams/:id/tasks`, `/teams/:id/collaborate`) is not fully wired.

## Architecture Options

### Option A: Incremental Shell Convergence (recommended)
Implementation:
- Keep current component tree.
- Wire existing `CommandPalette` and `StatusBar` into `App.tsx`.
- Replace legacy top tab interactions with sidebar + route state.
- Keep `AgentManagerPanel` temporarily, but host it through a detail-panel controller.

Pros:
- Lowest risk and fastest path.
- Reuses existing tested components.
- Small PRs and easy rollback.

Cons:
- Temporary duality while legacy panel remains behind detail controller.

Effort: Medium (1-2 focused implementation passes).

### Option B: Full Shell Refactor in One Pass
Implementation:
- Introduce a new `AppLayout` and route-level page modules.
- Remove legacy panel patterns immediately.

Pros:
- Clean architecture outcome quickly.

Cons:
- Higher regression risk.
- Harder review and rollback.

Effort: High.

### Option C: Route-First Foundation Then UI Migration
Implementation:
- First add full routing boundaries and layout slots.
- Migrate shell visuals afterward.

Pros:
- Strong long-term structure.

Cons:
- Slower visible progress.
- More temporary duplicate wiring.

Effort: Medium-High.

## Decision
Selected architecture path: **Option C (Route-First Foundation Then UI Migration)**.

## Implementation Plan (Option C)

### Phase 1: Route Foundation (No Visual Breakage)
- [x] Define canonical routes for primary views:
	- `/chat`, `/tasks`, `/collaborate`
	- `/teams/:teamId/chat`, `/teams/:teamId/tasks`, `/teams/:teamId/collaborate`
- [x] Make URL route the source of truth for view mode.
- [x] Keep existing components and visuals while deriving state from route.

### Phase 2: Navigation Alignment to Route Model
- [x] Make sidebar interactions update routes instead of local-only state.
- [x] Keep top tab temporarily, but route-backed (transition phase).
- [x] Preserve mobile drawer open/close behavior and close-on-navigation.

### Phase 3: Shell UI Migration
- [x] Mount `CommandPalette` globally with route-aware commands.
- [x] Mount `StatusBar` globally with live session/connection indicators.
- [ ] Introduce detail panel controller and migrate off legacy panel wiring.
- [ ] Remove top tab bar once sidebar-only navigation is stable.

### Phase 4: Validation
- [x] Build and type-check frontend.
- [ ] Responsive checks at 375px, 768px, 1024px, 1440px.
- [ ] Keyboard checks: Cmd+K, sidebar nav, panel open/close.
- [ ] Deep-link checks across all canonical routes.

## Acceptance Criteria
- Shell visibly includes command bar access, status bar, sidebar-first nav, and right detail panel behavior.
- No regression in chat send/stream, goal submission, plan approval, and task dashboard rendering.
- Routes are shareable and team-scoped for primary views.

## Decision Status
Approved by user: Option C.