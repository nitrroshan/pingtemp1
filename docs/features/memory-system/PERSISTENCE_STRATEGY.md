# Memory Persistence Strategy

> **Purpose:** Define how memory persists across sessions, server restarts, and failures.  
> **Status:** Planning  
> **Last Updated:** 2025-01-XX

---

## Executive Summary

The memory system requires persistence at different levels:
- **L1 Agent Memory:** Per-task agent context (messages, reasoning, tool calls) — recoverable
- **L2 Team Memory:** Project-scoped, persistent throughout project lifecycle
- **L3 Org Memory:** Permanent, versioned, backed by durable storage

### Design Principle: Clear Storage Boundaries

**Agent-internal storage:** Markdown files + SQLite (no external dependencies)
**Service-level storage:** MongoDB + Git (shared, persistent)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                        STORAGE BOUNDARY PRINCIPLE                              │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  AGENT-INTERNAL (Markdown + SQLite)      SERVICE-LEVEL (MongoDB + Git)        │
│  ═══════════════════════════════════     ══════════════════════════════════   │
│  • TaskCheckpointer (SQLite)             • L2 CollabStore (MongoDB)           │
│  • LangGraph SqliteSaver (checkpoints)   • L2 Artifacts (MongoDB GridFS)      │
│  • MarkdownMemoryEngine*                 • L3 Knowledge (Git + MongoDB)       │
│    (agent long-term memory)                                                    │
│                                                                                │
│  * = Clawdbot-inspired: Plain markdown files as source of truth,              │
│      indexed by sqlite-vec (vectors) + FTS5 (keywords) for hybrid search.     │
│      Exposed to LangGraph agents via memory_search / memory_get tools.        │
│                                                                                │
│  WHY THIS SPLIT:                                                               │
│  • Agent data stays local → no network latency during task execution          │
│  • Markdown is human-readable, git-friendly, survives any tooling change      │
│  • SQLite indexes are disposable — can always re-index from markdown          │
│  • Service data is shared → needs MongoDB for multi-agent coordination        │
│  • Git provides versioning and audit trail for org knowledge                   │
│                                                                                │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Reference: What Exists vs What We're Adding

| Component | Status | Purpose | Storage |
|-----------|--------|---------|---------|
| **RoleTaskQueue** | ✅ EXISTS | Task orchestration (queues, priorities, events) | In-memory (lost on crash) |
| **MemoryManager** | ✅ EXISTS | Task dependencies and outputs | In-memory (lost on crash) |
| **LangGraph agent** | ✅ EXISTS | Agent executes tasks | In-memory (lost on crash) |
| **TaskCheckpointer** | 🆕 NEW | Persist RoleTaskQueue + MemoryManager state | SQLite |
| **LangGraph SqliteSaver** | 🆕 USE | Persist agent conversation history | SQLite |
| **MarkdownMemoryEngine** | 🆕 NEW | Long-term agent memory (Clawdbot-inspired) | Markdown files + SQLite index |

### The Three Types of "Memory" We Need

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                        UNDERSTANDING AGENT MEMORY                              │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  1. TASK ORCHESTRATION (What tasks exist? What's their status?)               │
│     ├── RoleTaskQueue.ts       ← IN-MEMORY (exists)                           │
│     ├── MemoryManager.ts       ← IN-MEMORY (exists)                           │
│     └── TaskCheckpointer.ts    ← SQLITE (NEW - persists the above)            │
│                                                                                │
│  2. AGENT CONVERSATION (What did the agent say/do during a task?)             │
│     ├── LangGraph agent state  ← IN-MEMORY (exists)                           │
│     └── SqliteSaver            ← SQLITE (USE - LangGraph's checkpointer)      │
│                                                                                │
│  3. AGENT LEARNING (What should agents remember long-term?)                   │
│     └── MarkdownMemoryEngine   ← NEW (Clawdbot-inspired)                      │
│         ├── Source of truth:     Plain markdown files (human-readable)         │
│         ├── Daily logs:          workspace/memory/YYYY-MM-DD.md               │
│         ├── Long-term memory:    workspace/MEMORY.md (curated knowledge)      │
│         ├── Search index:        sqlite-vec (vectors) + FTS5 (keywords)       │
│         └── Agent tools:         memory_search, memory_get (LangGraph tools)  │
│                                                                                │
└───────────────────────────────────────────────────────────────────────────────┘

Server crashes? 
├── TaskCheckpointer      → Restores: which tasks, their status, dependencies
├── LangGraph Saver       → Restores: agent conversation mid-task
└── MarkdownMemoryEngine  → Re-indexes: markdown files are the source of truth
                             (SQLite index is disposable, rebuilt from markdown)
```

---

## Persistence Requirements by Layer

| Layer | Persistence | Recovery Need | Storage Type |
|-------|-------------|---------------|--------------|
| **L1: Agent Memory** | Per-task + cross-task | Resume from failure + long-term learning | **Markdown + SQLite** (agent-internal) |
| **L2: Team Memory** | Project | Full restore | **MongoDB** (GridFS for files) |
| **L3: Org Memory** | Permanent | Full restore + History | **Git** (source) + **MongoDB** (retrieval) |

### Storage Architecture by Boundary

| Boundary | Storage | Components | Rationale |
|----------|---------|------------|-----------|
| **Agent-Internal** | Markdown + SQLite | TaskCheckpointer, SqliteSaver, MarkdownMemoryEngine | No network latency, human-readable, standalone operation |
| **Service-Level** | MongoDB + Git | CollabStore, ArtifactStore, KnowledgeStore | Shared state, multi-agent coordination |

### Why This is Better

| Aspect | Before (4 backends) | After (2+1 backends) |
|--------|---------------------|----------------------|
| **Agent dependencies** | MongoDB required | SQLite only (embedded) |
| **Local dev setup** | Start MongoDB | Just `npm run dev` |
| **Agent isolation** | Requires network | Fully local |
| **Service persistence** | MongoDB | MongoDB + Git for audit |

---

## 1. L1 Agent Memory Persistence

### Research: How Leading Systems Handle Agent Memory

#### LangGraph Memory Model

LangGraph provides two distinct memory systems:

| Type | Scope | Storage | Use Case |
|------|-------|---------|----------|
| **Short-term (Checkpoints)** | Per-thread | SQLite/Postgres | Conversation history within a task |
| **Long-term (Store)** | Cross-thread | Key-value store | User preferences, learned facts |

**Checkpointer:** Saves graph state at every "super-step" (after each node runs). Enables:
- Resume from failure
- Time travel (replay/fork from any checkpoint)
- Human-in-the-loop (pause, inspect, modify, resume)

**Memory Store:** Namespaced key-value storage for facts that persist across conversations:
```python
namespace = (user_id, "memories")
store.put(namespace, memory_id, {"food_preference": "I like pizza"})
```

#### ChatGPT Memory Model

ChatGPT uses a **two-tier system**:

| Type | What It Stores | Persistence | User Control |
|------|----------------|-------------|--------------|
| **Saved Memories** | Explicit facts ("Remember I'm vegetarian") | Permanent until deleted | Full control |
| **Chat History Reference** | Inferred preferences from past chats | Evolves over time | Can disable |

**Key insight:** ChatGPT uses a `save_memories` tool that the model calls to upsert memories. The model decides what's worth remembering.

#### Claude Session Memory (Anthropic Cookbook)

The `session_memory_compaction.ipynb` shows how to handle long conversations:
- **Problem:** Long tasks exceed context window
- **Solution:** Periodically summarize/compact conversation history
- **Key:** Agent keeps working on same task but with compressed context

### Understanding Our Current System

**We already have task tracking!** Let me clarify the existing architecture:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CURRENT ARCHITECTURE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   MemoryManager                        RoleTaskQueue                         │
│   ├── tasks: Map<id, Task>            ├── queues: Map<role, PriorityQueue>  │
│   ├── addTask()                       ├── tasks: Map<id, TaskWithContext>   │
│   ├── completeTask()                  ├── queueTask()                       │
│   ├── checkTaskReady()                ├── poll()                            │
│   └── updateDependantTasks()          └── completeTask()                    │
│                                                                              │
│   Task {                               TaskWithContext {                     │
│     id, description                      id, description                     │
│     assigned_role                        assigned_role, priority             │
│     status                               status (queued|in_progress|...)     │
│     context: Record<string, any>         context: { previousOutputs, ... }   │
│     prerequisites: Map<id, bool>         createdAt                           │
│     dependants: string[]               }                                     │
│     output                                                                   │
│   }                                                                          │
│                                                                              │
│   THE PROBLEM: Both are in-memory Maps. Lost on restart!                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### What "Agent Memory" Actually Means for Us

**There are TWO different things we need to persist:**

| What | Where It Lives Now | What Gets Lost | Solution |
|------|-------------------|----------------|----------|
| **Task Orchestration** | MemoryManager + RoleTaskQueue | All task metadata, dependencies, status | **TaskCheckpointer** (SQLite) |
| **Agent Conversation** | LangGraph agent state (in-memory) | Messages, tool calls, reasoning | **LangGraph SqliteSaver** |

**Agent "long-term memory" during a task** means:
- The agent can have a multi-turn conversation for a single task
- If server crashes mid-task, agent resumes with full conversation history
- This is handled by LangGraph's checkpointer, NOT by us

### Why We Need Both: Task vs Agent State

```
User Goal: "Build a REST API for user management"
      │
      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  TASK ORCHESTRATION (TaskCheckpointer - OUR CODE)                           │
│  ├── Task 1: "Design API schema"        → architect  (completed)           │
│  ├── Task 2: "Implement User model"     → backend    (in_progress) ←────┐  │
│  ├── Task 3: "Write unit tests"         → qa         (pending)          │  │
│  └── Dependencies: Task 3 waits for Task 2                              │  │
│                                                                          │  │
│  This is MemoryManager + RoleTaskQueue state                             │  │
│  Needs: SQLite persistence (TaskCheckpointer)                            │  │
└──────────────────────────────────────────────────────────────────────────┼──┘
                                                                           │
┌──────────────────────────────────────────────────────────────────────────┼──┐
│  AGENT CONVERSATION (LangGraph SqliteSaver - THEIR CODE)                 │  │
│                                                                          │  │
│  Task 2 Thread (thread_id = task-2):                                     │  │
│  ├── Message 1: "Implement User model based on this schema..."         │  │
│  ├── Message 2: Agent: "I'll create the model. Let me check existing..." │  │
│  ├── Tool Call: searchCode("User model patterns")                        │  │
│  ├── Tool Result: "Found: src/models/BaseModel.ts..."                   │  │
│  ├── Message 3: Agent: "I'll extend BaseModel. Creating file..."        │  │
│  └── [CRASH HERE] ← LangGraph checkpoint preserves all of this!         │  │
│                                                                          │  │
│  On restart: Agent continues from last checkpoint                        │  │
│  This is LangGraph's job, not ours                                       │  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Implementation Strategy: Two Checkpointers

#### 1. TaskCheckpointer (Our Code) - Task Orchestration

Persists **MemoryManager + RoleTaskQueue state**:

```typescript
// src/worker/memory/persistence/TaskCheckpointer.ts
import Database from 'better-sqlite3';

export class TaskCheckpointer {
  private db: Database.Database;
  
  initialize(dbPath: string = 'data/checkpoints/tasks.db'): void {
    this.db = new Database(dbPath);
    this.createTables();
  }
  
  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        description TEXT,
        assigned_role TEXT,
        status TEXT,
        priority INTEGER DEFAULT 0,
        context TEXT,           -- JSON
        output TEXT,            -- JSON
        workspace_id TEXT,
        branch_name TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id TEXT REFERENCES tasks(id),
        depends_on TEXT REFERENCES tasks(id),
        completed INTEGER DEFAULT 0,
        PRIMARY KEY (task_id, depends_on)
      );
      
      CREATE TABLE IF NOT EXISTS task_dependants (
        task_id TEXT REFERENCES tasks(id),
        dependant_id TEXT REFERENCES tasks(id),
        PRIMARY KEY (task_id, dependant_id)
      );
    `);
  }
  
  // Called by MemoryManager.addTask()
  saveTask(task: Task): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO tasks 
      (id, description, assigned_role, status, priority, context, output, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id, 
      task.description, 
      task.assigned_role, 
      task.status,
      task.priority || 0,
      JSON.stringify(task.context || {}),
      JSON.stringify(task.output || null),
      Date.now()
    );
    
    // Save dependencies
    for (const [depId, completed] of task.prerequisites) {
      this.db.prepare(`
        INSERT OR REPLACE INTO task_dependencies (task_id, depends_on, completed)
        VALUES (?, ?, ?)
      `).run(task.id, depId, completed ? 1 : 0);
    }
  }
  
  // Called on server restart
  getAllTasks(): Task[] {
    const rows = this.db.prepare(`SELECT * FROM tasks`).all();
    return rows.map(row => this.rowToTask(row));
  }
  
  getUnfinishedTasks(): Task[] {
    const rows = this.db.prepare(`
      SELECT * FROM tasks WHERE status IN ('ready', 'pending', 'in_progress')
    `).all();
    return rows.map(row => this.rowToTask(row));
  }
}
```

#### 2. LangGraph SqliteSaver (Their Code) - Agent Conversation

```typescript
// In AgentWorker or wherever agents are created
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

// Shared checkpointer for all agents
const agentCheckpointer = SqliteSaver.fromConnString('data/checkpoints/agent-state.db');

// When creating an agent for a task
const agent = createReactAgent({
  llm,
  tools,
  checkpointer: agentCheckpointer,  // LangGraph persists conversation
});

// Each task gets its own thread
const config = { configurable: { thread_id: task.id } };

// This conversation is automatically checkpointed:
const result = await agent.invoke(
  { messages: [{ role: 'user', content: task.description }] },
  config
);
```

### Integration with Existing Code

**Changes to MemoryManager** (~20 lines):

```typescript
// src/worker/memoryManager/MemoryManager.ts
export class MemoryManager {
  private tasks: Map<string, Task>;
  public readonly taskQueue: RoleTaskQueue;
  private checkpointer?: TaskCheckpointer;  // ADD
  
  setCheckpointer(checkpointer: TaskCheckpointer): void {
    this.checkpointer = checkpointer;
  }
  
