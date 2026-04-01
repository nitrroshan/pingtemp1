# v2.1 Feature: L2 Search — Hocuspocus Search Extension

> **Goal:** Give agents instant search, grep, and structured query over all L2 team-shared state (CRDT docs, plans, output manifests) — faster than L1 disk-based tools  
> **Duration:** 3-4 days  
> **Priority:** 🔴 Critical — Agents currently must read entire L2 docs to find relevant information  
> **Dependencies:** v1.1 (L2 CollaborationSpace, collab tool)  
> **Research:** [L2_SEARCH_RESEARCH.md](../L2_SEARCH_RESEARCH.md) §9-12, [VIRTUAL_FILESYSTEM_RESEARCH.md](../VIRTUAL_FILESYSTEM_RESEARCH.md)

---

## Technology Decisions (Locked)

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Search engine** | MiniSearch (in-memory, BM25) | Proven incremental add/remove, team familiarity. Already used by L1 (root `package.json`), needs explicit install in `src/worker/package.json`. |
| **Structured queries** | JSONPath via `jsonpath-plus` | ~13KB, no index needed, runs on live `Y.Doc.toJSON()` — perfect for plan/status filtering |
| **Where index lives** | Hocuspocus server process (as Extension) | Single shared index, always warm, zero agent cost, survives doc unloads |
| **Agent ↔ server** | **Dual mode:** In-process direct calls (embedded) or HTTP via `onRequest` (when port available / remote) | In-process = zero latency; HTTP = same port as WebSocket, no new infra |
| **Index updates** | `afterLoadDocument` + `onStoreDocument` hooks | Debounced (2s), receives full Y.Doc |
| **Text extraction** | Existing `xmlFragmentToText()` + `Y.Map.toJSON()` + `Y.Text.toString()` | Already implemented |
| **Changelog** | Ring buffer maintained by `onStoreDocument` hook (debounced, not per-keystroke) | Powers the `/whatsnew` endpoint — coalesces rapid changes |

---

## Branch

`feature/memory-system-v2.1`

---

## Scope — What's Included

### In Scope
- Hocuspocus `SearchExtension` class with MiniSearch index
- HTTP endpoints: `/search`, `/grep`, `/ls`, `/cat`, `/query`, `/whatsnew`, `/stat`, `/stats` (served when port available)
- In-process API: direct method calls on `SearchExtension` (embedded mode without port)
- Virtual path schema: `/crdt/{doc}/{key}`, `/plans/{planId}`, `/outputs/{taskId}`
- Agent-facing `l2` tool with verbs: search, grep, ls, cat, query, find, whatsnew, stat
- Startup indexing of all persisted docs
- Changelog ring buffer for "what's new" tracking
- Text extraction from all Yjs shared types (Y.Map, Y.Array, Y.XmlFragment, Y.Text)
- Role-filtered search results
- Output manifest indexing

### Out of Scope (Future)
- Semantic/vector search (upgrade to Orama when keyword proves insufficient)
- Removing `projectToFilesystem()` (defer until `l2` tool is proven)
- Find-all-references at L1 (separate feature)
- Context budget management (cross-cutting concern)
- Remote Hocuspocus server deployment guide (remote mode works once the server has SearchExtension — deployment is ops concern)

---

## Implementation Steps

### Phase 1: Foundation — Search Extension + Index (Day 1)

#### Step 1.1: Install dependencies
- [ ] Add `minisearch` to `src/worker/package.json`
- [ ] Add `jsonpath-plus` to `src/worker/package.json`
- [ ] `yarn install` from `src/worker/`

**Files:** `src/worker/package.json`

#### Step 1.2: Create search types
- [ ] Create `src/worker/memory/L2/collaboration/types/search.types.ts`
- [ ] Define: `L2SearchResult`, `L2GrepResult`, `L2StatResult`, `L2ChangeEntry`, `SearchExtensionConfig`
- [ ] Export from `src/worker/memory/L2/collaboration/types/` barrel (if one exists, else from search.types.ts directly)

```typescript
// Key types to define:
interface L2SearchResult {
  docName: string;
  docType: 'crdt' | 'plan' | 'output';
  key?: string;
  content: string;  // snippet
  score: number;
  role?: string;
}

interface L2GrepResult {
  docName: string;
  docType: 'crdt' | 'plan' | 'output';
  key?: string;
  line: number;
  content: string;  // matching line
}

interface L2StatResult {
  path: string;
  type: 'file' | 'directory';
  size: number;  // bytes of serialized content
  keys?: number; // for Y.Map docs
  lastModified?: string;
}

interface L2ChangeEntry {
  timestamp: number;
  docName: string;
  action: 'created' | 'updated' | 'deleted';
  summary: string; // brief description of what changed
}
```

