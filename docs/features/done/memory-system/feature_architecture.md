# Memory System — Feature Architecture

**Feature:** Multi-layered memory system for multi-agent orchestration with organizational knowledge support.

**Parent:** [orchestrator-agent/feature_architecture.md](../orchestrator-agent/feature_architecture.md)

---

## Quick Links

| Document | Purpose |
|----------|---------|
| [PERSISTENCE_STRATEGY.md](./PERSISTENCE_STRATEGY.md) | Session recovery, checkpointing, storage backends |
| [WORKER_INTEGRATION.md](./WORKER_INTEGRATION.md) | AgentManager lifecycle, context injection |
| [v1.0/feature_implementation_planning.md](./v1.0/feature_implementation_planning.md) | L1: Agent Workspace (Git branches, workspace isolation) |
| [v1.1/feature_implementation_planning.md](./v1.1/feature_implementation_planning.md) | L2: Team Collaboration (PlanStore, output manifests, Hocuspocus CRDT, shared docs) |
| [v2.0/feature_implementation_planning.md](./v2.0/feature_implementation_planning.md) | L3: Knowledge Base (hierarchical retrieval, promotion) |
| [agent_memory_system.md](../../ping/agent_memory_system.md) | Conceptual overview (human-readable) |

---

## Terminology Mapping

This architecture aligns with the conceptual model in [agent_memory_system.md](../../ping/agent_memory_system.md):

| Technical Term (This Doc) | Conceptual Term | Human Analogy |
|---------------------------|-----------------|---------------|
| **L1: Agent Workspace** | Task Memory | Developer's notepad, terminal history |
| **L2: Collaboration Space** | Team Memory | Slack channel, shared Drive, Jira |
| **L3: Knowledge Base** | Org Memory | Confluence wiki, company playbooks |

---

## Source Documents (Consolidated Here)

This architecture consolidates concepts from these existing design docs:

| Document | What It Provides | Layer |
|----------|------------------|-------|
| [Organizational Knowledge Layer](../../product/ideas/organizational-knowledge-layer.md) | Skills/Runbooks/Decisions types, audience permissions, "documents as skills" | L3 |
| [Real-Time Collaboration](../../ping/realtime-collaboration.md) | CRDT tech (Yjs), Structured Document Model, Word export | L2 |
| [Artifact Output Strategy](../../ping/artifact-output-strategy.md) | Hybrid storage (Git + Object Storage), branching strategy | L1, L2 |
| [Group Chat Architecture](../../ping/group-chat-architecture.md) | Worker-to-worker collaboration via time-boxed discussions | L2 |
| [Ping Architecture](../../ping/architecture.md) | TaskQueue by role, Agent polling, Orchestrator tools | All |

---

## Overview

A multi-agent system needs **three distinct memory layers** with different purposes, sync models, and lifecycles:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      MULTI-AGENT MEMORY ARCHITECTURE                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                    LAYER 3: KNOWLEDGE BASE                          ││
│  │                    (Organizational Memory)                           ││
│  │  • Skills, Runbooks, Decisions                                      ││
│  │  • Human-curated, versioned                                         ││
│  │  • Read by agents, write requires approval                          ││
│  │  • Sync: Git-backed, eventual consistency                           ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                              ▲ promote                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                    LAYER 2: COLLABORATION SPACE                     ││
│  │                    (Team Working Memory)                             ││
│  │  • Shared artifacts, task outputs, plans                            ││
│  │  • Real-time sync (CRDT/OT)                                         ││
│  │  • Agents read/write freely                                         ││
│  │  • Lifecycle: Per-project/goal                                      ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                    ▲ publish              ▼ pull                         │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐                  │
│  │  LAYER 1:     │ │  LAYER 1:     │ │  LAYER 1:     │                  │
│  │  Agent A      │ │  Agent B      │ │  Agent C      │                  │
│  │  Workspace    │ │  Workspace    │ │  Workspace    │                  │
│  │  (Branched)   │ │  (Branched)   │ │  (Branched)   │                  │
│  │               │ │               │ │               │                  │
│  │  • Git branch │ │  • Git branch │ │  • Git branch │                  │
│  │  • Task state │ │  • Task state │ │  • Task state │                  │
│  │  • WIP files  │ │  • WIP files  │ │  • WIP files  │                  │
│  └───────────────┘ └───────────────┘ └───────────────┘                  │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### Memory Layer Comparison

| Layer | Purpose | Sync Model | Lifetime | Access |
|-------|---------|------------|----------|--------|
| **L1: Agent Workspace** | Isolated work-in-progress | None (isolated) | Task duration | Agent only |
| **L2: Collaboration Space** | Team coordination, shared context | Real-time (CRDT) | Project/goal | Team agents |
| **L3: Knowledge Base** | Organizational learning | Eventual (Git) | Permanent | All agents (read) |

---

## Layer 1: Agent Workspace

**Purpose:** Isolated environment for agent to work without affecting others.

```
workspace-{taskId}/
  .git/                           # Git repo (own or cloned)
  .scratch/                       # Zone 1: Private scratchpad (gitignored)
  .ping/                          # Metadata (gitignored in clone mode)
  │   ├── workspace.json
  │   └── activity.jsonl
  artifacts/ (or repo structure)  # Zone 2: Deliverables (git-tracked)
```

### Key Properties
- **Isolation:** Git branch per task, no interference
- **Rollback:** Delete branch = undo all changes
- **Safety:** `requireReadBeforeWrite` prevents blind overwrites
- **Search:** grep (`@vscode/ripgrep`), glob (`fast-glob`), BM25 keyword search (`MiniSearch`), semantic search (v2.0)
- **Navigation:** Tree-sitter repo map via `web-tree-sitter` (WASM) + cross-file `find_symbol` (code agents)
- **Scratchpad:** `.scratch/` for research, notes, experiments (gitignored)
- **Identity:** Agent knows its role, progress, tools via `IdentityCard`
- **Context:** Agent pulls relevant knowledge at task start
- **Modes:** Repo URL provided → clone, otherwise → basic workspace
- **Output:** Artifacts published to L2 on completion

### Storage Model

| File Type | Storage | Why |
|-----------|---------|-----|
| **Code, Markdown, JSON** | Git branch | Diffable, versionable |
| **Images, PDFs, .docx** | Git branch (small) / Hocuspocus (shared) | Small binaries git-tracked like any file; shared collaboration binaries via Hocuspocus `Uint8Array` |

> **Decision:** No separate BinaryStorage or Object Storage layer for v1.1. Agent-produced binaries (diagrams, exports) are small and immutable — git handles them fine. For binaries that need real-time sharing between agents, Hocuspocus stores `Uint8Array` natively via Yjs shared types, with persistence to S3/filesystem via the Database extension. Git LFS deferred to v2.0+ if files exceed ~100MB.