  addTask(task: Task): void {
    // ... existing logic
    this.checkpointer?.saveTask(task);  // ADD: persist to SQLite
  }
  
  completeTask(taskId: string, outputData: any): Task[] {
    // ... existing logic
    this.checkpointer?.completeTask(taskId, outputData);  // ADD
    return newlyReadyTasks;
  }
}
```

**Changes to AgentManager startup** (~15 lines):

```typescript
// In AgentManager initialization
async initializeOrchestrator(goal: string): Promise<void> {
  // 1. Initialize checkpointer
  const checkpointer = new TaskCheckpointer();
  checkpointer.initialize();
  
  // 2. Check for unfinished tasks (recovery)
  const unfinishedTasks = checkpointer.getUnfinishedTasks();
  if (unfinishedTasks.length > 0) {
    logger.info(`Recovering ${unfinishedTasks.length} unfinished tasks`);
    for (const task of unfinishedTasks) {
      this.memoryManager.addTask(task);  // Restore to memory
    }
    // Re-queue tasks that were in_progress (they'll resume via LangGraph)
    // ... continue from where we left off
  }
  
  // 3. Wire checkpointer
  this.memoryManager.setCheckpointer(checkpointer);
  
  // ... rest of initialization
}
```

```typescript
// src/worker/memory/persistence/TaskCheckpointer.ts
import Database from 'better-sqlite3';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

interface ITaskCheckpointer {
  // LangGraph checkpointer for agent state
  readonly langGraphSaver: SqliteSaver;
  
  // Initialize databases
  initialize(dbPath?: string): void;
  
  // Task orchestration (our metadata)
  saveTask(task: Task): void;
  completeTask(taskId: string, output: any): void;
  deleteTask(taskId: string): void;
  
  // Recovery
  hasUnfinishedTasks(): boolean;
  getUnfinishedTasks(): Task[];  // status IN ('pending', 'ready', 'in_progress')
  
  // Resume agent from LangGraph checkpoint
  getAgentState(threadId: string): Promise<AgentState | null>;
  
  // Cleanup
  clearAllTasks(): void;
  clearCompletedTasks(): void;
}

class TaskCheckpointer implements ITaskCheckpointer {
  private db: Database.Database;
  public langGraphSaver: SqliteSaver;
  
  async initialize(basePath: string = 'data/checkpoints'): Promise<void> {
    // Our task metadata
    this.db = new Database(`${basePath}/tasks.db`);
    this.createTables();
    
    // LangGraph's checkpointer for agent state
    this.langGraphSaver = SqliteSaver.fromConnString(`${basePath}/agent-state.db`);
  }
  
  // Get LangGraph checkpointer for agent compilation
  getCheckpointerForAgent(): SqliteSaver {
    return this.langGraphSaver;
  }
}
```

#### Recovery: Combining Both Systems

```typescript
// On server restart
async function recoverFromCheckpoint(checkpointer: TaskCheckpointer): Promise<void> {
  // 1. Get unfinished tasks from our metadata
  const unfinishedTasks = checkpointer.getUnfinishedTasks();
  
  for (const task of unfinishedTasks) {
    // 2. Restore task to MemoryManager
    memoryManager.addTask(task);
    
    // 3. LangGraph will auto-restore agent state when we invoke
    // The thread_id links to saved checkpoints
    // No manual restoration needed - just invoke with same thread_id
  }
  
  // 4. Re-assign tasks to workers (they'll resume from checkpoint)
  await agentManager.assignTasksToWorkers();
}

// In AgentWorker - resuming a task
async function resumeTask(task: Task): Promise<void> {
  const config = { 
    configurable: { 
      thread_id: task.id  // Same thread_id = resume from checkpoint
    } 
  };
  
  // LangGraph automatically loads previous state
  // Agent continues from where it left off
  const result = await agent.invoke(
    { messages: [] },  // Empty = continue from checkpoint
    config
  );
}
```

#### Time Travel: Debugging Failed Tasks

LangGraph's checkpointer enables powerful debugging:

```typescript
// Get full history of agent execution
const history = await agent.getStateHistory({ 
  configurable: { thread_id: taskId } 
});

// See exactly what happened at each step
for (const snapshot of history) {
  console.log('Step:', snapshot.metadata.step);
  console.log('Node:', snapshot.metadata.writes);
  console.log('State:', snapshot.values);
}

// Fork from a previous checkpoint (try different approach)
const config = { 
  configurable: { 
    thread_id: taskId,
    checkpoint_id: snapshot.config.checkpoint_id  // Fork from here
  } 
};
await agent.invoke(newInput, config);
```

#### Recovery Flow

```
Server Restart
      │
      ├─── Load TaskCheckpointer
      │         │
      │         ├── No unfinished tasks → Fresh start
      │         │
      │         └── Unfinished tasks found
      │                   │
      │                   ├── Restore tasks to MemoryManager
      │                   │
      │                   ├── Re-assign to workers
      │                   │
      │                   └── Workers invoke with same thread_id
      │                              │
      │                              └── LangGraph auto-restores agent state
      │                                       │
      │                                       └── Agent resumes from checkpoint
      │
      └─── Ready
```

### Long-Term Agent Memory (Clawdbot-Inspired, LangGraph-Powered)

**This is DIFFERENT from task recovery!**

The previous sections cover **crash recovery** (resuming interrupted work). This section covers **learning** — agents remembering knowledge across tasks using **plain markdown files** as the source of truth.

#### Design Philosophy: Memory Is Plain Markdown

> *Inspired by [Clawdbot's memory system](https://manthanguptaa.in/posts/clawdbot_memory/)*

Instead of storing memories in opaque database rows, **every agent memory is a readable markdown file** in the agent's workspace. The SQLite index is disposable — you can always delete it and re-index from the markdown files.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                  MEMORY = PLAIN MARKDOWN + SEARCH INDEX                        │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  SOURCE OF TRUTH (Markdown files)          SEARCH INDEX (SQLite, disposable)  │
│  ════════════════════════════════          ═════════════════════════════════  │
│                                                                                │
│  workspace/                                data/memory-index/                  │
│  ├── MEMORY.md          ← curated          ├── chunks.db                      │
│  │   (long-term knowledge)                 │   ├── chunks (text + metadata)   │
│  └── memory/                               │   ├── chunks_vec (sqlite-vec)    │
│      ├── 2026-01-15.md  ← daily log        │   ├── chunks_fts (FTS5)         │
│      ├── 2026-01-16.md  ← daily log        │   └── embedding_cache           │
│      └── auth-design.md ← session save     │                                  │
│                                            └── (can be deleted & rebuilt!)     │
│                                                                                │
│  WHY MARKDOWN:                                                                 │
│  • Human-readable — anyone can open and read agent memories                   │
│  • Git-friendly — diffs, blame, version history come free                     │
│  • Survives tooling changes — no vendor lock-in                               │
│  • Agents can write with standard file tools                                   │
│  • Searchable even without the index (grep, IDE search)                       │
│                                                                                │
└───────────────────────────────────────────────────────────────────────────────┘
```

#### Two-Layer Memory Architecture

| Layer | File(s) | Write Pattern | Purpose |
|-------|---------|---------------|---------|
| **Daily Logs** | `memory/YYYY-MM-DD.md` | Append-only, one per day | Raw observations, task notes, decisions (chronological) |
| **Long-Term Memory** | `MEMORY.md` | Curated, periodically rewritten | Distilled knowledge: preferences, patterns, key decisions |

**Daily Logs** (`memory/YYYY-MM-DD.md`):
```markdown
# 2026-01-15

## Task: Implement JWT Authentication
- Discovered project uses Prisma with PostgreSQL (prisma/schema.prisma)
- User model has: id, email, passwordHash, createdAt, updatedAt
- Decision: RS256 JWT with 15min access / 7day refresh tokens
  - Reasoning: RS256 allows key rotation, short access limits damage
- Created AuthService in src/services/auth.ts

## Task: Fix CORS Issues
- Root cause: Missing origin whitelist in Express config
- Added configurable CORS origins via environment variable
- Pattern: All middleware config lives in src/middleware/
```

**Long-Term Memory** (`MEMORY.md`):
```markdown
# Agent Memory

## Project Facts
- **Framework:** Express.js with TypeScript
- **ORM:** Prisma with PostgreSQL
- **Auth:** RS256 JWT (15min access, 7day refresh, Redis for revocation)

## User Preferences
- Prefers Express over Fastify
- Always define TypeScript interfaces — never use `any[]`
- Named exports over default exports
- Tests alongside implementation files

## Architecture Decisions
- Middleware config in `src/middleware/`
- All API routes use asyncHandler() wrapper
- Environment-based configuration (no hardcoded values)

## Learned Patterns
- Always create migration files, never raw ALTER TABLE
- Check for existing Prisma migrations before adding new ones
- Use Zod for input validation on all endpoints

## Common Pitfalls
- CORS errors → check `src/middleware/cors.ts` whitelist
- Missing thread_id in LangGraph invoke → always pass configurable
```

#### Indexing Pipeline: File Watcher → Chunk → Embed → SQLite

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                          INDEXING PIPELINE                                      │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  Markdown File Changed                                                         │
│       │                                                                        │
│       ▼                                                                        │
│  File Watcher (Chokidar)                                                       │
│  • Monitors: MEMORY.md + memory/**/*.md                                        │
│  • Debounce: 1.5 seconds (batch rapid edits)                                  │
│       │                                                                        │
│       ▼                                                                        │
│  Chunker                                                                       │
│  • Split into ~400 token chunks                                                │
│  • 80 token overlap between chunks                                             │
│  • Track: file path, start_line, end_line, text hash                          │
│       │                                                                        │
│       ▼                                                                        │
│  Embedding (hash-cached)                                                       │
│  • Hash each chunk's text → check embedding_cache                             │
│  • Only embed NEW or CHANGED chunks                                            │
│  • Provider-agnostic: Azure OpenAI / local models                              │
│  • Dimensions: 1536 (text-embedding-3-small) or 768 (local)                  │
│       │                                                                        │
│       ▼                                                                        │
│  SQLite Storage                                                                │
│  ├── chunks table (id, path, start_line, end_line, text, hash)                │
│  ├── chunks_vec (sqlite-vec virtual table — vector similarity)                │
│  ├── chunks_fts (FTS5 virtual table — keyword/BM25 search)                   │
│  └── embedding_cache (hash → embedding vector)                                │
│                                                                                │
│  INVARIANT: SQLite index is DISPOSABLE — delete & re-index from markdown      │
│                                                                                │
└───────────────────────────────────────────────────────────────────────────────┘
```

#### SQLite Schema for Memory Index

```sql
-- Core chunk storage
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,        -- 'MEMORY.md' or 'memory/2026-01-15.md'
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  text TEXT NOT NULL,
  hash TEXT NOT NULL,             -- SHA-256 of text (for change detection)
  indexed_at INTEGER NOT NULL,    -- Unix timestamp
  UNIQUE(file_path, start_line, end_line)
);

-- Vector similarity search (sqlite-vec extension)
CREATE VIRTUAL TABLE chunks_vec USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding FLOAT[1536]           -- Match your embedding model dimensions
);

-- Full-text keyword search (FTS5 — built into SQLite)
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,
  content='chunks',
  content_rowid='id'
);

-- Embedding cache (avoid re-embedding unchanged text)
CREATE TABLE embedding_cache (
  hash TEXT PRIMARY KEY,          -- SHA-256 of chunk text
  embedding BLOB NOT NULL,        -- Raw float array
  model TEXT NOT NULL,            -- 'text-embedding-3-small'
  created_at INTEGER NOT NULL
);

-- Indexes
CREATE INDEX idx_chunks_path ON chunks(file_path);
CREATE INDEX idx_chunks_hash ON chunks(hash);
```

#### Hybrid Search: Vector + Keyword Scoring

The search combines **semantic similarity** (sqlite-vec cosine distance) with **keyword matching** (FTS5 BM25):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         HYBRID SEARCH                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Query: "how does authentication work?"                                      │
│       │                                                                      │
│       ├──▶ Embed query ──▶ sqlite-vec cosine search                         │
│       │                       │                                              │
│       │                       ▼                                              │
│       │                   Vector Scores                                      │
│       │                   [0.89, 0.72, 0.65, ...]                           │
│       │                                                                      │
│       └──▶ FTS5 BM25 search (keyword matching)                              │
│                               │                                              │
│                               ▼                                              │
│                           Text Scores                                        │
│                           [0.95, 0.40, 0.82, ...]                           │
│       │                                                                      │
│       ▼                                                                      │
│   COMBINE: finalScore = (0.7 × vectorScore) + (0.3 × textScore)            │
│                                                                              │
│   Filter: minScore = 0.35 (discard low-relevance results)                   │
│   Limit: top 10 results                                                      │
│                                                                              │
│   Returns: [{ file, startLine, endLine, text, score }]                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

```typescript
// Hybrid search implementation
interface SearchResult {
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
}