**Files:** New `src/worker/memory/L2/collaboration/types/search.types.ts`

#### Step 1.3: Create the SearchExtension class
- [ ] Create `src/worker/memory/L2/collaboration/SearchExtension.ts`
- [ ] Implement Hocuspocus `Extension` interface
- [ ] Core responsibilities:
  - Maintain MiniSearch index as instance state
  - `afterLoadDocument` — index doc content on load
  - `onStoreDocument` — re-index on change AND append to changelog (already debounced by Hocuspocus at 2s — avoids per-keystroke flooding from `onChange`)
  - `onRequest` — route HTTP requests to handler methods (only fires when server port is active)
  - `afterUnloadDocument` — keep index entries (don't delete on unload — index survives doc lifecycle)
  - Public methods: `search()`, `grep()`, `whatsnew()`, `getStats()` — callable directly in-process (not just via HTTP)

**MiniSearch configuration:**
```typescript
new MiniSearch({
  fields: ['content', 'title', 'key'],
  storeFields: ['docName', 'docType', 'key', 'role', 'content', 'title'],
  searchOptions: { fuzzy: 0.2, prefix: true },
})
```

**Text extraction strategy per Yjs shared type:**
| Shared type | Extraction | Document ID format |
|---|---|---|
| `Y.Map` | `map.toJSON()` → JSON.stringify each key-value | `{docName}:{key}` |
| `Y.Array` | Each item → JSON.stringify | `{docName}:arr:{index}` |
| `Y.XmlFragment` | `xmlFragmentToText()` (existing helper) | `{docName}:content` |
| `Y.Text` | `.toString()` | `{docName}:text` |
| Plan tasks | Each task: `title + description + assignedRole` | `plan:{planId}:{taskId}` |
| Output manifests | `activitySummary + role + outputs` | `output:{taskId}` |

**Key methods:**
- `indexDoc(docName: string, doc: Y.Doc)` — extract text from all shared types, add to MiniSearch
- `removeDoc(docName: string)` — remove all entries for a doc from MiniSearch
- `indexPlan(stored: StoredPlan)` — index plan tasks
- `indexManifest(manifest: OutputManifest)` — index output manifest
- `search(query: string, opts?)` → `L2SearchResult[]`
- `grep(pattern: string, opts?)` → `L2GrepResult[]`

**Changelog ring buffer:**
- Max 1000 entries (configurable)
- Each entry: `{ timestamp, docName, action, summary }`
- `onStoreDocument` appends (NOT `onChange` — `onChange` fires per-keystroke and would flood the buffer). `onStoreDocument` is debounced at 2s by Hocuspocus with a 10s max, and fires on last client disconnect — perfect for meaningful changelog entries.
- `whatsnew(since)` filters by timestamp

**Files:** New `src/worker/memory/L2/collaboration/SearchExtension.ts`  
**Dependencies:** MiniSearch, types from Step 1.2  
**Estimated:** ~250-350 lines

---

### Phase 2: Path Resolver + HTTP Endpoints (Day 1-2)

#### Step 2.1: Create CrdtPathResolver
- [ ] Create `src/worker/memory/L2/collaboration/CrdtPathResolver.ts`
- [ ] Map virtual paths to CRDT/Plan/Output data sources
- [ ] Methods:
  - `resolve(path: string)` → `{ type: 'file' | 'directory', content?, entries?, stat? }`
  - `glob(pattern: string)` → `string[]` (match virtual paths by name pattern)

**Path schema:**
```
/                           → { type: 'directory', entries: ['crdt/', 'plans/', 'outputs/'] }
/crdt/                      → { type: 'directory', entries: docNames }
/crdt/{docName}             → { type: 'file', content: Y.Map.toJSON() as JSON }
/crdt/{docName}/{key}       → { type: 'file', content: map.get(key) as JSON }
/plans/                     → { type: 'directory', entries: planMetas }
/plans/{planId}             → { type: 'file', content: StoredPlan as JSON }
/plans/{planId}/tasks       → { type: 'file', content: plan.tasks as JSON }
/plans/{planId}/tasks/{id}  → { type: 'file', content: singleTask as JSON }
/outputs/                   → { type: 'directory', entries: manifestIds }
/outputs/{taskId}           → { type: 'file', content: OutputManifest as JSON }
```

**Files:** New `src/worker/memory/L2/collaboration/CrdtPathResolver.ts`  
**Dependencies:** CollaborationSpace, PlanStore, L2CollaborationPlugin  
**Estimated:** ~150-200 lines

#### Step 2.2: Wire HTTP endpoints into SearchExtension.onRequest
- [ ] Parse `request.url` and route to handlers
- [ ] Implement each endpoint:

| Endpoint | Handler | Returns |
|---|---|---|
| `GET /search?q={query}&limit=20&role={role}` | `this.search(query, { limit, role })` | `L2SearchResult[]` |
| `GET /grep?pattern={regex}&doc={docFilter}` | `this.grep(pattern, { doc })` | `L2GrepResult[]` |
| `GET /ls?path={path}` | `resolver.resolve(path)` when type=directory | Directory entries |
| `GET /cat?path={path}` | `resolver.resolve(path)` when type=file | File content |
| `GET /query?path={jsonpath}&data={docName}` | JSONPath on live Y.Doc.toJSON() or plan JSON | Matched values |
| `GET /stat?path={path}` | `resolver.stat(path)` | `L2StatResult` |
| `GET /whatsnew?since={timestamp}` | Filter changelog by timestamp | `L2ChangeEntry[]` |
| `GET /stats` | MiniSearch document count, index stats | Index metadata |

**Response format:** All endpoints return JSON with `{ ok: true, data: ... }` or `{ ok: false, error: "..." }`.

**Error handling:** Invalid paths → 404. Bad regex → 400. Server errors → 500.

**Files:** Modify `SearchExtension.ts` (add `onRequest` handling)  
**Dependencies:** CrdtPathResolver from Step 2.1, `jsonpath-plus`  
**Estimated:** ~150-200 lines added to SearchExtension

---

### Phase 3: Agent Tool (Day 2)

#### Step 3.1: Create the `l2` agent tool
- [ ] Create `src/worker/memory/L2/tools/searchTool.ts`
- [ ] Build a `createL2SearchTool(searchExtensionOrUrl: SearchExtension | string)` factory function
- [ ] **Dual mode:** accepts either a `SearchExtension` instance (embedded, direct calls) or a URL string (remote, HTTP calls)
- [ ] Actions: `search`, `grep`, `ls`, `cat`, `query`, `find`, `whatsnew`, `stat`
- [ ] All query parameters must be URL-encoded via `encodeURIComponent()` when using HTTP mode (especially JSONPath with `$`, `[`, `?`, `@`, `'` characters)

**Tool schema:**
```typescript
z.object({
  action: z.enum(['search', 'grep', 'ls', 'cat', 'query', 'find', 'whatsnew', 'stat']),
  input: z.string().describe('Search query, grep pattern, path, JSONPath expression, or timestamp'),
  options: z.object({
    limit: z.number().optional(),
    role: z.string().optional(),
    doc: z.string().optional(),
  }).optional(),
})
```

**Each action maps to an HTTP call:**
| Action | HTTP call | Agent sees |
|---|---|---|
| `search "auth JWT"` | `GET /search?q=auth+JWT&limit=20` | Ranked results with snippets |
| `grep "TODO\|FIXME"` | `GET /grep?pattern=TODO%7CFIXME` | `docName:key:line: content` (grep format) |
| `ls /crdt/` | `GET /ls?path=/crdt/` | Directory listing |
| `cat /crdt/shared-context` | `GET /cat?path=/crdt/shared-context` | JSON content |
| `query $.tasks[?(@.status=='completed')]` | `GET /query?path=...` | Filtered JSON array |
| `find *.json` | `GET /ls?path=/&glob=*.json` | Matching paths |
| `whatsnew` (with since option) | `GET /whatsnew?since=...` | Change entries |
| `stat /crdt/shared-context` | `GET /stat?path=/crdt/shared-context` | File metadata |

**HTTP client (remote mode):** Use Node.js built-in `fetch()` (available in Node 18+). No new deps.  
**Direct calls (embedded mode):** Call `searchExtension.search()`, `searchExtension.grep()`, `resolver.resolve()` etc. directly. Zero latency.

**Files:** New `src/worker/memory/L2/tools/searchTool.ts`  
**Estimated:** ~180-250 lines

#### Step 3.2: Determine the search access mode
- [ ] In **embedded mode with port**: `collabPort` is set → HTTP URL is `http://localhost:{collabPort}`. Tool can use either HTTP or direct calls (prefer direct for speed).
- [ ] In **embedded mode without port** (common case): No HTTP server running. Tool MUST use direct calls to the `SearchExtension` instance. This is actually **faster** than HTTP — zero network overhead.
- [ ] In **remote mode**: `RemoteCollabClient` has the server URL. Derive HTTP URL: `this.serverUrl.replace(/^ws/, 'http')`. Tool uses HTTP.
- [ ] Add a `getSearchAccess()` method to `L2CollaborationPlugin` that returns either `{ mode: 'direct', extension: SearchExtension }` or `{ mode: 'http', url: string }`.

**Files:** Modify `L2CollaborationPlugin.ts`

#### Step 3.3: Wire tool into agent initialization
- [ ] **Key fix:** `WorkerPool.ts` currently imports `createCollabTool` directly and does NOT call `l2.createTools()`. Must fix this.
- [ ] **Option A (recommended):** Refactor `WorkerPool.ts` to call `l2.createTools(space, roleKey, repoPath)` instead of `createCollabTool()` directly. This aligns with the L3 pattern (which already calls `l3.createTools()`). Then `L2CollaborationPlugin.createTools()` returns both tools.
- [ ] **Option B:** Keep WorkerPool's direct import, add a second import for `createL2SearchTool`, push both tools.
- [ ] Update `L2CollaborationPlugin.createTools()` to return both `collab` tool AND `l2` search tool
- [ ] The `collab` tool remains for write operations (write, write-block)
- [ ] The `l2` tool handles all search/read operations

**Files:** Modify `WorkerPool.ts` (critical — the actual injection point), `L2CollaborationPlugin.ts` `createTools()`, `L2/tools/index.ts` (add export)

**Alternative approach:** Instead of two separate tools, extend the existing `collab` tool with new actions (`search`, `grep`, `ls`, `cat`, `query`, `find`, `whatsnew`, `stat`). This avoids WorkerPool changes. Decision: **Use a separate `l2` tool** — clearer separation of concerns (read/search vs. collaborate/write), and the WorkerPool refactor to use `createTools()` is a worthwhile cleanup.

---

### Phase 4: Registration + Startup Indexing (Day 2-3)

#### Step 4.1: Register SearchExtension in CollabServer
- [ ] Create `SearchExtension` in `L2CollaborationPlugin.initialize()` (not in CollabServer constructor)
- [ ] Register via direct push: `collabServer.instance.configuration.extensions.push(searchExtension)`
- [ ] **WARNING:** Do NOT use `instance.configure({ extensions: [...] })` — it re-pushes inline hooks (`onChange`, `onAuthenticate`) every time, causing duplicate event handling.
- [ ] `CollabServer` already exposes `get instance(): Hocuspocus` — no modification needed to `HocuspocusServer.ts`.
- [ ] Pass PlanStore, repoPath, and the L2 plugin itself to SearchExtension constructor for plan/manifest access
- [ ] Store the SearchExtension instance on the plugin for direct access by the `l2` tool

**Files:** Modify `L2CollaborationPlugin.ts` only (create + register extension, store reference)

#### Step 4.2: Startup indexing
- [ ] On `L2CollaborationPlugin.initialize()`, after creating and registering the SearchExtension:
  1. Get all persisted doc names via `collabServer.getDocNames()`
  2. For each doc, call `collabServer.instance.openDirectConnection(docName)` → get `DirectConnection` object → extract text from `connection.document` → index via `searchExtension.indexDoc()`
  3. **Do NOT call `connection.disconnect()`** — this unloads the doc from Hocuspocus memory and triggers full lifecycle hooks. Instead, just let the DirectConnection be garbage collected. The Hocuspocus `Document` stays loaded because the DirectConnection holds a reference.
  4. **Alternative approach:** Index inside `afterLoadDocument` hook. Since `openDirectConnection` triggers `afterLoadDocument` on the SearchExtension, the extension can self-index. This means startup code just needs to open+close connections to trigger the hook chain. Closing IS safe if we accept that the doc may unload and the index entry becomes a snapshot.
  5. Index all plans via `planStore.listAllPlans()` → load each → index
  6. Index all output manifests via `getAllManifests(repoPath)`
- [ ] Log startup indexing stats: "Indexed N CRDT docs, M plans, K manifests in Xms"
- [ ] **Staleness note:** CRDT docs that unload after startup indexing won't get re-indexed until someone opens them again (triggering `afterLoadDocument`). At L2 scale this is acceptable — docs change only when agents connect, which triggers a load.

**Performance:** At L2 scale (~10-30 docs, ~5-10 plans, ~10-20 manifests), startup indexing should take <1 second.

**Files:** Modify `L2CollaborationPlugin.ts`

#### Step 4.3: Remote mode support
- [ ] In remote mode (`RemoteCollabClient`), the SearchExtension runs on the **remote server**, not locally
- [ ] The `l2` tool calls HTTP endpoints on the remote server URL
- [ ] No local SearchExtension is created — it's a server-side concern
- [ ] `L2CollaborationPlugin.getSearchAccess()` returns `{ mode: 'http', url: remoteHttpUrl }` in remote mode
- [ ] HTTP base URL derived from WebSocket URL inline in the plugin — one-liner `serverUrl.replace(/^ws/, 'http')`, no need to modify `RemoteCollabClient.ts`
- [ ] **Prerequisite:** The remote Hocuspocus server must have SearchExtension registered. This is a deployment concern, not an implementation step. Document in README/deployment guide.

**Files:** Modify `L2CollaborationPlugin.ts` (remote URL derivation)

---

### Phase 5: Barrel Exports + Tests (Day 3)

#### Step 5.1: Update barrel exports + cleanup
- [ ] Update `src/worker/memory/L2/index.ts` — export SearchExtension, createL2SearchTool, search types
- [ ] Update `src/worker/memory/L2/tools/index.ts` — export search tool factory
- [ ] Add `SearchExtension` cleanup in `L2CollaborationPlugin.dispose()` — clear the MiniSearch index and changelog to free memory

**Files:** Modify `L2/index.ts`, `L2/tools/index.ts`, `L2CollaborationPlugin.ts` (`dispose()` method)

#### Step 5.2: Unit tests for SearchExtension
- [ ] Create `src/worker/memory/L2/collaboration/__tests__/SearchExtension.test.ts`
- [ ] Test scenarios:
  - Index a Y.Map doc → search finds content
  - Index a Y.XmlFragment doc → search finds text
  - Index a plan → search finds task descriptions
  - Index an output manifest → search finds activity summary
  - Grep with regex → returns matching lines
  - Changelog → whatsnew returns recent changes
  - Remove doc → search no longer finds content
  - JSONPath query → returns filtered results

**Files:** New test file  
**Estimated:** ~150-200 lines

#### Step 5.3: Unit tests for CrdtPathResolver
- [ ] Create `src/worker/memory/L2/collaboration/__tests__/CrdtPathResolver.test.ts`
- [ ] Test scenarios:
  - `/` → lists root categories
  - `/crdt/` → lists doc names
  - `/crdt/{docName}` → returns full doc JSON
  - `/crdt/{docName}/{key}` → returns specific key
  - `/plans/` → lists plan metadata
  - `/plans/{planId}/tasks/{taskId}` → returns specific task
  - Invalid path → error
  - `/outputs/{taskId}` → returns manifest

**Files:** New test file  
**Estimated:** ~100-150 lines

#### Step 5.4: Integration test for the `l2` tool
- [ ] Create `src/worker/memory/L2/tools/__tests__/searchTool.test.ts`
- [ ] Test with a mock HTTP server that simulates SearchExtension responses
- [ ] Verify each action (search, grep, ls, cat, query, whatsnew, stat) formats output correctly for agents

**Files:** New test file  
**Estimated:** ~100-150 lines

---

### Phase 6: Documentation + Cleanup (Day 3-4)

#### Step 6.1: Update feature architecture doc
- [ ] Update `docs/features/memory-system/feature_architecture.md` — add L2 Search section
- [ ] Document the SearchExtension as part of the L2 architecture
- [ ] Update the L2 data flow diagram to include search

**Files:** Modify `feature_architecture.md`

#### Step 6.2: Update copilot instructions
- [ ] Update `.github/copilot-instructions.md` — add L2 search tool documentation
- [ ] Document `l2` tool actions and their usage patterns
- [ ] Add to "Key files" section

**Files:** Modify `.github/copilot-instructions.md`

#### Step 6.3: Update CLAUDE.md
- [ ] Add L2 search to the architecture section
- [ ] Document the HTTP endpoints

**Files:** Modify `CLAUDE.md`

---

## File Summary

### New Files (6)
| File | Purpose | Est. Lines |
|------|---------|-----------|
| `L2/collaboration/SearchExtension.ts` | MiniSearch index + HTTP endpoints + changelog + public API | 450-550 |
| `L2/collaboration/CrdtPathResolver.ts` | Virtual path → CRDT/Plan/Output resolver | 150-200 |
| `L2/collaboration/types/search.types.ts` | Search result types, stat types, change entries | 50-80 |
| `L2/tools/searchTool.ts` | Agent-facing `l2` tool (dual mode: direct calls or HTTP) | 180-250 |
| `L2/collaboration/__tests__/SearchExtension.test.ts` | Unit tests for search + index | 150-200 |
| `L2/collaboration/__tests__/CrdtPathResolver.test.ts` | Unit tests for path resolver | 100-150 |

### Modified Files (6)
| File | Change | Lines Changed |
|------|--------|------|
| `src/worker/package.json` | Add `minisearch`, `jsonpath-plus` deps | 2 |
| `src/worker/services/WorkerPool.ts` | Refactor L2 tool injection to call `l2.createTools()` instead of `createCollabTool()` directly | 5-10 |
| `L2/L2CollaborationPlugin.ts` | Create SearchExtension in `initialize()`, store ref, `getSearchAccess()`, update `createTools()`, cleanup in `dispose()` | 40-60 |
| `L2/index.ts` | Export new classes/types | 5-10 |
| `L2/tools/index.ts` | Export `createL2SearchTool` | 2-5 |
| `.github/copilot-instructions.md` | Document `l2` tool | 20-30 |

**NOT modified** (no changes needed):
- `L2/collaboration/HocuspocusServer.ts` — `instance` getter already exists
- `L2/collaboration/RemoteCollabClient.ts` — HTTP URL derived in plugin, not client

### Total Estimated New Code
~1100-1500 lines of implementation + ~350-500 lines of tests

---

## Testing Strategy

| Level | What | How |
|-------|------|-----|
| **Unit** | SearchExtension index operations | Create Y.Docs in-memory, index them, verify search/grep results |
| **Unit** | CrdtPathResolver path resolution | Mock CollaborationSpace/PlanStore, verify path→data mapping |
| **Unit** | `l2` tool HTTP client | Mock HTTP server responses, verify tool output formatting |
| **Integration** | Full extension in Hocuspocus | Start a real HocuspocusHTTPServer with SearchExtension, verify HTTP endpoints return correct data |
| **E2E** | Agent uses `l2` tool in a task | Create a test agent with the `l2` tool, run a task that requires searching L2 state |

**Run with:** `cd src/worker && yarn test` (Vitest)

---

## Rollback Plan

1. The feature is **additive** — new files, minimal modifications to existing code
2. The `collab` tool remains unchanged — agents that don't use `l2` are unaffected
3. If SearchExtension causes issues, remove it from the extensions array in L2CollaborationPlugin
4. If the `l2` tool causes confusion, stop returning it from `createTools()`
5. `projectToFilesystem()` is NOT removed in this version — it remains as a fallback

---

## Known Tradeoffs

| Tradeoff | Decision | Rationale |
|---|---|---|
| Index staleness after doc unload | Accept | CRDT docs only change when agents connect → `afterLoadDocument` re-indexes. At L2 scale, staleness window is negligible. |
| Per-keystroke changelog noise | Use `onStoreDocument` instead of `onChange` | `onStoreDocument` is debounced at 2s/10s by Hocuspocus. Produces meaningful entries, not noise. |
| Two L2 tools vs one | Separate `l2` (search/read) from `collab` (write) | Clearer agent mental model. Worth the WorkerPool refactor. |
| Remote mode prereq | Document, don't implement server deploy | The SearchExtension is pure TypeScript — any Hocuspocus server can use it. Deployment is an ops concern. |

---

## Success Criteria

- [ ] Agent can `l2 search "authentication"` and get ranked results across all L2 content in <10ms
- [ ] Agent can `l2 grep "TODO"` and get regex matches in ripgrep-like format in <10ms
- [ ] Agent can `l2 ls /crdt/` and see all CRDT doc names
- [ ] Agent can `l2 cat /crdt/shared-context/blockers` and read specific keys
- [ ] Agent can `l2 query "$.tasks[?(@.assignedRole=='researcher')]"` and get filtered results
- [ ] Agent can `l2 whatsnew --since=...` and see what changed
- [ ] L2 grep is measurably faster than L1 grep (no process spawn, no disk I/O)
- [ ] All tests pass
- [ ] Works in embedded mode (direct calls) without `collabPort` configured
- [ ] Works in embedded mode with `collabPort` (HTTP endpoints available)
- [ ] Remote mode: `l2` tool can reach HTTP endpoints on remote Hocuspocus server