### Interface
```typescript
interface AgentWorkspace {
  agentId: string;
  taskId: string;
  branchName: string;
  
  // Workspace operations
  initialize(task: Task): Promise<void>;
  pullContext(knowledgeRefs: string[]): Promise<void>;
  createFile(path: string, content: string): Promise<void>;
  createBinaryFile(path: string, buffer: Buffer): Promise<void>;  // Git-tracked like any file
  commit(message: string): Promise<void>;
  
  // Lifecycle
  publish(): Promise<Artifact[]>;  // → L2 Collaboration Space
  discard(): Promise<void>;        // Delete branch
  merge(): Promise<MergeResult>;   // → main branch
}
```

---

## Layer 2: Collaboration Space

**Purpose:** Real-time shared memory for team coordination during goal execution.

> **Source:** [Real-Time Collaboration](../../ping/realtime-collaboration.md), [Group Chat Architecture](../../ping/group-chat-architecture.md)

Hocuspocus is the unified collaboration backbone. All shared state flows through Yjs documents managed by Hocuspocus (embedded in our Node.js backend):

```
Hocuspocus Server (embedded in Node.js backend, persistence: S3/filesystem via Database extension)
  └── Documents per team/goal:
      ├── {teamId}/{goalId}/shared-context    # Y.Map: agent statuses, blockers, progress
      ├── {teamId}/{goalId}/binaries          # Y.Map: shared binaries as Uint8Array
      ├── {teamId}/{goalId}/chat-outcomes     # Y.Array: group chat outcomes
      ├── {teamId}/{goalId}/doc-{docId}       # Y.XmlFragment: BlockNote CRDT documents
      └── ...

Git (main branch, merged from agent branches):
  └── .ping/outputs/                          # Output manifests (what each task produced)
      ├── task-001.json
      ├── task-002.json
      └── ...

File system:
  └── data/plans/{teamId}/                    # PlanStore (operational state)
      ├── {goalId}/
      │   ├── {planId}.json                   # Active/completed plans (full history)
      │   └── {planId}.json
      ├── {goalId}/
      │   └── {planId}.json
      └── _archive/{goalId}/                  # Archived plans (after cleanup)
          └── {planId}.json
```