async function hybridSearch(
  db: Database.Database,
  query: string,
  embedQuery: (text: string) => Promise<number[]>,
  options: { limit?: number; minScore?: number } = {}
): Promise<SearchResult[]> {
  const { limit = 10, minScore = 0.35 } = options;
  
  // 1. Get query embedding
  const queryEmbedding = await embedQuery(query);
  
  // 2. Vector search (sqlite-vec cosine similarity)
  const vectorResults = db.prepare(`
    SELECT chunk_id, distance
    FROM chunks_vec
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `).all(new Float32Array(queryEmbedding), limit * 2);  // Fetch extra for merging
  
  // 3. Keyword search (FTS5 BM25)
  const textResults = db.prepare(`
    SELECT rowid, rank
    FROM chunks_fts
    WHERE chunks_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit * 2);
  
  // 4. Normalize scores to [0, 1]
  const maxVecDist = Math.max(...vectorResults.map(r => r.distance), 1);
  const maxTextRank = Math.max(...textResults.map(r => Math.abs(r.rank)), 1);
  
  const vecScores = new Map(
    vectorResults.map(r => [r.chunk_id, 1 - (r.distance / maxVecDist)])
  );
  const textScores = new Map(
    textResults.map(r => [r.rowid, Math.abs(r.rank) / maxTextRank])
  );
  
  // 5. Combine scores: 70% semantic + 30% keyword
  const allChunkIds = new Set([...vecScores.keys(), ...textScores.keys()]);
  const combined: { chunkId: number; score: number }[] = [];
  
  for (const id of allChunkIds) {
    const vecScore = vecScores.get(id) || 0;
    const textScore = textScores.get(id) || 0;
    const finalScore = (0.7 * vecScore) + (0.3 * textScore);
    
    if (finalScore >= minScore) {
      combined.push({ chunkId: id, score: finalScore });
    }
  }
  
  // 6. Sort by score, limit, and fetch chunk details
  combined.sort((a, b) => b.score - a.score);
  const topResults = combined.slice(0, limit);
  
  return topResults.map(({ chunkId, score }) => {
    const chunk = db.prepare(
      'SELECT file_path, start_line, end_line, text FROM chunks WHERE id = ?'
    ).get(chunkId);
    
    return {
      filePath: chunk.file_path,
      startLine: chunk.start_line,
      endLine: chunk.end_line,
      text: chunk.text,
      score,
    };
  });
}
```

#### LangGraph Agent Tools for Memory

Agents interact with the memory system through two LangGraph tools:

**1. `memory_search` — Hybrid semantic + keyword search**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const memorySearchTool = tool(
  async ({ query, limit }, config) => {
    const engine: MarkdownMemoryEngine = config.configurable?.memoryEngine;
    
    const results = await engine.search(query, { limit });
    
    if (results.length === 0) {
      return 'No relevant memories found.';
    }
    
    return results.map(r => 
      `**${r.filePath}** (lines ${r.startLine}-${r.endLine}, score: ${r.score.toFixed(2)}):\n${r.text}`
    ).join('\n\n---\n\n');
  },
  {
    name: 'memory_search',
    description: `Search your long-term memory for relevant information.
Uses hybrid search: semantic similarity (70%) + keyword matching (30%).
Use this when you need to recall facts, decisions, patterns, or past experiences.
Examples: "authentication approach", "user preferences for testing", "why did we choose Prisma"`,
    schema: z.object({
      query: z.string().describe('What to search for — natural language or keywords'),
      limit: z.number().optional().default(5).describe('Max results to return (default: 5)'),
    }),
  }
);
```

**2. `memory_get` — Read specific lines from a memory file**

```typescript
const memoryGetTool = tool(
  async ({ filePath, startLine, endLine }, config) => {
    const engine: MarkdownMemoryEngine = config.configurable?.memoryEngine;
    
    const content = await engine.readFile(filePath, startLine, endLine);
    
    return `**${filePath}** (lines ${startLine}-${endLine}):\n\`\`\`markdown\n${content}\n\`\`\``;
  },
  {
    name: 'memory_get',
    description: `Read specific lines from a memory file. Use this after memory_search 
returns a relevant result and you need more context around it.`,
    schema: z.object({
      filePath: z.string().describe('The memory file path (e.g., "MEMORY.md" or "memory/2026-01-15.md")'),
      startLine: z.number().describe('First line to read (1-indexed)'),
      endLine: z.number().describe('Last line to read (1-indexed)'),
    }),
  }
);
```

**3. Writing Memory — No special tool needed!**

Agents write to memory files using **standard file write tools** — the file watcher automatically detects changes and re-indexes:

```
Agent writes to memory/2026-01-15.md
       │
       ▼
File watcher detects change (1.5s debounce)
       │
       ▼
Re-chunk → re-embed (only changed chunks) → update SQLite index
       │
       ▼
Next memory_search query finds the new content
```

This is a key Clawdbot insight: **writing memory doesn't need a special tool**. The agent's standard file write capabilities are sufficient. The file watcher handles indexing.

#### Wiring Memory Tools into LangGraph Agent

```typescript
import { createReactAgent } from '@langchain/langgraph/prebuilt';

// Create the memory engine (once per agent workspace)
const memoryEngine = new MarkdownMemoryEngine({
  workspacePath: '/path/to/agent/workspace',
  dbPath: 'data/memory-index/chunks.db',
  embedModel: 'text-embedding-3-small',
  embedDims: 1536,
  chunkSize: 400,     // ~400 tokens per chunk
  chunkOverlap: 80,   // 80 token overlap
});

// Start watching markdown files for changes
await memoryEngine.startWatcher();

// Create agent with memory tools
const agent = createReactAgent({
  llm,
  tools: [
    memorySearchTool,    // ← Hybrid search over markdown files
    memoryGetTool,       // ← Read specific lines from memory files
    // ... file write tools (agent writes markdown directly)
    // ... other task-specific tools
  ],
  checkpointer: sqliteSaver,  // Short-term: conversation history
  // NOTE: No LangGraph Store needed — markdown files ARE the store!
});

// Pass memory engine via configurable
const config = {
  configurable: {
    thread_id: task.id,
    memoryEngine,  // Injected into tools via config.configurable
  }
};

await agent.invoke({ messages: [...] }, config);
```

#### Three Memory Categories (Mapped to Markdown)

The three memory types from LangGraph (semantic/episodic/procedural) naturally map to markdown sections:

| Memory Type | What It Stores | Markdown Location |
|-------------|----------------|-------------------|
| **Semantic** | Facts: user prefs, project patterns, codebase structure | `MEMORY.md` → "Project Facts", "User Preferences" sections |
| **Episodic** | Experiences: task outcomes, failures, corrections | `memory/YYYY-MM-DD.md` → Daily task logs with outcomes |
| **Procedural** | Rules: refined instructions, checklists, style guides | `MEMORY.md` → "Learned Patterns", "Common Pitfalls" sections |

```
┌─────────────────────────────────────────────────────────────────────────────┐
│              MEMORY TYPES → MARKDOWN FILE ORGANIZATION                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  SEMANTIC (Facts & Preferences)      →   MEMORY.md                          │
│  ══════════════════════════════           ## Project Facts                    │
│  "User prefers tabs"                     - Framework: Express + TypeScript   │
│  "Project uses PostgreSQL"               - ORM: Prisma with PostgreSQL       │
│  "API follows REST conventions"          ## User Preferences                 │
│                                          - Always use named exports          │
│                                                                              │
│  EPISODIC (Past Experiences)         →   memory/YYYY-MM-DD.md               │
│  ═══════════════════════════════         ## Task: Implement Auth              │
│  "Migration failed — no backup"          - Approach: JWT + Redis             │
│  "jose + Redis worked well"              - Outcome: Passed security review   │
│  "User corrected: no any[]"              - Lesson: jose + Redis is proven    │
│                                                                              │
│  PROCEDURAL (Self-Improving Rules)   →   MEMORY.md                          │
│  ════════════════════════════════════     ## Learned Patterns                 │
│  "Always validate with Zod"              - Always create migration files     │
│  "Use custom error classes"              - Use Zod for validation            │
│  "Write tests alongside code"            ## Common Pitfalls                  │
│                                          - CORS → check whitelist            │
│                                                                              │
│  ALL searchable via memory_search (hybrid vector + keyword)                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Memory Lifecycle: Compaction, Flush, and Session Hooks

**1. Memory Flush (Pre-Compaction)**

When the context window approaches its limit and conversation summarization is about to trigger, the agent performs a **memory flush** — silently saving important information from the conversation to markdown before compression:

```typescript
// Called before LangGraph's conversation summarization
async function memoryFlush(
  state: AgentState,
  config: RunnableConfig
): Promise<void> {
  const engine: MarkdownMemoryEngine = config.configurable?.memoryEngine;
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const logPath = `memory/${today}.md`;
  
  // Extract important info from recent messages
  const recentMessages = state.messages.slice(-20);
  const importantInfo = await extractImportantInfo(recentMessages);
  
  if (importantInfo.length > 0) {
    // Append to today's daily log
    const content = importantInfo.map(info => 
      `- ${info.summary}\n  ${info.detail}`
    ).join('\n');
    
    await appendToFile(logPath, `\n## Pre-Compaction Flush (${new Date().toISOString()})\n${content}\n`);
    
    // File watcher will auto-index the new content
  }
}
```

**2. Session Memory Hook**

When a session ends (user starts new conversation), save the last N messages as a named markdown file:

```typescript
// Called on session end or /new command
async function saveSessionMemory(
  sessionId: string,
  messages: Message[],
  config: RunnableConfig
): Promise<void> {
  const engine: MarkdownMemoryEngine = config.configurable?.memoryEngine;
  const today = new Date().toISOString().split('T')[0];
  
  // Generate a slug from the conversation topic
  const topic = await summarizeTopic(messages.slice(0, 5));
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  
  const filePath = `memory/${today}-${slug}.md`;
  
  // Save last 15 messages as markdown
  const content = messages.slice(-15).map(msg => {
    const role = msg.role === 'assistant' ? 'Agent' : 'User';
    return `### ${role}\n${msg.content}\n`;
  }).join('\n');
  
  await writeFile(filePath, `# Session: ${topic}\n\n${content}`);
}
```

**3. Long-Term Memory Compaction**

Periodically, the agent (or a background process) distills daily logs into `MEMORY.md`:

```typescript
// Run periodically or when daily logs accumulate
async function compactMemory(
  engine: MarkdownMemoryEngine,
  llm: ChatModel
): Promise<void> {
  // Read all daily logs
  const dailyLogs = await engine.listFiles('memory/');
  
  // Read current MEMORY.md
  const currentMemory = await engine.readFile('MEMORY.md');
  
  // Use LLM to distill
  const updatedMemory = await llm.invoke(`
You are maintaining an agent's long-term memory file.

Current MEMORY.md:
${currentMemory}

Recent daily logs to incorporate:
${dailyLogs.map(log => `--- ${log.path} ---\n${log.content}`).join('\n\n')}

Update MEMORY.md to incorporate new learnings from the daily logs:
- Add new facts to "Project Facts" 
- Update "User Preferences" with any new preferences
- Add to "Architecture Decisions" for significant choices
- Update "Learned Patterns" with new patterns discovered
- Add to "Common Pitfalls" for issues encountered
- Remove outdated information
- Keep it concise — MEMORY.md should be a distilled reference, not a log

Return the complete updated MEMORY.md content.
  `);
  
  await engine.writeFile('MEMORY.md', updatedMemory);
}
```

#### Multi-Agent Isolation

Each agent gets its own **workspace directory** with isolated memory:

```
workspaces/
├── backend-agent/
│   ├── MEMORY.md                    ← Backend agent's curated memory
│   ├── memory/
│   │   ├── 2026-01-15.md
│   │   └── 2026-01-16.md
│   └── data/memory-index/
│       └── chunks.db                ← Backend agent's search index
│
├── frontend-agent/
│   ├── MEMORY.md                    ← Frontend agent's curated memory
│   ├── memory/
│   │   └── 2026-01-15.md
│   └── data/memory-index/
│       └── chunks.db                ← Frontend agent's search index
│
└── qa-agent/
    ├── MEMORY.md
    ├── memory/
    └── data/memory-index/
        └── chunks.db
```

Each `MarkdownMemoryEngine` instance is scoped to one agent's workspace. No cross-contamination.

#### Checkpointer vs Memory Engine vs Store — Comparison

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  CHECKPOINTER (SqliteSaver)        MEMORY ENGINE (MarkdownMemoryEngine)     │
│  ══════════════════════════        ═════════════════════════════════════    │
│                                                                              │
│  • Per-thread (one task)           • Cross-thread (all tasks)                │
│  • Conversation messages           • Markdown files (human-readable)         │
│  • Auto-saved by LangGraph         • Written by agent + file watcher index  │
│  • Binary SQLite format            • Plain text files (git-friendly)         │
│  • Lost if thread deleted          • Persists until manually deleted         │
│  • Used for crash recovery         • Used for learning & recall              │
│                                                                              │
│  thread_id = "task-123"            MEMORY.md                                 │
│  ├── Message 1                     ├── ## Project Facts                      │
│  ├── Message 2                     │   - Uses Prisma + PostgreSQL            │
│  ├── Tool Call                     ├── ## User Preferences                   │
│  └── Message 3                     │   - Always named exports                │
│                                    └── ## Learned Patterns                   │
│  [Summarization compresses this]       - Always use Zod validation           │
│                                                                              │
│                                    memory/2026-01-15.md                      │
│                                    ├── ## Task: Implement Auth               │
│                                    │   - Decision: JWT + Redis               │
│                                    └── ## Task: Fix CORS                     │
│                                        - Root cause: missing whitelist       │
│                                                                              │
│                                    [Never lost — plain files on disk]        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Why NOT use LangGraph Store directly?**

| LangGraph Store | MarkdownMemoryEngine |
|-----------------|----------------------|
| Key-value pairs in memory/Postgres | Plain markdown files |
| Opaque to humans | Human-readable |
| Needs custom SQLiteBackedStore wrapper | SQLite index is disposable |
| Semantic search only (no FTS5) | Hybrid: 70% vector + 30% keyword |
| Hard to debug/inspect | Open any file and read |
| Vendor-coupled (LangGraph API) | Survives any tooling change |
| No built-in embedding cache | Hash-based embedding cache |

**LangGraph Store IS still used** — for structured metadata (e.g., task assignments, inter-agent coordination in L2). But for **agent long-term memory**, markdown files win on every axis.

#### Complete Flow: Using Memory in Agent Execution

```typescript
// Before agent starts a task — load relevant memories
async function prepareAgent(task: Task, role: string, engine: MarkdownMemoryEngine): Promise<string> {
  // 1. Search for relevant memories about this task
  const relevantMemories = await engine.search(task.description, { limit: 5 });
  
  // 2. Read MEMORY.md for general context
  const longTermMemory = await engine.readFile('MEMORY.md');
  
  // 3. Compose system prompt with memory context
  return `
${longTermMemory}

## Relevant Past Memories
${relevantMemories.map(r => `- (${r.filePath}:${r.startLine}) ${r.text}`).join('\n')}

## Your Current Task
${task.description}
`;
}

