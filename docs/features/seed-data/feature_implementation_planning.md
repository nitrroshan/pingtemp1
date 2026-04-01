# Seed Data System — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 1 (Core Loop)  
**ID:** B4

---

## Branch
- `feature/seed-data`

## Scope
Create configurable data seeding for dev/test with safety guards. Idempotent seeds for teams, agents, skills, tasks.

## Implementation Steps

### Step 1: Create Seed Infrastructure
**Files to create:**
- `packages/backend/data/seeds/index.ts` — Orchestrate all seeds, safety guard (`NODE_ENV !== 'production'`), `SEED_ENABLED` check
- `packages/backend/data/seeds/guard.ts` — Production guard function

**Exit criteria:** `bun run seed` refuses to run in production, respects `SEED_ENABLED` flag

### Step 2: Create Team Seeds
**Files to create:**
- `packages/backend/data/seeds/teams.seed.ts` — 3 sample teams: Engineering, Product, Marketing
- `packages/backend/data/fixtures/team-engineering.json` — Team config fixture
- `packages/backend/data/fixtures/team-product.json`
- `packages/backend/data/fixtures/team-marketing.json`

**Exit criteria:** `bun run seed:teams` creates 3 teams idempotently (upsert by name)

### Step 3: Create Agent Seeds
**Files to create:**
- `packages/backend/data/seeds/agents.seed.ts` — Standard agents per team (researcher, writer, developer, etc.)
- `packages/backend/data/fixtures/agent-researcher.yaml` — Agent definition fixtures

**Exit criteria:** Each team gets its default agents, idempotent

### Step 4: Wire Skills Seeds
**Files to modify:**
- `packages/backend/data/seeds/skills.seed.ts` — Move existing `seedOfficialSkills.ts` here, standardize format

**Exit criteria:** `bun run seed:skills` seeds all official skills

### Step 5: Create Task/Plan Seeds (Optional)
**Files to create:**
- `packages/backend/data/seeds/tasks.seed.ts` — Sample completed plan + tasks for demo walkthroughs

**Exit criteria:** Demo team has a pre-completed goal for showcase

### Step 6: Add Package.json Scripts
**Files to modify:**
- `packages/backend/package.json` — Add `seed`, `seed:teams`, `seed:skills`, `seed:tasks` scripts
- `packages/backend/.env.example` — Add `SEED_ENABLED=true`

**Exit criteria:** All seed commands work, documented in .env.example

## Testing Strategy
- Run seeds twice — verify idempotent (no duplicates)
- Run with `NODE_ENV=production` — verify refusal
- Run with `SEED_ENABLED=false` — verify skip

## Complexity
Low — 2-3 days.
