# v1.1 Feature: Team Collaboration (L2 Team Memory)

> **Goal:** Team-scoped shared memory: plan persistence, output tracking via git manifests, real-time CRDT collaboration — all via Hocuspocus  
> **Duration:** 2 weeks  
> **Priority:** 🔴 Critical — Agents need L2 to coordinate and share context  
> **Dependencies:** v1.0 (AgentWorkspace for publish flow)  
> **Architecture:** [feature_architecture.md](../feature_architecture.md) — L2 section for all interfaces and design decisions

---

## Technology Decisions (Locked)

| Component | Technology | Rationale |
|-----------|------------|----------|
| **CRDT** | [Yjs](https://yjs.dev/) + [Hocuspocus](https://tiptap.dev/docs/hocuspocus) | TypeScript, MIT, same-process embedding, 18 hooks, Database extension for persistence |
| **Editor** | [BlockNote](https://blocknotejs.org/) | React block editor, native Yjs collaboration |
| **Storage** | Local FS (dev) → Azure Blob (prod) | via Hocuspocus Database extension `fetch()`/`store()` |

### Dual-Write Storage

All CRDT docs stored via two paths:

| Path | Mechanism | Purpose |
|------|-----------|---------|
| **Durable** | Database extension `store()` → S3/FS | Source of truth (Yjs binary, rehydrates via `fetch()`) |
| **Projection** | `onChange` hook → `.ping/collaboration/` | Readable JSON/markdown for Planner (uses existing L1 tools). Disposable. |

```
.ping/
  outputs/{taskId}.json                  # Output manifests (written by publish())
  plans/{planId}.json                    # Plan projections (written by PlanStore)
  agent-statuses/{agentId}.json          # Per-agent status (CRDT-projected from Y.Map)
  collaboration/
    chat-outcomes/{sessionId}.json       # Group chat decisions (CRDT-projected from Y.Array)
    documents/{docId}.md                 # Collaborative docs (CRDT-projected from Y.XmlFragment)
    binaries/metadata.json               # Shared binaries index (CRDT-projected from Y.Map)
```

**All real-time coordination state flows through CRDT (Yjs + Hocuspocus).** Agent statuses, chat outcomes, binaries, and shared documents are all CRDT-backed — giving every agent and the Planner instant visibility into team state without polling.

- **Reads** (L1 tools / collab tool): Planner uses `read_file('.ping/...')`, workers use `collab({ action: 'discover' })` → `list` → `read`
- **Writes** (collab tool): `collab({ action: 'write', docName: 'agent-statuses', key: myRole, value: { status, blockers, discoveries } })` — real-time propagation + auto-projected to `.ping/`
- **System CRDT writes**: WorkerPool (auto-status), GroupChatManager (outcomes), Frontend (BlockNote) — via `CollaborationSpace.openDoc()` directly

---

## Implementation Phases

### Phase 1: Housekeeping (2 days)

**1a. Move PlanStore** — `orchestrator/FilePlanStore.ts` → `memory/collaboration/PlanStore.ts`

**Current problems:**
- No `goalId` scoping — a team working on multiple goals mixes all plans in one flat directory
- `getLatestPlan(teamId)` returns only the most recent plan — no way to list plans by goal
- Completed plans are **deleted** from disk — zero history, can't review past decisions
- `pendingPlan` in OrchestratorService is singular — only one plan per team at a time
- `PlanMetadata` has no `goalId` field

**Fix: goalId-scoped PlanStore with plan history and multi-goal support**

```
# NEW directory structure — scoped by team + goal
data/plans/
  {teamId}/
    {goalId}/
      {planId}.json        # individual plan files
    {goalId}/
      {planId}.json
```

```typescript
// memory/collaboration/PlanStore.ts — replaces FilePlanStore entirely
import { promises as fs } from 'fs';
import path from 'path';
import type { AgentPlanOutput } from '../../orchestrator/schemas.js';

// Extended metadata — adds goalId + completedAt for history
export interface PlanMetadata {
  planId: string;
  teamId: string;
  goalId: string;                    // NEW: which goal this plan is for
  goal: string;                      // human description
  createdAt: string;
  completedAt?: string;              // NEW: when the plan completed (if completed)
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'interrupted';
  taskCount: number;
  version: number;                   // NEW: replan increments version (plan-v1, plan-v2)
  parentPlanId?: string;             // NEW: if this plan was created by replanning
}

export interface StoredPlan {
  plan: AgentPlanOutput;
  metadata: PlanMetadata;
  savedAt: string;
}

export class PlanStore {
  private baseDir: string;

  constructor(
    private teamId: string,
    private repoPath: string,
    baseDir?: string,
  ) {
    this.baseDir = baseDir ?? `./data/plans/${teamId}`;
  }

  // === Core CRUD ===

  async savePlan(
    plan: AgentPlanOutput,
    metadata: Partial<PlanMetadata> & { goalId: string },  // goalId required
  ): Promise<void> {
    const goalDir = path.join(this.baseDir, metadata.goalId);
    await fs.mkdir(goalDir, { recursive: true });

    // Determine version — count existing plans for this goal
    const existing = await this.listPlansByGoal(metadata.goalId);
    const version = metadata.version ?? existing.length + 1;

    const storedPlan: StoredPlan = {
      plan,
      metadata: {
        planId: plan.planId,
        teamId: this.teamId,
        goalId: metadata.goalId,
        goal: plan.goal,
        createdAt: metadata.createdAt ?? new Date().toISOString(),
        status: metadata.status ?? 'pending',
        taskCount: plan.tasks.length,
        version,
        parentPlanId: metadata.parentPlanId,
      },
      savedAt: new Date().toISOString(),
    };

    await fs.writeFile(
      path.join(goalDir, `${plan.planId}.json`),
      JSON.stringify(storedPlan, null, 2),
    );

    // Project to .ping/plans/ for agent reads
    await this.projectPlan(storedPlan);
  }

  async loadPlan(planId: string, goalId: string): Promise<StoredPlan | null> {
    const filePath = path.join(this.baseDir, goalId, `${planId}.json`);
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf-8'));
    } catch { return null; }
  }

  async updatePlanStatus(
    planId: string,
    goalId: string,
    status: PlanMetadata['status'],
  ): Promise<void> {
    const stored = await this.loadPlan(planId, goalId);
    if (!stored) return;
    stored.metadata.status = status;
    if (status === 'completed') stored.metadata.completedAt = new Date().toISOString();
    stored.savedAt = new Date().toISOString();
    const filePath = path.join(this.baseDir, goalId, `${planId}.json`);
    await fs.writeFile(filePath, JSON.stringify(stored, null, 2));
    await this.projectPlan(stored);
  }

  // === Queries ===

  /** All plans for a goal (newest first) — includes completed plans for history */
  async listPlansByGoal(goalId: string): Promise<PlanMetadata[]> {
    const goalDir = path.join(this.baseDir, goalId);
    try {
      const files = await fs.readdir(goalDir);
      const plans: PlanMetadata[] = [];
      for (const f of files.filter(f => f.endsWith('.json'))) {
        const stored: StoredPlan = JSON.parse(
          await fs.readFile(path.join(goalDir, f), 'utf-8'),
        );
        plans.push(stored.metadata);
      }
      return plans.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch { return []; }
  }

  /** Active plan for a goal (executing or approved) — at most one */
  async getActivePlan(goalId: string): Promise<StoredPlan | null> {
    const plans = await this.listPlansByGoal(goalId);
    const active = plans.find(p => p.status === 'executing' || p.status === 'approved');
    return active ? this.loadPlan(active.planId, goalId) : null;
  }

  /** Latest plan across all goals for this team — for loadActivePlan() recovery */
  async getLatestActivePlan(): Promise<StoredPlan | null> {
    try {
      const goalDirs = await fs.readdir(this.baseDir).catch(() => []);
      let latest: StoredPlan | null = null;
      for (const goalId of goalDirs) {
        const active = await this.getActivePlan(goalId);
        if (active && (!latest || active.metadata.createdAt > latest.metadata.createdAt)) {
          latest = active;
        }
      }
      return latest;
    } catch { return null; }
  }

  /** All plans for this team across all goals */
  async listAllPlans(filter?: { status?: PlanMetadata['status'] }): Promise<PlanMetadata[]> {
    const goalDirs = await fs.readdir(this.baseDir).catch(() => []);
    const all: PlanMetadata[] = [];
    for (const goalId of goalDirs) {
      const plans = await this.listPlansByGoal(goalId);
      all.push(...plans);
    }
    let result = all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (filter?.status) result = result.filter(p => p.status === filter.status);
    return result;
  }

  // === Projection (.ping/plans/) ===

  private async projectPlan(stored: StoredPlan): Promise<void> {
    const projDir = path.join(this.repoPath, '.ping', 'plans');
    await fs.mkdir(projDir, { recursive: true });
    await fs.writeFile(
      path.join(projDir, `${stored.metadata.planId}.json`),
      JSON.stringify({
        ...stored.plan,
        _metadata: stored.metadata,    // agents can see status, goalId, version
      }, null, 2),
    );
  }

  // === NO deletePlan() — completed plans are kept for history ===
  // To clean up old plans, use archivePlan() which moves to data/plans/{teamId}/_archive/
  async archivePlan(planId: string, goalId: string): Promise<void> {
    const src = path.join(this.baseDir, goalId, `${planId}.json`);
    const archiveDir = path.join(this.baseDir, '_archive', goalId);
    await fs.mkdir(archiveDir, { recursive: true });
    await fs.rename(src, path.join(archiveDir, `${planId}.json`));
    // Remove projection
    const projPath = path.join(this.repoPath, '.ping', 'plans', `${planId}.json`);
    await fs.unlink(projPath).catch(() => {});
  }
}
```

**Key changes from current FilePlanStore:**

| Aspect | Before | After |
|--------|--------|-------|
| Directory | `data/plans/{planId}.json` (flat) | `data/plans/{teamId}/{goalId}/{planId}.json` |
| Multiple plans per team | No — `getLatestPlan()` returns one | Yes — `listPlansByGoal()`, `listAllPlans()` |
| Multiple goals per team | No `goalId` concept | Yes — each goal has its own plan history |
| Completed plan deletion | `deletePlan()` on completion | Never deleted — `archivePlan()` if cleanup needed |
| Plan history | None | Full history per goal with `version` + `parentPlanId` |
| Replan lineage | No tracking | `parentPlanId` links to previous plan that was replanned |
| `savePlan()` signature | `goalId` optional (`teamId` only) | `goalId` **required** |

**Update OrchestratorService.ts:**
```typescript
// BEFORE: import { FilePlanStore } from "./FilePlanStore.js";
import { PlanStore } from "../memory/collaboration/PlanStore.js";

// Constructor:
this.planStore = new PlanStore(this.teamId, this.repoPath);

// approvePlan() — pass goalId:
await this.planStore.savePlan(plan, { goalId: this.currentGoalId, status: 'approved' });
await this.planStore.updatePlanStatus(planId, this.currentGoalId, 'executing');

// On completion — mark completed, DO NOT delete:
await this.planStore.updatePlanStatus(planId, goalId, 'completed');
// (removed: this.planStore.deletePlan(planId))

// loadActivePlan() — use getLatestActivePlan():
const storedPlan = await this.planStore.getLatestActivePlan();

// resetPlan() — archive instead of delete:
await this.planStore.archivePlan(planId, goalId);

// replan() — link to parent:
await this.planStore.savePlan(newPlan, {
  goalId,
  status: 'pending',
  parentPlanId: currentPlan.planId,  // lineage tracking
});
```

**Update createPlan tool** — generate `goalId` from plan goal and pass to PlanStore:
```typescript
// In tools/createPlan.ts:

// Generate stable goalId from goal text — same goal always produces same goalId
function toGoalId(goal: string): string {
  return goal
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')  // non-alphanumeric → hyphens
    .replace(/^-|-$/g, '')         // trim leading/trailing hyphens
    .slice(0, 64);                 // cap length
}

const goalId = toGoalId(plan.goal);  // "Build REST API" → "build-rest-api"

await context.planStore.savePlan(plan, {
  goalId,
  status: 'pending',
});

// Store on OrchestratorContext so replan() uses the same goalId
context.currentGoalId = goalId;
```

**Why slug, not UUID?** Stable across replans — if the goal text is the same, `goalId` is the same. Replans for the same goal land in the same directory (`data/plans/{teamId}/{goalId}/`) with `parentPlanId` linking them. A UUID would require storing/passing the original goalId through replan flows.

**1b. Delete ArtifactRegistry** — remove from 4 locations:

| File | What to Remove |
|------|----------------|
| `orchestrator/ArtifactRegistry.ts` | Delete entire file |
| `orchestrator/OrchestratorService.ts` | Remove import, `this.artifactRegistry = new ArtifactRegistry()`, `artifactRegistry.initialize()`, and `artifactRegistry` from `createContext()` |
| `orchestrator/types.ts` | Remove `artifactRegistry: ArtifactRegistry` from `OrchestratorContext` |
| `orchestrator/tools/getContext.ts` | Remove `ArtifactQuery` import, replace artifact queries with manifest reads |
| `memory/MemoryCoordinator.ts` | Remove `InMemoryArtifactRegistry` inner class (~30 lines), replace `artifacts` field with `null` placeholder |

**1c. Define OutputManifest types** in `collaboration/types/output-manifest.types.ts`:

```typescript
export interface OutputManifest {
  taskId: string;
  role: string;
  completedAt: string;                // ISO
  outputs: OutputEntry[];
  activitySummary: string;            // LLM-friendly summary
  toolsUsed: string[];
  metrics: { filesCreated: number; commits: number; duration: number };
}

export interface OutputEntry {
  path: string;                       // relative path in workspace
  type: 'code' | 'doc' | 'data' | 'config' | 'binary';
  lang?: string;                      // 'typescript', 'markdown', etc.
  size: number;
  contentHash: string;                // sha256 for dedup
}
```

**1d. Update `AgentWorkspace.publish()`** — write manifest instead of returning Artifact[]:

```typescript
// In memory/workspace/AgentWorkspace.ts — replace the current publish() method
async publish(): Promise<OutputManifest> {
  this.assertActive();
  
  // Commit any uncommitted changes (existing logic, keep as-is)
  const changedFiles = await this.gitManager.getChangedFiles();
  if (changedFiles.length > 0) {
    await this.gitManager.withLock(async () => {
      await this._commitGitOps(`Publish: task-${this.taskId}`);
    });
  }

  // Build output manifest (replaces old Artifact[] collection)
  const outputs: OutputEntry[] = [];
  const artifactsDir = path.join(this.basePath, 'artifacts');
  
  const collectFiles = async (dir: string, prefix: string) => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isFile()) {
        const relPath = path.join(prefix, entry.name);
        const filePath = path.join(dir, entry.name);
        const stat = await fs.promises.stat(filePath);
        const content = await fs.promises.readFile(filePath);
        outputs.push({
          path: `artifacts/${relPath}`,
          type: this.inferOutputType(entry.name),
          lang: this.inferLang(entry.name),
          size: stat.size,
          contentHash: crypto.createHash('sha256').update(content).digest('hex'),
        });
      } else if (entry.isDirectory()) {
        await collectFiles(path.join(dir, entry.name), path.join(prefix, entry.name));
      }
    }
  };
  await collectFiles(artifactsDir, '');

  const manifest: OutputManifest = {
    taskId: this.taskId,
    role: this.agentId,
    completedAt: new Date().toISOString(),
    outputs,
    activitySummary: await this.getActivitySummary() ?? '',
    toolsUsed: [],  // TODO: track from tool calls
    metrics: { filesCreated: outputs.length, commits: 0, duration: 0 },
  };

  // Write manifest to .ping/outputs/ (will merge with branch)
  const manifestPath = path.join(this.basePath, '.ping', 'outputs', `${this.taskId}.json`);
  await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  // Commit manifest + update status
  this._status = 'published';
  await this.gitManager.withLock(async () => {
    await this.writeWorkspaceMetadata();
    await this.gitManager.addAll();
    await this.gitManager.commit(`Publish: ${this.taskId}`, `${this.agentId} <agent>`);
  });

  this.events.emit('workspace:published', { workspaceId: this.id, manifest });
  return manifest;
}
```

**1e. Update Task type** in `memoryManager/types/Task.types.ts`:

```typescript
// Replace: artifacts?: string[];
// With:
outputManifest?: string;       // Path to .ping/outputs/{taskId}.json (set on publish)
projectId?: string;            // L2 scope
```

---

### Phase 2: Hocuspocus + Core (3 days)

**2a. HocuspocusServer.ts** — embedded server with persistence + projection:

```typescript
// memory/collaboration/HocuspocusServer.ts
import { Hocuspocus } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as Y from 'yjs';

export class CollabServer {
  private server: Hocuspocus;
  private storageDir: string;

  constructor(storageDir = './data/collab') {
    this.storageDir = storageDir;
    this.server = new Hocuspocus({
      extensions: [
        new Database({
          fetch: async ({ documentName }) => {
            const filePath = path.join(this.storageDir, 'yjs', `${documentName.replace(/\//g, '_')}.bin`);
            try { return await fs.readFile(filePath); } catch { return null; }
          },
          store: async ({ documentName, state }) => {
            const filePath = path.join(this.storageDir, 'yjs', `${documentName.replace(/\//g, '_')}.bin`);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, state);
          },
        }),
      ],

      async onChange({ document, documentName }) {
        // Projection: CRDT → readable files for Planner
        await projectToFilesystem(documentName, document);
      },

      async onAuthenticate({ token, documentName }) {
        // TODO: validate agent/user has access to this team/goal
        return { user: token };
      },
    });
  }

  async start(port = 1234): Promise<void> {
    await this.server.listen(port);
  }

  async stop(): Promise<void> {
    await this.server.destroy();
  }

  // In-process access — no WebSocket needed
  async openDoc(docName: string): Promise<Y.Doc> {
    const connection = await this.server.openDirectConnection(docName);
    return connection.document;
  }

  get instance(): Hocuspocus { return this.server; }

  /** List all doc names — in-memory (loaded) + persisted (on disk) */
  async getDocNames(): Promise<string[]> {
    const loaded = Array.from(this.server.documents.keys());
    // Also scan persisted storage for docs not currently loaded
    const persisted: string[] = [];
    try {
      const dir = path.join(this.storageDir, 'yjs');
      const files = await fs.readdir(dir);
      for (const f of files) {
        if (f.endsWith('.bin')) {
          // Reverse the filename encoding: underscores → slashes
          persisted.push(f.slice(0, -4).replace(/_/g, '/'));
        }
      }
    } catch { /* no storage dir yet */ }
    // Deduplicate
    return [...new Set([...loaded, ...persisted])];
  }
}