// After task completes — store learnings
async function learnFromTask(task: Task, output: string, engine: MarkdownMemoryEngine): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const logPath = `memory/${today}.md`;
  
  // Append task summary to daily log
  const entry = `
## Task: ${task.description}
- **Status:** ${task.status}
- **Output:** ${output.slice(0, 500)}
- **Key decisions:** ${task.decisions?.join(', ') || 'None recorded'}
`;
  
  await engine.appendToFile(logPath, entry);
  // File watcher auto-indexes → immediately searchable
}
```

#### Progressive Memory: Save-Then-Summarize Pattern

The progressive storage pattern from the Clawdbot approach works naturally with markdown:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   PROGRESSIVE MEMORY WITH MARKDOWN                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Agent Working on Task...                                                    │
│       │                                                                      │
│       ├── Step 1: Agent discovers "project uses Prisma"                     │
│       │       │                                                              │
│       │       ├── 1a. WRITE to memory/2026-01-15.md:                        │
│       │       │       "- Discovered: Uses Prisma ORM with PostgreSQL"       │
│       │       │       "  Found in: package.json + prisma/schema.prisma"     │
│       │       │       "  Models: User, Post, Comment"                       │
│       │       │       (File watcher auto-indexes in 1.5s)                   │
│       │       │                                                              │
│       │       └── 1b. Continue working (summary in conversation)             │
│       │               "I found the project uses Prisma with PostgreSQL"     │
│       │                                                                      │
│       ├── Step 2: Agent makes architecture decision                         │
│       │       │                                                              │
│       │       ├── 2a. WRITE to memory/2026-01-15.md:                        │
│       │       │       "- Decision: Use JWT with refresh tokens in Redis"    │
│       │       │       "  Reasoning: Stateless, scalable, secure"            │
│       │       │       "  Alternatives: sessions, OAuth only"                │
│       │       │                                                              │
│       │       └── 2b. Continue working                                       │
│       │                                                                      │
│       ├── [CONTEXT WINDOW FULL — SUMMARIZATION TRIGGERED]                   │
│       │       │                                                              │
│       │       ├── Memory flush → saves key info to daily log                │
│       │       └── Conversation compressed, but markdown has FULL details!   │
│       │                                                                      │
│       └── Step 3: Agent continues — queries memory_search                   │
│               │                                                              │
│               └── memory_search("what ORM does this project use?")          │
│                   → Finds chunk from memory/2026-01-15.md                   │
│                   → Returns: "Uses Prisma ORM with PostgreSQL"              │
│                   → Full details preserved in plain markdown!               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Implementation: MarkdownMemoryEngine

```typescript
// src/worker/memory/persistence/MarkdownMemoryEngine.ts

import Database from 'better-sqlite3';
import * as chokidar from 'chokidar';
import { createHash } from 'crypto';
import { readFile, writeFile, appendFile, readdir } from 'fs/promises';
import { join, relative } from 'path';

interface MarkdownMemoryConfig {
  workspacePath: string;           // Root directory for this agent's workspace
  dbPath?: string;                 // SQLite index location (default: data/memory-index/chunks.db)
  embedModel?: string;             // Embedding model name (default: text-embedding-3-small)
  embedDims?: number;              // Embedding dimensions (default: 1536)
  chunkSize?: number;              // Target tokens per chunk (default: 400)
  chunkOverlap?: number;           // Overlap tokens between chunks (default: 80)
  debounceMs?: number;             // File watcher debounce (default: 1500)
  hybridWeights?: {                // Hybrid search scoring weights
    vector: number;                //   default: 0.7
    keyword: number;               //   default: 0.3
  };
  minScore?: number;               // Minimum result score (default: 0.35)
}

interface SearchResult {
  filePath: string;                // Relative path within workspace
  startLine: number;
  endLine: number;
  text: string;
  score: number;
}

/**
 * Clawdbot-inspired markdown memory system.
 * 
 * Source of truth: Plain markdown files in the agent's workspace.
 * Search index: SQLite with sqlite-vec (vectors) + FTS5 (keywords).
 * Index is DISPOSABLE — delete chunks.db and re-index anytime.
 * 
 * Two-layer memory:
 * - MEMORY.md: Curated long-term knowledge (preferences, patterns, decisions)
 * - memory/*.md: Daily logs and session saves (chronological observations)
 * 
 * Agents write markdown with standard file tools.
 * File watcher detects changes → re-chunks → re-embeds → updates index.
 * Agents search via memory_search (hybrid) and memory_get (direct read).
 */
export class MarkdownMemoryEngine {
  private db: Database.Database;
  private watcher: chokidar.FSWatcher | null = null;
  private config: Required<MarkdownMemoryConfig>;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  
  constructor(config: MarkdownMemoryConfig) {
    this.config = {
      workspacePath: config.workspacePath,
      dbPath: config.dbPath || join(config.workspacePath, 'data/memory-index/chunks.db'),
      embedModel: config.embedModel || 'text-embedding-3-small',
      embedDims: config.embedDims || 1536,
      chunkSize: config.chunkSize || 400,
      chunkOverlap: config.chunkOverlap || 80,
      debounceMs: config.debounceMs || 1500,
      hybridWeights: config.hybridWeights || { vector: 0.7, keyword: 0.3 },
      minScore: config.minScore || 0.35,
    };
    
    this.db = new Database(this.config.dbPath);
    this.createTables();
  }
  
  private createTables(): void {
    this.db.exec(`
      -- Core chunk storage
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        text TEXT NOT NULL,
        hash TEXT NOT NULL,
        indexed_at INTEGER NOT NULL,
        UNIQUE(file_path, start_line, end_line)
      );
      
      CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(file_path);
      CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(hash);
      
      -- Embedding cache (avoid re-embedding unchanged text)
      CREATE TABLE IF NOT EXISTS embedding_cache (
        hash TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    
    // sqlite-vec and FTS5 tables (created separately — extension-dependent)
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
          chunk_id INTEGER PRIMARY KEY,
          embedding FLOAT[${this.config.embedDims}]
        );
      `);
    } catch {
      console.warn('[MarkdownMemoryEngine] sqlite-vec extension not available — vector search disabled');
    }
    
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          text,
          content='chunks',
          content_rowid='id'
        );
      `);
    } catch {
      console.warn('[MarkdownMemoryEngine] FTS5 not available — keyword search disabled');
    }
  }
  
  /**
   * Start watching markdown files for changes.
   * Monitors: MEMORY.md + memory/**\/*.md
   */
  async startWatcher(): Promise<void> {
    const patterns = [
      join(this.config.workspacePath, 'MEMORY.md'),
      join(this.config.workspacePath, 'memory/**/*.md'),
    ];
    
    this.watcher = chokidar.watch(patterns, {
      ignoreInitial: false,  // Index existing files on startup
      persistent: true,
    });
    
    this.watcher.on('add', (path) => this.debouncedIndex(path));
    this.watcher.on('change', (path) => this.debouncedIndex(path));
    this.watcher.on('unlink', (path) => this.removeFileChunks(path));
    
    console.log(`[MarkdownMemoryEngine] Watching: ${patterns.join(', ')}`);
  }
  
  /**
   * Debounce file indexing (batch rapid edits)
   */
  private debouncedIndex(absolutePath: string): void {
    const existing = this.debounceTimers.get(absolutePath);
    if (existing) clearTimeout(existing);
    
    this.debounceTimers.set(absolutePath, setTimeout(async () => {
      this.debounceTimers.delete(absolutePath);
      await this.indexFile(absolutePath);
    }, this.config.debounceMs));
  }
  
  /**
   * Index a single markdown file: chunk → embed → store
   */
  async indexFile(absolutePath: string): Promise<void> {
    const relativePath = relative(this.config.workspacePath, absolutePath);
    const content = await readFile(absolutePath, 'utf-8');
    const lines = content.split('\n');
    
    // 1. Remove existing chunks for this file
    this.removeFileChunks(absolutePath);
    
    // 2. Chunk the content
    const chunks = this.chunkText(lines, relativePath);
    
    // 3. For each chunk: hash → embed (cached) → store
    const insertChunk = this.db.prepare(`
      INSERT INTO chunks (file_path, start_line, end_line, text, hash, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const insertTransaction = this.db.transaction(async () => {
      for (const chunk of chunks) {
        const hash = createHash('sha256').update(chunk.text).digest('hex');
        
        const result = insertChunk.run(
          relativePath, chunk.startLine, chunk.endLine,
          chunk.text, hash, Date.now()
        );
        
        const chunkId = result.lastInsertRowid as number;
        
        // Get or compute embedding
        const embedding = await this.getOrComputeEmbedding(chunk.text, hash);
        
        // Insert into vector index
        if (embedding) {
          try {
            this.db.prepare(
              'INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)'
            ).run(chunkId, new Float32Array(embedding));
          } catch { /* sqlite-vec not available */ }
        }
        
        // Insert into FTS5 index
        try {
          this.db.prepare(
            'INSERT INTO chunks_fts (rowid, text) VALUES (?, ?)'
          ).run(chunkId, chunk.text);
        } catch { /* FTS5 not available */ }
      }
    });
    
    await insertTransaction();
    console.log(`[MarkdownMemoryEngine] Indexed ${chunks.length} chunks from ${relativePath}`);
  }
  
  /**
   * Chunk text into ~chunkSize token segments with overlap
   */
  private chunkText(lines: string[], filePath: string): Array<{
    text: string; startLine: number; endLine: number;
  }> {
    const chunks: Array<{ text: string; startLine: number; endLine: number }> = [];
    const avgCharsPerToken = 4;  // Rough approximation
    const chunkChars = this.config.chunkSize * avgCharsPerToken;
    const overlapChars = this.config.chunkOverlap * avgCharsPerToken;
    
    let i = 0;
    while (i < lines.length) {
      let text = '';
      const startLine = i + 1;  // 1-indexed
      let endLine = startLine;
      
      // Accumulate lines until we hit chunk size
      while (i < lines.length && text.length < chunkChars) {
        text += lines[i] + '\n';
        endLine = i + 1;
        i++;
      }
      
      chunks.push({ text: text.trimEnd(), startLine, endLine });
      
      // Back up by overlap amount
      const overlapLines = Math.floor(overlapChars / (text.length / (endLine - startLine + 1)));
      i = Math.max(i - overlapLines, endLine);  // Don't go backwards past where we ended
      
      if (i >= lines.length) break;
    }
    
    return chunks;
  }
  
  /**
   * Get embedding from cache or compute new one
   */
  private async getOrComputeEmbedding(text: string, hash: string): Promise<number[] | null> {
    // Check cache
    const cached = this.db.prepare(
      'SELECT embedding FROM embedding_cache WHERE hash = ?'
    ).get(hash);
    
    if (cached) {
      return Array.from(new Float32Array(cached.embedding));
    }
    
    // Compute embedding (provider-agnostic)
    try {
      const embedding = await this.embed(text);
      
      // Cache it
      this.db.prepare(
        'INSERT OR REPLACE INTO embedding_cache (hash, embedding, model, created_at) VALUES (?, ?, ?, ?)'
      ).run(hash, new Float32Array(embedding), this.config.embedModel, Date.now());
      
      return embedding;
    } catch (error) {
      console.warn(`[MarkdownMemoryEngine] Embedding failed: ${error}`);
      return null;
    }
  }
  
  /**
   * Embed text using configured provider.
   * Override this method for different embedding providers.
   */
  protected async embed(text: string): Promise<number[]> {
    // Default: Azure OpenAI embeddings
    // In production, inject the embedding function via constructor
    throw new Error('embed() must be implemented or injected via config');
  }
  
  /**
   * Hybrid search: semantic (sqlite-vec) + keyword (FTS5)
   */
  async search(query: string, options?: { limit?: number; minScore?: number }): Promise<SearchResult[]> {
    const limit = options?.limit || 10;
    const minScore = options?.minScore || this.config.minScore;
    const { vector: vecWeight, keyword: kwWeight } = this.config.hybridWeights;
    
    // 1. Get query embedding
    const queryHash = createHash('sha256').update(query).digest('hex');
    const queryEmbedding = await this.getOrComputeEmbedding(query, queryHash);
    
    // 2. Vector search
    let vecScores = new Map<number, number>();
    if (queryEmbedding) {
      try {
        const vecResults = this.db.prepare(`
          SELECT chunk_id, distance FROM chunks_vec
          WHERE embedding MATCH ? ORDER BY distance LIMIT ?
        `).all(new Float32Array(queryEmbedding), limit * 2);
        
        const maxDist = Math.max(...vecResults.map(r => r.distance), 1);
        vecScores = new Map(
          vecResults.map(r => [r.chunk_id, 1 - (r.distance / maxDist)])
        );
      } catch { /* sqlite-vec not available */ }
    }
    
    // 3. Keyword search (FTS5)
    let kwScores = new Map<number, number>();
    try {
      const ftsResults = this.db.prepare(`
        SELECT rowid, rank FROM chunks_fts
        WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?
      `).all(query, limit * 2);
      
      const maxRank = Math.max(...ftsResults.map(r => Math.abs(r.rank)), 1);
      kwScores = new Map(
        ftsResults.map(r => [r.rowid, Math.abs(r.rank) / maxRank])
      );
    } catch { /* FTS5 not available */ }
    
    // 4. Combine: finalScore = (vecWeight × vecScore) + (kwWeight × kwScore)
    const allIds = new Set([...vecScores.keys(), ...kwScores.keys()]);
    const combined: { chunkId: number; score: number }[] = [];
    
    for (const id of allIds) {
      const vs = vecScores.get(id) || 0;
      const ks = kwScores.get(id) || 0;
      const score = (vecWeight * vs) + (kwWeight * ks);
      if (score >= minScore) {
        combined.push({ chunkId: id, score });
      }
    }
    
    combined.sort((a, b) => b.score - a.score);
    
    // 5. Fetch chunk details
    return combined.slice(0, limit).map(({ chunkId, score }) => {
      const chunk = this.db.prepare(
        'SELECT file_path, start_line, end_line, text FROM chunks WHERE id = ?'
      ).get(chunkId);
      
      return {
        filePath: chunk.file_path,
        startLine: chunk.start_line,
        endLine: chunk.end_line,
        text: chunk.text,
        score,
      };
    });
  }
  
  /**
   * Read specific lines from a memory file
   */
  async readFile(filePath: string, startLine?: number, endLine?: number): Promise<string> {
    const absolutePath = join(this.config.workspacePath, filePath);
    const content = await readFile(absolutePath, 'utf-8');
    
    if (!startLine && !endLine) return content;
    
    const lines = content.split('\n');
    const start = (startLine || 1) - 1;
    const end = endLine || lines.length;
    return lines.slice(start, end).join('\n');
  }
  
  /**
   * Append content to a memory file (creates if needed)
   */
  async appendToFile(filePath: string, content: string): Promise<void> {
    const absolutePath = join(this.config.workspacePath, filePath);
    await appendFile(absolutePath, content, 'utf-8');
    // File watcher will auto-trigger re-index
  }
  
  /**
   * Write (overwrite) a memory file
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    const absolutePath = join(this.config.workspacePath, filePath);
    await writeFile(absolutePath, content, 'utf-8');
    // File watcher will auto-trigger re-index
  }
  
  /**
   * List all memory files
   */
  async listFiles(dir: string = ''): Promise<Array<{ path: string; content: string }>> {
    const absoluteDir = join(this.config.workspacePath, dir);
    const files = await readdir(absoluteDir, { recursive: true });
    const mdFiles = files.filter(f => f.endsWith('.md'));
    
    return Promise.all(mdFiles.map(async (f) => {
      const filePath = join(dir, f);
      const content = await readFile(join(absoluteDir, f), 'utf-8');
      return { path: filePath, content };
    }));
  }
  
  /**
   * Remove all chunks for a file (before re-indexing or on delete)
   */
  private removeFileChunks(absolutePath: string): void {
    const relativePath = relative(this.config.workspacePath, absolutePath);
    
    // Get chunk IDs before deleting
    const chunkIds = this.db.prepare(
      'SELECT id FROM chunks WHERE file_path = ?'
    ).all(relativePath).map(r => r.id);
    
    if (chunkIds.length > 0) {
      // Remove from vector index
      try {
        for (const id of chunkIds) {
          this.db.prepare('DELETE FROM chunks_vec WHERE chunk_id = ?').run(id);
        }
      } catch { /* sqlite-vec not available */ }
      
      // Remove from FTS5 index
      try {
        for (const id of chunkIds) {
          this.db.prepare('DELETE FROM chunks_fts WHERE rowid = ?').run(id);
        }
      } catch { /* FTS5 not available */ }
      
      // Remove chunks
      this.db.prepare('DELETE FROM chunks WHERE file_path = ?').run(relativePath);
    }
  }
  
  /**
   * Rebuild entire index from markdown files (when index is corrupted/deleted)
   */
  async rebuildIndex(): Promise<void> {
    console.log('[MarkdownMemoryEngine] Rebuilding index from markdown files...');
    
    // Clear all tables
    this.db.exec('DELETE FROM chunks');
    try { this.db.exec('DELETE FROM chunks_vec'); } catch {}
    try { this.db.exec('DELETE FROM chunks_fts'); } catch {}
    
    // Re-index all markdown files
    const memoryMd = join(this.config.workspacePath, 'MEMORY.md');
    const memoryDir = join(this.config.workspacePath, 'memory');
    
    try { await this.indexFile(memoryMd); } catch {}
    
    try {
      const files = await readdir(memoryDir, { recursive: true });
      for (const f of files) {
        if (f.endsWith('.md')) {
          await this.indexFile(join(memoryDir, f));
        }
      }
    } catch {}
    
    console.log('[MarkdownMemoryEngine] Index rebuild complete');
  }
  
  /**
   * Stop watcher and close database
   */
  async close(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.db.close();
  }
}
```

#### Connection to RoleTaskQueue Clarification

**Let me be crystal clear about the relationship:**

| Component | What It Does | Persistence | Source |
|-----------|--------------|-------------|--------|
| **RoleTaskQueue** | In-memory task orchestration (queues, priorities, status) | ❌ None | `src/worker/util/RoleTaskQueue.ts` (EXISTS) |
| **MemoryManager** | In-memory task dependencies and outputs | ❌ None | `src/worker/memoryManager/MemoryManager.ts` (EXISTS) |
| **TaskCheckpointer** | Persists RoleTaskQueue + MemoryManager state to SQLite | ✅ SQLite | NEW: `src/worker/memory/persistence/TaskCheckpointer.ts` |
| **LangGraph SqliteSaver** | Persists agent conversation history | ✅ SQLite | USE: `@langchain/langgraph-checkpoint-sqlite` |
| **MarkdownMemoryEngine** | Long-term memory: markdown files + hybrid search index | ✅ Markdown + SQLite | NEW: `src/worker/memory/persistence/MarkdownMemoryEngine.ts` |

**RoleTaskQueue IS NOT being replaced.** We're adding a persistence layer underneath it.

```
                     BEFORE                              AFTER
                     ──────                              ─────
         
         RoleTaskQueue (in-memory)              RoleTaskQueue (in-memory)
                 │                                      │
                 │                              TaskCheckpointer (SQLite)
                 │                                      │
                 ▼                                      ▼
            [CRASH]                               [CRASH]
                 │                                      │
                 ▼                                      ▼
          Lost forever                        Restore from SQLite
