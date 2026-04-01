# Feature: Bun Monorepo Migration

**Status:** In Progress  
**Date:** 2026-03-21  
**Chosen Approach:** Option A — Bun Workspaces

## Problem Statement

The project currently has **4 separate package.json files**, **3 different package managers** (npm, Yarn Classic, Yarn Berry 4.4.1), **5 lock files**, and inconsistent TypeScript configurations. This creates:

- Confusion about which package manager to use where
- Duplicate dependencies across packages (express, mongoose, typescript, etc.)
- Multiple lock files (yarn.lock + package-lock.json in same directories)
- Slow `install:all` script that sequentially installs in 3 directories
- No shared code between packages (duplicated types, utils)
- Different TypeScript versions (5.8.2, 5.8.3, 5.9.3)

### Current State Audit

| Package | Location | Package Manager | Lock Files | Type |
|---------|----------|-----------------|------------|------|
| `agent-chat-baccked` | `/` (root) | npm/yarn hybrid | `yarn.lock`, `package-lock.json` | Scripts/orchestration |
| `worker` | `src/worker/` | Yarn Berry 4.4.1 | `yarn.lock`, `package-lock.json` | Backend (Node.js + Express) |
| `nexus-agent-browser` | `src/AgentChat/` | Yarn Berry 4.4.1 | `yarn.lock`, `package-lock.json` | Frontend (React + Vite) |
| `agentregistry` | `src/agentRegistry/` | npm | `package-lock.json` | Backend service |

**Duplicated dependencies across packages:**
- `express` (root + worker + agentRegistry)
- `mongoose` (root + worker + agentRegistry — 3 different versions: 9.1.5, 9.0.2, 8.19.2)
- `typescript` (4 copies — versions 5.8.2, 5.8.3, 5.9.3)
- `dotenv`, `swagger-*`, `@types/*` duplicated

**Files to delete during migration:**
- `yarn.lock` (root, src/worker/, src/AgentChat/)
- `package-lock.json` (root, src/worker/, src/AgentChat/, src/agentRegistry/)
- `.yarnrc.yml` (src/worker/, src/AgentChat/)
- `.yarn/` directory (root)
- Root-level legacy code folders: `agents/`, `llm/`, `mcp/`, `types/`, `utils/`, `taskManager/`, `taskWorker/`, `_deprecated/`

---

## Architecture Options

### Option A: Bun Workspaces (Recommended)

**Implementation:** Use Bun's native workspace support. Single `bun.lock` at root. Each package under `packages/` with its own `package.json` but shared `node_modules` hoisted to root.

```
ping/
├── bun.lock
├── bunfig.toml
├── package.json              # workspace root
├── tsconfig.json             # base TS config
├── packages/
│   ├── backend/              # src/worker → packages/backend
│   │   ├── package.json      # "name": "@ping/backend"
│   │   └── tsconfig.json     # extends ../../tsconfig.json
│   ├── frontend/             # src/AgentChat → packages/frontend
│   │   ├── package.json      # "name": "@ping/frontend"
│   │   ├── vite.config.ts
│   │   └── tsconfig.json
│   ├── registry/             # src/agentRegistry → packages/registry
│   │   ├── package.json      # "name": "@ping/registry"
│   │   └── tsconfig.json
│   └── shared/               # NEW: shared types, utils
│       ├── package.json      # "name": "@ping/shared"
│       └── tsconfig.json
├── docs/
├── data/
└── .github/
```

**Root `package.json`:**
```json
{
  "name": "ping",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "bun run --filter '*' dev",
    "dev:backend": "bun run --filter @ping/backend dev",
    "dev:frontend": "bun run --filter @ping/frontend dev",
    "build": "bun run --filter '*' build",
    "test": "bun run --filter '*' test",
    "typecheck": "bun run --filter '*' typecheck",
    "mongo:start": "docker run -d --name ping-mongo -p 27017:27017 -v ping-mongo-data:/data/db mongo:7",
    "mongo:stop": "docker stop ping-mongo",
    "mongo:rm": "docker rm ping-mongo"
  }
}
```

**`bunfig.toml`:**
```toml
[install]
peer = false

[install.scopes]
"@ping" = { resolution = "workspace" }
```

**Pros:**
- Single lock file (`bun.lock`)
- ~10-25x faster installs than Yarn/npm
- Native TypeScript execution (no `tsx` or `ts-node` needed)
- Native workspace support with `--filter`
- Dependency deduplication (hoisted `node_modules`)
- Cross-package imports via `@ping/shared`
- `bun run` replaces `npx`, `tsx`, `ts-node`
- Built-in test runner (replaces Vitest for unit tests)

