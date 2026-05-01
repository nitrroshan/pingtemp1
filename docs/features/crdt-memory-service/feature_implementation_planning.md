# CRDT Memory Service — Implementation Planning

**Parent:** [Feature Architecture](feature_architecture.md)  
**Principle:** Each phase must pass `bun run build:backend` + existing tests with ZERO changes to any consumer.

---

## Exact Breakage Surface (Audited)

Before planning, here's every file that imports the code we're moving:

**`CollabServer` class imported by:**
1. `packages/collaboration/src/L2/L2CollaborationPlugin.ts` — creates embedded server
2. `packages/collaboration/src/L2/index.ts` — re-exports
3. `packages/collaboration/src/index.ts` — re-exports
4. `packages/collaboration/src/standalone.ts` — entry point

**`CollabServer` accessed at runtime by:**
5. `packages/backend/api/SocketServerV2.ts:762` — `plugin.l2Plugin.collabServer` for discussion events

**`HocuspocusBlobStorageAdapter` imported by:**
6. `packages/collaboration/src/L2/collaboration/HocuspocusServer.ts` — internal only

**Nothing in `packages/backend/`, `packages/agent-manager/`, or `packages/frontend/` directly imports `HocuspocusServer.ts` or `HocuspocusBlobStorageAdapter.ts`.** They only use `@ping/collaboration` package exports.

---

## Phase 1: Copy (Don't Move) Server Code to collab-service

**Strategy: COPY first, move later.** Don't delete anything from `packages/collaboration/`. Just copy the server code to the new package and make it build. Zero risk.

**Branch:** `feature/collab-service-v1`

### Step 1.1: Create collab-service package skeleton

**Files to create:**
```
packages/collab-service/
  package.json                     — name: "@ping/collab-service"
  tsconfig.json                    — extends root tsconfig
  src/
    index.ts                       — exports CollabServer
```

**`package.json` deps:** `@hocuspocus/server`, `@hocuspocus/extension-database`, `yjs`, `pino`

**Verify:** `cd packages/collab-service && bun install && bun run tsc --noEmit`

### Step 1.2: Copy server files (don't delete originals)

**Files to COPY (not move):**
- `packages/collaboration/src/L2/collaboration/HocuspocusServer.ts` → `packages/collab-service/src/server/HocuspocusServer.ts`
- `packages/collaboration/src/L2/collaboration/HocuspocusBlobStorageAdapter.ts` → `packages/collab-service/src/server/HocuspocusBlobStorageAdapter.ts`
- `packages/collaboration/src/L2/collaboration/types/collab-provider.types.ts` → `packages/collab-service/src/types/collab-provider.types.ts`
- `packages/collaboration/src/L2/collaboration/types/blob-storage.types.ts` → `packages/collab-service/src/types/blob-storage.types.ts`

**Files to modify:**
- `packages/collab-service/src/server/HocuspocusServer.ts` — fix import paths (logging, types)
- `packages/collab-service/src/index.ts` — export `CollabServer`, `FsBlobStorage`, types

**Verify:**
```bash
cd packages/collab-service && bun run tsc --noEmit    # collab-service builds
cd ../.. && bun run build:backend                       # nothing else changed
```

**What breaks: NOTHING.** Original files untouched. collab-service is a new package nobody imports yet.

### Step 1.3: Add standalone entry point

**Files to create:**
- `packages/collab-service/src/standalone.ts` — copy of `packages/collaboration/src/standalone.ts` but importing from local

**Verify:**
```bash
cd packages/collab-service && bun run src/standalone.ts   # starts on port 1234
curl http://localhost:1234                                  # hocuspocus responds
```

**What breaks: NOTHING.** This is a new file. Original standalone.ts untouched.

### Phase 1 Exit Criteria
- [ ] `collab-service` package builds independently
- [ ] `collab-service` standalone starts Hocuspocus on port 1234
- [ ] `bun run build:backend` passes (ZERO changes to existing code)
- [ ] All existing collab tests pass
- [ ] Original `packages/collaboration/` completely unchanged

---

## Phase 2: Wire Backend to Use collab-service (Optional External Mode)

**Strategy:** Add `COLLAB_MODE=external` support. Default stays `embedded` (existing behavior). Only when explicitly set does the backend connect to external service.

**Branch:** `feature/collab-service-v1.1`  
**Depends on:** Phase 1

### Step 2.1: Add docker-compose entry

**Files to modify:**
- `docker-compose.dev.yml` — add collab service (not started by default)

```yaml
collab:
  build:
    context: .
    dockerfile: packages/collab-service/Dockerfile
  ports:
    - "1234:1234"
  environment:
    - COLLAB_PORT=1234
    - COLLAB_STORAGE_DIR=/data/collab
  profiles: ["collab-external"]    # Only starts with --profile collab-external
```

**What breaks: NOTHING.** Service only starts when explicitly requested with `--profile`.

### Step 2.2: Create Dockerfile for collab-service