```

### Files to Create

| File | Purpose | Custom or LangGraph? |
|------|---------|---------------------|
| `TaskCheckpointer.ts` | Persist task orchestration state | **Custom** (our code) |
| `MarkdownMemoryEngine.ts` | Markdown files + sqlite-vec/FTS5 hybrid search | **Custom** (Clawdbot-inspired) |
| `checkpoint.types.ts` | TypeScript types for checkpointing | **Custom** (our code) |
| - | Agent conversation persistence | **LangGraph** `SqliteSaver` |

### Files Summary by Storage Boundary

```
src/worker/memory/persistence/
├── TaskCheckpointer.ts         # L1: Task orchestration → SQLite
├── MarkdownMemoryEngine.ts     # L1: Agent long-term memory → Markdown + SQLite index
├── checkpoint.types.ts         # Shared types
└── PersistenceConfig.ts        # Configuration

workspace/<agent-role>/         # Agent workspace (per agent)
├── MEMORY.md                   # Curated long-term knowledge
├── memory/                     # Daily logs and session saves
│   ├── 2026-01-15.md
│   └── 2026-01-15-auth-design.md
└── data/memory-index/
    └── chunks.db               # SQLite search index (DISPOSABLE)

src/worker/memory/collab/       # L2: Team collaboration → MongoDB
├── CollabStore.ts              # Yjs/CRDT persistence
└── ArtifactStore.ts            # GridFS file storage

src/worker/memory/knowledge/  # L3: Org knowledge → Git + MongoDB
├── KnowledgeStore.ts         # Dual storage coordination
├── GitSync.ts                # Git repo operations
└── ProposalManager.ts        # Approval workflow
```

**Note:** We leverage LangGraph for conversation checkpointing. For long-term memory, we use a Clawdbot-inspired approach: plain markdown files as source of truth, indexed by sqlite-vec + FTS5 for hybrid search. We only build TaskCheckpointer and MarkdownMemoryEngine ourselves.

### Integration with Existing Code

**Task threads already exist** — `WorkerPool.ts` uses `threadId: taskId` for LangGraph.

**No extra session concept needed.** Recovery is based on task status:
- `completed` / `failed` → Done, ignore
- `pending` / `ready` / `in_progress` → Interrupted, restore

**Changes needed:**

1. **MemoryManager** (add checkpointer):
```typescript
// src/worker/memoryManager/MemoryManager.ts
export class MemoryManager {
  private checkpointer?: TaskCheckpointer;  // ADD (optional)
  
  setCheckpointer(checkpointer: TaskCheckpointer): void {
    this.checkpointer = checkpointer;
  }
  
  addTask(task: Task): void {
    // ... existing logic
    this.checkpointer?.saveTask(task);  // ADD
  }
  
  completeTask(taskId: string, output: any): Task[] {
    // ... existing logic
    this.checkpointer?.completeTask(taskId, output);  // ADD
    return newlyReadyTasks;
  }
}
```

2. **Startup recovery** (in AgentManager):
```typescript
if (checkpointer.hasUnfinishedTasks()) {
  const tasks = checkpointer.getUnfinishedTasks();
  for (const task of tasks) {
    memoryManager.addTask(task);  // Restore to memory
  }
}
```

**Total: ~15 lines of changes** to existing code.

---

## 2. L2 Team Memory Persistence

### Current State
- `CollabMemoryManager` created but persistence unclear
- `ArtifactRegistry` uses in-memory Map - **NOT PERSISTENT**

### Strategy: MongoDB Only (with GridFS)

**Start simple:** MongoDB handles everything, including files.

| File Size | Storage Method |
|-----------|----------------|
| < 16MB | Inline in document (BSON) |
| ≥ 16MB | GridFS (MongoDB's file storage) |

**Add S3 later** only if you hit scale limits (>10GB artifacts, >1000 concurrent uploads).

#### What is L2 Team Memory?

**L2 is the shared workspace where agents collaborate on a project/goal.**

Think of it as **Google Drive + Notion + GitHub** combined for AI agents:

```
L1 (Agent Memory)    →  Per-task agent context (messages, reasoning, tools)
L2 (Team Memory)     →  Team's shared project workspace (persistent)
L3 (Org Memory)      →  Company knowledge base (permanent, versioned)
```

#### The Three L2 Collections

| Collection | Purpose | Analogy |
|------------|---------|---------|
| `collaboration_spaces` | Container grouping all work for one goal | A project folder |
| `structured_documents` | Block-based docs that agents edit in real-time | Notion pages |
| `artifacts` | Generated output files (code, images, PDFs) | GitHub releases |

**Why 3 collections?**

1. **`collaboration_spaces`** — Groups related work. Without this, documents would float without context. Enables: archive projects, control access, query "show all work on this goal".

2. **`structured_documents`** — The collaboration surface. Multiple agents edit simultaneously using block-based content (no merge conflicts). Yjs CRDT keeps everyone in sync.

3. **`artifacts`** — Generated outputs that are immutable once created. Different storage strategy (GridFS for large files). Tracks lineage (which task created it).

#### Practical Workflow Example

```
User: "Build me a user authentication API"
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  AgentManager creates collaboration_space                    │
│  └── spaceId: "space-auth-api"                               │
│  └── members: ["architect", "backend", "qa"]                 │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  Architect Agent                                              │
│  └── Creates structured_document: "Architecture.md"          │
│       ├── Block 1: heading "Authentication Flow"             │
│       ├── Block 2: code (mermaid diagram)                    │
│       └── Block 3: table "Endpoint | Method | Auth"          │
└──────────────────────────────────────────────────────────────┘
         │
         ▼ (real-time sync via Hocuspocus)
┌──────────────────────────────────────────────────────────────┐
│  Backend Agent (edits same document simultaneously)          │
│  └── Adds Block 4: code "interface AuthToken { ... }"        │
│  └── Creates artifact: "src/auth/AuthService.ts"             │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  QA Agent                                                     │
│  └── Reads Architecture.md (sees all blocks instantly)       │
│  └── Creates structured_document: "TestPlan.md"              │
│  └── Creates artifact: "tests/auth.test.ts"                  │
└──────────────────────────────────────────────────────────────┘
```

#### Schema Design

```typescript
// MongoDB Collections

// collaboration_spaces (container for a team's project)
{
  _id: ObjectId,
  teamId: string,
  goalId: string,
  projectId: string,
  status: 'active' | 'archived',
  createdAt: Date,
  archivedAt?: Date,
  metadata: {
    name: string,
    description: string,
    members: string[],
  }
}

// structured_documents (Notion-like block documents for real-time collab)
{
  _id: ObjectId,
  spaceId: ObjectId,
  name: string,
  type: 'requirements' | 'design' | 'code' | 'notes' | 'report',
  
  // Block-based content (like Notion/ProseMirror)
  blocks: DocumentBlock[],
  
  // CRDT state for real-time sync
  yjsState: Buffer,           // Yjs encoded document state
  lastSyncedAt: Date,
  
  // Metadata
  createdBy: string,
  createdFromTask?: string,
  version: number,
  createdAt: Date,
  updatedAt: Date,
}

// Block types (stored in blocks array)
interface DocumentBlock {
  id: string,
  type: 'heading' | 'paragraph' | 'code' | 'table' | 'image' | 'list' | 'quote' | 'divider',
  content: BlockContent,       // Type-specific content
  metadata?: {
    createdBy: string,
    createdAt: Date,
    language?: string,         // For code blocks
    level?: number,            // For headings (1-6)
  }
}

// Example block contents
type BlockContent = 
  | { text: string }                                    // paragraph, quote
  | { level: number, text: string }                     // heading
  | { language: string, code: string }                  // code
  | { rows: string[][], headers?: string[] }            // table
  | { url: string, alt?: string, caption?: string }     // image
  | { items: string[], ordered: boolean }               // list

// artifacts (binary files - images, PDFs, generated exports)
{
  _id: ObjectId,
  spaceId: ObjectId,
  taskId: string,
  type: 'code' | 'document' | 'config' | 'data' | 'image' | 'export',
  
  // Metadata
  name: string,
  path: string,
  mimeType: string,
  size: number,
  hash: string,
  
  // Storage (simplified)
  storageType: 'inline' | 'gridfs',
  content?: Buffer,           // Inline for < 16MB
  gridfsFileId?: ObjectId,    // GridFS reference for large files
  
  // Lineage
  createdBy: string,
  createdFromTask: string,
  sourceDocId?: string,       // If exported from a structured_document
  predecessorId?: string,
  
  createdAt: Date,
  tags: string[],
}
```

#### Block-Based Collaboration (Like Notion)

**Why blocks over raw text?**

| Aspect | Raw Text | Block-Based |
|--------|----------|-------------|
| **Multi-agent editing** | Conflicts on same line | Each agent edits different blocks |
| **Code support** | Mixed with prose | Dedicated code blocks with syntax highlighting |
| **Rich content** | Limited | Tables, images, embeds |
| **CRDT granularity** | Character-level | Block-level (faster sync) |

#### Real-Time Sync: Hocuspocus (Yjs Backend)

**Why Hocuspocus?**

| Build Yourself | Use Hocuspocus |
|----------------|----------------|
| WebSocket server | ✅ Built-in |
| Yjs sync protocol | ✅ Built-in |
| Presence/cursors | ✅ Built-in |
| Persistence hooks | ✅ `onStoreDocument` callback |
| Auth middleware | ✅ `onAuthenticate` hook |
| Reconnection | ✅ Handled |
| **Effort: 2-3 weeks** | **Effort: 1-2 days** |

**Architecture with Hocuspocus:**
```
┌─────────────────────────────────────────────────────────────┐
│  Agent A        Agent B        Agent C                      │
│     │              │              │                          │
│     └──────────────┼──────────────┘                          │
│                    ↓                                         │
│         ┌──────────────────────┐                            │
│         │   Hocuspocus Server   │  ← Handles Yjs sync       │
│         │   (Yjs backend)       │                            │
│         └──────────┬───────────┘                            │
│                    │ onStoreDocument()                       │
│                    ↓                                         │
│         ┌──────────────────────┐                            │
│         │   MongoDB (CollabStore)│  ← Persist yjsState      │
│         └──────────────────────┘                            │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**
```typescript
import { Hocuspocus } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';

const server = new Hocuspocus({
  port: 1234,
  
  // Persist to MongoDB via CollabStore
  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        // Load Yjs state from MongoDB
        const doc = await collabStore.loadYjsState(documentName);
        return doc?.yjsState || null;
      },
      store: async ({ documentName, state }) => {
        // Save Yjs state to MongoDB
        await collabStore.saveYjsState(documentName, state);
      },
    }),
  ],
  
  // Auth hook
  async onAuthenticate({ token }) {
    // Validate agent/user token
    return verifyToken(token);
  },
});

server.listen();
```