**Cons:**
- Some npm packages may have Bun compatibility issues (rare for LangChain ecosystem)
- Team needs to install Bun (one-liner: `powershell -c "irm bun.sh/install.ps1 | iex"`)
- Vite still needed for frontend (Bun's bundler is not React-production-ready yet)

---

### Option B: Bun Single-Package (Flat)

**Implementation:** Merge everything into a single package.json. No workspaces. Backend and frontend share one dependency tree.

```
ping/
├── bun.lock
├── package.json              # everything
├── tsconfig.json
├── src/
│   ├── backend/
│   ├── frontend/
│   └── shared/
```

**Pros:**
- Simplest structure, one package.json
- No workspace config needed

**Cons:**
- Frontend dependencies (React, Vite) pollute backend
- Can't run `bun install` for just one part
- Harder to dockerize separately
- No clear dependency boundaries
- Bloated single package.json (50+ dependencies)

---

### Option C: Turborepo + Bun

**Implementation:** Use Turborepo for task orchestration with Bun as the package manager. Turborepo handles build caching, dependency graph, and parallel execution.

```
ping/
├── bun.lock
├── turbo.json
├── package.json
├── packages/
│   ├── backend/
│   ├── frontend/
│   ├── registry/
│   └── shared/
```

**Pros:**
- Remote build caching
- Smart dependency-aware task execution
- Industry standard for large monorepos

**Cons:**
- Overhead for a 3-4 package monorepo (Turborepo shines at 10+ packages)
- Extra config (`turbo.json`)
- Another tool to learn and maintain
- Bun workspaces alone handle this scale fine

---

## Recommended: Option A (Bun Workspaces)

**Rationale:** Right-sized for this project. Bun workspaces natively handle everything needed without extra tooling. Turborepo is overkill for 4 packages. Flat structure loses the isolation benefits.

---

## Migration Steps (High-Level)

### Phase 1: Preparation
1. Create `@ping/shared` package — extract shared types, utils from root
2. Audit and unify dependency versions across packages
3. Delete legacy root-level code (`agents/`, `llm/`, `types/`, `utils/`, etc.)

### Phase 2: Restructure
4. Move `src/worker/` → `packages/backend/`
5. Move `src/AgentChat/` → `packages/frontend/`
6. Move `src/agentRegistry/` → `packages/registry/`
7. Create unified root `package.json` with workspaces
8. Create base `tsconfig.json` with per-package extensions

### Phase 3: Switch to Bun
9. Delete all lock files (yarn.lock, package-lock.json)
10. Delete `.yarnrc.yml` files and `.yarn/` directory
11. Create `bunfig.toml`
12. Run `bun install` at root
13. Update all scripts from `yarn`/`npm`/`npx`/`tsx` → `bun`/`bun run`

### Phase 4: Cleanup
14. Update `.gitignore` (remove yarn patterns, add `bun.lock`)
15. Update `CLAUDE.md` and docs with new commands
16. Update CI/CD if applicable
17. Update VS Code launch configs

### Phase 5: Shared Package
18. Move shared types to `@ping/shared`
19. Update imports across backend/frontend
20. Add cross-package `dependencies` in package.json files

---

## Files to Delete

```
# Lock files (5 files)
yarn.lock
src/worker/yarn.lock
src/AgentChat/yarn.lock
src/worker/package-lock.json
src/AgentChat/package-lock.json
src/agentRegistry/package-lock.json
package-lock.json

# Yarn config (3 files/dirs)
src/worker/.yarnrc.yml
src/AgentChat/.yarnrc.yml
.yarn/

# Legacy root code (to move to shared or delete)
agents/
llm/
mcp/
types/
utils/
taskManager/
taskWorker/
_deprecated/

# Old root entry points
index.ts
```

---

## Impact Summary

| Area | Before | After |
|------|--------|-------|
| Package managers | npm + Yarn Classic + Yarn Berry | Bun only |
| Lock files | 5+ (mixed) | 1 (`bun.lock`) |
| Install time | ~60-90s sequential | ~5-10s parallel |
| TS execution | tsx / ts-node / tsc+node | `bun run` (native TS) |
| Package structure | 4 independent packages | Bun workspaces monorepo |
| Shared code | Duplicated | `@ping/shared` |
| TypeScript versions | 3 different | 1 unified |