// Projection: CRDT state → .ping/collaboration/ files
// Convention-based — auto-detects Yjs shared types, no hardcoded doc names
async function projectToFilesystem(docName: string, doc: Y.Doc) {
  const parts = docName.split('/');
  if (parts.length < 3) return;
  const [teamId, goalId, ...rest] = parts;
  const docType = rest.join('/');
  const projDir = path.join('.ping', 'collaboration');
  await fs.mkdir(projDir, { recursive: true });

  // Auto-project every shared type in the doc based on its Yjs type
  for (const [key, sharedType] of doc.share.entries()) {
    if (sharedType instanceof Y.Map) {
      // Y.Map → JSON file (e.g., shared-context.json, binaries.json)
      const data = sharedType.toJSON();
      await fs.writeFile(path.join(projDir, `${docType}.json`), JSON.stringify(data, null, 2));

    } else if (sharedType instanceof Y.Array) {
      // Y.Array → individual JSON files per item (if items have an id/sessionId)
      // or a single array JSON file
      const items = sharedType.toJSON();
      const arrDir = path.join(projDir, docType);
      await fs.mkdir(arrDir, { recursive: true });
      for (const item of items) {
        const itemId = item.id ?? item.sessionId ?? item.taskId ?? crypto.randomUUID();
        await fs.writeFile(path.join(arrDir, `${itemId}.json`), JSON.stringify(item, null, 2));
      }

    } else if (sharedType instanceof Y.XmlFragment) {
      // Y.XmlFragment → markdown file
      const docDir = path.join(projDir, 'documents');
      await fs.mkdir(docDir, { recursive: true });
      const markdown = xmlFragmentToMarkdown(sharedType); // TODO: implement
      await fs.writeFile(path.join(docDir, `${docType}.md`), markdown);

    } else if (sharedType instanceof Y.Text) {
      // Y.Text → plain text file
      await fs.writeFile(path.join(projDir, `${docType}.txt`), sharedType.toString());
    }
  }
}
```

**2b. CollabDocument.ts** — thin Y.Doc wrapper:

```typescript
// memory/collaboration/CollabDocument.ts
import * as Y from 'yjs';