**Agent connects:**
```typescript
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

const ydoc = new Y.Doc();
const provider = new HocuspocusProvider({
  url: 'ws://localhost:1234',
  name: 'doc-123',  // Document ID
  document: ydoc,
  token: agentToken,
});

// Get block content as Yjs types
const blocks = ydoc.getArray<Y.Map<any>>('blocks');

// Insert a heading block
const headingBlock = new Y.Map();
headingBlock.set('id', 'block-1');
headingBlock.set('type', 'heading');
headingBlock.set('content', { level: 1, text: 'API Design' });
blocks.push([headingBlock]);

// Automatically syncs to all connected agents!
```

**Example: Multiple agents editing simultaneously**
```typescript
// Agent A adds a heading
blocks.push([createBlock('heading', { level: 1, text: 'API Design' })]);

// Agent B adds code (no conflict - different block)
blocks.push([createBlock('code', { language: 'typescript', code: 'interface User { ... }' })]);

// Agent C adds a table (no conflict - different block)  
blocks.push([createBlock('table', { 
  headers: ['Endpoint', 'Method', 'Description'],
  rows: [['/users', 'GET', 'List users']]
})]);

// All changes sync via Hocuspocus - no merge conflicts
```

#### How Yjs Sync Actually Works

**The Problem:** Multiple agents editing the same document simultaneously.

**Traditional approach (conflict hell):**
```
Agent A reads doc: "Hello"
Agent B reads doc: "Hello"
Agent A writes: "Hello World"
Agent B writes: "Hello Universe"   ← CONFLICT! Who wins?
```

**Yjs CRDT approach (conflict-free):**
```
Agent A and B both have local Yjs doc
Agent A inserts " World" at position 5
Agent B inserts " Universe" at position 5
Yjs merges: "Hello World Universe" (or "Hello Universe World")
           → Deterministic merge, no conflicts ever
```

**How it flows:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. Agent A makes a change locally                                       │
│     └── ydoc.getText('content').insert(0, 'Hello')                      │
│                                                                          │
│  2. Yjs creates an "update" (binary diff)                               │
│     └── Uint8Array with encoded operation                               │
│                                                                          │
│  3. HocuspocusProvider sends update via WebSocket                       │
│     └── ws.send(update)                                                  │
│                                                                          │
│  4. Hocuspocus server receives, broadcasts to other agents              │
│     └── All connected clients get the update                            │
│                                                                          │
│  5. Each agent applies update to their local ydoc                       │
│     └── Y.applyUpdate(ydoc, update)                                      │
│                                                                          │
│  6. Hocuspocus persists to MongoDB (via our CollabStore)                │
│     └── collabStore.saveYjsState(docId, Y.encodeStateAsUpdate(ydoc))    │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key insight:** Yjs doesn't sync "documents" — it syncs **operations**. Each operation has a unique ID based on (clientId, clock), making merges deterministic.

#### How Agents Call CollabStore

**Pattern 1: AgentWorker creates artifacts after task completion**

```typescript
// In AgentWorker.ts - after task execution
async function onTaskComplete(task: Task, output: string): Promise<void> {
  // Get the collaboration space for this team/goal
  const space = await collabStore.getSpace(task.context.spaceId);
  
  // If agent generated code, store as artifact
  if (output.includes('```typescript')) {
    const code = extractCodeBlock(output);
    await collabStore.storeArtifact(space._id, {
      type: 'code',
      name: `${task.id}-output.ts`,
      path: `src/generated/${task.id}.ts`,
      mimeType: 'text/typescript',
      createdBy: task.assigned_role,
      createdFromTask: task.id,
    }, Buffer.from(code));
  }
}
```

**Pattern 2: Agent edits shared document via Yjs**

```typescript
// In agent tool - e.g., "updateDesignDoc" tool
async function updateDesignDoc(docId: string, content: string): Promise<void> {
  // Connect to Hocuspocus (agent as a client)
  const provider = new HocuspocusProvider({
    url: process.env.HOCUSPOCUS_URL,
    name: docId,
    document: new Y.Doc(),
    token: agentToken,
  });
  
  await provider.synced;  // Wait for sync
  
  // Add a new block to the document
  const blocks = provider.document.getArray('blocks');
  blocks.push([{
    id: generateId(),
    type: 'paragraph',
    content: { text: content },
    metadata: { createdBy: 'backend-agent', createdAt: new Date() }
  }]);
  
  // Changes auto-sync via Hocuspocus → MongoDB
  provider.disconnect();
}
```

**Pattern 3: AgentManager creates space when goal starts**

```typescript
// In AgentManager.ts - when user submits a new goal
async function handleNewGoal(goal: Goal, team: Team): Promise<void> {
  // Create collaboration space for this goal
  const space = await collabStore.createSpace(team.id, goal.id, {
    name: goal.title,
    description: goal.description,
    members: team.roles.map(r => r.name),
  });
  
  // Create initial design document
  const designDoc = await collabStore.createDocument(
    space._id,
    'Architecture',
    'design'
  );
  
  // Store spaceId in goal context so agents can access it
  goal.context.spaceId = space._id;
  goal.context.designDocId = designDoc._id;
}
```

**Pattern 4: Read artifacts for context**

```typescript
// Agent needs context from previous work
async function getProjectContext(spaceId: string): Promise<string> {
  // Get all code artifacts
  const codeArtifacts = await collabStore.queryArtifacts(spaceId, {
    type: 'code',
  });
  
  // Get design documents
  const designDocs = await collabStore.getDocumentsByType(spaceId, 'design');
  
  // Build context string for agent prompt
  return `
## Existing Code
${codeArtifacts.map(a => `- ${a.path}`).join('\n')}

## Design Documents
${designDocs.map(d => d.name).join('\n')}
  `;
}
```

#### Export to Any Format

```typescript
// Export block document to Word
const wordFile = await doc.exportAs('docx');

// Export to PDF
const pdfFile = await doc.exportAs('pdf');

// Export to Markdown
const markdown = await doc.exportAs('markdown');
```
```

#### GridFS for Large Files (via Mongoose)

```typescript
import mongoose from 'mongoose';
import { GridFSBucket } from 'mongodb';

class CollabStore {
  private bucket: GridFSBucket;
  
  async connect(): Promise<void> {
    // Use existing Mongoose connection
    const db = mongoose.connection.db;
    this.bucket = new GridFSBucket(db, { bucketName: 'artifacts' });
  }
  
  async storeArtifact(artifact: Artifact, content: Buffer): Promise<string> {
    if (content.length < 16 * 1024 * 1024) {
      // Inline storage in document
      return this.storeInline(artifact, content);
    } else {
      // GridFS for large files (uses Mongoose's connection)
      const uploadStream = this.bucket.openUploadStream(artifact.name, {
        metadata: { taskId: artifact.taskId, spaceId: artifact.spaceId }
      });
      uploadStream.end(content);
      artifact.gridfsFileId = uploadStream.id;
      return this.saveArtifactMetadata(artifact);
    }
  }
}
```

**Note:** GridFSBucket comes from `mongodb` driver (which Mongoose uses internally). No extra dependency needed.

#### Implementation

```typescript
// src/worker/memory/persistence/CollabStore.ts
interface ICollabStore {
  // Spaces
  createSpace(teamId: string, goalId: string, metadata: SpaceMetadata): Promise<CollaborationSpace>;
  getSpace(spaceId: string): Promise<CollaborationSpace | null>;
  getSpacesForTeam(teamId: string): Promise<CollaborationSpace[]>;
  archiveSpace(spaceId: string): Promise<void>;
  
  // Structured Documents (block-based, like Notion)
  createDocument(spaceId: string, name: string, type: DocType): Promise<StructuredDocument>;
  getDocument(docId: string): Promise<StructuredDocument | null>;
  
  // Block operations (for CRDT sync)
  insertBlock(docId: string, block: DocumentBlock, afterBlockId?: string): Promise<void>;
  updateBlock(docId: string, blockId: string, content: BlockContent): Promise<void>;
  deleteBlock(docId: string, blockId: string): Promise<void>;
  
  // CRDT state persistence
  saveYjsState(docId: string, state: Buffer): Promise<void>;
  loadYjsState(docId: string): Promise<Buffer | null>;
  
  // Export
  exportDocument(docId: string, format: 'docx' | 'pdf' | 'markdown' | 'html'): Promise<Buffer>;
  
  // Artifacts (binary files)
  storeArtifact(spaceId: string, artifact: Artifact, content: Buffer): Promise<string>;
  getArtifact(artifactId: string): Promise<{ metadata: Artifact; content: Buffer } | null>;
  queryArtifacts(spaceId: string, filter: ArtifactFilter): Promise<Artifact[]>;
}
```

### Files to Create
- `src/worker/memory/persistence/CollabStore.ts`
- `src/worker/memory/persistence/types/collab-store.types.ts`

### Future: Add S3 When Needed

If you later need S3, add `ObjectStorageAdapter` as a drop-in replacement:
```typescript
storageType: 'inline' | 'gridfs' | 's3'  // Extend enum
```

---

## 3. L3 Org Memory Persistence

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Hierarchy** | Team-based | Mirrors org structure, natural permissions |
| **Primary creators** | Agents (learn & propose) | Agents extract learnings from tasks |
| **Storage** | Git (source of truth) + MongoDB (fast retrieval) | Best of both worlds |
| **Review workflow** | Agents suggest, humans approve (auto-approve optional) | Quality control with flexibility |

### What is L3?

**L3 is the organizational documentation system** — permanent, versioned, team-structured knowledge that teaches agents how to work.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    L3: ORGANIZATIONAL DOCS                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Purpose: Teach agents (and humans) how YOUR organization works         │
│                                                                          │
│  WITHOUT L3:                         WITH L3:                            │
│  Agent uses generic LLM knowledge    Agent loads YOUR team's runbooks   │
│  "Deploy with docker..."             "Deploy with our K8s + ArgoCD..."  │
│                                                                          │
│  Key insight: Documents TEACH. Agents LEARN.                             │
│  The skill is the knowledge transfer.                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Team-Based Hierarchy

```
knowledge/
  │
  ├── shared/                          # 🌐 Cross-team (everyone can read)
  │   ├── coding-standards.md
  │   ├── security-guidelines.md
  │   ├── api-conventions.md
  │   └── decisions/
  │       ├── why-postgresql.md
  │       └── why-typescript.md
  │
  ├── engineering/                     # 👥 Engineering department
  │   ├── _team.yaml                   # Team metadata, permissions
  │   │
  │   ├── backend/                     # 👥 Backend team
  │   │   ├── _team.yaml
  │   │   ├── skills/
  │   │   │   ├── api-design.md
  │   │   │   └── database-migrations.md
  │   │   ├── runbooks/
  │   │   │   ├── deploy-production.md
  │   │   │   └── incident-response.md
  │   │   └── projects/
  │   │       ├── auth-service/
  │   │       │   ├── overview.md
  │   │       │   ├── how-it-works.md
  │   │       │   └── working-on.md
  │   │       └── payments-api/
  │   │           └── ...
  │   │
  │   ├── frontend/                    # 👥 Frontend team
  │   │   ├── skills/
  │   │   ├── runbooks/
  │   │   └── projects/
  │   │
  │   └── devops/                      # 👥 DevOps team
  │       ├── skills/
  │       ├── runbooks/
  │       └── infrastructure/
  │
  ├── marketing/                       # 👥 Marketing department
  │   ├── skills/
  │   │   ├── brand-voice.md
  │   │   └── social-media-strategy.md
  │   ├── runbooks/
  │   │   └── campaign-launch-checklist.md
  │   └── campaigns/
  │       └── q1-2026-launch/
  │
  └── legal/                           # 👥 Legal department
      ├── skills/
      │   └── contract-review-process.md
      ├── templates/
      └── compliance/
```

### Team Metadata (`_team.yaml`)

```yaml
# knowledge/engineering/backend/_team.yaml
name: Backend Team
department: Engineering
parent: engineering              # Inherits from parent

# Permissions
permissions:
  read:
    - role:backend              # Agents with backend role
    - role:architect            # Architects can read
    - team:frontend             # Frontend team can read our docs
  propose:
    - role:backend              # Backend agents can propose changes
  approve:
    - user:john@company.com     # Team lead approves
    - user:jane@company.com
  auto_approve:
    - role:backend              # Backend agents auto-approved for skills/*
    patterns:
      - "skills/*"              # Only skills, not runbooks

# Review settings
review:
  staleness_days: 90            # Flag if not updated in 90 days
  require_approval: true        # Default: require human approval
  notify_on_proposal: true      # Slack/email notification

# Agent access
agent_roles:
  - backend
  - architect
  - qa
```

### Document Types

