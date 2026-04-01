# Seed Data System — Feature Architecture

**Status:** New  
**Date:** March 29, 2026  
**ID:** B4

---

## Overview

Configurable data seeding for dev/test environments. Controlled via configuration flag — **never runs in production**. Provides test fixtures for teams, agents, skills, tasks, and conversations.

### Current State
- `bun run seed:skills` exists for seeding official skills
- No comprehensive seeding for teams, agents, tasks
- No configuration to control seeding behavior
- No guard against running seeds in production

### Target State
- `bun run seed` — seeds all test data
- `bun run seed:teams` / `bun run seed:skills` / `bun run seed:tasks` — granular seeding
- Config flag: `SEED_ENABLED=true` (default: `true` in dev, `false` in prod)
- Hard guard: refuse to seed if `NODE_ENV=production`
- Idempotent seeds — safe to run multiple times

---

## Architecture

```
packages/backend/
  data/
    seeds/
      index.ts          — orchestrates all seeds
      teams.seed.ts     — sample teams (engineering, product, marketing)
      agents.seed.ts    — sample agent definitions per team
      skills.seed.ts    — official skills (already exists)
      tasks.seed.ts     — sample task plans and completed tasks
      conversations.seed.ts — sample chat history for testing
    fixtures/
      team-engineering.json
      team-product.json
      agent-researcher.yaml
      agent-developer.yaml
      plan-webapp.json
```

### Safety Guard

```typescript
// data/seeds/index.ts
export async function seed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: Cannot seed in production environment');
  }
  if (process.env.SEED_ENABLED !== 'true') {
    console.log('Seeding disabled. Set SEED_ENABLED=true to enable.');
    return;
  }
  // ... run seeds
}
```

### Config Integration

```typescript
// config/development.ts
export default {
  seed: { enabled: true, resetBeforeSeed: true },
}

// config/production.ts  
export default {
  seed: { enabled: false, resetBeforeSeed: false },
}
```

**Effort:** Low (1 week)
