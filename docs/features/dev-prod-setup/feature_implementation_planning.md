# Dev/Prod Environment Setup — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 3 (Teams & Packages)

---

## Branch
- `feature/dev-prod-setup`

## Scope
Proper environment configuration, Docker Compose for local dev, startup validation, single-command dev startup.

## Implementation Steps

### Step 1: Create Environment Config System
**Files to create:**
- `packages/backend/config/default.ts` — Shared defaults (port, log level, etc.)
- `packages/backend/config/development.ts` — Dev overrides (verbose logging, seeding ON, local MongoDB)
- `packages/backend/config/production.ts` — Prod overrides (no debug, seeding OFF, optimized)
- `packages/backend/config/index.ts` — Merge configs based on `NODE_ENV`

**Exit criteria:** `getConfig()` returns merged config for current environment

### Step 2: Create Startup Validation
**Files to create:**
- `packages/backend/config/validate.ts` — Check required env vars (`AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT_URL`, `MONGODB_URI`). Fail fast with clear error message on missing vars.

**Files to modify:**
- `packages/backend/server.ts` — Call `validateConfig()` before anything else

**Exit criteria:** Missing env var → clear error on startup, not a cryptic crash later

### Step 3: Create Docker Compose
**Files to create:**
- `docker-compose.dev.yml` — MongoDB 8 (port 27017, volume for data persistence)
- `.dockerignore` — Exclude node_modules, dist, .git

**Exit criteria:** `docker compose -f docker-compose.dev.yml up -d` starts MongoDB

### Step 4: Update .env.example
**Files to modify:**
- `packages/backend/.env.example` — Document ALL env vars: required, optional, defaults. Group by category (Azure, MongoDB, App, Seed).

**Exit criteria:** New developer can copy .env.example → .env and get started

### Step 5: Create Single Dev Command
**Files to modify:**
- Root `package.json` — Add `dev` script that starts Docker Compose + backend + frontend
- `start.ps1` — Update to use Docker Compose for MongoDB

**Exit criteria:** `bun run dev` starts everything (MongoDB + backend + frontend)

### Step 6: Add Build Targets
**Files to modify:**
- Root `package.json` — Add `build:staging`, `build:prod` scripts with appropriate NODE_ENV

**Exit criteria:** Environment-specific builds work

## Testing Strategy
- Fresh clone → `bun install` → copy `.env.example` → `bun run dev` → everything starts
- Test startup validation: remove a required var, verify clear error

## Complexity
Low-Medium — 3-5 days.
