# Virtual Filesystem Abstraction Over Remote Yjs/CRDT Documents

> **Scope:** Architectural patterns for exposing remote Hocuspocus CRDT state as a filesystem-like interface to AI agents  
> **Date:** March 2026  
> **Status:** Research Only — no implementation  
> **Depends on:** [crdt-filesystem-projection.md](../../ping/crdt-filesystem-projection.md), [L2_SEARCH_RESEARCH.md](L2_SEARCH_RESEARCH.md), [feature_architecture.md](feature_architecture.md)

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [A — Virtual Filesystem Abstractions](#2-a--virtual-filesystem-abstractions)
3. [B — Search Over Virtual Filesystems](#3-b--search-over-virtual-filesystems)
4. [C — Agent UX Patterns](#4-c--agent-ux-patterns)
5. [D — Industry Examples](#5-d--industry-examples)
6. [Evaluation Matrix](#6-evaluation-matrix)
7. [Recommendation](#7-recommendation)

---

## 1. Problem Statement

### The Three Memory Layers

| Layer | Storage | Agent Interface | Filesystem Feel? |
|-------|---------|----------------|-----------------|
| **L1** (per-agent workspace) | Real git repo on disk | `workspace_grep`, `workspace_glob`, `read_file`, `find_symbol`, `get_repo_map`, `keyword_search` | ✅ Full filesystem |
| **L2** (team-shared) | Remote Hocuspocus Yjs CRDT docs | `collab` tool: `discover/list/read/write/write-block/read-block` | ❌ Database-like |
| **L3** (knowledge base) | MongoDB Atlas RAG | Semantic search API | ❌ Not relevant here |

### Why This Matters

Agents are trained to think in **filesystem terms** — grep, glob, read files, search content. The current `collab` tool presents L2 as a database with progressive discovery (`discover` → `list` → `read`), which is effective but cognitively foreign to agents that expect to browse, grep, and glob.

The existing [crdt-filesystem-projection.md](../../ping/crdt-filesystem-projection.md) proposed materialization approaches (write CRDT state to disk as real files at `.ping/collaboration/`). That works when Hocuspocus runs **in-process** or on the same machine. But when Hocuspocus is a **remote server** (separate machine/container), writing to the agent's local disk requires:

1. Network round-trip to fetch each Y.Doc
2. Hydration (`Y.applyUpdate()`) in the agent process  
3. Serialization to JSON/Markdown
4. Disk write
5. All of this before the agent can even `read_file`

This pipeline is workable for "snapshot before planning" (Approach C from the projection doc) but doesn't scale to continuous access scenarios where multiple workers need near-real-time L2 reads.

### The Core Question

> **Can we give agents a filesystem-like experience over remote CRDT state — with grep, glob, and path-based reads — without materializing real files to disk?**

### Constraints

- Hocuspocus runs on a **remote server** (not co-located with agents)
- Agent processes connect via `RemoteCollabClient` (WebSocket `HocuspocusProvider`)
- The `ICollabProvider` interface (`openDoc(docName) → Y.Doc`, `getDocNames() → string[]`) is the agent-side API
- `CollaborationSpace` namespaces docs with `{teamId}/{goalId}/` prefixes
- L1 tools (`workspace_grep`, `read_file`, etc.) use real `fs` module under the hood
- Agent count: 3-8 concurrent workers + 1 planner per goal
- L2 doc count: typically 3-10 CRDT docs per goal (shared-context, agent-statuses, chat-outcomes, plus 1-5 custom/editor docs)
- Data volume: Each CRDT doc typically ~1-50 KB materialized

---

## 2. A — Virtual Filesystem Abstractions

### A1. FUSE (Filesystem in Userspace)

**What it is:** The FUSE kernel interface lets userspace programs implement a filesystem. The kernel intercepts `open()`, `read()`, `readdir()`, etc. and calls your handler. Processes see a real mounted directory — `ls`, `cat`, `grep` all work transparently.

**Node.js bindings:**

| Library | npm weekly | Status | Platform |
|---------|-----------|--------|----------|
| `fuse-native` | ~1.3K | Active (2024), uses NAPI | Linux, macOS. Windows via WinFsp (experimental). |
| `node-fuse-bindings` | ~200 | Fork of fuse-native | Linux, macOS |
| `@aspect-build/rules_js` | N/A | Bazel-specific FUSE | Linux only |
| `winfsp` (WinFsp) | N/A | C library, would need N-API bindings | Windows only |

**How it would work:**

```
mount point: /tmp/ping-l2/
             ├── plans/
             │   └── {planId}.json        ← FUSE read → PlanStore.loadPlan()
             ├── outputs/
             │   └── {taskId}.json        ← FUSE read → l2.getOutputManifest()
             ├── crdt/
             │   ├── shared-context.json  ← FUSE read → openDoc("shared-context") → map.toJSON()
             │   ├── agent-statuses.json  ← FUSE read → openDoc("agent-statuses") → map.toJSON()
             │   ├── chat-outcomes/
             │   │   └── session-001.json ← FUSE read → openDoc("chat-outcomes") → array[0]
             │   └── documents/
             │       └── design-spec.md   ← FUSE read → openDoc("doc-design") → yDocToBlocks → blocksToMarkdownLossy
             └── .search                  ← special file? grep-like interface?
```

The FUSE handler intercepts each syscall:
- `readdir("/crdt/")` → `space.listDocs()` → return directory entries
- `read("/crdt/shared-context.json")` → `space.openDoc("shared-context")` → `map.toJSON()` → return JSON string
- `stat("/crdt/documents/design-spec.md")` → return synthetic stat with size = serialized length

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Works with remote Yjs?** | ✅ Yes — FUSE handler calls `RemoteCollabClient.openDoc()` over WebSocket |
| **Familiar filesystem verbs?** | ✅ Perfect — `ls`, `cat`, `grep`, `find` all work natively. Any program that uses `open()/read()` works. |
| **Search/grep/glob?** | ✅ Standard tools work — `grep -r "auth" /tmp/ping-l2/` traverses all docs via FUSE reads |
| **Implementation complexity** | 🔴 **High** — FUSE requires OS-level setup (kernel module on Linux, macOS FUSE/osxfuse, WinFsp on Windows). Platform-specific. Need to handle stale file handles, caching, stat sizes, error mapping. Production FUSE filesystems are notoriously hard to get right. |
| **Latency** | ⚠️ **Per-syscall network trip** — Every `read()` triggers a WebSocket message + Yjs sync if doc not cached. `grep` across 10 docs = 10 `openDoc()` calls. First access is ~50-200ms (WebSocket sync), subsequent reads from cached Y.Doc are ~1ms. |
| **Caching** | Built-in via `HocuspocusProvider` — once synced, the local Y.Doc replica is live-updated via WebSocket. First access is slow, subsequent reads are instant. |

**Honest Assessment:**

FUSE is the **gold standard for transparency** — agents wouldn't know the difference between L1 and L2 files. But the implementation cost is enormous:

1. **Platform portability nightmare.** The dev team works on Windows (WinFsp), CI is likely Linux. macOS needs different FUSE. Three separate platform paths.
2. **Node.js FUSE bindings are fragile.** `fuse-native` has ~1.3K weekly downloads. When it breaks, you're debugging C/kernel interactions.
3. **Process lifecycle complexity.** The FUSE mount must outlive the agent. If the agent crashes, the mount becomes stale. Need cleanup handlers, signal traps, umount on exit.
4. **Docker/container complexity.** If agents run in containers, FUSE requires `--privileged` or `SYS_ADMIN` capability. Security teams hate this.
5. **Debugging is awful.** When `grep` hangs because a WebSocket timed out inside a FUSE handler, the error surfaces as an I/O error in the agent process with no useful context.

**Verdict:** Technically beautiful, practically dangerous. Only consider if the team has deep systems programming experience and the deployment target is a single Linux platform.

---

### A2. Custom `fs` Module Overlay / memfs

**What it is:** Replace the `fs` module (or intercept it) with an in-memory filesystem backed by CRDT state. Libraries like `memfs` provide a full `fs`-compatible API in memory. `unionfs` merges multiple filesystem implementations.

**Key libraries:**

| Library | npm weekly | What it does |
|---------|-----------|-------------|
| `memfs` | ~11.6M | In-memory filesystem with full `fs` API (sync + async + promises) |
| `unionfs` | ~353K | Merges multiple `fs` implementations into one |
| `linkfs` | ~24K | Rewrites paths before delegating to another `fs` |
| `fs-monkey` | ~10.6M | Patches `require('fs')` globally to redirect to a custom `fs` |

**How it would work:**

```typescript
import { Volume } from 'memfs';
import { ufs } from 'unionfs';
import * as realFs from 'fs';

// Create an in-memory volume representing L2
const l2Volume = Volume.fromJSON({});

// Populate from CRDT state (one-time or on-change)
async function syncCrdtToMemfs(space: CollaborationSpace) {
  const docs = await space.listDocs();
  for (const docName of docs) {
    const doc = await space.openDoc(docName);
    const json = doc.toJSON();
    l2Volume.writeFileSync(
      `/.ping/collaboration/${docName}.json`, 
      JSON.stringify(json[docName] ?? json, null, 2)
    );
  }
}

// Union: real disk (L1) + memory volume (L2)
ufs.use(realFs).use(l2Volume);

// Now: ufs.readFileSync('/.ping/collaboration/shared-context.json') → CRDT data
// And: ufs.readFileSync('/src/main.ts') → real file from disk
```

**The catch:** L1 agent tools use `require('fs')` or `import fs from 'fs'` directly. To intercept transparently:

**Option 1: `fs-monkey` global patch**
```typescript
import { patchFs } from 'fs-monkey';
patchFs(ufs);
// Now ALL fs calls in the process go through unionfs
// DANGER: Affects EVERYTHING — logging, config loading, npm, etc.
```

**Option 2: Inject custom `fs` into agent tools**
```typescript
// Agent tools accept an `fs` parameter instead of importing directly
function createReadFileTool(filesystem: typeof fs) {
  return tool(async ({ path }) => {
    return filesystem.readFileSync(path, 'utf-8');
  }, { ... });
}

// Create with the union filesystem
const readFile = createReadFileTool(ufs);
```

**Option 3: Path-aware interceptor (no `fs` replacement needed)**
```typescript
// In each tool implementation, check if path is under .ping/collaboration/
async function readFileHandler(path: string): Promise<string> {
  if (path.startsWith('.ping/collaboration/')) {
    // Route to CRDT
    const docName = extractDocName(path); // '.ping/collaboration/shared-context.json' → 'shared-context'
    const doc = await space.openDoc(docName);
    return JSON.stringify(doc.toJSON(), null, 2);
  }
  // Real filesystem
  return fs.readFileSync(path, 'utf-8');
}
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Works with remote Yjs?** | ✅ Yes — memfs is populated from `RemoteCollabClient.openDoc()` results |
| **Familiar filesystem verbs?** | ⚠️ Depends on approach. Option 1 (global patch) = transparent. Option 2 (inject fs) = requires tool changes. Option 3 (path interceptor) = custom per-tool. |
| **Search/grep/glob?** | ⚠️ **Only if L1 tools use the patched `fs`.** `grep` tool uses `ripgrep` (external binary) — it won't see memfs files. `glob` tool uses `fast-glob` which reads real disk. These would need separate handling. |
| **Implementation complexity** | 🟡 Medium — memfs/unionfs are mature and well-tested. The complexity is in the integration: patching `fs` safely (Option 1) or modifying every tool (Options 2/3). |
| **Latency** | ✅ After initial sync, reads from memfs are ~microseconds. The question is when/how often to sync. |
| **Caching** | ✅ memfs IS the cache. Invalidation via Yjs WebSocket `observeDeep()` callbacks updating the volume. |

**Critical problem: external tools.**

The biggest blocker isn't `fs` — it's that L1 grep/glob/search tools don't use Node's `fs` module. They shell out to:
- **ripgrep** (`rg`) for grep operations — a Rust binary that uses OS syscalls directly
- **fast-glob** for glob operations — uses `fs.readdir` (interceptable via unionfs/Option 1, but tricky)
- **MiniSearch** for keyword search — operates on an index built from real files

These external tools bypass any `fs` interception. To make `grep` work on L2 content in memfs, you'd need to either:
1. Replace ripgrep with a JS grep that uses the patched `fs` (performance regression)
2. Use FUSE (back to A1)
3. Materialize to actual disk (back to Approach C/D/E from projection doc)
4. Build separate search tools for L2 (what we're trying to avoid)

**Verdict:** Promising for simple `read_file`/`list_dir` but falls apart for grep/glob/search. The external binary problem (ripgrep, fast-glob relying on real FS) makes transparent interception impossible without FUSE or disk materialization.

---

### A3. VS Code FileSystemProvider Pattern

**What it is:** VS Code's extension API lets you register virtual filesystems via `FileSystemProvider`. This is how extensions provide FTP, SSH, S3, and cloud storage browsing. The API:

```typescript
interface FileSystemProvider {
  stat(uri: Uri): FileStat;
  readDirectory(uri: Uri): [string, FileType][];
  readFile(uri: Uri): Uint8Array;
  writeFile(uri: Uri, content: Uint8Array, options: { create, overwrite }): void;
  rename(oldUri: Uri, newUri: Uri, options: { overwrite }): void;
  delete(uri: Uri): void;
  createDirectory(uri: Uri): void;
  
  // Change notifications
  onDidChangeFile: Event<FileChangeEvent[]>;
  watch(uri: Uri): Disposable;
}
```

Extensions register a scheme: `vscode.workspace.registerFileSystemProvider('crdt', myProvider)`. Then `crdt://shared-context.json` opens, edits, and saves through the provider. VS Code's file explorer, search, and text editor all work transparently over the virtual scheme.

**Applicability to our system:**

This pattern is relevant as **design inspiration**, not as a direct implementation target. Our agents don't run inside VS Code — they're Node.js processes with LangGraph tools. But the pattern has key insights:

1. **URI-based addressing.** `crdt://team-1/goal-1/shared-context.json` is a clean addressing scheme. The scheme prefix tells the system which provider to use.
2. **Watch + change events.** `onDidChangeFile` enables real-time invalidation. When a CRDT doc changes (WebSocket update), emit a change event to invalidate caches/indexes.
3. **Separation of stat/read/write.** The provider doesn't bundle everything into one tool. Each operation is independent. This maps well to agent tool design.
4. **Opaque to consumers.** Code using `vscode.workspace.fs.readFile(uri)` doesn't know (or care) whether the backing store is local disk, S3, or a CRDT. This is the transparency we want.

**How we'd adapt it:**

```typescript
interface VirtualL2FileSystem {
  stat(path: string): Promise<{ type: 'file' | 'directory'; size: number; mtime: number }>;
  readDirectory(path: string): Promise<Array<[name: string, type: 'file' | 'directory']>>;
  readFile(path: string): Promise<string>;
  // writeFile not needed for read-only projection
  
  // Search support (VS Code doesn't have this in FileSystemProvider — we add it)
  grep(pattern: string, path?: string): Promise<Array<{ file: string; line: number; content: string }>>;
  glob(pattern: string): Promise<string[]>;
}
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Works with remote Yjs?** | ✅ The pattern abstracts the storage backend — remote Yjs is just another provider |
| **Familiar filesystem verbs?** | ✅ At the interface level, yes. But it's an API, not actual `fs` — tools must be written against it. |
| **Search/grep/glob?** | ⚠️ VS Code's FileSystemProvider doesn't include search — VS Code handles search separately via `TextSearchProvider`/`FileSearchProvider`. We'd need to add search ourselves. |
| **Implementation complexity** | 🟢 Low-Medium — it's an interface definition + implementation. No OS-level dependencies. |
| **Latency** | Same as underlying CRDT access — first access ~50-200ms (WebSocket sync), then cached. |

**Verdict:** Excellent as a **design pattern** to adopt. Not a drop-in solution but the cleanest mental model. Define a `VirtualL2FileSystem` interface, implement it with CRDT backends, and have agent tools call the interface instead of raw `fs`.

---

### A4. Virtual Path → CRDT Resolver

**What it is:** A custom routing layer where filesystem-like paths map to specific positions in the CRDT document hierarchy. No actual filesystem operations — just a path-to-data resolution function.

**Path schema:**

```
l2://                                          → Root (list categories)
l2://crdt/                                     → List CRDT doc names
l2://crdt/shared-context                       → Y.Doc "shared-context" → Map.toJSON()
l2://crdt/shared-context/plannerState          → Y.Map.get("plannerState")
l2://crdt/agent-statuses/researcher            → Y.Map.get("researcher")  → { role, status, lastUpdated }
l2://crdt/chat-outcomes                        → Y.Array → JSON array
l2://crdt/chat-outcomes/0                      → Y.Array.get(0)  → single outcome
l2://crdt/doc-design-spec                      → Y.XmlFragment → markdown
l2://plans/                                    → List plan IDs
l2://plans/{planId}                            → PlanStore.loadPlan()
l2://plans/{planId}/tasks                      → plan.tasks array
l2://plans/{planId}/tasks/{taskId}             → single task
l2://outputs/                                  → List output manifests
l2://outputs/{taskId}                          → OutputManifest JSON
l2://outputs/{taskId}/files                    → manifest.outputs array
```

**Implementation:**

```typescript
class CrdtPathResolver {
  constructor(
    private space: CollaborationSpace,
    private planStore: PlanStore,
    private l2Plugin: IL2CollaborationPlugin,
    private repoPath: string,
  ) {}

  async resolve(path: string): Promise<ResolveResult> {
    const segments = path.replace(/^l2:\/\//, '').split('/').filter(Boolean);
    
    if (segments.length === 0) {
      return { type: 'directory', entries: ['crdt', 'plans', 'outputs'] };
    }

    const [category, ...rest] = segments;

    switch (category) {
      case 'crdt':
        return this.resolveCrdt(rest);
      case 'plans':
        return this.resolvePlans(rest);
      case 'outputs':
        return this.resolveOutputs(rest);
      default:
        throw new Error(`Unknown category: ${category}`);
    }
  }

  private async resolveCrdt(segments: string[]): Promise<ResolveResult> {
    if (segments.length === 0) {
      const docs = await this.space.listDocs();
      return { type: 'directory', entries: docs };
    }

    const [docName, ...keyPath] = segments;
    const doc = await this.space.openDoc(docName);
    
    if (keyPath.length === 0) {
      // Return entire doc
      const json = doc.toJSON();
      return { type: 'file', content: JSON.stringify(json, null, 2), mimeType: 'application/json' };
    }
    
    // Drill into nested keys
    let value: any = doc.getMap(docName).toJSON();
    for (const key of keyPath) {
      if (value == null || typeof value !== 'object') {
        throw new Error(`Path not found: ${key} in ${docName}`);
      }
      value = Array.isArray(value) ? value[parseInt(key)] : value[key];
    }
    
    return { type: 'file', content: JSON.stringify(value, null, 2), mimeType: 'application/json' };
  }
  // ... similar for plans, outputs
}
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Works with remote Yjs?** | ✅ Yes — uses `space.openDoc()` which works through `ICollabProvider` (embedded or remote) |
| **Familiar filesystem verbs?** | ⚠️ Partially — path-based, so `read_file("l2://crdt/shared-context")` feels filesystem-like. But it's a custom URL scheme, not real `fs` paths. |
| **Search/grep/glob?** | ❌ Not inherently — a resolver only reads specific paths. Grep/glob require iterating over all content, which the resolver doesn't optimize for. Would need a separate search layer. |
| **Implementation complexity** | 🟢 Low — ~150-200 lines. Pure TypeScript, no native deps. |
| **Latency** | First resolve of a doc: ~50-200ms (WebSocket sync). Subsequent: ~1ms (cached Y.Doc). Deep path drills add negligible overhead. |

**Key Insight:** This is essentially what the `collab` tool already does, but with filesystem-like path syntax instead of `action/docName/key` parameters. The upgrade is cosmetic, not structural. The real value would come from pairing this with a search layer (Section 3).

**Verdict:** Simple and practical. Could be an incremental improvement over the current `collab` tool — same backend, friendlier addressing. But doesn't solve the search/grep problem on its own.

---

### A5. Directory-Layer Patterns (FoundationDB, TiKV, BanyanDB)

**What it is:** Distributed key-value databases that expose directory-like hierarchical namespaces over flat key spaces.

**FoundationDB Directory Layer:**

FoundationDB stores flat `(key, value)` pairs, but its Directory Layer creates a virtual hierarchy:

```python
# FoundationDB — directories over a flat KV store
directory = fdb.directory.create_or_open(db, ('teams', 'team-1', 'goals', 'goal-1', 'crdt'))
directory['shared-context'] = encode(map.toJSON())  # Stored as a flat key with a generated prefix

# Listing a directory
subdirs = fdb.directory.list(db, ('teams', 'team-1', 'goals', 'goal-1'))
# → ['crdt', 'plans', 'outputs']
```

The directory layer doesn't create real directories — it maps human-readable paths to binary key prefixes. Looking up `teams/team-1/goals/goal-1/crdt/shared-context` translates to a single KV lookup with a prefix-encoded key.

**TiKV (used by TiDB):**

Uses key ranges as virtual directories. Keys are byte-ordered, so all keys starting with `teams/team-1/` can be range-scanned efficiently. No explicit directory concept, but the lexicographic ordering of keys creates an implicit directory structure:

```
Key: "teams/team-1/goals/goal-1/crdt/agent-statuses" → Value: JSON blob
Key: "teams/team-1/goals/goal-1/crdt/shared-context" → Value: JSON blob
Key: "teams/team-1/goals/goal-1/plans/plan-001"      → Value: JSON blob
```

A "list directory" operation is a range scan: `scan("teams/team-1/goals/goal-1/crdt/", "teams/team-1/goals/goal-1/crdt/~")`.

**Applicability:**

The `CollaborationSpace` already uses this pattern implicitly. Doc names are `{teamId}/{goalId}/{docName}` — a path-like hierarchical key. The `listDocs()` method filters by prefix (`startsWith(this.prefix)`), which is the same as a range scan.

The insight from FoundationDB is the **directory-to-prefix mapping**: human-readable paths don't need to map 1:1 to storage keys. A `resolve()` function can translate `l2://plans/plan-001/tasks/task-3` into the right `PlanStore.loadPlan("plan-001")` call + key extraction. The storage structure is irrelevant — only the address space matters.

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Works with remote Yjs?** | ✅ Conceptually yes — the pattern is storage-agnostic |
| **Familiar filesystem verbs?** | ⚠️ Directory listing and path-based reads, yes. But no `grep` or content search in a KV directory layer. |
| **Search/grep/glob?** | ❌ KV directory layers don't support full-text search. They support prefix scans (like glob) but not content search (like grep). |
| **Implementation complexity** | 🟢 Low — we already have the prefix pattern in `CollaborationSpace`. Formalizing it as a directory layer is ~50 lines. |
| **Latency** | Same as CRDT access. |

**Verdict:** Validates the path → storage resolution pattern we'd use in A4. Not a solution by itself but confirms that hierarchical addressing over non-hierarchical storage is a well-proven pattern.

---

## 3. B — Search Over Virtual Filesystems

### B1. In-Memory Search Index Mirroring CRDT State ("CRDT Replica for Search")

**What it is:** Each agent process maintains a local MiniSearch (or Orama) index populated from CRDT state. The index is kept in sync via Yjs `observeDeep()` callbacks. When a CRDT doc changes (remote write arriving via WebSocket), the change event updates the local search index.

**Architecture:**

```
┌─────────────────────────────────────────────────────────┐
│  Agent Process                                           │
│                                                          │
│  ┌──────────────┐    observe()    ┌──────────────┐       │
│  │ Y.Doc replica │──────────────▶│ MiniSearch    │       │
│  │ (via WebSocket│  (on change)  │ L2 Index      │       │
│  │  Yjs sync)   │               │               │       │
│  └──────┬───────┘               └──────┬────────┘       │
│         │                              │                 │
│         │ openDoc()                    │ search()        │
│  ┌──────┴───────┐               ┌──────┴────────┐       │
│  │ RemoteCollab  │              │ Agent Tools    │       │
│  │ Client        │              │ (grep, search) │       │
│  └──────┬───────┘               └───────────────┘       │
│         │ WebSocket                                      │
└─────────┼────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────┐
│  Remote           │
│  Hocuspocus       │
│  Server           │
└──────────────────┘
```

**How index sync works:**

```typescript
class L2SearchIndex {
  private miniSearch = new MiniSearch({
    fields: ['content', 'docName', 'key'],
    storeFields: ['docName', 'key', 'content', 'type'],
  });

  /** Subscribe to a CRDT doc and index its content */
  observeDoc(docName: string, ydoc: Y.Doc) {
    const map = ydoc.getMap(docName);
    
    // Index current state
    this.indexMap(docName, map);
    
    // Re-index on changes (debounced)
    map.observeDeep(() => {
      this.reindexMap(docName, map);
    });
  }

  private indexMap(docName: string, map: Y.Map<any>) {
    const json = map.toJSON();
    for (const [key, value] of Object.entries(json)) {
      if (key === '_meta') continue;
      this.miniSearch.add({
        id: `${docName}:${key}`,
        docName,
        key,
        content: typeof value === 'object' ? JSON.stringify(value) : String(value),
        type: 'crdt',
      });
    }
  }

  grep(pattern: string): SearchResult[] {
    // Use MiniSearch for fuzzy keyword search
    return this.miniSearch.search(pattern, { fuzzy: 0.2, prefix: true });
  }
}
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Works with remote Yjs?** | ✅ Yes — Yjs sync protocol automatically replicates docs. `observeDeep()` fires on remote changes arriving via WebSocket. |
| **Search latency** | ✅ <1ms — MiniSearch operates on local in-memory data |
| **Index freshness** | ✅ Near-real-time — Yjs sync delivers changes within milliseconds. Index updates are debounced (e.g., 200ms). |
| **Implementation complexity** | 🟡 Medium — ~100-150 lines for the index manager. Need to handle: doc discovery (new docs created by other agents), doc removal, index persistence across agent restarts. |
| **Memory overhead** | 🟢 Low — at L2 scale (<50 docs, <500 KB total content), MiniSearch index is <1 MB. |
| **Multi-agent consistency** | ⚠️ Each agent has its own index replica. Indexes are eventually consistent (Yjs guarantees CRDT convergence). Two agents may see slightly different search results for a brief window during propagation. |

**Key advantages:**
1. **Zero network latency for search** — once the CRDT doc is synced, all search is local.
2. **Incremental updates** — Yjs `observeDeep()` provides granular change notifications. MiniSearch supports `add`/`remove`/`discard`, so we only re-index changed docs.
3. **Already proven at L1** — the `WorkspaceSearchIndex` uses exactly this pattern for code files.
4. **No server infrastructure** — no separate search service to deploy.

**Limitations:**
1. **Per-agent index** — 8 agents = 8 index replicas. Memory-wise fine, but wasted compute re-building the same index.
2. **Cold start** — on agent restart, must re-sync all L2 docs and rebuild the index. At L2 scale this is fast (<1s).
3. **No regex grep** — MiniSearch does fuzzy keyword search, not regex. For true `grep -E "pattern"` behavior, would need to linearly scan the in-memory content.

**Verdict:** **Strongest approach for search.** Low complexity, proven pattern (extends L1), zero latency, automatic freshness via Yjs sync. The per-agent replica cost is negligible at L2 scale. This is the recommended search layer.

---

### B2. Server-Side Search on Hocuspocus

**What it is:** The Hocuspocus server maintains a single search index over all CRDT documents. Agents call a search RPC (HTTP or WebSocket message) instead of searching locally.

**Architecture:**

```
┌────────────────────────────────────────────┐
│  Hocuspocus Server                          │
│                                             │
│  ┌──────────────┐   onChange    ┌─────────┐ │
│  │ Y.Doc store  │────────────▶│ Orama   │ │
│  │ (all docs)   │  (debounce) │ Index   │ │
│  └──────────────┘             └────┬────┘ │
│                                    │       │
│  ┌──────────────┐          search()│       │
│  │ HTTP/WS API  │◀────────────────┘       │
│  │ /api/search  │                          │
│  └──────┬───────┘                          │
└─────────┼──────────────────────────────────┘
          │
     ┌────┴────┐
     │ Agents  │   HTTP: POST /api/search { query: "auth" }
     │ (1..N)  │   → [{ docName, key, snippet, score }]
     └─────────┘
```

**How it would work:**

On the Hocuspocus server, the `onChange` hook indexes content into Orama/MiniSearch. A custom HTTP endpoint (via `onRequest` hook) exposes search:

```typescript
// On Hocuspocus server
const searchIndex = new Orama({ schema: { content: 'string', docName: 'string' } });

new Hocuspocus({
  async onChange({ documentName, document }) {
    const json = document.toJSON();
    // Upsert into search index
    await removeByDocName(searchIndex, documentName);
    await insertDocContent(searchIndex, documentName, json);
  },

  async onRequest({ request, response }) {
    if (request.url === '/api/search') {
      const { query } = JSON.parse(await readBody(request));
      const results = await search(searchIndex, { term: query });
      response.writeHead(200);
      response.end(JSON.stringify(results));
    }
  },
});
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Works with remote Yjs?** | ✅ Yes — the search index lives on the same server as the CRDT state. No sync needed. |
| **Search latency** | ⚠️ Network round-trip for every search (~5-50ms depending on network). For interactive grep: noticeable. For agent tool call: acceptable. |
| **Index freshness** | ✅ Excellent — `onChange` fires on every write (debounced ~2s). Single index, no replication lag. |
| **Implementation complexity** | 🟡 Medium — ~80 lines for the search endpoint. But requires changes to the Hocuspocus server deployment (add search dependency, HTTP route). |
| **Multi-agent consistency** | ✅ Perfect — single index, all agents see the same results. |
| **Scalability** | ✅ Index maintained once, queried by N agents. |

**Advantages over B1:**
1. **Single index.** One index instead of N replicas.
2. **Guaranteed consistency.** All agents get the same search results.
3. **Lower agent memory** — agents don't hold an index.

**Disadvantages vs B1:**
1. **Network latency per search.** Every `grep` is a round-trip.
2. **Server coupling.** Search is unavailable if Hocuspocus is down (but so is all L2 access).
3. **More complex deployment.** The Hocuspocus server needs search deps (Orama/MiniSearch).
4. **Less agent autonomy** — agents can't search offline or disconnected.

**Verdict:** Viable and architecturally clean. Better than B1 for consistency, worse for latency. At L2 scale, the difference between ~1ms (local) and ~10ms (network) is negligible for agent tool calls. **Recommended as an alternative if per-agent index replication feels wasteful.**

---

### B3. Materialized Views

**What it is:** A process (or hook) reads CRDT state and produces searchable "views" — not files on disk, but structured projections optimized for specific query patterns.

This is the database concept: a materialized view pre-computes a query result and stores it. When the underlying data changes, the view is updated (eagerly or lazily).

**Concrete examples:**

```typescript
// View 1: "All tasks assigned to a role" — pre-computed on plan change
interface TasksByRoleView {
  [role: string]: Array<{
    taskId: string;
    title: string;
    status: string;
    planId: string;
  }>;
}

// View 2: "Cross-document content search" — pre-computed keyword index
interface ContentIndex {
  search(query: string): Array<{
    source: 'crdt' | 'plan' | 'output';
    docName: string;
    key?: string;
    snippet: string;
    score: number;
  }>;
}

// View 3: "Latest agent activity timeline" — pre-computed from statuses + chat outcomes
interface ActivityTimeline {
  entries: Array<{
    timestamp: number;
    agent: string;
    action: string;
    details: string;
  }>;
}
```

**How it relates to other patterns:**

- B1 (local search index) **is** a materialized view — the index is a view of CRDT content optimized for keyword queries.
- B2 (server-side search) **is** a materialized view maintained server-side.
- The `collab` tool's `discover` action already produces a view ("3 CRDT docs, 2 plans, 5 output manifests").

The insight is that "materialized view" is the **unifying concept** behind all our approaches. The question isn't "should we use materialized views?" (we already do) but "where should the view live and how fresh should it be?"

**View placement options:**

| Where | Freshness | Latency | Consistency |
|-------|-----------|---------|-------------|
| Agent process (B1) | ~200ms (Yjs sync + debounce) | ~1ms (local) | Per-agent (eventually consistent) |
| Hocuspocus server (B2) | ~2s (onChange debounce) | ~10ms (network) | Global (single source) |
| Sidecar process | ~200ms (dedicated sync) | ~1ms (shared memory/IPC) | Shared across co-located agents |
| CDN/edge cache | ~5-30s (TTL-based) | ~1-5ms | Stale (TTL-bounded) |

**Verdict:** Materialized views are the correct conceptual framework. B1 and B2 are specific instances. For L2 at current scale, agent-local views (B1) are the pragmatic choice. Server-side views (B2) become better as agent count grows.

---

### B4. Content-Addressable Storage Pattern

**What it is:** Each CRDT doc/key gets a content hash. A lookup table maps hashes to content. Agents search the lookup table (metadata) and read content by hash (guaranteed immutable snapshot).

```
Content hash: sha256(Y.Map.toJSON()) → "a1b2c3d4..."

Lookup table:
  "a1b2c3d4" → { docName: "shared-context", size: 2048, updatedAt: "2026-03-12T..." }
  "e5f6g7h8" → { docName: "agent-statuses", size: 512, updatedAt: "2026-03-12T..." }

Agent reads:
  1. GET /l2/lookup → { "shared-context": "a1b2c3d4", "agent-statuses": "e5f6g7h8" }
  2. GET /l2/content/a1b2c3d4 → { "plannerState": { ... }, "blockers": [] }
```

**How it could work with Yjs:**

Every time a CRDT doc changes, compute `sha256(encodeStateAsUpdate(ydoc))`. Store `{ hash → serialized content }` in a content store (Redis, memcached, or in-memory Map). Agents request content by hash — guaranteed to get a consistent snapshot (the hash is immutable once computed).

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Works with remote Yjs?** | ✅ Yes — hashes computed server-side, content served by hash |
| **Familiar filesystem verbs?** | ❌ No — content-addressable is git-internal style, not user-facing. Agents would need to learn a new concept. |
| **Search/grep/glob?** | ❌ Hashes are opaque. You can't grep across hashes without fetching all content first, which defeats the purpose. |
| **Implementation complexity** | 🟡 Medium — hash computation on every change, content store management, garbage collection of old hashes. |
| **Latency** | ✅ Content read by hash is fast (cache-friendly, immutable). But requires two round-trips: lookup table → content. |
| **Consistency** | ✅ Excellent — reading by hash guarantees a point-in-time snapshot. No torn reads. |

**Why it doesn't fit well:**

Content-addressable storage solves the **consistency** problem (agents see a coherent snapshot) but doesn't solve the **usability** problem (agents want grep/glob/read, not hash lookups). It's the wrong abstraction for agent UX.

Where it IS useful: **cache keys.** If the path resolver (A4) caches resolved content, using the CRDT doc's state vector hash as the cache key is efficient and correct. The hash changes when the doc changes, automatically invalidating the cache.

**Verdict:** Not useful as the primary abstraction. Useful as an implementation detail for caching within B1 or B2.

---

## 4. C — Agent UX Patterns

### C1. Dual-Mode Tool (Filesystem Verbs Over CRDT)

**What it is:** A single tool that combines `ls`, `grep`, `cat`, `find` semantics but operates on CRDT state. Like the `collab` tool but with filesystem verbs.

**Current `collab` tool verbs:** `discover`, `list`, `read`, `write`, `read-block`, `write-block`
**Proposed filesystem verbs:** `ls`, `cat`, `grep`, `find`, `write`, `edit`

```typescript
// Current: collab({ action: "discover" })
// Proposed: l2fs({ action: "ls", path: "/" })

// Current: collab({ action: "read", docName: "shared-context", key: "plannerState" })
// Proposed: l2fs({ action: "cat", path: "/crdt/shared-context/plannerState" })

// NEW — not possible with current collab tool:
// l2fs({ action: "grep", pattern: "authentication", path: "/crdt/" })
// l2fs({ action: "find", pattern: "*.json", path: "/" })
```

**Implementation sketch:**

```typescript
const l2fsTool = tool(
  async ({ action, path, pattern }) => {
    const resolver = new CrdtPathResolver(space, planStore, l2Plugin, repoPath);
    const searchIndex = getL2SearchIndex(); // B1 pattern

    switch (action) {
      case 'ls':
        const result = await resolver.resolve(path ?? '/');
        if (result.type === 'directory') {
          return result.entries.map(([name, type]) => 
            type === 'directory' ? `${name}/` : name
          ).join('\n');
        }
        return `${path} is a file, not a directory`;
      
      case 'cat':
        const file = await resolver.resolve(path!);
        if (file.type === 'file') return file.content;
        return `${path} is a directory. Use ls.`;
      
      case 'grep':
        const matches = searchIndex.grep(pattern!, path);
        return matches.map(m => `${m.file}:${m.line}: ${m.content}`).join('\n');
      
      case 'find':
        const files = await resolver.glob(pattern!, path);
        return files.join('\n');
      
      default:
        return `Unknown action. Use: ls, cat, grep, find, write.`;
    }
  },
  {
    name: 'l2fs',
    description: 'Browse and search team shared state as a virtual filesystem.\n'
      + 'ls   — list directory contents\n'
      + 'cat  — read file contents\n'
      + 'grep — search content by keyword\n'
      + 'find — find files by name pattern\n',
    schema: z.object({
      action: z.enum(['ls', 'cat', 'grep', 'find', 'write']),
      path: z.string().optional().describe('Virtual path (e.g., /crdt/shared-context)'),
      pattern: z.string().optional().describe('Search pattern for grep/find'),
    }),
  },
);
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Familiar to agents?** | ✅ Very — `ls`, `cat`, `grep`, `find` are universal shell concepts that LLMs handle well. |
| **Works with remote Yjs?** | ✅ Path resolver calls `space.openDoc()` which works via `RemoteCollabClient` |
| **Search support?** | ✅ `grep` action backed by B1 search index. `find` backed by path resolver glob. |
| **Implementation complexity** | 🟢 Low-Medium — combines A4 (path resolver) + B1 (search index) into one tool. ~200 lines. |
| **Backward compatibility** | ⚠️ Replaces the `collab` tool. Agents trained on `discover/list/read` would need re-prompting. |

**Honest take:** This is probably the best balance of UX and complexity. It doesn't try to make L2 invisible (agents still use a separate tool), but it makes L2 feel like a filesystem. The `grep` action is the key feature the `collab` tool lacks.

---

### C2. Path-Based API (URL-Like Addressing)

**What it is:** Agents specify paths like `l2://plans/current/tasks`, `l2://crdt/agent-statuses/researcher`. A router resolves each path to the right data source.

This is essentially A4 (Virtual Path → CRDT Resolver) exposed as a tool interface. The difference from C1 is that there's ONE action (`resolve`) and the path itself encodes the intent:

```typescript
// Instead of separate actions:
l2({ path: "l2://crdt/" })                          // → directory listing
l2({ path: "l2://crdt/shared-context" })             // → file content (JSON)
l2({ path: "l2://crdt/shared-context/blockers" })    // → nested key value
l2({ path: "l2://plans/" })                          // → list plans
l2({ path: "l2://plans/plan-001/tasks" })            // → task list
```

**Pros:**
- Very simple tool schema (one `path` parameter + optional `query` for search).
- LLMs naturally construct paths — they're good at URL-like patterns.
- No action/verb confusion — the path determines what happens.

**Cons:**
- How does grep work? `l2({ path: "l2://", query: "auth" })` is ambiguous — is `query` a search or a filter?
- Need to distinguish "list directory" from "read file" based on whether the path points to a leaf node. This requires stat-before-read.
- Less explicit than C1 — a human reading the tool call can't tell at a glance whether it's a list or a read.

**Verdict:** Elegant but potentially confusing for both agents and developers. C1 with explicit actions is clearer.

---

### C3. L2 Workspace Mount (Same Interface as L1)

**What it is:** Give agents an `L2Workspace` object that implements the same interface as `AgentWorkspace` (L1). Agents call the SAME tools (`grep`, `glob`, `read_file`) and the workspace routes to CRDT state.

**How it would work:**

```typescript
class L2Workspace implements AgentWorkspaceInterface {
  constructor(
    private space: CollaborationSpace,
    private searchIndex: L2SearchIndex,
    private resolver: CrdtPathResolver,
  ) {}

  async readFile(path: string): Promise<string> {
    return (await this.resolver.resolve(path)).content;
  }

  async listDir(path: string): Promise<string[]> {
    const result = await this.resolver.resolve(path);
    if (result.type === 'directory') return result.entries.map(e => e[0]);
    throw new Error('Not a directory');
  }

  async grep(pattern: string, path?: string): Promise<GrepResult[]> {
    return this.searchIndex.grep(pattern, path);
  }

  async glob(pattern: string): Promise<string[]> {
    return this.resolver.glob(pattern);
  }

  // Write operations
  async writeFile(path: string, content: string): Promise<void> {
    // Parse path, write to CRDT
    const [docName, key] = this.parsePath(path);
    const doc = await this.space.openDoc(docName);
    doc.getMap(docName).set(key, JSON.parse(content));
  }
}
```

Then during agent initialization:

```typescript
// L1 tools operate on the git workspace
const l1Tools = createWorkspaceTools(agentWorkspace); // read_file, grep, glob, ...

// L2 tools operate on the CRDT virtual workspace — SAME interface
const l2Workspace = new L2Workspace(space, searchIndex, resolver);
const l2Tools = createWorkspaceTools(l2Workspace); // Same tools, different backend

// Rename L2 tools to avoid collision
for (const tool of l2Tools) {
  tool.name = `l2_${tool.name}`; // l2_read_file, l2_grep, l2_glob, ...
}

// Agent gets both tool sets
agent.addTools([...l1Tools, ...l2Tools]);
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Familiar to agents?** | ✅ Maximum familiarity — same tool names, same parameters, same return format. |
| **Mental model?** | ⚠️ Agents need to understand they have TWO workspaces. `read_file` vs `l2_read_file`. This could cause confusion about which to use. |
| **Search support?** | ✅ `l2_grep`, `l2_glob` backed by search index + resolver. |
| **Implementation complexity** | 🟡 Medium-High — must implement the full `AgentWorkspaceInterface` for CRDT (including edge cases: symlinks? binary files? permissions?). |
| **Risk** | ⚠️ The L1 `AgentWorkspace` interface may have methods that don't map to CRDT (e.g., `commit()`, `createBinaryFile()`, `merge()`). Implementing a full workspace-compatible interface for CRDT may require stubs/exceptions for unsupported operations. |

**Verdict:** Best for consistency but has a leaky abstraction risk. The CRDT "filesystem" isn't really a filesystem — it doesn't have commits, branches, or binary files. Forcing it into the `AgentWorkspace` interface creates a lie that eventually causes confusing failures. C1 (explicit filesystem verbs) is more honest.

---

### C4. RSS/Atom Feed Analogy (Subscription + Search)

**What it is:** Agents "subscribe" to L2 content streams (like subscribing to RSS feeds) and search within their subscription. The subscription is a filtered view of L2 relevant to the agent's role.

```typescript
// Agent subscribes to content relevant to their role
const subscription = await l2.subscribe({
  role: 'researcher',
  interests: ['plans', 'chat-outcomes', 'shared-context'],
  filter: { assignedToMe: true },
});

// Search within subscribed content
const results = subscription.search("authentication patterns");
// → Only searches the agent's subscribed subset of L2

// Get latest updates since last check
const updates = subscription.getUpdates(sinceTimestamp);
// → [{ docName, key, action: 'created'|'updated', timestamp }]
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Familiar to agents?** | ❌ Unfamiliar — agents don't naturally think in subscription terms. |
| **Filesystem feel?** | ❌ No — it's a pub/sub model, not a filesystem. |
| **Search support?** | ✅ Search within subscription scope. |
| **Use case fit?** | ⚠️ Better suited for **notification** scenarios ("what changed since I last checked?") than for **exploration** scenarios ("let me browse L2"). |

**Verdict:** Wrong abstraction for our problem. Agents need exploration (browse/search), not notification (what changed). The subscription model is useful as an implementation detail (subscribe to Yjs doc changes to keep the search index fresh) but shouldn't be the agent-facing API.

---

## 5. D — Industry Examples

### D1. Google Colossus / GFS

**Architecture:**

Google File System (GFS) and its successor Colossus separate **metadata** from **data**:

```
┌──────────────┐       ┌──────────────────┐
│  GFS Master  │       │  Chunkservers    │
│  (metadata)  │◀─────▶│  (data chunks)   │
│  - namespace │       │  - 64MB chunks   │
│  - chunk map │       │  - 3x replicated │
│  - file→chunk│       │                  │
└──────┬───────┘       └──────────────────┘
       │
       │  Namespace operations (ls, stat, mkdir)
       │  are metadata-only — no data transfer
       ▼
┌──────────────┐
│  Client      │  read(file, offset, len) → Master returns chunk locations
│              │  → Client reads directly from chunkserver
└──────────────┘
```

**Key patterns relevant to us:**

1. **Metadata/data separation.** Directory listing and file stat operations hit only the metadata server — extremely fast. Data reads go directly to the storage nodes. For L2: directory listing (`space.listDocs()`) is a metadata operation. Content reads (`doc.toJSON()`) are data operations. We should keep them separate.

2. **Chunk-level caching.** GFS clients cache chunk locations (metadata), not chunk data. For L2: agents should cache doc metadata (name, size, last-modified) but read content on demand.

3. **No built-in search.** GFS/Colossus is a storage layer — search is a separate system (like Google Search's indexing pipeline that reads from Colossus). For L2: search should be a separate concern from the virtual filesystem. The VFS provides read/list; a search index (B1/B2) provides grep/find.

**Applicability:** The architecture validates separating directory operations from content reads, and keeping search as a separate layer. Directly applicable to our design.

---

### D2. CRDTfs / y-fuse (Existing Projects)

**Research finding: No production projects exist that mount CRDTs as FUSE filesystems.**

Searched npm, GitHub, academic papers, and CRDT community forums:

- **"crdtfs"** — No npm package. No GitHub repo. No academic paper.
- **"y-fuse"** — No npm package. No GitHub repo.
- **"yjs fuse"** — No results.
- **"crdt filesystem"** — Automerge has `automerge-repo-storage-nodefs` (covered in [crdt-filesystem-projection.md Entry 2E](../../ping/crdt-filesystem-projection.md)) which stores CRDT binary blobs as files — NOT a readable filesystem projection.
- **"hypercore fuse"** — Hypercore/Hyperdrive (DAT/Beaker) has `hyperdrive-fuse` (archived, unmaintained). Mounts a Hypercore-backed distributed filesystem via FUSE. This is the closest analog but uses append-only logs, not CRDTs.

The `hyperdrive-fuse` project is instructive:
- It existed, worked, and was **abandoned** due to maintenance burden of FUSE bindings across platforms.
- The team moved to custom API access instead of FUSE mounting.
- This is a strong signal that FUSE-based CRDT filesystems are theoretically sound but practically unsustainable.

**Adjacent project: Earthstar**
- A peer-to-peer document database using CRDTs (author: `@cinnamon`).
- Exposes documents via HTTP API, not FUSE.
- Documents have paths (`/wiki/gardening/tomatoes.md`) — path-based addressing over CRDTs.
- No FUSE mounting, no `fs` interception. Just a path-addressed API.
- This validates pattern A4/C1 (path-based API over CRDTs).

**Verdict:** No one has successfully shipped a CRDT-as-FUSE system. The closest attempts were abandoned. Path-based APIs over CRDTs are the proven approach (Earthstar, Notion, etc.).

---

### D3. Obsidian Sync

**How it works:**

Obsidian stores notes as **Markdown files on local disk**. Obsidian Sync uses a **proprietary CRDT** to synchronize file contents across devices:

```
Device A:                        Obsidian Cloud:                    Device B:
┌──────────────┐   CRDT sync    ┌──────────────┐   CRDT sync     ┌──────────────┐
│ Local .md    │ ──────────────▶│ CRDT state   │──────────────▶  │ Local .md    │
│ files on disk│ ◀──────────────│ (per file)   │◀──────────────  │ files on disk│
└──────────────┘                └──────────────┘                  └──────────────┘
```

Key architectural points:

1. **Files are the truth, CRDTs are transport.** Obsidian does NOT expose CRDTs to plugins. Plugins see local `.md` files via standard `fs` APIs. The CRDT layer is invisible — it only handles conflict resolution during sync.

2. **Plugin search uses a local Lucene-based index.** The "Search" core plugin indexes all local `.md` files. Since CRDTs materialize as real files, the search index is just "index all files in the vault folder." No CRDT awareness needed.

3. **This is exactly our Approach C/D from the projection doc.** Obsidian materializes CRDTs to disk → plugins use standard file APIs → search indexes real files. The only difference is that Obsidian owns the CRDT merge (it's a file-sync tool), while we use Yjs for richer structured data (Y.Map, Y.Array, Y.XmlFragment).

**Lesson for our system:**

Obsidian validates that **"materialize to disk, then use standard tools"** is a production-proven approach. Their scale is massive (millions of users, billions of files synced). The approach works.

The question is whether we can afford the materialization step when Hocuspocus is remote. Obsidian syncs to local disk first, then plugins read local disk. If we adopt the same pattern:

1. Agent starts → sync all L2 CRDT docs to local workspace (`.ping/collaboration/`)
2. Yjs WebSocket keeps local replicas updated
3. Agent tools read from local disk — unchanged

This is Approach D (write-through) from the projection doc, powered by `RemoteCollabClient`'s WebSocket connection. The `HocuspocusProvider` already keeps local Y.Doc replicas in sync. We just need to serialize them to disk on change.

**Verdict:** Strongly validates the "materialize to disk" approach. If it works for Obsidian at scale, it works for us.

---

### D4. Notion API

**How it works:**

Notion stores content as **blocks in a tree structure**, synchronized via a proprietary CRDT-like system. The API exposes:

```
Search endpoint:
  POST https://api.notion.com/v1/search
  Body: { "query": "authentication", "filter": { "property": "object", "value": "page" } }
  Returns: [{ id, title, last_edited_time, parent, ... }]

Page/block reads:
  GET https://api.notion.com/v1/blocks/{block_id}/children
  Returns: [{ type: "paragraph", paragraph: { rich_text: [...] } }, ...]

Database queries (structured):
  POST https://api.notion.com/v1/databases/{db_id}/query
  Body: { "filter": { "property": "Status", "select": { "equals": "In Progress" } } }
```

**Key patterns:**

1. **Search is a first-class API.** Not `grep` — it's a dedicated search endpoint that returns ranked results across all content. This maps to our B2 (server-side search) pattern.

2. **Separate search from read.** You search to find pages, then read specific blocks. Two distinct operations. This matches GFS's metadata/data separation.

3. **No filesystem metaphor.** Notion doesn't pretend blocks are files. It uses blocks, pages, and databases as the abstraction. Agents using the Notion API learn Notion's model, not a filesystem model.

4. **Structured query over databases.** Notion databases support rich filters — status equals, date after, multi-select contains. This maps to our "structured query over plan tasks" scenario.

**Lesson for our system:**

Notion's "search then read" two-step pattern is exactly what C1 (dual-mode tool) with grep + cat would provide. The difference is naming: Notion calls it `search`; we'd call it `grep` (more familiar to agents).

Notion's block model is richer than what we need. Our CRDT docs are simpler: Y.Map (flat key-value), Y.Array (list), Y.XmlFragment (rich text). We don't need Notion's deeply nested block tree.

**Verdict:** Validates the "search endpoint + targeted read" pattern. We should offer grep-then-cat, not try to make CRDT data browseable as a flat filesystem.

---

### D5. Figma

**How it works:**

Figma uses a custom CRDT for multiplayer editing. Their API exposes:

```
GET https://api.figma.com/v1/files/{key}
→ Returns the entire file as a JSON tree of nodes (frames, components, text, etc.)

GET https://api.figma.com/v1/files/{key}/nodes?ids=...
→ Returns specific nodes by ID

GET https://api.figma.com/v1/files/{key}/comments
→ Returns comments (searchable)
```

**Key patterns:**

1. **No built-in content search API.** Figma's API lets you fetch the entire file tree or specific nodes by ID. There's no `search("button design")` endpoint. To search, you'd download the full file and search client-side.

2. **Entire document or specific nodes.** Binary choice: get everything or get specific things by ID. No intermediate "browse directories" step.

3. **CRDT is invisible.** The API returns JSON snapshots — you never interact with the CRDT layer. Figma converts CRDT state → JSON before serving it. This is the materialization pattern.

**Lesson for our system:**

Figma's lack of search API is instructive — it shows that even CRDT-native products sometimes don't solve search over CRDTs, punting it to clients. Our system needs search, so we must build it ourselves (B1/B2).

Figma's "entire file or specific node" model maps to our pattern: `resolve("/crdt/shared-context")` returns the whole doc; `resolve("/crdt/shared-context/plannerState")` returns a specific key. The CRDT-to-JSON conversion is the materialization step.

**Verdict:** Confirms that CRDT → JSON materialization for API consumption is standard practice. Figma doesn't try to expose CRDTs as files. Search is not built into the CRDT layer.

---

## 6. Evaluation Matrix

### Filesystem Abstraction Patterns (Section A)

| Pattern | Remote Yjs? | FS Verbs? | Grep/Glob? | Complexity | Latency | Recommendation |
|---------|:-----------:|:---------:|:----------:|:----------:|:-------:|:--------------:|
| **A1: FUSE** | ✅ | ✅ Perfect | ✅ Native | 🔴 High | ⚠️ Per-syscall | ❌ Not recommended |
| **A2: memfs/unionfs** | ✅ | ⚠️ Partial | ❌ ripgrep bypass | 🟡 Medium | ✅ After sync | ❌ Not recommended |
| **A3: FileSystemProvider** | ✅ | ✅ At API level | ⚠️ Need separate | 🟢 Low-Med | ✅ Cached | ✅ As design pattern |
| **A4: Path resolver** | ✅ | ⚠️ Path-only | ❌ Need search layer | 🟢 Low | ✅ Cached | ✅ As building block |
| **A5: Directory layer** | ✅ | ⚠️ List+read | ❌ No content search | 🟢 Low | ✅ | ✅ Validates A4 |

### Search Patterns (Section B)

| Pattern | Remote Yjs? | Latency | Freshness | Consistency | Complexity | Recommendation |
|---------|:-----------:|:-------:|:---------:|:-----------:|:----------:|:--------------:|
| **B1: Local index** | ✅ | ~1ms | ~200ms | Per-agent | 🟡 Medium | ✅ **Primary choice** |
| **B2: Server search** | ✅ | ~10ms | ~2s | Global | 🟡 Medium | ✅ Alternative |
| **B3: Mat. views** | ✅ | Varies | Varies | Varies | Conceptual | ✅ Framework |
| **B4: Content-addr** | ✅ | 2 hops | Snapshot | ✅ | 🟡 Medium | ⚠️ Cache detail only |

### Agent UX Patterns (Section C)

| Pattern | Familiarity | Search? | Complexity | Honest? | Recommendation |
|---------|:-----------:|:-------:|:----------:|:-------:|:--------------:|
| **C1: Dual-mode tool** | ✅ High | ✅ | 🟢 Low-Med | ✅ | ✅ **Primary choice** |
| **C2: Path-based API** | ✅ Medium | ⚠️ | 🟢 Low | ⚠️ | ⚠️ Viable alternative |
| **C3: L2 Workspace** | ✅ Max | ✅ | 🟡 Med-High | ❌ Leaky | ⚠️ Risky |
| **C4: Feed/subscribe** | ❌ Low | ✅ | 🟡 Medium | ✅ | ❌ Wrong model |

---

## 7. Recommendation

### Recommended Architecture: C1 + A4 + B1

**A single `l2fs` tool** with filesystem verbs (`ls`, `cat`, `grep`, `find`), backed by a **path resolver** (A4) for directory/file operations and a **local MiniSearch index** (B1) for search, kept in sync via **Yjs WebSocket replication**.

```
┌──────────────────────────────────────────────────────────────────┐
│  Agent Process                                                    │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  l2fs tool (C1)                                              │ │
│  │                                                              │ │
│  │  action: ls   → CrdtPathResolver.resolve(path)              │ │
│  │  action: cat  → CrdtPathResolver.resolve(path)              │ │
│  │  action: grep → L2SearchIndex.grep(pattern)                  │ │
│  │  action: find → CrdtPathResolver.glob(pattern)              │ │
│  │  action: write → CollaborationSpace.openDoc().getMap().set() │ │
│  └──────────────────────────┬──────────────────┬────────────────┘ │
│                             │                  │                  │
│  ┌──────────────────────────┴──┐  ┌────────────┴──────────────┐  │
│  │  CrdtPathResolver (A4)      │  │  L2SearchIndex (B1)       │  │
│  │                              │  │                           │  │
│  │  l2://crdt/{doc}/{key}       │  │  MiniSearch index         │  │
│  │  l2://plans/{planId}         │  │  Populated from Y.Doc     │  │
│  │  l2://outputs/{taskId}       │  │  Updated via observeDeep  │  │
│  │                              │  │  ~200ms freshness         │  │
│  └──────────────┬───────────────┘  └──────────┬───────────────┘  │
│                 │  openDoc()                   │  observe()       │
│  ┌──────────────┴──────────────────────────────┴───────────────┐  │
│  │  RemoteCollabClient (ICollabProvider)                        │  │
│  │  → HocuspocusProvider per doc (WebSocket, lazy, cached)     │  │
│  └──────────────────────────┬──────────────────────────────────┘  │
│                             │ WebSocket                           │
└─────────────────────────────┼─────────────────────────────────────┘
                              ▼
                   ┌──────────────────┐
                   │  Remote           │
                   │  Hocuspocus       │
                   │  Server           │
                   └──────────────────┘
```

### Why This Combination

1. **C1 (filesystem verbs)** gives agents familiar `ls/cat/grep/find` semantics without pretending L2 is a real filesystem. Honest abstraction — agents know they're using `l2fs`, not `read_file`.

2. **A4 (path resolver)** makes addressing clean and extensible. Adding new data sources means adding new path prefixes, not new tool actions.

3. **B1 (local search index)** gives sub-millisecond search with near-real-time freshness. No network latency for grep. The Yjs WebSocket sync that already exists for `RemoteCollabClient` provides automatic index updates.

4. **No FUSE, no `fs` patching, no platform-specific code.** Pure TypeScript, works on Windows/Linux/macOS.

5. **Incremental adoption.** The `collab` tool can coexist with `l2fs` during migration. No big-bang switch.

### What We Explicitly Reject

| Approach | Why rejected |
|----------|-------------|
| **FUSE (A1)** | Platform portability nightmare. FUSE bindings for Node.js are fragile. Container `--privileged` requirement. Debugging is painful. Killed hyperdrive-fuse. |
| **memfs/fs patching (A2)** | External tools (ripgrep, fast-glob) bypass `fs` patching. Global `fs.monkey` patch affects entire process. Solving the bypass requires FUSE anyway. |
| **L2 Workspace Mount (C3)** | Leaky abstraction. `AgentWorkspace` has methods (commit, merge, createBinaryFile) that don't map to CRDTs. Would require stubs/throws that confuse agents. |
| **Content-addressable (B4)** | Wrong user-facing abstraction. Useful only as a caching detail inside B1. |
| **RSS/Feed (C4)** | Wrong model. Agents need exploration (browse+search), not notification (what changed). |

### Latency Profile

| Operation | Expected Latency | Mechanism |
|-----------|:---------------:|-----------|
| `ls /crdt/` | ~50-200ms first call, ~1ms after | `listDocs()` cached by CollaborationSpace |
| `cat /crdt/shared-context` | ~50-200ms first call, ~1ms after | Y.Doc synced via WebSocket, then local |
| `grep "auth"` | ~1ms | MiniSearch on local in-memory index |
| `find "*.json"` | ~1ms | In-memory path enumeration |
| `write /crdt/doc/key value` | ~5-10ms | Local Y.Doc mutation → WebSocket propagation |

First-access latency (~50-200ms) is the Yjs WebSocket sync time. Once a doc is synced, it stays synced — the `HocuspocusProvider` keeps the local replica updated. **All subsequent reads are local.**

### Migration Path from `collab` Tool

1. **Phase 1:** Build `l2fs` tool alongside `collab`. Both available.
2. **Phase 2:** Add `l2fs` to new agent configurations. Existing agents keep `collab`.
3. **Phase 3:** Update agent prompts to prefer `l2fs`. Monitor usage.
4. **Phase 4:** Deprecate `collab` tool once all agents are migrated.

The tools can coexist because they use different names (`collab` vs `l2fs`) and don't conflict.

### Open Questions for Implementation Phase

1. **Doc pre-warming.** Should all L2 docs be synced eagerly on agent start, or lazily on first `ls`/`cat`? Eager = fast first access, ~3-10 WebSocket connections up front. Lazy = no wasted connections for unused docs.

2. **Search index scope.** Should the L2 search index cover only CRDT docs, or also plans and output manifests? Plans/manifests are already on disk — they could be covered by the L1 search index if the `.ping/` path isn't excluded.

3. **Write-back semantics.** Should `l2fs write` be supported? If yes, writes to CRDT docs are straightforward (Y.Map.set). Writes to plans/outputs should remain read-only.

4. **Index persistence.** Should the MiniSearch L2 index be serialized to disk/MongoDB on agent shutdown and restored on restart? At L2 scale (<50 docs), rebuilding from scratch is fast (<1s), so persistence may not be worth the complexity.

5. **Concurrent resolver access.** If `grep` triggers parallel doc syncs, how many concurrent WebSocket connections should `RemoteCollabClient` open? Need a connection pool or concurrency limit.

---

> **Next steps:** This is research only. No implementation until architecture is approved. When ready, see [crdt-filesystem-projection.md](../../ping/crdt-filesystem-projection.md) for the materialization alternative and [L2_SEARCH_RESEARCH.md](L2_SEARCH_RESEARCH.md) for search engine comparison details.
