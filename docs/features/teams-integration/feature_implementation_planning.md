# Teams Integration — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 3 (Teams & Packages)  
**ID:** E6

---

## Branch
- `feature/teams-integration`

## Scope
Wire teams into frontend (team-scoped routes, management UI) and CLI (team commands). Frontend uses HTTP/WebSocket; CLI imports packages directly.

## Implementation Steps

### Step 1: Frontend — Team Service Layer
**Files to modify:**
- `packages/frontend/services/` — Add team CRUD methods: `listTeams()`, `createTeam()`, `updateTeam()`, `deleteTeam()`, `getTeamAgents()`, `getTeamTasks()`

**Exit criteria:** All team HTTP endpoints callable from frontend

### Step 2: Frontend — Team Routes
**Files to modify:**
- `packages/frontend/App.tsx` — Add React Router routes: `/teams` (list), `/teams/:id` (dashboard), `/teams/:id/agents` (agents), `/teams/:id/agents/:role` (agent chat), `/teams/:id/tasks` (task DAG)

**Exit criteria:** Navigation between team pages works

### Step 3: Frontend — Team Switcher
**Files to create:**
- `packages/frontend/components/TeamSwitcher.tsx` — Sidebar dropdown for switching teams. Switching disconnects socket, connects to new team, loads agents/chat/tasks.

**Exit criteria:** Team switching loads correct team context

### Step 4: Frontend — Team Management Page
**Files to create:**
- `packages/frontend/components/TeamManagement.tsx` — Card-based team list. Create, edit name/description, delete teams. Shows agent count, goal count, active status per team.

**Exit criteria:** Full team CRUD from UI

### Step 5: Frontend — Agent Settings Panel
**Files to create:**
- `packages/frontend/components/AgentSettings.tsx` — Slide-over panel. Edit agent name, role, model, system prompt, skills. Save changes via API.

**Exit criteria:** Agent configuration editable from UI

### Step 6: CLI — Team Commands
**Files to create/modify:**
- `packages/backend/cli/commands/team.ts` — Add `/team list`, `/team create`, `/team use`, `/team delete` commands

**Exit criteria:** CLI team management works without HTTP server

### Step 7: CLI — Plan Commands
**Files to modify:**
- `packages/backend/cli/commands/planning.ts` — Update `/plan` to scope to active team context (from `/team use`)

**Exit criteria:** Planning scoped to selected team

## Testing Strategy
- Frontend: navigate team creation → agent config → goal submission flow
- CLI: `team create` → `team use` → `plan "goal"` → verify scoped execution
- Test: switching teams clears previous team state

## Complexity
Medium — 1-2 weeks.