export class CollabDocument {
  constructor(
    readonly name: string,
    readonly spaceId: string,
    readonly ydoc: Y.Doc,
  ) {}

  getMap<T = any>(name: string): Y.Map<T> { return this.ydoc.getMap(name); }
  getArray<T = any>(name: string): Y.Array<T> { return this.ydoc.getArray(name); }
  getXmlFragment(name: string): Y.XmlFragment { return this.ydoc.getXmlFragment(name); }
  getText(name: string): Y.Text { return this.ydoc.getText(name); }

  toJSON(): Record<string, any> {
    const result: Record<string, any> = {};
    // Iterate over all shared types in the doc
    this.ydoc.share.forEach((value, key) => {
      result[key] = value.toJSON();
    });
    return result;
  }

  toMarkdown(): string {
    // For block documents — convert XmlFragment to markdown
    const fragment = this.ydoc.getXmlFragment('content');
    return xmlFragmentToMarkdown(fragment); // shared with projection
  }

  getPresence(): AgentPresence[] {
    // Read from Hocuspocus awareness protocol
    // Awareness is per-connection, managed by HocuspocusProvider on client side
    return []; // TODO: wire to server awareness states
  }

  disconnect(): void {
    // Connection cleanup handled by Hocuspocus server
  }
}
```

**2c. CollaborationSpace.ts** — per-goal namespace + context bundle (no caching, no manifest reads):

```typescript
// memory/collaboration/CollaborationSpace.ts
import { CollabServer } from './HocuspocusServer.js';
import { CollabDocument } from './CollabDocument.js';

/**
 * Thin namespace wrapper — prefixes every doc name with `teamId/goalId/`
 * to prevent cross-goal collisions. No caching (Hocuspocus holds Y.Docs
 * in memory already). Manifest reads live in MemoryCoordinator.
 */
export class CollaborationSpace {
  constructor(
    readonly id: string,
    readonly teamId: string,
    readonly goalId: string,
    private server: CollabServer,
  ) {}

  /** Opens (or gets) a namespaced CRDT doc via Hocuspocus */
  async openDoc(docName: string): Promise<CollabDocument> {
    const fullName = `${this.teamId}/${this.goalId}/${docName}`;
    const ydoc = await this.server.openDoc(fullName);
    return new CollabDocument(docName, this.id, ydoc);
  }

  /** List all CRDT docs in this space — loaded + persisted (for progressive discovery) */
  async listDocs(): Promise<string[]> {
    const prefix = `${this.teamId}/${this.goalId}/`;
    const all = await this.server.getDocNames();
    return all
      .filter(n => n.startsWith(prefix))
      .map(n => n.slice(prefix.length));
  }
}
```

---

### Phase 3: Frontend (3 days)

**3a. BlockNote + Hocuspocus integration** in AgentChat:

```tsx
// AgentChat/components/CollaborativeEditor.tsx
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';  // or shadcn
import '@blocknote/mantine/style.css';

interface Props {
  docId: string;       // e.g., 'team-1/goal-1/doc-requirements'
  userName: string;
  userColor: string;
}

export function CollaborativeEditor({ docId, userName, userColor }: Props) {
  const [provider] = useState(() => new HocuspocusProvider({
    url: `ws://localhost:1234`,
    name: docId,
    // token: authToken,  // passed to onAuthenticate hook
  }));

  const editor = useCreateBlockNote({
    collaboration: {
      provider,
      fragment: provider.document.getXmlFragment('content'),
      user: { name: userName, color: userColor },
    },
  });

  useEffect(() => {
    return () => { provider.destroy(); };
  }, [provider]);

  return <BlockNoteView editor={editor} />;
}
```

**3b. Presence UI** — BlockNote awareness is built-in. Cursor colors + names appear automatically via the `user` field above. For a custom presence bar:

```tsx
// Show who's editing
function PresenceBar({ provider }: { provider: HocuspocusProvider }) {
  const [users, setUsers] = useState<any[]>([]);
  
  useEffect(() => {
    const update = () => {
      const states = provider.awareness?.getStates();
      if (states) setUsers(Array.from(states.values()));
    };
    provider.awareness?.on('change', update);
    return () => provider.awareness?.off('change', update);
  }, [provider]);

  return (
    <div className="flex gap-1">
      {users.map((u, i) => (
        <span key={i} style={{ color: u.user?.color }}>{u.user?.name}</span>
      ))}
    </div>
  );
}
```

---

### Phase 4: Wiring (2 days)

**4a. Wire GroupChatManager outcomes** — when a group chat concludes, store the outcome:

```typescript
// Where group chat concludes (probably in a future GroupChatManager or OrchestratorService)
async function storeGroupChatOutcome(space: CollaborationSpace, outcome: GroupChatOutcome) {
  const doc = await space.openDoc('chat-outcomes');
  doc.getArray<GroupChatOutcome>('chat-outcomes').push([outcome]);
  // Hocuspocus auto-persists via Database extension + projects via onChange
}
```

**Why CRDT for chat outcomes?** Chat decisions are a **real-time planning input** — the Planner observes outcomes as they arrive via Hocuspocus, enabling immediate re-planning without polling. When Agent A and Agent B resolve a design disagreement in a group chat, the Planner sees the outcome instantly and can re-prioritize dependent tasks or spawn new ones. The `Y.Array` also preserves full decision history, so any agent can trace *why* a decision was made.

**4b. Wire binary sharing:**

```typescript
async function shareBinary(space: CollaborationSpace, name: string, content: Uint8Array, metadata: any) {
  const doc = await space.openDoc('binaries');
  doc.getMap('binaries').set(name, { content, metadata, sharedAt: new Date().toISOString() });
}
```

**Why CRDT for binaries?** Binary sharing is multi-writer — one agent generates a diagram, another annotates it with metadata; one agent produces a data export, another adds validation results. `Y.Map` gives automatic merge on concurrent writes to the same binary entry (e.g., updating metadata while another agent replaces the content). The `onChange` projection writes `metadata.json` so all agents can discover available binaries via `read_file`.

**4c. All real-time coordination via CRDT** — every shared state that agents need to coordinate on flows through Hocuspocus:

| CRDT Doc | Yjs Type | Who Writes | Why CRDT (Not Plain Files) |
|----------|----------|------------|---------------------------|
| `agent-statuses` | `Y.Map` | Every agent (via `collab`), WorkerPool (auto) | Real-time propagation — all agents instantly see who's blocked, what's in progress, what was discovered. File polling would add seconds of latency that kills coordination. |
| `chat-outcomes` | `Y.Array` | GroupChatManager | Planner observes decisions as they land — enables immediate re-planning. Append-only with full history. |
| `binaries` | `Y.Map` | Any agent (via `collab`), OrchestratorService | Multi-writer: generate + annotate + validate concurrently. |
| `doc-{docId}` | `Y.XmlFragment` | Frontend (BlockNote), agents (via `collab`) | Core CRDT use case — rich text co-authoring with cursors. |
| *Any custom name* | `Y.Map` | Any agent (via `collab`) | Agents create new docs on demand — no pre-registration needed. |

**Agents can create CRDT documents on demand.** Calling `collab({ action: 'write', docName: 'my-new-spec', key: 'section-1', value: { ... } })` auto-creates the Hocuspocus doc `{teamId}/{goalId}/my-new-spec` if it doesn't exist. Hocuspocus treats all `openDoc()` calls as "get or create" — there's no separate creation step. The `onChange` hook auto-projects every new doc to `.ping/collaboration/my-new-spec.json`. This means:

- **Agent A** can `collab({ action: 'write', docName: 'api-contract', key: 'endpoints', value: [...] })` to start a shared API contract
- **Agent B** can `collab({ action: 'write', docName: 'api-contract', key: 'auth', value: { mechanism: 'JWT', ... } })` to add auth section
- Both writes merge automatically via CRDT — the projected file at `.ping/collaboration/api-contract.json` has both sections
- Any agent can create any doc name — there's no fixed schema or registry

**BlockNote documents + agent co-authoring:**

BlockNote docs are just CRDT docs with `Y.XmlFragment` instead of `Y.Map`. The frontend creates them via `HocuspocusProvider` (WebSocket), and agents can co-edit them via `collab`:

```
# How it works end-to-end:

1. Human opens collaborative editor in AgentChat UI
   → Frontend creates HocuspocusProvider(doc='doc-requirements')
   → Hocuspocus auto-creates Y.Doc with Y.XmlFragment('content')
   → BlockNote renders rich editor (tables, code blocks, headings)

2. Agent writes to same doc via collab tool
   → collab({ action: 'write', docName: 'doc-requirements', key: 'analysis', value: { findings: [...] } })
   → Agent's Y.Map write merges into same Y.Doc
   → onChange projects to .ping/collaboration/doc-requirements.json
   → Human sees agent's contribution in their editor (live)

3. Human edits content in BlockNote
   → Y.XmlFragment updates propagate via Hocuspocus
   → onChange projects updated markdown to .ping/collaboration/documents/doc-requirements.md
   → Planner can read_file('.ping/collaboration/documents/doc-requirements.md') to see latest
   → Workers can collab({ action: 'read', docName: 'doc-requirements' }) for same content
```

**Custom folders in `.ping/collaboration/`** are auto-created by the projection. When an agent writes to `Y.Array` (list-like data), the projection creates a directory with individual files per item. When it writes to `Y.Map` (structured data), it creates a single JSON file. No explicit folder management needed — the projection derives structure from the Yjs type.

**Workers access all L2 state via the unified `collab` tool** — progressive discovery, no filesystem paths. The `onChange` hook still projects to `.ping/` for the Planner (co-located with Hocuspocus).

```
# Progressive discovery flow (workers — via collab tool):