**Files to create:**
- `packages/collab-service/Dockerfile`

**What breaks: NOTHING.** New file.

### Step 2.3: Wire COLLAB_MODE env var

**Files to modify:**
- `packages/backend/agentManager/plugins/CollaborationPlugin.ts`

```typescript
// ADD at the top of constructor:
if (process.env.COLLAB_MODE === 'external') {
  const { RemoteCollabClient } = await import("@ping/collaboration");
  config.collabProvider = new RemoteCollabClient(
    process.env.COLLAB_URL || 'ws://localhost:1234',
    process.env.COLLAB_TOKEN,
  );
}
```

**What breaks: NOTHING.** 
- `COLLAB_MODE` is not set by default → existing embedded behavior
- Only when `COLLAB_MODE=external` is explicitly set does it use RemoteCollabClient
- `RemoteCollabClient` already exists and is tested

### Step 2.4: Health check endpoint

**Files to modify:**
- `packages/collab-service/src/standalone.ts` — add Express `GET /health`

**What breaks: NOTHING.** New endpoint on the new service.

### Step 2.5: Integration test

**Files to create:**
- `packages/collab-service/src/__tests__/remote-connect.test.ts`

Test: start collab-service → connect RemoteCollabClient → write Y.Doc → read back → verify match

### Phase 2 Exit Criteria
- [ ] `COLLAB_MODE` unset → same behavior as before (embedded)
- [ ] `COLLAB_MODE=external` + collab-service running → backend connects via WebSocket
- [ ] Write via embedded, read via embedded → works
- [ ] Write via RemoteCollabClient, read via RemoteCollabClient → works
- [ ] `bun run build:backend` passes
- [ ] All existing tests pass

---

## Phase 3: Deprecate Original Server Code

**Strategy:** NOW that collab-service is proven, update `packages/collaboration/` to import from `@ping/collab-service` instead of having its own copy. The original files become thin re-exports.

**Branch:** `feature/collab-service-v2`  
**Depends on:** Phase 2 running in production/staging for at least 1 week

### Step 3.1: Add @ping/collab-service as dependency

**Files to modify:**
- `packages/collaboration/package.json` — add `"@ping/collab-service": "workspace:*"`

### Step 3.2: Re-export from collab-service

**Files to modify:**
- `packages/collaboration/src/L2/collaboration/HocuspocusServer.ts` — replace 502 lines with:
```typescript
// Re-export from @ping/collab-service
export { CollabServer, type DiscussionChangeEvent } from "@ping/collab-service";
```

- `packages/collaboration/src/L2/collaboration/HocuspocusBlobStorageAdapter.ts` — replace 71 lines with:
```typescript
export { FsBlobStorage, HocuspocusBlobStorageAdapter } from "@ping/collab-service";
```

### Step 3.3: Verify ALL consumers still work

```bash
bun run build:backend           # backend compiles
bun run test                    # all tests pass
bun run dev:backend             # embedded mode works
COLLAB_MODE=external bun run dev:backend   # external mode works
```

**What breaks: NOTHING.** Same exports, same types, same behavior. The `import { CollabServer } from "@ping/collaboration"` still works — it just re-exports from `@ping/collab-service` now.

### Step 3.4: Delete standalone.ts from collaboration

**Files to delete:**
- `packages/collaboration/src/standalone.ts` — replaced by `collab-service/src/standalone.ts`

### Phase 3 Exit Criteria
- [ ] `packages/collaboration/` no longer contains server implementation (only re-exports)
- [ ] All existing imports from `@ping/collaboration` still work
- [ ] `bun run build:backend` passes
- [ ] All tests pass
- [ ] embedded and external modes both work

---

## Phase 4: Add Rooms + Auth + Search (Separate Features)

This is where `crdt-search` and `crdt-memory-service` features land. See:
- [crdt-search/feature_architecture.md](../crdt-search/feature_architecture.md) — search extension on collab-service
- [crdt-memory-service/feature_architecture.md](feature_architecture.md) — rooms, auth, ACL on collab-service

These are separate feature branches, not part of the extraction.

---

## Summary

| Phase | What | Risk | Rollback | Verify |
|-------|------|------|----------|--------|
| **1** | Copy server code to new package | **Zero** — nothing changes | Delete collab-service folder | `bun run build:backend` |
| **2** | Add external mode (opt-in env var) | **Zero** — default is embedded | Unset COLLAB_MODE | `bun run build:backend` + manual test |
| **3** | Replace originals with re-exports | **Low** — same types, same API | Revert re-export files | `bun run build:backend` + all tests |
| **4** | Rooms + auth + search (new features) | **Medium** — new code | Feature flags | Feature-specific tests |

**Nothing breaks at any phase because:**
- Phase 1: We COPY, never delete
- Phase 2: Opt-in via env var, default unchanged  
- Phase 3: Re-exports maintain the same public API
- Phase 4: New features, not changes to existing