| Type | Audience | Agent Can Write? | Purpose |
|------|----------|------------------|---------|
| **Skills** | 🤖 Agent | ✅ Yes (auto-approvable) | "How do I do X?" |
| **Runbooks** | 🤖+👤 Both | ✅ With review | "What steps for Y?" |
| **Projects** | 🤖+👤 Both | ✅ Agent drafts | "What is this? How does it work?" |
| **Decisions** | 👤 Human | ❌ Suggest only | "Why did we choose Z?" |
| **Templates** | 🤖+👤 Both | ✅ With review | Reusable starting points |

### Document Schema

```typescript
interface KnowledgeDocument {
  // Identity
  id: string;
  path: string;                    // "engineering/backend/skills/api-design.md"
  slug: string;                    // "api-design"
  
  // Hierarchy (derived from path)
  team: string;                    // "backend"
  department: string;              // "engineering"
  category: string;                // "skills"
  
  // Classification
  type: 'skill' | 'runbook' | 'project' | 'decision' | 'template' | 'reference';
  audience: 'agent' | 'human' | 'both';
  
  // Content
  title: string;
  content: string;                 // Markdown
  summary: string;                 // LLM-generated for search (auto)
  
  // Retrieval hints (for agent context injection)
  usefulWhen: string[];            // ["deploying to production", "handling auth errors"]
  keywords: string[];              // Explicit tags
  relatedDocs: string[];           // Links to related docs
  agentRoles: string[];            // Which roles should see this
  
  // Lifecycle
  status: 'draft' | 'pending_review' | 'published' | 'deprecated' | 'archived';
  createdBy: string;               // User or agent ID
  createdAt: Date;
  lastUpdatedBy: string;
  lastUpdatedAt: Date;
  reviewDueAt: Date;               // For staleness detection
  
  // Versioning (Git-backed)
  version: number;
  gitCommit: string;               // SHA of latest commit
  
  // Origin tracking
  origin: {
    type: 'human' | 'agent' | 'imported' | 'graduated';
    sourceTaskId?: string;         // If learned from task
    sourceArtifactId?: string;     // If graduated from L2
    importedFrom?: string;         // If migrated from Confluence/Notion
  };
}
```

### Dual Storage: Git + MongoDB

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     L3 DUAL STORAGE ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   GIT REPOSITORY (Source of Truth)       MONGODB (Fast Retrieval)       │
│   ════════════════════════════════       ════════════════════════════   │
│                                                                          │
│   knowledge/                             knowledge_documents collection  │
│   ├── engineering/                       ┌────────────────────────────┐ │
│   │   └── backend/                       │ {                          │ │
│   │       └── skills/                    │   _id: "...",              │ │
│   │           └── api-design.md ─────────│   path: "engineering/...", │ │
│   │                                      │   content: "# API Design", │ │
│   └── _team.yaml                         │   summary: "...",          │ │
│                                          │   embedding: [...],        │ │
│   WHY GIT?                               │   gitCommit: "abc123",     │ │
│   • Version history                      │   ...                      │ │
│   • PR-based review                      │ }                          │ │
│   • Familiar workflow                    └────────────────────────────┘ │
│   • Compliance audit trail                                              │
│   • Human-editable                       WHY MONGODB?                   │
│                                          • Fast queries                 │
│                                          • Full-text search             │
│                                          • Vector embeddings (RAG)      │
│                                          • Metadata indexing            │
│                                                                          │
│   SYNC FLOW:                                                             │
│   ──────────                                                             │
│   Git push → Webhook → Parse MD → Update MongoDB → Recompute embeddings │
│                                                                          │
│   Agent proposes → MongoDB draft → Human approves → Git commit → Sync   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Graduation: L2 → L3 Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    GRADUATION: L2 → L3 FLOW                              │
│              (How project learnings become org knowledge)                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. TASK EXECUTION (L1/L2)                                               │
│     Agent works on "Implement JWT authentication"                        │
│     └── Creates: Architecture.md, decision log, code                    │
│                                                                          │
│  2. AGENT PROPOSES GRADUATION                                            │
│     Agent (or system) detects:                                           │
│     ├── "This Architecture.md could help future auth tasks"             │
│     └── Calls: proposeGraduation(artifactId, targetPath, metadata)      │
│                                                                          │
│                         ┌──────────────────────────────┐                │
│                         │    KnowledgeProposal         │                │
│                         │    ─────────────────         │                │
│                         │    status: pending           │                │
│                         │    sourcePath: L2 artifact   │                │
│                         │    targetPath: eng/backend/  │                │
│                         │    proposedBy: backend-agent │                │
│                         │    proposedAt: 2026-02-13    │                │
│                         │    autoApprove: false        │                │
│                         └──────────────┬───────────────┘                │
│                                        │                                 │
│  3. HUMAN REVIEW (or Auto-Approve)     ▼                                │
│     ┌─────────────────────────────────────────────────────────────────┐ │
│     │  Notification → Team Lead                                       │ │
│     │                                                                 │ │
│     │  "Backend agent proposes adding 'JWT Auth Best Practices'       │ │
│     │   to engineering/backend/skills/"                               │ │
│     │                                                                 │ │
│     │  [✅ Approve]  [✏️ Edit & Approve]  [❌ Reject]                 │ │
│     └─────────────────────────────────────────────────────────────────┘ │
│                                        │                                 │
│  4. COMMIT TO GIT                      ▼                                │
│     ├── Create branch: docs/add-jwt-auth-skills                        │
│     ├── Add file: engineering/backend/skills/jwt-authentication.md     │
│     ├── Commit: "Add JWT auth skills (graduated from task-123)"        │
│     ├── Auto-merge (if approved) or PR (if needs more review)          │
│     └── Webhook triggers MongoDB sync                                   │
│                                                                          │
│  5. AVAILABLE FOR FUTURE TASKS                                          │
│     Next "implement auth" task:                                          │
│     └── Agent auto-retrieves: jwt-authentication.md                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Auto-Approve Configuration

```typescript
interface AutoApproveConfig {
  enabled: boolean;
  
  rules: AutoApproveRule[];
}

interface AutoApproveRule {
  // WHO can be auto-approved?
  proposerRoles: string[];         // ["backend", "frontend"]
  
  // WHAT can be auto-approved?
  targetPatterns: string[];        // ["skills/*", "projects/*/working-on.md"]
  documentTypes: string[];         // ["skill"]
  
  // CONDITIONS for auto-approval
  conditions: {
    maxContentLength?: number;     // Don't auto-approve huge docs
    requiresKeywords?: string[];   // Must have certain tags
    excludePatterns?: string[];    // Never auto-approve runbooks/*
  };
}

// Example: Backend agents can auto-approve skills, not runbooks
const backendAutoApprove: AutoApproveConfig = {
  enabled: true,
  rules: [
    {
      proposerRoles: ['backend'],
      targetPatterns: ['engineering/backend/skills/*'],
      documentTypes: ['skill'],
      conditions: {
        maxContentLength: 5000,
        excludePatterns: ['**/runbooks/*', '**/decisions/*'],
      },
    },
  ],
};
```

### KnowledgeStore Interface

```typescript
interface KnowledgeStore {
  // === RETRIEVAL (MongoDB - fast) ===
  
  // Get docs for agent context injection
  getForRole(role: string, limit?: number): Promise<KnowledgeDocument[]>;
  
  // Search by query (semantic + keyword)
  search(query: string, options?: SearchOptions): Promise<KnowledgeDocument[]>;
  
  // Get relevant docs for a task
  getRelevant(taskDescription: string, role: string): Promise<KnowledgeDocument[]>;
  
  // Get by path
  getByPath(path: string): Promise<KnowledgeDocument | null>;
  
  // Get team hierarchy
  getTeamDocs(team: string, includeParent?: boolean): Promise<KnowledgeDocument[]>;
  
  // === PROPOSALS (Agent suggestions) ===
  
  // Agent proposes new doc or update
  propose(proposal: KnowledgeProposal): Promise<string>;  // Returns proposalId
  
  // Get pending proposals for approver
  getPendingProposals(approverId: string): Promise<KnowledgeProposal[]>;
  
  // Human approves/rejects
  approve(proposalId: string, approverId: string): Promise<void>;
  reject(proposalId: string, approverId: string, reason: string): Promise<void>;
  editAndApprove(proposalId: string, approverId: string, edits: string): Promise<void>;
  
  // === GRADUATION (L2 → L3) ===
  
  // Propose artifact graduation
  proposeGraduation(
    artifactId: string,
    targetPath: string,
    metadata: Partial<KnowledgeDocument>
  ): Promise<string>;
  
  // === GIT SYNC ===
  
  // Sync MongoDB from Git (on webhook)
  syncFromGit(): Promise<SyncResult>;
  
  // Commit approved proposal to Git
  commitToGit(proposalId: string): Promise<string>;  // Returns commit SHA
  
  // === MAINTENANCE ===
  
  // Get stale docs needing review
  getStaleDocs(olderThanDays: number): Promise<KnowledgeDocument[]>;
  
  // Deprecate a document
  deprecate(path: string, reason: string): Promise<void>;
  
  // Archive (soft delete)
  archive(path: string): Promise<void>;
}

interface KnowledgeProposal {
  id: string;
  type: 'create' | 'update' | 'graduate';
  
  // What's being proposed
  targetPath: string;
  content: string;
  metadata: Partial<KnowledgeDocument>;
  
  // Who proposed it
  proposedBy: string;              // Agent or user ID
  proposedAt: Date;
  reason: string;                  // "Learned from task-123"
  
  // Source (for graduation)
  sourceTaskId?: string;
  sourceArtifactId?: string;
  
  // Review status
  status: 'pending' | 'approved' | 'rejected' | 'auto_approved';
  reviewedBy?: string;
  reviewedAt?: Date;
  rejectionReason?: string;
  
  // Auto-approve check
  autoApproveEligible: boolean;
  autoApproveReason?: string;
}
```

### RAG: Agent Context Injection