collab({ action: 'discover' })                                   → top-level L2 categories
→ 📂 crdt    — 3 real-time docs (agent-statuses, chat-outcomes, api-contract)
  📂 plans   — 2 plan files
  📂 outputs — 5 task output manifests

collab({ action: 'discover', docName: 'crdt' })                  → CRDT docs (descriptions from _meta)
→ 📄 "agent-statuses" — Real-time status of all team agents (working/blocked/idle)
  📄 "chat-outcomes"  — Decisions from group chat sessions (append-only)
  📄 "api-contract" [by backend-dev] — Shared REST API contract (endpoints, auth, schemas)

collab({ action: 'discover', docName: 'plans' })                 → plans with status/goal
→ 📄 plan-v1 [executing] — "Build REST API for user management"
  📄 plan-v2 [pending]   — "Add OAuth integration"

collab({ action: 'discover', docName: 'outputs' })               → manifests with role/count
→ 📄 task-042 (backend-dev)  — 3 files, completed 2026-02-27
  📄 task-043 (frontend-dev) — 7 files, completed 2026-02-28

collab({ action: 'list', docName: 'agent-statuses' })            → keys + value previews
→ Keys in "agent-statuses" (3):
    • backend-dev: {"status":"working","currentTask":"task-042"…}
    • frontend-dev: {"status":"blocked","blockers":["need API…}
    • devops: {"status":"idle","discoveries":["CI pipeline r…}

collab({ action: 'read', docName: 'agent-statuses', key: 'frontend-dev' })  → full JSON
→ { "status": "blocked", "blockers": ["need API schema"], ... }

collab({ action: 'read', docName: 'plans', key: 'plan-v1' })    → full plan JSON
collab({ action: 'read', docName: 'outputs', key: 'task-042' }) → full manifest JSON

# Writing (CRDT only — plans and outputs are read-only):
collab({ action: 'write', docName: 'agent-statuses', key: 'backend-dev', value: {
  status: 'working',
  currentTask: 'task-042',
  blockers: ['waiting on API schema from frontend-dev'],
  discoveries: ['API requires auth header', 'rate limit is 100/min'],
  updatedAt: '2026-02-26T10:00:00Z',
}})
# → instantly visible to all agents
# → auto-projected to .ping/agent-statuses/backend-dev.json (for Planner L1 reads)

# Creating a new custom doc (description stored as _meta in the doc itself):
collab({ action: 'write', docName: 'api-contract', key: 'endpoints', value: [...],
         description: 'Shared REST API contract — endpoints, auth, schemas' })
# → doc created, _meta key auto-written: { description, createdBy: 'backend-dev', createdAt }
# → other agents see the description when they discover('crdt')
# → subsequent writes skip _meta (already exists)
```

**Planner reads** (co-located with Hocuspocus) can also use L1 `read_file`/`list_dir`/`grep` on `.ping/` projections — both paths work.

**Automatic status updates via WorkerPool:** In addition to manual `collab` writes, the WorkerPool automatically updates agent status in the CRDT when tasks start, complete, or fail — agents only need `collab` for discoveries, blockers, and manual context sharing.

**Why CRDT for agent status (not per-agent files)?** File writes + polling adds seconds of latency. With Yjs `Y.Map`, every status change propagates instantly to all observers. The Planner can subscribe to the `agent-statuses` doc and react in real-time: reassign tasks when an agent reports a blocker, spawn parallel work when an agent reports a discovery, or pause a plan when agents report conflicting findings.

---

### Phase 5: Integration (3 days)

**5a. Wire into MemoryCoordinator** — replace stub with real CollaborationSpace:

```typescript
// memory/MemoryCoordinator.ts — update constructor and add space management
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'fast-glob';

export class MemoryCoordinator {
  readonly teamId: string;
  readonly tasks: MemoryManager;
  workspaces: WorkspaceManager | null = null;
  private spaces = new Map<string, CollaborationSpace>();  // replaces artifacts + collab stubs
  private collabServer: CollabServer;

  constructor(config: MemoryCoordinatorConfig) {
    this.teamId = config.teamId;
    this.tasks = config.memoryManager;
    this.collabServer = new CollabServer();
  }

  async initialize(): Promise<void> {
    await this.collabServer.start();
  }

  getOrCreateSpace(goalId: string): CollaborationSpace {
    const key = `${this.teamId}/${goalId}`;
    if (!this.spaces.has(key)) {
      this.spaces.set(key, new CollaborationSpace(key, this.teamId, goalId, this.collabServer));
    }
    return this.spaces.get(key)!;
  }

  // === Output manifest queries (moved from CollaborationSpace) ===

  async getOutputManifest(repoPath: string, taskId: string): Promise<OutputManifest | null> {
    const manifestPath = path.join(repoPath, '.ping', 'outputs', `${taskId}.json`);
    try {
      return JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    } catch { return null; }
  }

  async getAllManifests(repoPath: string): Promise<OutputManifest[]> {
    const outputsDir = path.join(repoPath, '.ping', 'outputs');
    const files = await glob('*.json', { cwd: outputsDir, absolute: true }).catch(() => []);
    const manifests: OutputManifest[] = [];
    for (const file of files) {
      manifests.push(JSON.parse(await fs.readFile(file, 'utf-8')));
    }
    return manifests;
  }

  async queryOutputs(repoPath: string, filter?: { role?: string; type?: string }): Promise<OutputEntry[]> {
    const manifests = await this.getAllManifests(repoPath);
    let entries = manifests.flatMap(m => m.outputs);
    if (filter?.role) {
      const roleManifests = manifests.filter(m => m.role === filter.role);
      entries = roleManifests.flatMap(m => m.outputs);
    }
    if (filter?.type) entries = entries.filter(e => e.type === filter.type);
    return entries;
  }

  // Updated completeTask — write manifest instead of register artifacts
  async completeTask(taskId: string, output: any): Promise<void> {
    this.tasks.updateTaskStatus(taskId, 'completed');
    this.tasks.setTaskOutput(taskId, output);
    // Manifest written by workspace.publish() — no separate step needed
  }

  async archiveSpace(goalId: string): Promise<void> {
    const key = `${this.teamId}/${goalId}`;
    this.spaces.delete(key);
    // Hocuspocus server holds Y.Docs — they'll be GC'd when no connections remain
  }
}
```

**5b. Update WorkerPool** — L1 tools + one CRDT tool:

```typescript
// In services/WorkerPool.ts — update runTask
async runTask(task: TaskWithContext): Promise<void> {
  // ... existing workspace setup ...

  // NEW: Get collaboration space for this goal
  const space = this.memoryCoordinator?.getOrCreateSpace(
    task.context?.goalId ?? 'default',
  );

  // Ensure .ping/agent-statuses/ exists in workspace
  const statusDir = path.join(workspace.basePath, '.ping', 'agent-statuses');
  await fs.mkdir(statusDir, { recursive: true });

  // Build tools array — L1 workspace tools + unified collab tool
  const tools = [
    ...createWorkspaceTools(workspace),
    ...(space ? [createCollabTool(space, task.assignedRole, this.memoryCoordinator!, this.repoPath)] : []),
    ...this.standardTools,
  ];

  // ... rest of existing runTask logic ...
}

// Unified L2 tool — discover, list, read, and write team state.
// Abstracts CRDT docs (Hocuspocus) AND filesystem state (plans, outputs)
// behind a single progressive-discovery interface.
function createCollabTool(
  space: CollaborationSpace,
  agentRole: string,
  coordinator: MemoryCoordinator,
  repoPath: string,
): StructuredTool {
  // Well-known CRDT docs — fallback descriptions when _meta hasn't been written yet
  const KNOWN_CRDT_DOCS: Record<string, string> = {
    'agent-statuses': 'Real-time status of all team agents — who is working, blocked, idle. Each key is a role name.',
    'chat-outcomes': 'Decisions from group chat sessions between agents. Append-only history.',
    'binaries': 'Shared binary files and metadata (diagrams, exports, data files).',
  };

  // Convention: every CRDT doc carries its own metadata as a `_meta` key in its root Y.Map.
  // Like YAML front-matter in a markdown file — co-located, not a separate registry.
  //
  //   doc.getMap(docName).get('_meta') → { description, createdBy, createdAt }
  //
  // Well-known docs use KNOWN_CRDT_DOCS as fallback. Custom docs get _meta on first write
  // via the `description` parameter. Agents that don't provide description get a default.

  async function readMeta(docName: string): Promise<{ description: string; createdBy?: string; createdAt?: string } | null> {
    try {
      const doc = await space.openDoc(docName);
      const meta = doc.getMap(docName).get('_meta') as any;
      if (meta?.description) return meta;
    } catch { /* doc doesn't exist yet */ }
    // Fallback for well-known docs
    if (KNOWN_CRDT_DOCS[docName]) return { description: KNOWN_CRDT_DOCS[docName] };
    return null;
  }

  async function ensureMeta(docName: string, doc: CollabDocument, role: string, description?: string): Promise<void> {
    const map = doc.getMap(docName);
    if (map.has('_meta')) return;  // already has metadata
    map.set('_meta', {
      description: description ?? KNOWN_CRDT_DOCS[docName] ?? `Created by ${role}`,
      createdBy: role,
      createdAt: new Date().toISOString(),
    });
  }

  return tool(async ({ action, docName, key, value, description }) => {

    // === DISCOVER: progressive drill-down into L2 categories ===
    if (action === 'discover') {
      if (!docName) {
        // Top-level: show all L2 categories with counts
        const crdtDocs = await space.listDocs();
        const plans = await coordinator.planStore.listAllPlans();
        const manifests = await coordinator.getAllManifests(repoPath);
        return [
          'Available L2 team state (use discover with docName to drill in):',
          '',
          `  📂 crdt    — ${crdtDocs.length} real-time docs (${crdtDocs.join(', ') || 'none yet'})`,
          `  📂 plans   — ${plans.length} plan files`,
          `  📂 outputs — ${manifests.length} task output manifests`,
          '',
          'Use: collab({ action: "discover", docName: "crdt" | "plans" | "outputs" })',
        ].join('\n');
      }

      if (docName === 'crdt') {
        const liveDocs = await space.listDocs();
        // Read _meta from each doc for descriptions (parallel)
        const metas = await Promise.all(liveDocs.map(async d => ({
          name: d,
          meta: await readMeta(d),
        })));
        return [
          'CRDT documents (real-time, read+write):',
          ...metas.map(({ name, meta }) => {
            const desc = meta?.description ?? 'no description (add via `description` param on write)';
            const by = meta?.createdBy && !KNOWN_CRDT_DOCS[name] ? ` [by ${meta.createdBy}]` : '';
            return `  📄 "${name}"${by} — ${desc}`;
          }),
          '',
          'Any "doc-*" documents are BlockNote collaborative editors (rich text).',
          'You can create new docs by writing to any name — auto-created on first write.',
          'Tip: include a "description" field on first write — stored as _meta in the doc.',
        ].join('\n');
      }

      if (docName === 'plans') {
        const plans = await coordinator.planStore.listAllPlans();
        if (!plans.length) return 'No plans found for this team.';
        return [
          'Plans (read-only):',
          ...plans.map(p => `  📄 ${p.planId} [${p.status}] — "${p.goal}" (v${p.version})`),
        ].join('\n');
      }

      if (docName === 'outputs') {
        const manifests = await coordinator.getAllManifests(repoPath);
        if (!manifests.length) return 'No output manifests found.';
        return [
          'Output manifests (read-only):',
          ...manifests.map(m => `  📄 ${m.taskId} (${m.role}) — ${m.outputs.length} files, completed ${m.completedAt}`),
        ].join('\n');
      }

      return `Unknown category "${docName}". Use: crdt, plans, outputs.`;
    }

    // === LIST: show keys/items in a specific doc or category ===
    if (action === 'list') {
      if (!docName) return 'Provide docName. Use discover to see available categories.';

      if (docName === 'plans') {
        const plans = await coordinator.planStore.listAllPlans();
        return plans.map(p => `  • ${p.planId} [${p.status}] — ${p.goal}`).join('\n') || 'No plans.';
      }
      if (docName === 'outputs') {
        const manifests = await coordinator.getAllManifests(repoPath);
        return manifests.map(m => `  • ${m.taskId} (${m.role}) — ${m.outputs.length} files`).join('\n') || 'No outputs.';
      }

      // CRDT doc — list keys with value previews (filter out _meta)
      const doc = await space.openDoc(docName);
      const map = doc.getMap(docName);
      const keys = Array.from(map.keys()).filter(k => k !== '_meta');
      if (!keys.length) return `"${docName}" exists but has no entries yet.`;
      return [
        `Keys in "${docName}" (${keys.length}):`,
        ...keys.map(k => {
          const val = map.get(k);
          const preview = typeof val === 'object' ? JSON.stringify(val).slice(0, 80) + '…' : String(val);
          return `  • ${k}: ${preview}`;
        }),
      ].join('\n');
    }

    // === READ: get a specific item ===
    if (action === 'read') {
      if (!docName) return 'Provide docName. Use discover to see available categories.';

      if (docName === 'plans' && key) {
        // Find plan across all goals
        const plans = await coordinator.planStore.listAllPlans();
        const meta = plans.find(p => p.planId === key);
        if (!meta) return `Plan "${key}" not found.`;
        const stored = await coordinator.planStore.loadPlan(meta.planId, meta.goalId);
        return stored ? JSON.stringify(stored, null, 2) : `Plan "${key}" not found.`;
      }
      if (docName === 'outputs' && key) {
        const manifest = await coordinator.getOutputManifest(repoPath, key);
        return manifest ? JSON.stringify(manifest, null, 2) : `Output manifest "${key}" not found.`;
      }

      // CRDT doc
      const doc = await space.openDoc(docName);
      if (key) {
        if (key === '_meta') return JSON.stringify(doc.getMap(docName).get('_meta'), null, 2);
        const val = doc.getMap(docName).get(key);
        return val ? JSON.stringify(val, null, 2) : `Key "${key}" not found in "${docName}".`;
      }
      // Full doc read — strip _meta from output
      const json = doc.toJSON();
      const { _meta, ...data } = json[docName] ?? json;
      return JSON.stringify(data, null, 2);
    }

    // === WRITE: CRDT only (plans and outputs are read-only) ===
    if (action === 'write') {
      if (!docName || !key) return 'Both docName and key required for writes.';
      if (docName === 'plans' || docName === 'outputs') return `"${docName}" is read-only. Only CRDT docs are writable.`;
      const doc = await space.openDoc(docName);
      doc.getMap(docName).set(key, typeof value === 'string' ? JSON.parse(value) : value);
      // Auto-populate _meta on first write (co-located with the doc itself)
      await ensureMeta(docName, doc, agentRole, description);
      return `Written to "${docName}": ${key}. All team agents can now see this.`;
    }

    return `Unknown action "${action}". Use: discover, list, read, write.`;
  }, {
    name: 'collab',
    description: [
      'Access shared team state — CRDT docs, plans, and output manifests.',
      'Progressive discovery: start with discover, then list, read, or write.',
      '',
      'Actions:',
      '  discover — browse L2 categories (no docName) or items in a category (docName = crdt|plans|outputs)',
      '  list     — show keys in a CRDT doc, or items in plans/outputs',
      '  read     — get a specific key/item as JSON',
      '  write    — set a key/value in a CRDT doc (plans & outputs are read-only)',
      '           include "description" on first write to a new doc so others can discover it',
      '',
      'Typical workflow:',
      '  1. discover()                                          → see L2 categories',
      '  2. discover({ docName: "crdt" })                       → see CRDT docs with descriptions',
      '  3. list({ docName: "agent-statuses" })                 → see who is on the team',
      '  4. read({ docName: "agent-statuses", key: "frontend-dev" }) → check their status',
      '  5. write({ docName: "agent-statuses", key: myRole, value: {...} }) → report yours',
      '  6. write({ docName: "my-spec", key: "v1", value: {...}, description: "..." }) → new doc',
    ].join('\n'),
    schema: z.object({
      action: z.enum(['discover', 'list', 'read', 'write']).describe('discover | list | read | write'),
      docName: z.string().optional().describe('Category (crdt|plans|outputs) for discover, or doc/category name for list/read/write'),
      key: z.string().optional().describe('Key (optional for read-all, required for write)'),
      value: z.any().optional().describe('Value to write (only for write action)'),
      description: z.string().optional().describe('Description of a new custom doc (only for first write to a new doc — helps other agents discover it)'),
    }),
  });
}
```

**Agent tool summary:**
| Action | Tool | Example |
|--------|------|---------|
| Discover L2 categories | `collab` | `{ action: 'discover' }` → crdt, plans, outputs |
| Discover CRDT docs | `collab` | `{ action: 'discover', docName: 'crdt' }` → docs with descriptions |
| Discover plans | `collab` | `{ action: 'discover', docName: 'plans' }` → plans with status/goal |
| List keys in a CRDT doc | `collab` | `{ action: 'list', docName: 'agent-statuses' }` → keys + previews |
| Read specific value | `collab` | `{ action: 'read', docName: 'agent-statuses', key: 'frontend-dev' }` |
| Read a plan | `collab` | `{ action: 'read', docName: 'plans', key: 'plan-v1' }` |
| Read an output manifest | `collab` | `{ action: 'read', docName: 'outputs', key: 'task-042' }` |
| Report status / write | `collab` | `{ action: 'write', docName: 'agent-statuses', key: myRole, value: {...} }` |
| Co-author shared spec | `collab` | `{ action: 'write', docName: 'api-contract', key: 'endpoints', value: [...] }` |
| Create new custom doc | `collab` | `{ action: 'write', docName: 'my-spec', key: 'v1', value: {...}, description: '...' }` — auto-registered |

**System-internal CRDT (supplements agent `collab` tool):**
| Action | Called by | API |
|--------|-----------|-----|
| Auto-update task status (start/complete/fail) | `WorkerPool` | `space.openDoc('agent-statuses').getMap().set(role, ...)` |
| Store group chat outcome | `GroupChatManager` | `space.openDoc('chat-outcomes').getArray().push()` |
| Collaborative document editing | Frontend (BlockNote) | `HocuspocusProvider` (WebSocket) |
| onChange → projection to `.ping/` | Hocuspocus hook | Automatic (Planner reads; workers use `collab` tool) |

---

### Phase 6: Code Intel Persistence (2-3 days)

**Keep L1 in-memory indexes (MiniSearch + SymbolIndex). Add L2 persistence so workspaces load instantly.**

The current L1 indexes (MiniSearch for BM25 keyword search, `Map<string, SymbolLocation[]>` for symbols) are fast and proven — they stay. The problem is they rebuild from scratch on every workspace init. Phase 6 adds a persistence layer: L1 indexes serialize to L2 snapshots (MongoDB), and on next init L1 hydrates from the snapshot instead of re-parsing every file. Only files changed since the snapshot need re-indexing.

**Foundation: .scm Tag Queries (Completed)** — Before the persistence work, all symbol extraction was migrated from manual AST walking to `.scm` tag query files (Aider-style). This eliminates ~150 lines of fragile `walkTree()`/`nodeToSymbol()`/`extractName()`/`mapNodeKind()` code and provides both definitions AND references from a single parse.

| Component | Before | After |
|-----------|--------|-------|
| **Symbol extraction** | `SYMBOL_NODE_TYPES` Set + recursive `walkTree()` | `.scm` query files via `Language.query()` → `query.matches()` |
| **Reference counting** | `string.includes(name)` — false positives | `@name.reference.*` captures — tree-sitter-accurate |
| **Language coverage** | ~15 node types hardcoded | 17 languages with per-language query files |
| **Data output** | `Symbol[]` (definitions only) | `TagCapture[]` (definitions + references, `type` discriminated) |

Changes already applied:
- `queries/` — 17 `.scm` files (typescript, tsx, javascript, python, go, rust, java, c, cpp, csharp, ruby, php, swift, kotlin, scala, lua, bash). Adapted from Aider's `tree-sitter-language-pack` (MIT/Apache-2.0). Custom predicates (`#strip!`, `#select-adjacent!`) removed (unsupported in web-tree-sitter WASM).
- `TreeSitterService.ts` — Added `extractTags(source, filePath): Promise<TagCapture[]>`, `hasTagQuery()`, `getTagQuery()`, query caching (`queryCache`, `querySourceCache`). `SYMBOL_NODE_TYPES`/`NAMED_NODE_TYPES` deprecated.
- `RepoMapBuilder.ts` — `extractSymbols()` now calls `extractTags()` and filters to definitions. `buildRepoMap()` extracts defs + refs in a single pass (no double-parse). `countReferences()` uses pre-extracted `@reference.*` captures instead of `string.includes()`. Removed: `walkTree()`, `nodeToSymbol()`, `extractName()`, `mapNodeKind()` (~150 lines).
- `SymbolIndex.ts` — `indexFile()` calls `extractTags()` directly (removed `RepoMapBuilder` dependency). `normalizeKind()` maps tag kinds → `SymbolKind`.
- `index.ts` — Barrel exports `TagCapture`.

```typescript
// TagCapture interface (from TreeSitterService.ts)
export interface TagCapture {
  name: string;                              // Symbol name
  type: "definition" | "reference";          // Discriminator
  kind: string;                              // function, method, class, interface, type, enum, module, variable, constant, macro, call, implementation
  line: number;                              // 0-based
  endLine: number;                           // 0-based
  signature: string;                         // First line of captured node
  language: LanguageName;
}
```

**Architecture: L1 ↔ L2 snapshot cycle**

```
┌────────────────────────────────────────────────────────────────────────┐
│  L1 (Agent Workspace — in-memory, fast)                                │
│  ┌──────────────────────┐  ┌──────────────────────────────────────┐    │
│  │ MiniSearch            │  │ SymbolIndex (Map<file, Symbol[]>)    │    │
│  │ • BM25 keyword search │  │ • findSymbol (exact/prefix/fuzzy)   │    │
│  │ • Fuzzy + prefix      │  │ • getFileSymbols                    │    │
│  │ • Auto-suggest        │  │ • repo map building                 │    │
│  └──────────┬───────────┘  └──────────────┬───────────────────────┘    │
│             │                              │                            │
│             │  serialize on persist        │  serialize on persist       │
│             ▼                              ▼                            │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ IndexPersistence (save/load trigger)                              │  │
│  │ • On init: load snapshot → hydrate MiniSearch + SymbolIndex       │  │
│  │ • On change: debounced save → serialize to L2                     │  │
│  │ • Tracks FileState (contentHash per file) for incremental         │  │
│  └──────────────────────────────────────────┬───────────────────────┘  │
└──────────────────────────────────────────────┼──────────────────────────┘
                                               │
                    save / load                │
                                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  L2 (MongoDB — persistent, shared, branched)                             │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ IndexSnapshotModel                                                  │  │
│  │ • branchId: string          (workspace branch — CoW key)           │  │
│  │ • searchIndex: Buffer       (MiniSearch.toJSON() → gzipped)        │  │
│  │ • symbols: SymbolEntry[]    (flat array of all symbols)            │  │
│  │ • fileStates: FileState[]   (contentHash per file — for incr.)    │  │
│  │ • version: number           (schema version for migrations)        │  │
│  │ • savedAt: Date                                                     │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

**Why snapshots (not row-per-symbol)?**
- **MiniSearch can't be built from rows** — its internal inverted index (term → document IDs, tf-idf weights) must be serialized/deserialized as a whole via `MiniSearch.loadJSON()`. You can't reconstruct BM25 scores from individual documents without re-indexing them all.
- **Atomic consistency** — symbols + search index + file states are always in sync (one write). Row-per-symbol risks partial writes where the search index and symbol map disagree.
- **Branching is simpler** — CoW = copy one document, not thousands of rows. Fork is O(1) DB op, not O(n) row copies.
- **L1 is the fast path** — agents query in-memory MiniSearch and Map, not MongoDB. L2 is cold storage for persistence and branching. No need for DB query optimization.

**What stays in L1 (unchanged):**
| L1 File | Status | Why |
|---------|--------|-----|
| `workspace/codeintel/TreeSitterService.ts` | Stays | Stateless parser, no persistence needed |
| `workspace/codeintel/RepoMapBuilder.ts` | Stays | Builds repo map from in-memory SymbolIndex |
| `workspace/codeintel/SymbolIndex.ts` | Stays + adds `toJSON()`/`fromJSON()` | Serialization hooks for snapshot |
| `workspace/search/WorkspaceSearchIndex.ts` | Stays + adds `toJSON()`/`fromJSON()` | MiniSearch already has `toJSON()`/`loadJSON()` |
| `workspace/tools/workspace-tools.ts` | Stays | Tools call L1 in-memory indexes directly |

**What's new (L2 persistence layer):**
| New File | Purpose |
|----------|---------|
| `codeintel/models/IndexSnapshot.model.ts` | Mongoose schema for persisted snapshots |
| `codeintel/IndexPersistence.ts` | Save/load/fork/merge orchestrator |

**Mongoose schema** — one document per branch snapshot:

```typescript
// codeintel/models/IndexSnapshot.model.ts
import mongoose, { Schema, Document, Model } from 'mongoose';

// Symbol entry — flat structure for serialization (mirrors SymbolLocation)
export interface SymbolEntry {
  file: string;
  name: string;
  kind: string;
  line: number;
  endLine: number;
  signature: string;
  language: string;
}

// File state — tracks content hash for incremental re-indexing
export interface FileState {
  file: string;
  contentHash: string;       // sha256 — skip re-indexing if unchanged
  lineCount: number;
  language: string;
}

export interface IIndexSnapshot extends Document {
  branchId: string;          // workspace branch — CoW key
  searchIndex: Buffer;       // MiniSearch.toJSON() → gzipped
  symbols: SymbolEntry[];    // all symbols across all files
  fileStates: FileState[];   // content hash per file (for incremental)
  version: number;           // schema version (for future migrations)
  savedAt: Date;
}

const indexSnapshotSchema = new Schema<IIndexSnapshot>({
  branchId: { type: String, required: true, unique: true, index: true },
  searchIndex: { type: Buffer, required: true },
  symbols: [{
    file: String, name: String, kind: String,
    line: Number, endLine: Number, signature: String, language: String,
  }],
  fileStates: [{
    file: String, contentHash: String, lineCount: Number, language: String,
  }],
  version: { type: Number, default: 1 },
  savedAt: { type: Date, default: Date.now },
}, { timestamps: true });

export const IndexSnapshotModel = (mongoose.models.IndexSnapshot as Model<IIndexSnapshot>)
  || mongoose.model<IIndexSnapshot>('IndexSnapshot', indexSnapshotSchema);
```

**IndexPersistence** — orchestrates save/load/fork/merge between L1 and L2:

```typescript
// codeintel/IndexPersistence.ts
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import crypto from 'crypto';
import MiniSearch from 'minisearch';
import { IndexSnapshotModel, type SymbolEntry, type FileState } from './models/IndexSnapshot.model.js';
import type { SymbolIndex } from '../workspace/codeintel/SymbolIndex.js';
import type { WorkspaceSearchIndex } from '../workspace/search/WorkspaceSearchIndex.js';
import type { TreeSitterService } from '../workspace/codeintel/TreeSitterService.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const SAVE_DEBOUNCE_MS = 5000;  // persist 5s after last change

export class IndexPersistence {
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private fileHashes = new Map<string, string>();  // file → contentHash

  constructor(
    private branchId: string,
    private symbolIndex: SymbolIndex,
    private searchIndex: WorkspaceSearchIndex,
    private parser: TreeSitterService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════
  // LOAD: L2 snapshot → L1 in-memory indexes
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Hydrate L1 indexes from L2 snapshot. Returns files that need re-indexing
   * (changed since snapshot). If no snapshot exists, returns null (full rebuild needed).
   */
  async load(): Promise<{ changedFiles: string[] } | null> {
    const snapshot = await IndexSnapshotModel.findOne({ branchId: this.branchId }).lean();
    if (!snapshot) return null;  // no snapshot — full rebuild needed

    // Hydrate MiniSearch from gzipped JSON
    const searchJSON = (await gunzipAsync(snapshot.searchIndex)).toString('utf-8');
    this.searchIndex.loadFromJSON(searchJSON);

    // Hydrate SymbolIndex from flat symbol array
    this.symbolIndex.loadFromEntries(snapshot.symbols);

    // Rebuild fileHashes map for incremental tracking
    for (const fs of snapshot.fileStates) {
      this.fileHashes.set(fs.file, fs.contentHash);
    }

    return { changedFiles: [] };  // Caller diffs workspace files against fileHashes
  }

  /**
   * Check which files have changed since the snapshot (by comparing content hashes).
   * These files need re-indexing after hydration.
   */
  getChangedFiles(currentFiles: Map<string, string>): string[] {
    const changed: string[] = [];
    // Files modified or added
    for (const [file, hash] of currentFiles) {
      if (this.fileHashes.get(file) !== hash) changed.push(file);
    }
    // Files deleted (in snapshot but not in workspace)
    for (const file of this.fileHashes.keys()) {
      if (!currentFiles.has(file)) changed.push(file);
    }
    return changed;
  }

  /**
   * Compute content hash for a file (for incremental tracking).
   */
  static contentHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SAVE: L1 in-memory indexes → L2 snapshot
  // ═══════════════════════════════════════════════════════════════════════

  /** Schedule a debounced save to L2 (call after any index mutation). */
  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_DEBOUNCE_MS);
  }

  /** Immediately persist current L1 state to L2 snapshot. */
  async save(): Promise<void> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }

    // Serialize MiniSearch → gzipped JSON
    const searchJSON = JSON.stringify(this.searchIndex.toJSON());
    const searchBuffer = await gzipAsync(Buffer.from(searchJSON, 'utf-8'));

    // Serialize SymbolIndex → flat array
    const symbols: SymbolEntry[] = this.symbolIndex.toEntries();

    // Serialize file states
    const fileStates: FileState[] = Array.from(this.fileHashes.entries()).map(
      ([file, contentHash]) => ({
        file, contentHash,
        lineCount: this.symbolIndex.getFileLineCount(file) ?? 0,
        language: this.symbolIndex.getFileLanguage(file) ?? 'unknown',
      }),
    );

    await IndexSnapshotModel.findOneAndUpdate(
      { branchId: this.branchId },
      { searchIndex: searchBuffer, symbols, fileStates, version: 1, savedAt: new Date() },
      { upsert: true },
    );
  }

  /** Update file hash after indexing (for incremental tracking). */
  trackFile(file: string, contentHash: string): void {
    this.fileHashes.set(file, contentHash);
    this.scheduleSave();
  }

  /** Remove file hash after file deletion. */
  untrackFile(file: string): void {
    this.fileHashes.delete(file);
    this.scheduleSave();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BRANCHING: CoW fork + merge
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Fork: copy L2 snapshot from source branch → new branch.
   * O(1) MongoDB op — copies one document, not thousands of rows.
   */
  static async forkSnapshot(sourceBranch: string, newBranch: string): Promise<void> {
    const source = await IndexSnapshotModel.findOne({ branchId: sourceBranch }).lean();
    if (!source) return;  // no snapshot to fork — new branch will rebuild
    const { _id, ...data } = source;
    await IndexSnapshotModel.create({ ...data, branchId: newBranch, savedAt: new Date() });
  }

  /**
   * Merge: re-index only changed files from diff on the target branch.
   * 1. Load target branch snapshot into L1
   * 2. Re-index changedFiles using L1's indexFile()
   * 3. Save updated L1 back to L2
   */
  static async mergeSnapshot(
    targetBranch: string, changedFiles: string[],
    symbolIndex: SymbolIndex, searchIndex: WorkspaceSearchIndex, parser: TreeSitterService,
  ): Promise<void> {
    const persistence = new IndexPersistence(targetBranch, symbolIndex, searchIndex, parser);
    await persistence.load();
    // Caller re-indexes changedFiles via workspace's indexFile(), then calls persistence.save()
  }

  /** Delete a branch's snapshot (cleanup after branch delete). */
  static async deleteSnapshot(branchId: string): Promise<void> {
    await IndexSnapshotModel.deleteOne({ branchId });
  }
}
```

**L1 serialization hooks** — small additions to existing classes:

```typescript
// Add to SymbolIndex.ts:
export class SymbolIndex {
  // ... existing code ...

  /** Serialize all symbols to flat array (for L2 snapshot) */
  toEntries(): SymbolEntry[] {
    const entries: SymbolEntry[] = [];
    for (const [file, symbols] of this.symbols) {
      for (const sym of symbols) {
        entries.push({ file, name: sym.name, kind: sym.kind, line: sym.line,
          endLine: sym.endLine, signature: sym.signature, language: sym.language });
      }
    }
    return entries;
  }

  /** Hydrate from flat array (from L2 snapshot) */
  loadFromEntries(entries: SymbolEntry[]): void {
    this.symbols.clear();
    for (const e of entries) {
      if (!this.symbols.has(e.file)) this.symbols.set(e.file, []);
      this.symbols.get(e.file)!.push({
        name: e.name, kind: e.kind as SymbolKind, file: e.file, line: e.line,
        endLine: e.endLine, signature: e.signature, language: e.language as LanguageName,
      });
    }
  }

  /** Helper for IndexPersistence */
  getFileLineCount(file: string): number | undefined { /* from fileStates */ }
  getFileLanguage(file: string): string | undefined { /* from fileStates */ }
}

// Add to WorkspaceSearchIndex.ts:
export class WorkspaceSearchIndex {
  // ... existing code ...

  /** Serialize MiniSearch index (for L2 snapshot) */
  toJSON(): any {
    return this.miniSearch.toJSON();
  }

  /** Hydrate MiniSearch from serialized JSON (from L2 snapshot) */
  loadFromJSON(json: string): void {
    this.miniSearch = MiniSearch.loadJSON(json, {
      fields: ['content'],
      storeFields: ['file', 'content', 'lineStart', 'lineEnd'],
    });
    // Rebuild indexedFiles map from MiniSearch stored fields
    this.indexedFiles.clear();
    for (const doc of this.miniSearch.documentCount /* iterate stored docs */) {
      // Group chunks by file to rebuild indexedFiles
    }
  }
}
```

**Init flow** — workspace startup with snapshot hydration:

```typescript
// In AgentWorkspace initialization:
async function initializeWithPersistence(workspace: AgentWorkspace, branchId: string) {
  const persistence = new IndexPersistence(
    branchId, workspace.symbolIndex, workspace.searchIndex, workspace.parser,
  );

  // Try to hydrate from L2 snapshot
  const result = await persistence.load();

  if (!result) {
    // No snapshot — full rebuild (first time for this branch)
    await workspace.searchIndex.indexWorkspace();
    await workspace.symbolIndex.indexWorkspace();
    await persistence.save();
    return persistence;
  }

  // Snapshot loaded — only re-index changed files
  const currentHashes = await hashWorkspaceFiles(workspace.basePath);
  const changed = persistence.getChangedFiles(currentHashes);

  if (changed.length > 0) {
    for (const file of changed) {
      await workspace.searchIndex.indexFile(file);
      await workspace.symbolIndex.indexFile(file);
      persistence.trackFile(file, currentHashes.get(file)!);
    }
  }

  return persistence;
}

// Hook into file changes (existing debounced reindex):
// After searchIndex.scheduleReindex() and symbolIndex.scheduleReindex():
persistence.trackFile(file, IndexPersistence.contentHash(content));
// → debounced save to L2 snapshot (5s after last change)
```

**Branching flow** — workspace fork/merge:

```
# Fork (agent starts new task on a branch):
1. Git creates branch from main
2. IndexPersistence.forkSnapshot('main', 'task-042-branch')  → O(1) MongoDB doc copy
3. New workspace loads → persistence.load() hydrates from forked snapshot instantly
4. Agent works → file changes → incremental re-index + debounced save

# Merge (agent completes task, merges to main):
1. Git merges branch to main
2. Get changedFiles from git diff
3. Load main snapshot → re-index only changed files → save
4. IndexPersistence.deleteSnapshot('task-042-branch')  → cleanup
```

**Clean L1:** No code is removed from L1. `workspace/search/` and `workspace/codeintel/` stay. New files are added in `codeintel/` for the persistence layer. Tools continue to call L1 in-memory indexes directly for fast queries.

---

## Use Cases

### A. Plan Management

| # | Use Case | Phase | Mechanism | Success Criterion |
|---|----------|-------|-----------|-------------------|
| 1 | Multiple plans per team (multi-goal) | 1a | PlanStore scoped by `teamId/goalId` directory | `listPlansByGoal()` returns plans per goal, `listAllPlans()` across goals |
| 2 | Plan history — never deleted, full lineage | 1a | `archivePlan()` replaces `deletePlan()`, `version` field | Completed plans persist on disk; archive moves to `_archive/` |
| 3 | Replan tracking (which plan replaced which) | 1a | `parentPlanId` on `PlanMetadata` | Replanned plans link to previous via `parentPlanId` |
| 4 | Active plan per goal (only one executing) | 1a | `getActivePlan(goalId)` — finds `executing` or `approved` | At most one plan with active status per `goalId` |
| 5 | Plan projection for agent reads | 1a | `.ping/plans/{planId}.json` via `projectPlan()` | Agents can `read_file('.ping/plans/...')` for plan context |
| 6 | Recovery — reload active plan on restart | 1a | `getLatestActivePlan()` scans all goals | OrchestratorService recovers state after crash/restart |

### B. Output Tracking

| # | Use Case | Phase | Mechanism | Success Criterion |
|---|----------|-------|-----------|-------------------|
| 7 | Task output manifests (replaces ArtifactRegistry) | 1b–1d | `OutputManifest` written by `publish()` to `.ping/outputs/{taskId}.json` | `ArtifactRegistry` deleted; manifests written on publish |
| 8 | Output discovery by role or type | 5a | `MemoryCoordinator.queryOutputs(repoPath, { role, type })` | Filter outputs across all tasks by role or file type |
| 9 | Deduplication via content hash | 1c | `contentHash` (sha256) in `OutputEntry` | Same file content produces same hash; consumers can dedup |
| 10 | Activity summary per task | 1d | `activitySummary` field in `OutputManifest` | LLM-friendly summary of what the agent did |

### C. Real-Time CRDT Coordination

| # | Use Case | Phase | Mechanism | Success Criterion |
|---|----------|-------|-----------|-------------------|
| 11 | Agent status broadcasting (working/blocked/idle) | 4c | `collab({ action: 'write', docName: 'agent-statuses', key: role, value: {...} })` → `Y.Map` | All agents see each other's status instantly (no polling) |
| 12 | Agent discovery reporting (share findings) | 4c | `discoveries` field in status payload | Planner + peers see discoveries in real-time |
| 13 | Agent blocker reporting (Planner reacts) | 4c | `blockers` field in status payload | Planner can reassign tasks when blockers appear |
| 14 | Automatic status updates (task start/complete/fail) | 5b | WorkerPool auto-writes to `agent-statuses` CRDT | Status updates without agent needing to call `collab` |
| 15 | Group chat outcome storage | 4a | `storeGroupChatOutcome()` → `Y.Array('chat-outcomes')` | Outcomes appended to CRDT array, projected to `.ping/collaboration/chat-outcomes/` |
| 16 | Planner real-time decision input from chat outcomes | 4a | Planner subscribes to Hocuspocus doc | Planner re-plans immediately when chat decisions land |
| 17 | Binary sharing (multi-writer: generate + annotate) | 4b | `shareBinary()` → `Y.Map('binaries')`, CRDT merge | Two agents write to same binary entry concurrently, CRDT merges |
| 18 | On-demand shared doc creation (no pre-registration) | 4c | `collab({ action: 'write', docName: 'any-name', key, value })` auto-creates doc | No setup step — `openDoc()` is "get or create" |
| 19 | Multi-agent co-authoring of shared specs/contracts | 4c | Multiple agents `collab` write same `docName` | Concurrent writes merge; projected JSON has all agents' contributions |

### D. Collaborative Editing (Frontend + Agents)

| # | Use Case | Phase | Mechanism | Success Criterion |
|---|----------|-------|-----------|-------------------|
| 20 | BlockNote rich text editing (human) | 3a | `HocuspocusProvider` + `useCreateBlockNote()` with `Y.XmlFragment` | Human edits in block editor, changes persisted via Hocuspocus |
| 21 | Agent co-editing BlockNote docs | 4c | Agent `collab({ action: 'write', docName: 'doc-{id}', ... })` writes to same `Y.Doc` | Agent writes appear in human's BlockNote editor live |
| 22 | Real-time presence (cursors + user names) | 3b | Hocuspocus Awareness protocol, `PresenceBar` component | Cursor positions and user names visible in editor |
| 23 | Human sees agent contributions live | 4c | Agent CRDT writes propagate via Hocuspocus to BlockNote | No refresh needed — changes stream in real-time |

### E. Progressive Discovery & Agent Reads

| # | Use Case | Phase | Mechanism | Success Criterion |
|---|----------|-------|-----------|-------------------|
| 24 | CRDT → readable JSON/markdown projection | 2a | `onChange` hook: `Y.Map`→JSON, `Y.Array`→files, `Y.XmlFragment`→markdown | Every CRDT mutation auto-projected to `.ping/` within seconds |
| 25 | Progressive discovery of L2 state | 5b | `collab({ action: 'discover' })` → categories, then `discover(docName)` → items | Workers start with discover, drill into what they need — no upfront `.ping/` knowledge |
| 26 | Planner reads via L1 tools on projections | 4c | `read_file`, `list_dir`, `grep` on `.ping/` (co-located with Hocuspocus) | Planner uses existing L1 tools on projected files |
| 27 | Custom folder auto-creation in `.ping/collaboration/` | 4c | Projection derives directory structure from Yjs type | `Y.Array` → directory with per-item files; `Y.Map` → single JSON |

### F. Infrastructure

| # | Use Case | Phase | Mechanism | Success Criterion |
|---|----------|-------|-----------|-------------------|
| 28 | Hocuspocus embedded server (in-process) | 2a | `CollabServer` wrapping `Hocuspocus` + `openDirectConnection()` | No external server dependency; agents connect in-process |
| 29 | Dual-write persistence (durable + projection) | 2a | Database extension (`store/fetch`) + `onChange` projection | CRDT binary survives restart; `.ping/` files are disposable |
| 30 | Per-goal collaboration spaces | 2c, 5a | `CollaborationSpace` keyed by `teamId/goalId` | Each goal gets isolated CRDT namespace |
| 31 | MemoryCoordinator wiring | 5a | `getOrCreateSpace(goalId)` replaces artifact/collab stubs | Stubs removed; real `CollaborationSpace` instances provided |
| 32 | Unified `collab` tool (discover/list/read/write) | 5b | Single tool covers CRDT, plans, outputs — progressive discovery | Workers access all L2 state without knowing `.ping/` paths |

### G. Code Intelligence (L1 persistence to L2)

| # | Use Case | Phase | Mechanism | Success Criterion |
|---|----------|-------|-----------|-------------------|
| 33 | Incremental file indexing (skip unchanged) | 6 | `IndexPersistence.fileHashes` (sha256 per file) — in-memory Map persisted in snapshot | Unchanged files skipped on re-index; hash match = no work |
| 34 | Symbol search (exact/prefix/fuzzy) | 6 | `SymbolIndex` in-memory `Map<string, SymbolLocation[]>` — stays in L1, hydrated from L2 snapshot | `findSymbol('User', { mode: 'prefix' })` returns matches from in-memory Map |
| 35 | BM25 keyword search (MiniSearch stays) | 6 | `WorkspaceSearchIndex` MiniSearch in L1, serialized to L2 via `toJSON()`/`loadJSON()` | Keyword search returns BM25-ranked chunks from in-memory MiniSearch |
| 36 | Branch CoW (fork index without re-parsing) | 6 | `IndexPersistence.forkSnapshot()` — copy one MongoDB document (snapshot blob) | New branch gets full index instantly via O(1) document copy |
| 37 | Branch merge (re-index only changed files) | 6 | Load target snapshot → re-index `changedFiles` from git diff → save | Only diff files re-indexed; rest of index preserved |
| 38 | L1 stays, L2 persistence added | 6 | `workspace/search/` and `workspace/codeintel/` stay; `codeintel/IndexPersistence.ts` + model added | In-memory indexes persist to L2 snapshots; L1 hydrates from L2 on init |

---

### Known Gaps

#### Critical — blocks core loop (Planner plans → Agents work → fetch data)

| # | Status | Gap | Resolution |
|---|--------|-----|------------|
| G6 | ✅ RESOLVED | **`.ping/` was hidden from agent tools** — excluded from `fast-glob`, `ripgrep`, `WorkspaceSearchIndex`, `RepoMapBuilder` | Removed `.ping/` from all 4 agent tool exclusion lists. `.gitignore` stays (disposable projections shouldn't be committed). Agents now discover `.ping/` via L1 tools (`list_dir`, `read_file`, `grep`) — no special context injection needed. |
| G8 | ✅ RESOLVED | **`goalId` origin** — plan requires `goalId` everywhere but never showed where the first one comes from | `goalId` = slugified `plan.goal` via `toGoalId()` in `createPlan` tool (e.g., `"Build REST API"` → `"build-rest-api"`). Stable across replans. Stored on `OrchestratorContext.currentGoalId`. Implementation code added to Phase 1a. |

#### Deferred — not needed for core loop

| # | Gap | Impact | When to Address |
|---|-----|--------|-----------------|
| G1 | **Planner subscription mechanism** — UC 13/16 say Planner "subscribes" to CRDT but no implementation | Planner can't react in real-time; falls back to existing task-event-driven flow (which works) | Future: when Planner needs to re-plan mid-execution based on agent discoveries. Current task-completion events handle the basic loop. |
| G2 | **Authentication** — `onAuthenticate` is `TODO` | Any process can connect to any Hocuspocus doc | Future: before multi-tenant deployment. Single-team dev works without auth. |
| G3 | **Conflict surfacing** — CRDT auto-merges silently | Humans unaware when agents overwrite each other's Y.Map entries | Future: nice-to-have UI feature |
| G4 | **Collaboration space cleanup** — no lifecycle management for old CRDT docs | Old goal data accumulates | Future: call `MemoryCoordinator.archiveSpace(goalId)` on goal completion |
| G5 | **Offline/reconnect** — Hocuspocus handles it but undocumented | Agents don't know about auto-resync | Future: document in agent prompt |

---

## File Structure

```
src/worker/memory/
  collaboration/
    CollaborationSpace.ts
    CollabDocument.ts
    PlanStore.ts
    HocuspocusServer.ts
    types/
      collaboration.types.ts
      output-manifest.types.ts
  codeintel/
    IndexPersistence.ts               # save/load/fork/merge snapshots between L1 ↔ L2
    models/IndexSnapshot.model.ts     # Mongoose schema: one doc per branch snapshot
    types/index.ts
    index.ts
  workspace/
    codeintel/                        # L1 — stays in-memory (unchanged)
      TreeSitterService.ts
      RepoMapBuilder.ts
      SymbolIndex.ts                  # + toEntries()/loadFromEntries() serialization hooks
      queries/                        # .scm tag query files (17 languages)
    search/                           # L1 — stays in-memory (unchanged)
      WorkspaceSearchIndex.ts         # + toJSON()/loadFromJSON() serialization hooks
    tools/workspace-tools.ts          # tools call L1 in-memory indexes directly
```

---

## Dependencies

```json
{
  "yjs": "^13.x",
  "y-protocols": "^1.x",
  "@hocuspocus/server": "latest",
  "@hocuspocus/extension-database": "latest",
  "@hocuspocus/provider": "latest",
  "@blocknote/react": "latest",
  "@blocknote/core": "latest"
}
```

---

## Events

```typescript
interface CollabEvents {
  'space:created': { space: CollaborationSpace };
  'space:archived': { spaceId: string };
  'output:published': { manifest: OutputManifest; spaceId: string };
  'doc:opened': { docName: string; spaceId: string };
  'doc:updated': { docName: string; update: Uint8Array };
  'doc:presence': { docName: string; presence: AgentPresence[] };
  'plan:saved': { teamId: string; planId: string };
}
```

---

## Success Criteria

**Core loop (Planner → Agents → Data):**
- [ ] PlanStore in `memory/collaboration/`, ArtifactRegistry deleted
- [x] `goalId` = slugified `plan.goal` via `toGoalId()`, threaded through PlanStore, OrchestratorService, WorkerPool
- [ ] `workspace.publish()` writes output manifests, discoverable via `MemoryCoordinator.queryOutputs()`
- [x] `.ping/` visible to agents via L1 tools (exclusions removed from `AgentWorkspace`, `WorkspaceSearchIndex`, `RepoMapBuilder`)
- [ ] Agents can read projected CRDT state: `read_file('.ping/agent-statuses/backend-dev.json')` returns data

**CRDT collaboration:**
- [ ] All CRDT state via unified `openDoc()` → `CollabDocument` (no per-type store/get)
- [ ] Hocuspocus dual-write: Database extension + onChange projection
- [ ] CRDT collaboration works (multiple agents edit same doc)
- [ ] Group chat outcomes + binaries stored via unified API
- [ ] BlockNote editor connects to Hocuspocus in AgentChat
- [ ] Unified `collab` tool (discover/list/read/write) — progressive discovery of all L2 state
- [ ] `discover` scopes independently: `crdt`, `plans`, `outputs` each return category-specific listings
- [ ] Workers access plans + outputs + CRDT docs through `collab` without `.ping/` paths

**Code intelligence:**
- [ ] MiniSearch + SymbolIndex stay in L1 (fast in-memory queries), persist to L2 via `IndexPersistence`
- [ ] L2 snapshot: `IndexSnapshotModel` stores gzipped MiniSearch index + symbol array + file hashes per branch
- [ ] Incremental indexing: skip unchanged files via `IndexPersistence.fileHashes` (sha256)
- [ ] Instant hydration: L1 loads from L2 snapshot on init, only re-indexes changed files
- [ ] Branch CoW: `forkSnapshot()` copies one MongoDB document (O(1)), merge re-indexes git diff files only
