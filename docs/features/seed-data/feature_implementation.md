# Seed Data — Implementation Log

**Branch:** `copilot/implement-verify-phase-1`

---

## Summary

Created seed data infrastructure with production guard, idempotent team/agent seeds.

---

## Key Changes

### Files Created
- `packages/backend/scripts/seeds/guard.ts` — Production safety guard, refuses to run if `NODE_ENV=production` or `SEED_ENABLED` is not `true`
- `packages/backend/scripts/seeds/teams.seed.ts` — Seeds 3 sample teams (Engineering, Product, Research) with upsert logic
- `packages/backend/scripts/seeds/agents.seed.ts` — Seeds role-appropriate agents for each team (4 engineering roles, 3 product roles, 3 research roles)  
- `packages/backend/scripts/seeds/index.ts` — Orchestrates all seeds, connects to DB, calls in order: teams → agents

### package.json Changes
Added scripts:
- `"seed"` — `SEED_ENABLED=true bun run data/seeds/index.ts`
- `"seed:teams"` — Run only teams seed

---

## Usage

```bash
cd packages/backend
SEED_ENABLED=true bun run seed
```

---

## Safety
- Refuses to run in `NODE_ENV=production`
- Requires `SEED_ENABLED=true` flag
- Idempotent — safe to run multiple times (upserts by name)
