# Bun Monorepo Migration — Implementation Plan

**Parent:** [feature_architecture.md](./feature_architecture.md)  
**Branch:** `feature/bun-monorepo-migration`  
**Approach:** Option A — Bun Workspaces

## Key Findings

- **3 packages are fully independent** — zero cross-imports between worker, AgentChat, agentRegistry
- **Root-level code is dead** — `agents/`, `llm/`, `types/`, `utils/`, `mcp/`, `taskManager/`, `taskWorker/` are not imported by any active code
- **Root `package.json` dependencies serve legacy code only** — can be eliminated
- **Module system mismatch** — worker & AgentChat are ESM, agentRegistry is CJS (needs `"type": "module"`)
- **Major version conflicts** — @langchain packages: root v0.x vs worker v1.x; mongoose: 3 different versions

## Implementation Steps

### Phase 1: Delete Legacy Root Code
- [x] Step 1: Delete `agents/` folder (dead code, no imports)
- [x] Step 2: Delete `llm/` folder
- [x] Step 3: Delete `types/` folder (root-level, not src/AgentChat/types.ts)
- [x] Step 4: Delete `utils/` folder
- [x] Step 5: Delete `mcp/` folder
- [x] Step 6: Delete `taskManager/` folder
- [x] Step 7: Delete `taskWorker/` folder
- [x] Step 8: Delete `_deprecated/` folder
- [x] Step 9: Remove root-level legacy files (`$Profile`, old study docs)

### Phase 2: Restructure to `packages/`
- [x] Step 10: Move `src/worker/` → `packages/backend/`
- [x] Step 11: Move `src/AgentChat/` → `packages/frontend/`
- [x] Step 12: Move `src/agentRegistry/` → `packages/registry/`
- [x] Step 13: Remove empty `src/` directory

### Phase 3: Create Workspace Configs
- [ ] Step 14: Rewrite root `package.json` as workspace root
- [ ] Step 15: Update `packages/backend/package.json` (name: `@ping/backend`, remove packageManager)
- [ ] Step 16: Update `packages/frontend/package.json` (name: `@ping/frontend`)
- [ ] Step 17: Update `packages/registry/package.json` (name: `@ping/registry`, add `"type": "module"`)
- [ ] Step 18: Create base `tsconfig.json` at root, update per-package tsconfigs to extend it
- [ ] Step 19: Update `packages/backend/tsconfig.json` outDir

### Phase 4: Switch to Bun
- [ ] Step 20: Delete all lock files (yarn.lock ×3, package-lock.json ×4)
- [ ] Step 21: Delete `.yarnrc.yml` files and `.yarn/` directory
- [ ] Step 22: Create `bunfig.toml`
- [ ] Step 23: Run `bun install`
- [ ] Step 24: Update all scripts from yarn/npm/npx/tsx → bun

### Phase 5: Cleanup & Update
- [ ] Step 25: Update `.gitignore` (remove yarn patterns, add bun patterns)
- [ ] Step 26: Update `CLAUDE.md` with new commands
- [ ] Step 27: Update `.vscode/launch.json` paths
- [ ] Step 28: Update `.github/copilot-instructions.md` paths
- [ ] Step 29: Verify build & run

## Rollback Plan
- Git revert to pre-migration commit
- All changes are structural (moves + config), no logic changes