### Key Properties
- **Real-time:** CRDT sync via [Yjs](../../ping/realtime-collaboration.md#option-2-yjs-modern-crdt), served by [Hocuspocus](https://tiptap.dev/docs/hocuspocus) (open-source Yjs backend, TypeScript, 18 server hooks, MIT license)
- **Unified backbone:** Hocuspocus handles ALL shared state — documents, binaries, chat outcomes, agent statuses. One persistence mechanism, not three.
- **Same-process embedding:** Hocuspocus runs inside our existing Node.js backend — no separate binary. Y.Doc instances live in-process, enabling direct access via hooks.
- **Server hooks:** `onChange` fires on every document mutation (enables write-through CRDT→file projection), `onStoreDocument` fires for debounced persistence, `onAuthenticate` for auth, `onConnect`/`onDisconnect` for lifecycle.
- **Persistence:** `@hocuspocus/extension-database` with custom `fetch()`/`store()` — S3, filesystem, or any backend in ~20 lines of adapter code.
- **Editor:** [BlockNote](https://blocknotejs.org/) — React block editor with native Yjs collaboration, embedded in AgentChat
- **Scoped:** Per goal/project, not global
- **Transient:** Archived or promoted after goal completion
- **Visible:** All team agents + humans can read/write via shared BlockNote editor

### What Lives Here

| Content | Storage | Sync Model | Who Writes |
|---------|---------|------------|------------|
| Output manifests | Git (`.ping/outputs/`) | On merge | Owning agent (via `workspace.publish()`) |
| Structured documents | Hocuspocus (Yjs CRDT) | Real-time | Any team agent + frontEnd (BlockNote) |
| Shared binaries | Hocuspocus (`Uint8Array` in `Y.Map`) | Real-time | Any team agent |
| Group chat outcomes | Hocuspocus (`Y.Array`) | Real-time | GroupChatManager (Planner observes for re-planning) |
| Agent statuses / context | Hocuspocus (`Y.Map`) | Real-time | WorkerPool (auto) + agents (via `collab` tool) |
| Custom shared docs | Hocuspocus (`Y.Map`) | Real-time | Any agent on demand (auto-created, no registration) |
| Plan state | File system (`data/plans/`) | On change | Orchestrator |

### Server-Side Data Access (How Backend Reads Hocuspocus Docs)

Hocuspocus data is **directly accessible in-process** — no HTTP calls or WebSocket connections needed. Since Hocuspocus runs embedded in our Node.js backend, Y.Doc instances are available directly via server hooks and the Hocuspocus API:

```typescript
import { Hocuspocus } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import * as Y from 'yjs';

const server = new Hocuspocus({
  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        // Load from S3, filesystem, or any storage
        return await loadFromStorage(documentName);
      },
      store: async ({ documentName, state }) => {
        // Persist to S3, filesystem, or any storage
        await saveToStorage(documentName, state);
      },
    }),
  ],

  // Hook: fires on every document mutation (enables CRDT→file projection)
  async onChange({ document, documentName, context }) {
    // Direct Y.Doc access — no hydration needed, it's already in memory
    const context = document.getMap('shared-context').toJSON();
    const outcomes = document.getArray('chat-outcomes').toJSON();
    // Write-through projection to .ping/collaboration/
    await projectToFilesystem(documentName, document);
  },

  // Hook: debounced persistence (fires every 2-10s after changes)
  async onStoreDocument({ documentName, document, state }) {
    // state = Y.encodeStateAsUpdate(document) — ready to persist
  },
});

// Server-side read — open any document on demand:
const doc = await server.openDirectConnection(`${teamId}/${goalId}/shared-context`);
const data = doc.getMap('shared-context').toJSON();       // → { 'agent-backend': { status, currentTask } }
const outcomes = doc.getArray('chat-outcomes').toJSON();    // → GroupChatOutcome[]
```

#### Three Access Patterns

| Pattern | When | Cost | Use Case |
|---------|------|------|----------|
| **On-demand load** | Occasional reads (e.g., planner building context) | In-process Y.Doc access | `CollaborationSpace.getContext()`, Planner context injection |
| **Live subscription** | Active workers editing in real-time | WebSocket per doc | Agent editing shared documents, presence |
| **Write-through projection** | CRDT→file projection for planner | `onChange` hook (automatic) | Materialize `.ping/collaboration/` files on every edit |

> **Key insight:** Since Hocuspocus runs in-process, Y.Doc instances are directly accessible — no HTTP hydration needed. The `onChange` hook fires synchronously on mutations, enabling real-time write-through projection. For our scale (<20 spaces, <100 docs), this is zero-overhead.

### Future: CRDT Search Indexing (Deferred)

With Hocuspocus, the `onChange` hook provides real-time access to document mutations — enabling event-driven secondary indexing when scale demands it.

**Long-term pattern (when scale demands it):** Event-driven secondary indexing.

```
CRDT mutation → onChange hook → Hocuspocus (primary) + SearchIndex (secondary)
```

With Hocuspocus, the `onChange` hook fires on every mutation, providing the Y.Doc and update — no polling or interception needed.

**Search engine tiers (upgrade path):**

| Tier | Engine | When | Docs Scale |
|------|--------|------|------------|
| **T1** | MiniSearch (in-process) | v1.1 if needed | <1K docs |
| **T2** | Postgres tsvector | Growth | 1K-100K |
| **T3** | Elasticsearch/OpenSearch | Production | 100K+ |

**Why deferred for MVP:**
- Only 2 CRDT docs need reading (shared-context, chat-outcomes) — direct in-process access is simpler
- 95% of planner data is git files (`.ping/outputs/*.json`, `data/plans/*.json`) — already plain text
- Adding a search index adds complexity with no benefit at current scale
- The `SearchIndex` interface can be added later without changing callers

> **Research sources:** Yjs community forum (discuss.yjs.dev), Hocuspocus `onChange`/`onStoreDocument` hooks pattern. See [CRDT Filesystem Projection](../../ping/crdt-filesystem-projection.md) for full research notes.

### Group Chat Integration (from [Group Chat Architecture](../../ping/group-chat-architecture.md))

When workers need to collaborate on complex decisions:

```
Writer requests collaboration → Orchestrator moderates → GroupChatManager
                                                              │
                                      ┌───────────────────────┘
                                      ▼
                              ┌─────────────────┐
                              │ GroupChatOutcome │
                              │ • summary        │
                              │ • sharedContext  │ → Stored in L2
                              │ • actionItems    │ → New tasks
                              └─────────────────┘
```

Group chat outputs become **shared context** that other agents can reference.

### Interface
```typescript
interface CollaborationSpace {
  teamId: string;
  goalId: string;
  
  // Output discovery (reads .ping/outputs/*.json manifests from git)
  getOutputManifest(taskId: string): Promise<OutputManifest | null>;
  queryOutputs(filter?: OutputFilter): Promise<OutputEntry[]>;
  getAllManifests(): Promise<OutputManifest[]>;
  
  // === Hocuspocus unified document API ===
  // All CRDT state accessed through the SAME open/list pattern.
  // Document naming: {teamId}/{goalId}/{docName}
  //   'shared-context'  → Y.Map (agent statuses, blockers, shared facts)
  //   'binaries'        → Y.Map (Uint8Array content + metadata)
  //   'chat-outcomes'   → Y.Array (GroupChatOutcome entries)
  //   'doc-{docId}'     → Y.XmlFragment (BlockNote block document)
  openDoc(docName: string): Promise<CollabDocument>;
  listDocs(): Promise<DocumentInfo[]>;
  
  // Context — ALL agents (Planner + workers) use existing L1 workspace tools.
  // Most operations are plain file reads/writes in .ping/:
  //   .ping/agent-statuses/{agentId}.json  → per-agent status (written via L1 write_file)
  //   .ping/collaboration/chat-outcomes/   → group chat decisions (system-projected from CRDT)
  //   .ping/collaboration/{docName}.json   → shared CRDT docs (auto-projected)
  //   .ping/outputs/{taskId}.json          → completed task manifests (written by publish())
  //   .ping/plans/{planId}.json            → plan projections (written by PlanStore)
  //
  // Agents get a unified `collab` tool with progressive discovery:
  //   discover → see L2 categories (crdt, plans, outputs)
  //   list     → see keys in a doc/category
  //   read     → get specific values
  //   write    → set CRDT key/value (plans & outputs are read-only)
  // System code (GroupChatManager, OrchestratorService, Frontend) also writes
  // CRDT docs directly via openDoc().
  getContext(): GoalContext;
  
  // Lifecycle
  archive(): Promise<void>;
  promoteToKnowledge(artifactIds: string[]): Promise<void>;  // → L3
}

/**
 * Unified Hocuspocus document wrapper — same API for binaries, chat outcomes,
 * shared context, and block documents. Hocuspocus treats all docs identically;
 * the only difference is which Yjs shared type the caller accesses.
 */
interface CollabDocument {
  readonly name: string;
  readonly ydoc: Y.Doc;
  
  getMap<T = any>(name: string): Y.Map<T>;
  getArray<T = any>(name: string): Y.Array<T>;
  getXmlFragment(name: string): Y.XmlFragment;
  getText(name: string): Y.Text;
  
  toJSON(): Record<string, any>;
  toMarkdown(): string;           // Y.XmlFragment → markdown (for block docs)
  
  getPresence(): AgentPresence[];
  connect(agentId: string): Promise<void>;
  disconnect(): void;
  on(event: 'update', handler: (update: Uint8Array) => void): void;
}

/**
 * Agent Tooling Model — L1 tools + unified `collab` tool for all L2 access
 *
 * All agents have L1 workspace tools (read_file, write_file, list_dir, grep).
 * Planner (co-located) can also read .ping/ projections via L1 tools.
 *
 * Workers access ALL L2 state via the unified `collab` tool:
 *   discover() → see top-level L2 categories (crdt, plans, outputs)
 *   discover('crdt') → see available CRDT docs with descriptions
 *   discover('plans') → see plans with status/goal
 *   discover('outputs') → see task output manifests
 *   list('agent-statuses') → keys + previews in CRDT doc
 *   read('agent-statuses', 'frontend-dev') → specific value
 *   write('agent-statuses', myRole, { status, blockers, discoveries }) → CRDT write
 *
 * ALL real-time writes go through CRDT (Yjs + Hocuspocus):
 *   Plans & outputs are read-only via `collab` — only CRDT docs are writable.
 *   Agents can create new CRDT docs on demand — auto-created on first write.
 *
 * System-internal CRDT writes (not agent tools, same Hocuspocus backbone):
 *   chat-outcomes  — written by GroupChatManager (Planner observes for re-planning)
 *   documents      — written by Frontend (BlockNote) + agents (co-authoring)
 *   binaries       — written by agents + OrchestratorService
 *   agent-statuses — auto-updated by WorkerPool on task start/complete/fail
 *
 * Projection (onChange hook) is near-instant and disposable. Source of truth
 * is the Yjs binary in Database extension storage.
 */

interface GroupChatOutcome {
  sessionId: string;
  topic: string;
  participants: string[];            // Agent roles
  summary: string;                   // LLM-extracted summary
  sharedContext: Record<string, any>;  // Agreed facts/decisions
  actionItems: ActionItem[];         // New tasks to queue
  transcript: GroupMessage[];        // Full discussion
}
```

### Block Documents (via CollabDocument)

Block documents use the **same `CollabDocument`** wrapper (defined above). The `Y.XmlFragment` 
shared type provides block-level CRDT — agents edit different sections simultaneously. 
BlockNote handles rich formatting (tables, images, code) and export:

```typescript
// Open a block document — same openDoc() pattern as all other content
const doc = await space.openDoc('doc-requirements');
const blocks = doc.getXmlFragment('blocks');  // Y.XmlFragment for BlockNote

// Export
const markdown = doc.toMarkdown();            // Y.XmlFragment → markdown
```

No separate `StructuredDocument` interface needed — `CollabDocument.getXmlFragment()` 
provides the same capabilities through the unified API.

---

## Layer 3: Knowledge Base

**Purpose:** Permanent organizational memory that **teaches** agents how to work.

> **Source:** [Organizational Knowledge Layer](../../product/ideas/organizational-knowledge-layer.md)

### The Core Insight: Documents Teach, Agents Learn

From the [OKL design](../../product/ideas/organizational-knowledge-layer.md#document-types-as-skills):

> Traditional skills are **code** — rigid, executable, programmed behavior.  
> OKL skills are **documents** — adaptive, interpretable, teachable knowledge.

**Without L3:** Agent uses generic LLM knowledge → misses YOUR team's procedures  
**With L3:** Agent loads `auth-service-deployment.md` → knows YOUR rollback procedures

The document *teaches*. The agent *learns*. The skill is the knowledge transfer.

```
knowledge/
  skills/                       # 🤖 Agent audience — HOW to do things
    deploy-production.md
    api-design.md
    write-marketing-copy.md
    
  runbooks/                     # 🤖+👤 Both — Operational procedures
    incident-response.md
    campaign-launch-checklist.md
    contract-review-process.md
    
  projects/                     # 🤖+👤 Both — Project context (any type)
    auth-service/               # Software project
      overview.md
      how-it-works.md
      working-on.md
      ownership.md
    q1-marketing-campaign/      # Marketing project
      overview.md
      how-it-works.md           # Channels, audiences, timeline
      working-on.md             # Brand guidelines, approval flow
    enterprise-contract/        # Legal project
      overview.md
      how-it-works.md           # Clauses, negotiation stages
      
  decisions/                    # 👤 Human — Why we chose X over Y
    why-postgresql.md
    why-hubspot-over-marketo.md
    
  onboarding/                   # 👤 Human — New team member guides
    engineering-setup.md
    marketing-tools.md
    team-structure.md
```

### Document Types & Audiences

| Type | Answers | Primary Audience | Agent Can Write? |
|------|---------|------------------|------------------|
| **Skills** | "How do I do X?" | 🤖 Agent | ✅ Yes |
| **Runbooks** | "What steps for Y?" | 🤖+👤 Both | ✅ With review |
| **Projects** | "What is this system? How does it work?" | 🤖+👤 Both | ✅ Agent drafts, human refines |
| **Decisions** | "Why did we choose Z?" | 👤 Human | ❌ Suggest only |
| **Onboarding** | "How do I get started here?" | 👤 Human | ✅ Agent drafts, human refines |

### Project Documentation — Critical for Agent Work

Agents doing **any project work** need context just like humans:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Example 1: Software Task                                                │
│  Task: "Fix authentication timeout bug in auth-service"                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Agent pulls: projects/auth-service/how-it-works.md                     │
│               projects/auth-service/working-on.md                       │
│  Agent knows: JWT tokens in /src/auth/, use AuthError class, etc.       │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  Example 2: Marketing Task                                               │
│  Task: "Create social media posts for Q1 campaign"                       │
├─────────────────────────────────────────────────────────────────────────┤
│  Agent pulls: projects/q1-marketing-campaign/how-it-works.md            │
│               projects/q1-marketing-campaign/working-on.md              │
│  Agent knows: Target audience, brand voice, approval flow, hashtags     │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  Example 3: Legal Task                                                   │
│  Task: "Review liability clause in enterprise contract"                  │
├─────────────────────────────────────────────────────────────────────────┤
│  Agent pulls: projects/enterprise-contract/how-it-works.md              │
│               skills/contract-review-process.md                          │
│  Agent knows: Standard clauses, negotiation history, red flags          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Project Documentation (NEW)

Agents working on a project **output organizational knowledge** — not just code:

```typescript
interface ProjectDocumentation {
  projectId: string;
  
  // 👤+🤖 BOTH need this — context for any work
  overview: {
    purpose: string;             // "Auth service handles user identity"
    businessContext: string;     // Why this matters to the org
    status: 'active' | 'maintenance' | 'deprecated' | 'completed';
  };
  
  // 🤖 AGENT needs this — for any project work
  howItWorks: {                  // Generic: could be code, process, campaign, etc.
    components: ComponentDoc[];  // Key pieces (modules, stages, deliverables)
    workflow: string;            // How work flows through
    dependencies: string[];      // What it depends on
    keyResources: Record<string, string>;  // "auth" → "src/auth/" OR "brand guide" → "assets/brand.pdf"
    diagrams?: string[];
  };
  
  // 🤖 AGENT needs this — to follow standards
  workingOn: {
    structure: string;           // Where things live (files, folders, tools)
    conventions: string[];       // Team standards (naming, formats, processes)
    qualityChecks: string;       // How to verify work (tests, reviews, checklists)
    commonMistakes: string[];    // Pitfalls to avoid
  };
  
  // 👤 HUMAN needs this — organizational
  ownership: {
    team: string;
    maintainers: string[];
    contactChannels: string[];
    escalationPath: string;
  };
  
  // 👤 HUMAN needs this — for new contributors
  gettingStarted: {
    setupSteps: string[];
    tools: string[];             // What tools/access needed
    openWork: string[];          // Good first contributions
  };
}
```

**Works for any project type:**

| Project Type | `howItWorks.components` | `workingOn.conventions` |
|--------------|-------------------------|-------------------------|
| **Software** | Modules, services, APIs | Code style, test patterns |
| **Marketing Campaign** | Channels, audiences, assets | Brand voice, approval flow |
| **Legal Contract** | Sections, clauses, parties | Legal terminology, review process |
| **Research** | Phases, experiments, data sources | Citation format, peer review |
| **Business Process** | Stages, stakeholders, systems | SLAs, escalation rules |

**Auto-retrieval for maintenance tasks:**
```typescript
// When agent gets maintenance task, auto-pull project docs
if (task.type === 'bug_fix' || task.type === 'feature') {
  const projectDocs = await knowledgeBase.getForProject(task.projectId);
  await workspace.pullContext([
    projectDocs.architecture,    // How it works
    projectDocs.contributing,    // Conventions to follow
  ]);
}
```

### Key Properties
- **Curated:** Human approval for writes
- **Versioned:** Git-backed with history
- **Role-scoped:** Agents see knowledge relevant to their role
- **Teachable:** Documents "teach" agents procedures

### Knowledge Retrieval: Hierarchical Index (CPU Page Table Model)

Retrieval uses a **multi-level index** inspired by CPU memory page tables. We embed **summaries** at each level — not full document content. The index narrows scope level-by-level, then fetches actual content from Git only at the end.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    HIERARCHICAL KNOWLEDGE INDEX                          │
│                    (CPU Page Table Analogy)                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  L0: TEAM DIRECTORY                   ← Page Directory                   │
│  ┌────────────────────────────┐       Embedded summaries per team         │
│  │ "Team Alpha: auth service, │       Vector search here FIRST            │
│  │  payment APIs, backend"    │                                          │
│  └────────────┬───────────────┘                                          │
│               │ match → Team Alpha                                       │
│               ▼                                                          │
│  L1: PROJECT INDEX                    ← Page Table Level 1               │
│  ┌────────────────────────────┐       Embedded summaries per project      │
│  │ "auth-service: JWT, OAuth, │       Vector search within team            │
│  │  session management"       │                                          │
│  └────────────┬───────────────┘                                          │
│               │ match → auth-service                                     │
│               ▼                                                          │
│  L2: DOCUMENT INDEX                   ← Page Table Level 2               │
│  ┌────────────────────────────┐       Embedded summaries per doc          │
│  │ "how-it-works.md: JWT      │       Vector search within project        │
│  │  flow, token refresh,      │                                          │
│  │  session lifecycle"        │                                          │
│  └────────────┬───────────────┘                                          │
│               │ match → how-it-works.md                                  │
│               ▼                                                          │
│  L3: SECTION INDEX                    ← Page Table Entry                 │
│  ┌────────────────────────────┐       Embedded summaries per heading      │
│  │ "## Token Expiry Handling: │       Vector search within document       │
│  │  refresh logic, edge cases"│                                          │
│  └────────────┬───────────────┘                                          │
│               │ match → section "Token Expiry Handling"                  │
│               ▼                                                          │
│  CONTENT FETCH                        ← Physical Page Frame              │
│  ┌────────────────────────────┐                                          │
│  │ Git: auth-service/         │       Full content from Git               │
│  │   how-it-works.md          │       Only THIS section loaded            │
│  │   lines 145-210            │       NOT the entire document             │
│  └────────────────────────────┘                                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### CPU Analogy Mapping

| CPU Concept | Knowledge Equivalent |
|-------------|---------------------|
| **Virtual Address** | Agent's query: *"How do I handle JWT token expiry?"* |
| **Page Directory** | L0: Team index (which team's knowledge?) |
| **Page Table L1** | L1: Project index (which project?) |
| **Page Table L2** | L2: Document index (which doc?) |
| **Page Table Entry** | L3: Section index (which section?) |
| **Physical Page** | Actual content fetched from Git |
| **TLB (cache)** | Hot path cache — frequently accessed docs stay in memory |
| **Page Fault** | Cache miss → fetch from Git (cold storage) |

#### Why This Beats Flat RAG

| Flat RAG | Hierarchical Index |
|----------|--------------------|
| Chunk ALL docs → embed ALL chunks | Embed only **summaries** at each level |
| Search 10,000 embeddings | Search ~10 → ~20 → ~15 → ~10 = **55 comparisons** |
| Returns random paragraph fragments | Returns **exact section** with full context |
| Re-embed everything when one doc changes | Re-index **one entry** at the affected level |
| Same cost for all queries | **Short-circuit**: known project? Skip L0-L1 |

#### Short-Circuit (TLB Hit)

```typescript
// Agent already knows projectId — skip L0 and L1
if (task.projectId) {
  // TLB hit: jump directly to L2 (document index)
  const docs = await index.searchLevel(2, query, { projectId: task.projectId });
} else {
  // TLB miss: full page walk from L0
  const team = await index.searchLevel(0, query, { teamId });
  const project = await index.searchLevel(1, query, { teamId: team.id });
  const docs = await index.searchLevel(2, query, { projectId: project.id });
}
```

#### Index Entry Schema

```typescript
interface IndexEntry {
  id: string;
  level: 0 | 1 | 2 | 3;           // Which level of the page table
  summary: string;                  // Dense text, embedded for vector search
  embedding: number[];              // Pre-computed vector
  
  // Pointer to next level (like PTE → next table)
  children?: string[];              // Next level index entry IDs
  
  // At level 3, pointer to actual content (like PTE → physical frame)
  contentRef?: {
    repo: string;                   // Git repo
    path: string;                   // File path  
    lineRange: [number, number];    // Section boundaries
    commitHash: string;             // Version pinning
  };
  
  // Scoping metadata
  teamId: string;
  projectId?: string;
  docType?: 'skill' | 'runbook' | 'project' | 'decision';
  roles?: string[];                 // Role-based access
}
```

#### Index Generation

Index entries are generated when docs are committed to Git:

```typescript
// On git commit/push to knowledge repo
async function reindex(changedFiles: string[]) {
  for (const file of changedFiles) {
    const content = await git.readFile(file);
    const sections = parseSections(content);       // Split by ## headings
    
    // Generate summary per section (LLM or extractive)
    for (const section of sections) {
      const summary = await llm.summarize(section.content, { maxTokens: 100 });
      const embedding = await embed(summary);
      
      await indexStore.upsert({
        level: 3,
        summary,
        embedding,
        contentRef: { repo, path: file, lineRange: section.lines, commitHash },
      });
    }
    
    // Roll up: regenerate L2 doc summary from L3 section summaries
    await rollUpIndex(file, 2);
  }
}
```

### Knowledge Document Schema
```typescript
interface KnowledgeDocument {
  id: string;
  type: 'skill' | 'runbook' | 'project' | 'decision' | 'onboarding';
  audience: 'agent' | 'human' | 'both';
  roles: string[];              // Which roles can access
  projectId?: string;           // For project-scoped docs
  
  content: string;              // Markdown
  version: string;
  lastUpdated: Date;
  
  usefulWhen: string[];         // Triggers for retrieval
  relatedTo: string[];          // Links to other docs
  learnedFrom?: string[];       // Task IDs that contributed
  
  // For human docs — who should review
  reviewers?: string[];
  approvalStatus?: 'draft' | 'pending_review' | 'approved';
}

// Knowledge types and their purposes
type KnowledgeType = 
  | 'skill'       // 🤖 Agent: "How do I deploy?"
  | 'runbook'     // 🤖+👤 Both: "Steps for incident response"
  | 'project'     // 👤 Human: "What is auth-service? How to contribute?"
  | 'decision'    // 👤 Human: "Why PostgreSQL over MongoDB?"
  | 'onboarding'; // 👤 Human: "New engineer setup guide"
```

### Interface
```typescript
interface KnowledgeBase {
  // Retrieval
  getForRole(role: string): KnowledgeDocument[];
  search(query: string, role?: string): KnowledgeDocument[];
  getRelevant(taskDescription: string, role: string): KnowledgeDocument[];
  
  // Promotion (from L2)
  propose(artifact: Artifact, asDocument: Partial<KnowledgeDocument>): Promise<string>;
  approve(proposalId: string): Promise<void>;
  reject(proposalId: string, reason: string): Promise<void>;
  
  // Updates (agent suggestions, human approval)
  suggestUpdate(docId: string, patch: string, reason: string): Promise<string>;
  approveUpdate(suggestionId: string): Promise<void>;
}
```

---

## Data Flow: Complete Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         KNOWLEDGE LIFECYCLE                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  0. PLANNING (L2 → Planner via filesystem projection)                      │
│     Orchestrator gathers user intent                                      │
│     L2: materializeCollaborationState() — Hocuspocus onChange hook → .ping/collab/ │
│         → shared-context.json, agent-statuses.json, chat-outcomes/,       │
│           documents/*.md (BlockNote → markdown)                           │
│     Planner uses L1 tools (read_file, grep, list_dir) on .ping/ files     │
│     Plan created with full L2 awareness — zero new tools                  │
│                         │                                                 │
│  1. TASK ASSIGNED       ▼                                                 │
│     Orchestrator assigns task to Agent A                                  │
│                         │                                                 │
│  2. WORKSPACE CREATED   ▼                                                 │
│     L1: Create branch "task-123-implement-auth"                          │
│     L1: Pull relevant knowledge from L3                                  │
│         → skills/api-design.md                                           │
│         → runbooks/auth-best-practices.md                                │
│                         │                                                 │
│  3. AGENT WORKS         ▼                                                 │
│     L1: Agent creates files, commits incrementally                       │
│     L2: Agent reads shared context (artifacts, group chat outcomes)      │
│     L2: Agent updates structured doc if learns something useful          │
│                         │                                                 │
│  3b. COLLABORATION      ▼ (if needed)                                    │
│     Agent requests collaboration → GroupChatManager                       │
│     Workers discuss in time-boxed session                                 │
│     L2: Store GroupChatOutcome (summary, context, action items)          │
│                         │                                                 │
│  4. TASK COMPLETES      ▼                                                 │
│     L1: Write output manifest (.ping/outputs/{taskId}.json)              │
│     L1: Merge branch to main (manifest + artifacts land in main)        │
│     L2: CollaborationSpace reads manifests for cross-task discovery     │
│                         │                                                 │
│  5. GOAL COMPLETES      ▼                                                 │
│     L2 → L3: Promote valuable artifacts to knowledge base                │
│     L2: Archive collaboration space (artifacts + group chats)            │
│                         │                                                 │
│  6. KNOWLEDGE GROWS     ▼                                                 │
│     L3: Human reviews, approves/refines                                  │
│     L3: Future agents LEARN from this knowledge (documents teach)        │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Conflict Resolution Strategy

### L1 (Agent Workspace): No Conflicts
- Each agent has isolated branch
- No concurrent edits to same files

### L2 (Collaboration Space): CRDT Resolution
```
Agent A: Inserts "Step 1: Auth" at line 10
Agent B: Inserts "Step 1: Setup" at line 10
                    │
                    ▼
CRDT automatically merges:
  Line 10: "Step 1: Auth"
  Line 11: "Step 1: Setup"
  (deterministic ordering by agent ID)
```

### L3 (Knowledge Base): Human Resolution
```
Agent suggests update to "deploy-production.md"
                    │
                    ▼
Human reviews:
  - Approve: Update applied
  - Reject: Suggestion discarded
  - Modify: Human edits before approve
```

---

## Context Injection: What Knowledge Does Agent Get?

### Pull Strategy (Recommended)
Agent receives **references**, pulls content on-demand:

```typescript
// Task assignment includes knowledge hints
const task = {
  id: "implement-auth",
  role: "backend",
  knowledgeHints: [
    "api-design",
    "auth-best-practices"
  ]
};

// Agent workspace pulls at initialization
await workspace.pullContext(task.knowledgeHints);

// Agent can also search during execution
const relevant = await knowledgeBase.search("JWT token expiry");
```

### Automatic Retrieval
System suggests documents based on task description:

```typescript
const suggestions = await knowledgeBase.getRelevant(
  task.description,  // "Implement user authentication with JWT"
  task.role          // "backend"
);
// → Returns: auth-best-practices.md, jwt-implementation.md
```

---

## Current MemoryManager: Gap Analysis

**File:** `src/worker/memoryManager/MemoryManager.ts`

### What Exists (Task Memory Only)
```typescript
class MemoryManager {
  addTask(task: Task): void;              // ✅ Single task add
  getTasks(role: string): Task[];         // ✅ Ready tasks by role
  updateTaskStatus(id, status): void;     // ✅ Status update
  completeTask(id, output): void;         // ✅ Complete + store output
  isComplete(): boolean;                  // ✅ All tasks done?
  
  private checkTaskReady(id): boolean;    // ✅ Dependency check
  private updateDependantTasks(task);     // ✅ Propagate completion
  private updateContext(task, completed); // ✅ Merge dep outputs into context
}
```

### What's Missing

| Method | Need | Purpose |
|--------|------|---------|
| `getTask(id)` | 🔴 High | Single task retrieval for tools |
| `storeTasks(tasks[])` | 🔴 High | Batch add for approved plan |
| `getReadyTasks()` | 🔴 High | All ready tasks (any role) for auto-queue |
| `getTaskContext(id)` | 🟡 Medium | Explicit context getter |
| `getAllTasks()` | 🟡 Medium | Status overview for `get_status` tool |
| `getTasksByStatus(status)` | 🟢 Low | Filter by status |

### New Components Needed

| Component | Layer | Purpose |
|-----------|-------|---------|
| `AgentWorkspace` | L1 | Isolated git branch per task |
| `GitBranchManager` | L1 | Branch create/delete/merge operations |
| `WorkspaceManager` | L1 | Manage multiple agent workspaces |
| `SafeAgentWorkspace` | L1 | requireReadBeforeWrite safety, path containment |
| `Scratchpad` | L1 | Private `.scratch/` for research, notes, experiments |
| `WorkspaceSearchIndex` | L1 | BM25 relevance-ranked keyword search (`MiniSearch`) |
| `IdentityCard` | L1 | Agent self-awareness (role, progress, tools) |
| `RepoMapBuilder` | L1 | Tree-sitter compressed codebase overview (`web-tree-sitter` WASM, code agents) |
| `SymbolIndex` | L1 | Cross-file symbol search via `web-tree-sitter` (code agents) |
| `PlanStore` | L2 | Plan persistence, revisions, team-scoped |
| `CollaborationSpace` | L2 | Team shared memory — wraps Hocuspocus docs (CRDT, binaries, chat outcomes) + git manifests |
| `CollabDocument` | L2 | Unified Hocuspocus Y.Doc wrapper (all content types) |
| `HocuspocusServer` | L2 | Hocuspocus server setup, Database extension, hook wiring |
| `KnowledgeBase` | L3 | Organizational knowledge store |

---

## Implementation Approach

### Recommended: Layered Architecture

Build each layer independently, integrate via clear interfaces:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        MEMORY SYSTEM COMPONENTS                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     MemoryCoordinator                              │  │
│  │                     (Orchestrates all layers)                      │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│         │                    │                    │                      │
│         ▼                    ▼                    ▼                      │
│  ┌─────────────┐      ┌─────────────────────┐  ┌─────────────┐         │
│  │   L1:       │      │   L2:               │  │   L3:       │         │
│  │ Workspace   │      │ Team Collaboration  │  │ Knowledge   │         │
│  │ Manager     │      │                     │  │ Base        │         │
│  │             │      │ • CollabSpace       │  │             │         │
│  │ • GitBranch │      │   (Hocuspocus)      │  │ • Retrieval │         │
│  │   Manager   │      │ • PlanStore         │  │ • Promotion │         │
│  │ • Agent     │      │ • CollabDocument    │  │ • Indexing  │         │
│  │   Workspace │      │ • HocuspocusServer  │  │             │         │
│  └─────────────┘      └─────────────────────┘  └─────────────┘         │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     Shared Infrastructure                          │  │
│  │  • MemoryManager (task state — L1)    • EventBus                  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### File Structure
```
src/worker/
  memory/                           # Memory system root
    MemoryCoordinator.ts            # Top-level orchestrator
    
    workspace/                      # L1: Agent Workspace
      WorkspaceManager.ts           # Manages agent workspaces
      AgentWorkspace.ts             # Single workspace instance
      GitBranchManager.ts           # Branch operations
    
    collaboration/                  # L2: Team Collaboration
      CollaborationSpace.ts         # Team shared memory (Hocuspocus backbone + git manifests)
      PlanStore.ts                  # Plan persistence & revisions (team-scoped, file-based)
      CollabDocument.ts             # Unified Hocuspocus Y.Doc wrapper
      HocuspocusServer.ts             # Hocuspocus server setup, Database extension, hook wiring
    
    knowledge/                      # L3: Knowledge Base
      KnowledgeBase.ts              # Org knowledge store
      KnowledgeRetrieval.ts         # Hierarchical RAG (LlamaIndex.TS)
      KnowledgePromotion.ts         # Artifact → Knowledge flow
      KnowledgeIndexer.ts           # Index generation on git commit
    
    types/                          # Type definitions
      index.ts
      workspace.types.ts
      collaboration.types.ts
      knowledge.types.ts
      
  memoryManager/                    # EXISTING: Task state (L1 infrastructure)
    MemoryManager.ts                # Task lifecycle, dependency resolution
    types/Task.types.ts             # L1 fields (workspace) + L2 refs (artifacts)
```

---

## Phase Implementation Plan

### Implementation Priority

| Priority | Layers | Rationale |
|----------|--------|-----------|
| 🔴 **Critical** | L1 + L2 | Agents need workspace + collaboration to function. Core workflow enablers. |
| 🟡 **Enhancement** | L3 | Improves response quality, but agents can operate without it. Defer until L1+L2 stable. |

---

### Phase 1: Agent Workspace — L1 (v1.0) — 1 week
**Goal:** Isolated git branches per task with rollback capability
**Priority:** 🔴 Critical — Agents need workspace isolation to function
**Plan:** [v1.0/feature_implementation_planning.md](./v1.0/feature_implementation_planning.md)

| Component | Status | Description |
|-----------|--------|-------------|
| GitBranchManager | 🔴 Build | Create/delete/merge branches per task |
| AgentWorkspace | 🔴 Build | Workspace lifecycle (init → work → publish/discard) |
| WorkspaceManager | 🔴 Build | Manage multiple concurrent agent workspaces |
| LangGraph persistence | 🔴 Build | Agent state checkpointing via MemorySaver |
| Orchestrator tools | 🔴 Build | `create_branch`, `merge_branch`, `discard_branch` |

### Phase 2: Team Collaboration — L2 (v1.1) — 2 weeks
**Goal:** Team-scoped shared memory: plans, artifacts, real-time docs
**Priority:** 🔴 Critical — Agents need L2 to coordinate and share context
**Plan:** [v1.1/feature_implementation_planning.md](./v1.1/feature_implementation_planning.md)

| Component | Status | Description |
|-----------|--------|-------------|
| PlanStore | 🟡 Exists | Plan persistence — move from `orchestrator/` to `memory/collaboration/` |
| ArtifactRegistry | ❌ Delete | In-memory only, dual registration bug — replaced by git-based output manifests |
| CollaborationSpace | 🔴 Build | Per-goal shared memory (Hocuspocus backbone + git manifest reading) |
| CollabDocument | 🔴 Build | Unified Hocuspocus Y.Doc wrapper (all content types) |
| HocuspocusServer | 🔴 Build | Hocuspocus server setup, Database extension, hook wiring |
| Output manifests | 🔴 Build | `.ping/outputs/{taskId}.json` written by `workspace.publish()` |

### Phase 3: Knowledge Base — L3 (v2.0) — 2 weeks
**Goal:** Organizational learning with hierarchical retrieval
**Priority:** 🟡 Enhancement — Defer until L1+L2 stable
**Plan:** [v2.0/feature_implementation_planning.md](./v2.0/feature_implementation_planning.md)

| Component | Status | Description |
|-----------|--------|-------------|
| KnowledgeBase | 🔴 Build | Document storage + retrieval |
| KnowledgeRetrieval | 🔴 Build | Hierarchical RAG via LlamaIndex.TS |
| KnowledgeIndexer | 🔴 Build | Index generation on git commit |
| KnowledgePromotion | 🔴 Build | L2 → L3 with human approval |
| MemoryCoordinator | 🔴 Build | Unified interface across all layers |

---

## Key Interfaces Summary

### MemoryCoordinator (Top-level API)
```typescript
interface MemoryCoordinator {
  // Workspace (L1)
  createWorkspace(agentId: string, taskId: string): Promise<AgentWorkspace>;
  getWorkspace(taskId: string): AgentWorkspace | null;
  
  // Collaboration (L2) — MemoryCoordinator holds spaces directly (no CollabMemoryManager)
  getCollaborationSpace(teamId: string, goalId: string): CollaborationSpace;
  createCollaborationSpace(teamId: string, goalId: string, metadata: SpaceMetadata): Promise<CollaborationSpace>;
  
  // Knowledge (L3)
  getKnowledgeForTask(task: Task): Promise<KnowledgeDocument[]>;
  proposeKnowledge(artifact: Artifact): Promise<string>;
  
  // Cross-layer operations
  promoteToKnowledge(artifactId: string): Promise<void>;
}
```

### Enhanced Task Type
```typescript
interface Task {
  // Existing
  id: string;
  description: string;
  assigned_role: string;
  status: TaskStatus;
  prerequisites: Map<string, boolean>;
  context: string;
  output_data?: string;
  
  // L1 fields — Agent-private workspace state
  workspaceId?: string;
  branchName?: string;
  branchVersion?: number;
  branchStatus?: 'not_created' | 'active' | 'merge_requested' | 'merged' | 'deleted';
  
  // L2 fields — Team-visible, shared across agents
  outputManifest?: string;       // Path to .ping/outputs/{taskId}.json (populated on publish)
  knowledgeRefs?: string[];      // Docs pulled for this task
}
```

---

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **MemoryManager approach** | ✅ Extend (Option A) | Minimal change, fast to implement |
| **CRDT library** | Yjs | Best performance, rich types, Notion uses it ([source](../../ping/realtime-collaboration.md#option-2-yjs-modern-crdt)) |
| **Document model** | Structured blocks (JSON) | Block-level CRDT, Word/PDF export ([source](../../ping/realtime-collaboration.md#structured-document-model-primary-approach)) |
| **Binary storage** | Git (small) + Hocuspocus `Uint8Array` (shared) | Small agent binaries git-tracked; shared collaboration binaries via Hocuspocus Yjs types. Git LFS deferred to v2.0+ |
| **Knowledge storage** | Git-backed Markdown | Human-editable, versioned, searchable |
| **Workspace isolation** | Git branches | Native rollback, familiar workflow |
| **Worker collaboration** | GroupChatManager | Time-boxed discussions with outcomes ([source](../../ping/group-chat-architecture.md)) |
| **L2 sync server** | [Hocuspocus](https://tiptap.dev/docs/hocuspocus) | Open-source Yjs backend (TypeScript, MIT), 18 server hooks, same-process Node.js embedding, S3 persistence via Database extension. Replaces Y-Sweet — see [CRDT Filesystem Projection research](../../ping/crdt-filesystem-projection.md) Entry 4-5 |
| **L2 block editor** | [BlockNote](https://blocknotejs.org/) | React block editor, native Yjs collaboration, embeds in AgentChat, MIT license |
| **L2 human viewing** | BlockNote in AgentChat | Agents + humans co-edit in same real-time editor — no separate app needed |
| **L2 planner context** | Filesystem projection (CRDT → files) | Hocuspocus `onChange` hook enables write-through projection to `.ping/collaboration/`, Planner uses same L1 tools (read_file, grep, etc.) — zero new tools. See [CRDT Filesystem Projection](../../ping/crdt-filesystem-projection.md) |
| **L2 CRDT search** | Deferred (in-process access for MVP) | Only 2 CRDT docs to read; 95% of planner data is git files. Secondary index (MiniSearch → Postgres → ES) deferred until scale demands it |
| **L2 file access** | Git workspace (not Hocuspocus) | Files are plain text in git — already readable/searchable. Hocuspocus stores collaboration state only |
| **L2 CRDT projection** | Hocuspocus `onChange` → `.ping/collaboration/` | Write-through projection via `onChange` hook — fires on every mutation, materializes CRDT state as JSON/markdown files. Planner reuses L1 tools, no bespoke L2 tools. [Research](../../ping/crdt-filesystem-projection.md) |
| **L3 knowledge retrieval** | Hierarchical Index (CPU page table model) | Multi-level vector search on summaries (team → project → doc → section), fetch content from Git on demand. Cheaper, faster, more accurate than flat RAG |
| **L3 index storage** | MongoDB Atlas Vector Search | Reuse existing vector search infra from agent registry, 1536-dim embeddings, filter by teamId/projectId/level. Content stays in Git |
| **L3 retrieval engine** | [LlamaIndex.TS](https://github.com/run-llama/LlamaIndexTS) | TypeScript, MIT, `RouterQueryEngine` for multi-level traversal, `DocumentSummaryIndex` for summary embeddings |

---

## Open Questions

| Question | Options | Decision |
|----------|---------|----------|
| Real-time sync transport? | A) WebSocket B) Redis pub/sub | ✅ **WebSocket** — Hocuspocus handles this (built-in WebSocket server, same-process Node.js) |
| Knowledge retrieval? | A) Vector search B) Keyword + LLM C) Hierarchical index | ✅ **Hierarchical Index** (CPU page table model) — multi-level vector search on summaries, not full content. Levels: Team → Project → Document → Section → Git fetch |
| CRDT persistence? | A) Redis B) File system C) S3 | ✅ **S3/Local FS** — Hocuspocus Database extension persists Yjs docs via `fetch()`/`store()` callbacks to S3 or local FS |
| Knowledge approval UI? | A) Chat-based B) Dedicated panel | TBD |
| Object storage provider? | A) S3 B) Azure Blob C) Local FS (dev) | ✅ **Local FS (dev)** → **Azure Blob (prod)** — Hocuspocus Database extension persistence backend. No separate BinaryStorage; Hocuspocus stores all shared CRDT state including binaries |

---

## Deferred Ideas

### External Platform Collaboration (via MCP)

**Status:** Deferred — revisit when MCP ecosystem for these platforms matures

Agents could collaborate on external platform artifacts (Google Docs, Slides, Figma, Miro, etc.) using MCP servers. The platform handles real-time collaboration; our system only tracks metadata.

**Pattern:** Agent → MCP tool → external platform (collaboration engine) → other agents/humans

**What we'd add (small L2 extension):**
```typescript
interface ExternalResource {
  id: string;
  platform: 'google-docs' | 'google-slides' | 'figma' | 'miro' | string;
  externalId: string;      // Google Doc ID, Figma file key, etc.
  url: string;             // Direct link
  mcpServer: string;       // Which MCP server provides access
  teamId: string;
  goalId?: string;
  createdBy: string;       // Agent that created it
  collaborators: string[]; // Agents with access
}
```

**Why deferred:**
- MCP servers for these platforms are still maturing
- Hocuspocus + BlockNote covers core doc collaboration
- Additive enhancement — doesn't change architecture, just adds a resource type to CollaborationSpace

---

## Source Documents (Consolidated)

This architecture consolidates and connects these existing design documents:

| Document | What It Provides | Integrated Into |
|----------|------------------|-----------------|
| [Organizational Knowledge Layer](../../product/ideas/organizational-knowledge-layer.md) | Skills/Runbooks/Decisions, audience permissions, "documents teach" | L3 Knowledge Base |
| [Real-Time Collaboration](../../ping/realtime-collaboration.md) | Yjs, Structured Document Model, Word export | L2 Structured Documents |
| [Artifact Output Strategy](../../ping/artifact-output-strategy.md) | Hybrid storage, Git + Object Storage, branching | L1 Hybrid Storage |
| [Group Chat Architecture](../../ping/group-chat-architecture.md) | Worker-to-worker collaboration, time-boxed discussions | L2 Group Chat Integration |
| [Ping Architecture](../../ping/architecture.md) | TaskQueue, Orchestrator tools, Agent lifecycle | Memory integration points |

**Don't duplicate** — the source docs have full details. This architecture shows **how they connect**.