```typescript
// When agent starts a task, inject relevant L3 knowledge

async function injectKnowledgeContext(
  task: Task,
  role: string,
  store: KnowledgeStore
): Promise<string> {
  // 1. Get role-specific skills
  const skills = await store.getForRole(role);
  
  // 2. Search for task-relevant docs
  const relevant = await store.search(task.description, {
    roles: [role],
    types: ['skill', 'runbook', 'project'],
    limit: 5,
  });
  
  // 3. If task mentions a project, get project docs
  const projectDocs = task.projectId 
    ? await store.getByPath(`**/projects/${task.projectId}/*`)
    : [];
  
  // 4. Build context string
  return `
## Organizational Knowledge

### Your Skills (${role} role)
${skills.map(s => `- **${s.title}**: ${s.summary}`).join('\n')}

### Relevant to This Task
${relevant.map(d => `
#### ${d.title}
${d.content}
`).join('\n---\n')}

### Project Context
${projectDocs.map(d => d.content).join('\n\n')}
`;
}
```

### Staleness Detection & Maintenance

```typescript
// Cron job: Check for stale docs daily

async function checkStaleDocs(store: KnowledgeStore): Promise<void> {
  const staleDocs = await store.getStaleDocs(90);  // 90 days
  
  for (const doc of staleDocs) {
    // Notify team lead
    await notify({
      to: doc.team + '-leads',
      subject: `Documentation review needed: ${doc.title}`,
      body: `
        This document hasn't been updated in ${daysSince(doc.lastUpdatedAt)} days.
        
        Path: ${doc.path}
        Last updated by: ${doc.lastUpdatedBy}
        
        Please review and either:
        1. Update if outdated
        2. Mark as still-accurate (resets review timer)
        3. Deprecate if no longer relevant
      `,
    });
    
    // Update reviewDueAt
    await store.updateReviewDue(doc.id, addDays(new Date(), 14));
  }
}
```

### Implementation Files

```
src/worker/memory/knowledge/
  ├── KnowledgeStore.ts           # Main interface
  ├── KnowledgeRetrieval.ts       # RAG + search
  ├── KnowledgeProposal.ts        # Proposal workflow
  ├── KnowledgeGraduation.ts      # L2 → L3 flow
  ├── GitSync.ts                  # Git ↔ MongoDB sync
  ├── AutoApprove.ts              # Auto-approval rules
  ├── StalenessChecker.ts         # Maintenance cron
  └── types/
      ├── document.types.ts
      ├── proposal.types.ts
      └── team.types.ts
```

### MongoDB Collections

```typescript
// knowledge_documents - Fast retrieval + embeddings
{
  _id: ObjectId,
  path: string,                    // Indexed
  slug: string,
  team: string,                    // Indexed
  department: string,              // Indexed
  type: string,                    // Indexed
  status: string,                  // Indexed
  
  title: string,
  content: string,
  summary: string,
  
  // Vector embedding for semantic search
  embedding: number[],             // 1536 dims (OpenAI ada-002)
  
  // Retrieval
  usefulWhen: string[],
  keywords: string[],
  agentRoles: string[],            // Indexed
  
  // Versioning
  version: number,
  gitCommit: string,
  
  // Lifecycle
  createdAt: Date,
  lastUpdatedAt: Date,             // Indexed (for staleness)
  reviewDueAt: Date,
  
  // Origin
  origin: { type, sourceTaskId, ... },
}

// knowledge_proposals - Pending approvals
{
  _id: ObjectId,
  status: 'pending' | 'approved' | 'rejected',  // Indexed
  targetPath: string,
  content: string,
  proposedBy: string,              // Indexed
  proposedAt: Date,
  ...
}

// knowledge_teams - Team metadata (from _team.yaml)
{
  _id: ObjectId,
  path: string,                    // "engineering/backend"
  name: string,
  department: string,
  permissions: { read, propose, approve, auto_approve },
  agentRoles: string[],
  ...
}
```

---

## 4. Unified Persistence Configuration

```typescript
// src/worker/memory/persistence/PersistenceConfig.ts

interface PersistenceConfig {
  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT-INTERNAL STORAGE (SQLite only - no external dependencies)
  // ═══════════════════════════════════════════════════════════════════════════
  
  sqlite: {
    basePath: string;           // Default: 'data/checkpoints/'
    // Creates:
    //   - tasks.db          (TaskCheckpointer - task orchestration)
    //   - agent-state.db    (LangGraph SqliteSaver - conversation history)
  };
  
  // Markdown memory (Clawdbot-inspired)
  markdownMemory: {
    workspacePath: string;     // Per-agent workspace root
    indexDbPath: string;       // Default: 'data/memory-index/chunks.db' (DISPOSABLE)
    embedModel: string;        // Default: 'text-embedding-3-small'
    embedDims: number;         // Default: 1536
    chunkSize: number;         // Default: 400 tokens
    chunkOverlap: number;      // Default: 80 tokens
  };
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SERVICE-LEVEL STORAGE (MongoDB + Git - shared, persistent)
  // ═══════════════════════════════════════════════════════════════════════════
  
  // L2: Team collaboration & artifacts
  mongodb: {
    uri: string;                // MONGODB_URI env
    database: string;           // Default: 'ping'
    // Collections:
    //   - collab_docs       (Yjs CRDT documents)
    //   - artifacts.files   (GridFS - large files)
    //   - artifacts.chunks  (GridFS chunks)
  };
  
  // L3: Organizational knowledge
  knowledge: {
    gitRepo: string;            // Git repo URL or local path
    gitBranch: string;          // Default: 'main'
    syncOnStartup: boolean;     // Sync MongoDB from Git on start
    webhookSecret?: string;     // For Git webhook validation
    // MongoDB Collections:
    //   - knowledge_docs       (Parsed docs with embeddings)
    //   - knowledge_proposals  (Pending approval queue)
    //   - knowledge_teams      (Team metadata from _team.yaml)
  };
}
```

### Storage by Layer & Boundary

| Layer | Boundary | Primary Storage | Secondary | Purpose |
|-------|----------|-----------------|-----------|---------|
| **L1: Task Orchestration** | Agent | SQLite (tasks.db) | - | Crash recovery |
| **L1: Agent Conversation** | Agent | SQLite (agent-state.db) | - | Resume from checkpoint |
| **L1: Agent Long-term Memory** | Agent | SQLite (agent-memory.db) | - | Facts, decisions, patterns |
| **L2: Collaboration** | Service | MongoDB | GridFS | Real-time shared docs |
| **L3: Org Knowledge** | Service | **Git** (source) | **MongoDB** (retrieval) | Team docs, RAG |

### Environment Variables

```bash
# ═══════════════════════════════════════════════════════════════════════════
# AGENT-INTERNAL (SQLite - embedded, no setup needed)
# ═══════════════════════════════════════════════════════════════════════════

# Optional - defaults to data/checkpoints/
SQLITE_PATH=data/checkpoints/

# ═══════════════════════════════════════════════════════════════════════════
# SERVICE-LEVEL (MongoDB + Git - requires setup)
# ═══════════════════════════════════════════════════════════════════════════

# Required for L2/L3
MONGODB_URI=mongodb://localhost:27017
MONGODB_DATABASE=ping

# L3 Knowledge (optional - defaults to local)
KNOWLEDGE_GIT_REPO=./knowledge    # Local path or git@github.com:org/knowledge.git
KNOWLEDGE_GIT_BRANCH=main
KNOWLEDGE_WEBHOOK_SECRET=xxx      # For GitHub/GitLab webhook
```

### Local Development

```bash
# ═══════════════════════════════════════════════════════════════════════════
# AGENT-ONLY MODE (no MongoDB required for basic agent operation)
# ═══════════════════════════════════════════════════════════════════════════

# Just run! SQLite is embedded, creates files automatically
npm run dev

# Agent will:
# ✅ Run tasks (TaskCheckpointer in SQLite)
# ✅ Remember conversations (SqliteSaver in SQLite)  
# ✅ Learn facts long-term (MarkdownMemoryEngine: markdown files + SQLite index)
# ❌ No L2 collaboration (requires MongoDB)
# ❌ No L3 org knowledge (requires MongoDB + Git)

# ═══════════════════════════════════════════════════════════════════════════
# FULL MODE (with L2/L3 features)
# ═══════════════════════════════════════════════════════════════════════════

# Start MongoDB
docker run -d -p 27017:27017 mongo

# Create local knowledge repo (first time)
mkdir -p knowledge
cd knowledge && git init

npm run dev
```

### Production Setup

```bash
# ═══════════════════════════════════════════════════════════════════════════
# Agent workers (SQLite only - scales horizontally)
# ═══════════════════════════════════════════════════════════════════════════

# Each worker has its own SQLite files
SQLITE_PATH=/data/worker-${WORKER_ID}/checkpoints/

# ═══════════════════════════════════════════════════════════════════════════
# Service layer (MongoDB + Git - shared state)
# ═══════════════════════════════════════════════════════════════════════════

# MongoDB Atlas or self-hosted
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/ping

# Knowledge in Git repo (GitHub/GitLab)
KNOWLEDGE_GIT_REPO=git@github.com:your-org/knowledge.git
KNOWLEDGE_GIT_BRANCH=main
KNOWLEDGE_WEBHOOK_SECRET=your-webhook-secret
```

---

## 5. Startup & Recovery Sequence

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     SERVER STARTUP SEQUENCE                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  1. INITIALIZE AGENT-INTERNAL STORES                                     │
│     ├── TaskCheckpointer:      data/checkpoints/tasks.db                │
│     ├── LangGraph Saver:       data/checkpoints/agent-state.db          │
│     └── MarkdownMemoryEngine:  workspace/MEMORY.md + memory/*.md        │
│         └── Index:             data/memory-index/chunks.db (disposable) │
│                                                                           │
│  2. CHECK FOR RECOVERY                                                    │
│     ├── TaskCheckpointer: Query unfinished tasks                        │
│     ├── MarkdownMemoryEngine: Start file watcher, index markdown files  │
│     ├── If index missing/corrupt: rebuildIndex() from markdown          │
│     ├── If unfinished tasks exist: restore to MemoryManager             │
│     └── If none: fresh start                                             │
│                                                                           │
│  3. INITIALIZE SERVICE-LEVEL STORES (if enabled)                         │
│     ├── MongoDB: Connect to MONGODB_URI                                  │
│     ├── CollabStore: Initialize Yjs/Hocuspocus                          │
│     └── KnowledgeStore: Sync from Git (if syncOnStartup=true)           │
│                                                                           │
│  4. READY                                                                 │
│     └── Emit 'ready' event                                               │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Graceful Shutdown

```typescript
// In AgentManager or main entry point
process.on('SIGTERM', async () => {
  logger.info('Graceful shutdown initiated');
  
  // 1. Stop accepting new tasks
  agentManager.stopAcceptingTasks();
  
  // 2. Wait for in-progress tasks (with timeout)
  await agentManager.waitForCompletion({ timeoutMs: 30000 });
  
  // 3. Final checkpoint
  await memoryCoordinator.checkpoint();
  
  // 4. Sync CRDT documents to MongoDB
  await memoryCoordinator.collab?.syncAll();
  
  // 5. Close connections
  await memoryCoordinator.close();
  
  logger.info('Graceful shutdown complete');
  process.exit(0);
});
```

---

## 7. Implementation Priority

| Phase | Component | Effort | Value |
|-------|-----------|--------|-------|
| **Phase 1** | TaskCheckpointer (SQLite) | 1 day | High - enables recovery |
| **Phase 2** | MarkdownMemoryEngine | 1.5 days | High - agent long-term memory |
| **Phase 2** | Memory tools (memory_search, memory_get) | 0.5 day | High - agents use memory |
| **Phase 3** | CollabStore (MongoDB schemas) | 1 day | High - artifact + doc persistence |
| **Phase 4** | Hocuspocus server setup | 0.5 day | High - real-time collab |
| **Phase 5** | KnowledgeStore + Git sync | 2 days | High - org docs system |
| **Phase 6** | Graduation flow (L2→L3) | 1 day | Medium - knowledge promotion |
| **Phase 7** | RAG context injection | 1 day | High - agent uses org knowledge |

**Total: ~7.5 days** for full memory system

---

## 8. Testing Strategy

### Unit Tests
- `TaskCheckpointer.test.ts` - Save/restore cycle + LangGraph integration
- `MarkdownMemoryEngine.test.ts` - Chunking, indexing, hybrid search, file watcher
- `CollabStore.test.ts` - CRUD operations
- `KnowledgeStore.test.ts` - Proposal workflow, Git sync
- `ObjectStorageAdapter.test.ts` - File operations

### Integration Tests
- Full recovery simulation (crash + restart)
- Agent resume from LangGraph checkpoint
- MarkdownMemoryEngine: write markdown → watcher indexes → search finds it
- MarkdownMemoryEngine: delete index → rebuildIndex() restores from markdown
- Hybrid search accuracy (vector vs keyword vs combined)
- Embedding cache hit rate (unchanged chunks not re-embedded)
- Multi-agent workspace isolation (separate memory engines)
- Time travel / debugging failed tasks
- Multi-agent artifact storage
- CRDT sync after restart
- L2 → L3 graduation flow
- Git ↔ MongoDB sync consistency

### Failure Scenarios
1. MongoDB connection lost during operation
2. Disk full during checkpoint
3. Corrupt checkpoint file
4. Agent crashes mid-execution (checkpoint should preserve state)
5. Git push conflict during doc approval
6. Webhook delivery failure
7. SQLite index corrupted → rebuildIndex() from markdown (no data loss)
8. Embedding service unavailable → keyword-only search (FTS5 fallback)

---

## Dependencies

```json
{
  "dependencies": {
    "mongoose": "^8.x",                           // Already present
    "better-sqlite3": "^11.x",                    // Embedded SQLite (fast, synchronous)
    "sqlite-vec": "^0.x",                         // Vector similarity search extension
    "@langchain/langgraph-checkpoint-sqlite": "^0.x",  // LangGraph SQLite checkpointer
    "@langchain/langgraph": "^0.x",               // LangGraph agent framework
    "chokidar": "^4.x",                           // File watcher for markdown indexing
    "@hocuspocus/server": "^2.x",                 // Yjs collaboration backend
    "@hocuspocus/extension-database": "^2.x",     // MongoDB persistence hook
    "@hocuspocus/provider": "^2.x",               // Client for agents
    "yjs": "^13.x",                               // CRDT library
    "simple-git": "^3.x",                         // Git operations for L3
    "gray-matter": "^4.x"                         // Parse YAML frontmatter in MD
  }
}
```

**Key dependencies:**
- `better-sqlite3` — Fast embedded SQLite (task checkpointing, memory index)
- `sqlite-vec` — Vector similarity search extension for SQLite (semantic search)
- `chokidar` — File system watcher (triggers re-indexing when markdown changes)
- `@langchain/langgraph` — Agent framework with checkpointer
- `mongoose` — MongoDB for service-level storage (L2/L3)
- `simple-git` — Git operations for L3 knowledge management
- `gray-matter` — Parse markdown frontmatter (metadata in docs)

**Built-in (no dep needed):**
- FTS5 — Full-text search, built into SQLite (keyword/BM25 search)

**Removed:** `@aws-sdk/client-s3`, `minio`, `@langchain/langgraph-checkpoint-postgres` — not needed

---

## Summary: Memory Architecture

| Layer | What | Boundary | Storage | Key Technology |
|-------|------|----------|---------|----------------|
| **L1: Task Orchestration** | Task state, dependencies | Agent | SQLite | TaskCheckpointer |
| **L1: Agent Conversation** | Messages, tool calls | Agent | SQLite | LangGraph SqliteSaver |
| **L1: Agent Long-term** | Facts, decisions, patterns | Agent | Markdown + SQLite index | MarkdownMemoryEngine |
| **L2: Team Memory** | Shared docs, artifacts | Service | MongoDB + GridFS | Hocuspocus + Yjs |
| **L3: Org Knowledge** | Team docs, skills, runbooks | Service | **Git** + MongoDB | Dual storage + RAG |

### Storage Boundary Principle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  AGENT-INTERNAL (Markdown + SQLite)        SERVICE-LEVEL (MongoDB + Git)    │
│  ═══════════════════════════════════      ═══════════════════════════════  │
│  • Zero external dependencies              • Requires MongoDB               │
│  • Markdown is human-readable              • Shared across agents           │
│  • SQLite index is disposable              • Durable, scalable              │
│  • Each agent has own workspace            • Single source of truth         │
│                                                                              │
│  Files:                                    Collections: ping.collab_*,      │
│    workspace/MEMORY.md (long-term)           ping.knowledge_*, etc.         │
│    workspace/memory/*.md (daily logs)      Git: knowledge/ repo             │
│    data/checkpoints/tasks.db                                                │
│    data/checkpoints/agent-state.db                                          │
│    data/memory-index/chunks.db (disposable)                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### L3 Summary: Organizational Documentation System

| Aspect | Decision |
|--------|----------|
| **Hierarchy** | Team-based (mirrors org structure) |
| **Primary creators** | Agents (learn & propose) |
| **Storage** | Git (source of truth) + MongoDB (fast retrieval + RAG) |
| **Review workflow** | Agents suggest → Humans approve (auto-approve optional) |
| **Graduation** | L2 artifacts → Propose → Review → Commit to Git → Sync to Mongo |

```
Knowledge Creation Flow:
═══════════════════════

Agent learns       →   Proposes doc    →   Human reviews   →   Git commit
from task               to L3               (or auto-approve)    + MongoDB sync
                                                                      │
                                                                      ▼
                                                            Available for future
                                                            agents via RAG
```

**Key insight:** Documents TEACH, agents LEARN. L3 is how your organization's knowledge compounds over time — every task can contribute learnings that help future tasks.

---

## Next Steps

1. ✅ Document persistence strategy (this file)
2. ✅ Research LangGraph + ChatGPT + Clawdbot memory approaches
3. `npm install @langchain/langgraph-checkpoint-sqlite better-sqlite3 sqlite-vec chokidar`
4. Create `MarkdownMemoryEngine.ts` (Clawdbot-inspired markdown + hybrid search)
5. Create `TaskCheckpointer.ts` (our task metadata + LangGraph integration)
6. Create memory tools: `memory_search`, `memory_get` (LangGraph tools)
7. Update `AgentWorker.ts` to use checkpointer + memory engine when creating agents
8. Set up per-agent workspace directories with `MEMORY.md` and `memory/` folder
9. Create `CollabStore.ts` with GridFS support
10. Wire into `MemoryCoordinator`
11. Add recovery flow to `AgentManager.initializeOrchestrator()`
