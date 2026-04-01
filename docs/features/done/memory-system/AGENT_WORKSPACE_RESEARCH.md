# Agent Workspace Research: Scratchpad, Tooling, and Visibility

> **Purpose:** Research how production agent systems handle private scratchpads vs. committed work, tool environments, self-awareness, and multi-stakeholder visibility.  
> **Context:** L1 workspace is working. Now we need to separate "thinking space" from "deliverable space" and give agents real tool environments.  
> **Date:** February 2026

---

## Table of Contents

1. [The Problem (What's Missing)](#1-the-problem)
2. [How Others Do It](#2-how-others-do-it)
3. [Proposed Model: 4-Zone Agent Environment](#3-proposed-model)
4. [Zone 1: Scratchpad (Private Thinking)](#4-zone-1-scratchpad)
5. [Zone 2: Git Workspace (Deliverables)](#5-zone-2-git-workspace)
6. [**Workspace Navigation: How Agents Search & Understand Their Files**](#6-workspace-navigation)
7. [Zone 3: Toolbelt (External Capabilities)](#7-zone-3-toolbelt)
8. [Zone 4: Agent Identity Card (Self-Awareness)](#8-zone-4-agent-identity-card)
9. [Multi-Stakeholder Visibility Model](#9-multi-stakeholder-visibility)
10. [How This Maps to Current L1 Architecture](#10-mapping-to-l1)
11. [Recommendations](#11-recommendations)
12. [Should We Migrate to Mastra?](#12-should-we-migrate-to-mastra)
13. [**Library & Reference Code Analysis**](#13-library--reference-code-analysis)

---

## 1. The Problem

### Current State (L1 Working)
The current workspace = flat Git branch. Everything the agent writes is version-controlled. This creates problems:

| Problem | Why It Matters |
|---------|---------------|
| **No private thinking space** | Agent's rough drafts, failed attempts, internal notes all get committed |
| **No tool environment** | Agent can't invoke git CLI, Claude CLI, MCP servers, external APIs in a structured way |
| **No self-awareness** | Agent doesn't know what tools it has, what it already produced, what context is loaded |
| **No audience separation** | Manager sees same raw view as the agent; other teams can't get a summary without reading everything |

### What We Actually Need
Think of it from an LLM agent's POV — "I'm an agent, what do I need to do my job?"

```
┌─────────────────────────────────────────────────────────────────────────┐
│  What an Agent Needs (Like a Human Employee)                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. SCRATCHPAD (My Notepad)                                              │
│     - Research notes, investigation logs, decision reasoning             │
│     - Trial scripts, small experiments ("does this API work?")           │
│     - TODOs, bookmarks, "remember this for later"                        │
│     - NEVER committed to team repo                                       │
│                                                                          │
│  2. WORKSPACE (My Deliverables Folder)                                   │
│     - Files I want to commit and share                                   │
│     - Code, docs, reports — actual work product                          │
│     - Git-tracked, reviewable, mergeable                                 │
│                                                                          │
│  3. TOOLBELT (My Software & Access)                                      │
│     - Git CLI for code repos                                             │
│     - Claude CLI / Codegen for complex coding                            │
│     - MCP servers (filesystem, database, APIs)                           │
│     - Web search, email, Slack                                           │
│     - "What tools do I have access to?"                                  │
│                                                                          │
│  4. IDENTITY CARD (Who Am I, What Do I Know)                             │
│     - My role, skills, current task                                      │
│     - What context I've loaded                                           │
│     - What I've already produced                                         │
│     - What tools are available to me                                     │
│     - "Show me my capabilities"                                          │
│                                                                          │
│  5. REPORTING (Who Needs to Know What)                                   │
│     - My manager needs: progress, blockers, decisions                    │
│     - My team needs: deliverables, shared context                        │
│     - Other teams need: summaries, APIs, interfaces                      │
│     - Humans need: plain-language status, approval requests              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. How Others Do It

### A. OpenAI Codex (Agent Sandboxes)

**Model:** Every task spins up an isolated cloud sandbox (container).

```
Codex Agent Sandbox:
├── /workspace/           # Cloned repo — agent works here
├── /tmp/                 # Agent's scratch space (not committed)
├── Internet access       # Controlled — can use approved tools
└── Terminal              # Full shell — git, npm, python, etc.
```

**Key Insights:**
- **Separation is physical**: scratch space = `/tmp/`, work = `/workspace/`
- Agent has full terminal access — it runs real `git commit`, `npm test`, etc.
- Output = a git patch/PR, not the entire sandbox
- Human sees: PR diff + test results + summary, NOT the scratch space

### B. Devin (Cognition)

**Model:** Persistent, session-based workspace with its own shell, browser, editor.

```
Devin Environment:
├── Shell (terminal)       # Can run any command
├── Browser               # Can search the web, read docs
├── Editor                # Can edit files with syntax awareness
├── Planner (internal)    # Private planning — user sees only summaries
└── Git                   # Commits when ready, not every file write
```

**Key Insights:**
- **Planner is private** — Devin's internal reasoning/planning is NOT shown to the user as raw output
- User sees a **timeline of actions** (searched web, edited file, ran test) not the thinking
- Devin decides when to commit — accumulates changes then makes semantic commits
- Has a dedicated "thought" stream vs "action" stream vs "output" stream

### C. SWE-Agent (Princeton)

**Model:** Custom shell environment with specialized commands.

```
SWE-Agent Environment:
├── Codebase (cloned)
├── Custom commands: find_file, open_file, edit_file, scroll_up/down
├── Observation window (limited view of current state)
└── Scratchpad (agent tracks what it's tried, what worked)
```

**Key Insights:**
- Agent explicitly maintains a **scratchpad** of "things I've tried" to avoid loops
- Observation is windowed — agent sees a limited viewport, not everything
- The scratchpad is part of the agent's system prompt context, not stored to disk

### D. AutoGPT / BabyAGI

**Model:** Memory + workspace as separate concepts.

```
AutoGPT:
├── long_term_memory/    # Vector store (pinecone/chroma)
├── workspace/           # File operations
├── tools/               # Configured tool list
└── thoughts/            # Logged but not persistent
```

**Key Insights:**
- Clear split between "memory" (retrieval) and "workspace" (files)
- Tool list is explicit and introspectable — agent can ask "what tools do I have?"
- "Thoughts" are ephemeral — used for chain-of-thought, then discarded

### E. Claude Code (Anthropic)

**Model:** Terminal-native agent that works in the user's actual environment.

```
Claude Code:
├── User's file system     # Reads/writes real files
├── Terminal               # Runs real commands (git, npm, etc.)
├── No separate scratch    # Everything is in-context (conversation memory)
├── Permission system      # Asks before destructive operations
└── Tool use              # MCP servers, file I/O, bash
```

**Key Insights:**
- **Scratch is the conversation context itself** — once the conversation ends, scratch is gone
- Everything that matters gets written to files (committed to FS)
- Agent's "identity" is its system prompt + loaded context
- Tool discovery via MCP — agent can introspect what servers/tools are available

### F. LangGraph Platform

**Model:** Checkpointed state machine with thread-level persistence.

```
LangGraph Agent:
├── State (JSON)          # Checkpointed after each node
├── Memory (thread-level) # Conversation history
├── Tools (configured)    # Declared at graph creation
└── Human-in-the-loop     # Interrupt nodes for approval
```

**Key Insights:**
- State is the scratchpad — it persists across steps but is agent-internal
- "Store" is separate — for cross-thread shared state
- Tools are static (declared at graph build time), not dynamic

### G. CrewAI

**Model:** Role-based agents with explicit tool assignments and crew-level visibility.

```
CrewAI Agent:
├── Role + Goal + Backstory   # Agent identity
├── Tools                     # Explicit list bound at creation
├── Memory (short/long/entity) # Tiered memory
├── Delegations               # Can delegate to other agents
└── Task Output               # Structured result format
```

**Key Insights:**
- Agent identity is a first-class concept (role + goal + backstory)
- Tools are bound per-agent, not global
- **Crew-level**: manager agent can see all agents' outputs, individual agents see only delegations
- Output format is structured — raw is for the agent, summary is for the crew

### H. Mastra (Workspace System)

**Model:** Framework-level workspace abstraction with pluggable providers for filesystem, sandbox, search, and skills.

```
Mastra Workspace:
├── Filesystem (pluggable)     # LocalFilesystem, S3, GCS — read/write/list/delete/stat
├── Sandbox (pluggable)        # LocalSandbox or E2B cloud — command execution
├── Search (built-in)          # BM25 keyword + vector semantic + hybrid mode
├── Skills (reusable)          # SKILL.md + references/ + scripts/ — open spec
├── Mounts (composite)         # Route paths to different storage providers
└── Tool configuration         # Per-tool enable/disable, requireApproval, requireReadBeforeWrite
```

**Key Insights:**
- **Search is first-class** — not an afterthought. Three modes: BM25 (keyword), vector (semantic), hybrid (both with configurable weighting). Auto-indexes directories on `init()`
- **`requireReadBeforeWrite`** — smart safety mechanism: agent must `read_file` before it can `write_file` to an existing file. Prevents overwriting files the agent hasn't seen. *We didn't think of this*
- **Skills** — reusable instruction packages following [agentskills.io](https://agentskills.io/) open spec. A skill = `SKILL.md` + `references/` + `scripts/`. Skills are auto-indexed for search. This is like a structured version of our identity card's "loaded context"
- **Pluggable providers** — filesystem can be local, S3, or GCS. Sandbox can be local or E2B cloud. Clean abstraction layer
- **Mounts** — FUSE-mount cloud storage into sandboxes so shell commands can access cloud files at local paths. Multiple providers at different mount points
- **No git integration** — no branches, no commits, no clone, no PR workflow. Files are just files
- **No scratchpad** — no distinction between private thinking and deliverables. Everything the agent writes is visible
- **No agent identity/self-awareness** — no "what have I done" or "what tools do I have" introspection
- **No multi-stakeholder visibility** — no audience-specific views

**BM25 Search (we missed this):**
```typescript
// BM25 is a keyword scoring algorithm — better than naive grep for relevance ranking
// Considers: term frequency, document length normalization, inverse document frequency
// Works without embeddings — just needs tokenization

const workspace = new Workspace({
  filesystem: new LocalFilesystem({ basePath: './workspace' }),
  bm25: { k1: 1.5, b: 0.75 },  // Tunable parameters
});

// Hybrid: combine BM25 + vector with configurable weighting
const results = await workspace.search('authentication flow', {
  mode: 'hybrid',
  vectorWeight: 0.5,  // 0 = all BM25, 1 = all vector
  topK: 10,
  minScore: 0.5,
});

// Result includes score breakdown
// { id, content, score, lineRange?, metadata?, scoreDetails: { vector?, bm25? } }
```

### Comparison: Mastra Workspace vs. Our Research

| Capability | Mastra | Our Research | Verdict |
|-----------|--------|-------------|---------|
| **File ops** (read/write/list/delete) | ✅ Clean API, pluggable providers (S3, GCS, Local) | ✅ Via AgentWorkspace — local only | Mastra better (cloud support) |
| **Containment** (path traversal prevention) | ✅ `contained: true` default, read-only mode | ✅ `sanitizePath()` exists | Similar |
| **Search: keyword** | ✅ BM25 with tunable parameters | ⚡ grep/ripgrep (faster, no index needed) | Different tradeoffs — both useful |
| **Search: semantic** | ✅ Vector search with any embedding model | ✅ Proposed in Layer 4 (same approach) | Similar design |
| **Search: hybrid** | ✅ BM25 + vector with configurable weighting | ✅ Added: Layer 2.5 BM25 + hybrid search | Similar — adopted from Mastra |
| **Auto-indexing** | ✅ `autoIndexPaths` on init | ✅ Added: `indexWorkspace()` on init, debounced re-index | Similar — adopted from Mastra |
| **Sandbox** (command execution) | ✅ Local + E2B cloud, isolation, timeouts | ✅ Proposed in Zone 3 toolbelt (CLI tier) | Similar concept, Mastra more polished |
| **Skills** (reusable instructions) | ✅ Open spec, indexed for search | 🟡 Partially in identity card | Mastra has a cleaner model |
| **requireReadBeforeWrite** | ✅ Built-in safety | ✅ Added: `SafeAgentWorkspace` with read tracking | Similar — adopted from Mastra |
| **Git integration** | ❌ None | ✅ Full: clone, branch, commit, merge, PR | **We're way ahead** |
| **Scratchpad** (private thinking) | ❌ None | ✅ Research, trials, experiments (gitignored) | **We're ahead** |
| **Workspace modes** (repo/no-repo) | ❌ Just a basePath | ✅ Two paths: clone repo or basic workspace | **We're ahead** |
| **Code navigation** (repo map, AST) | ❌ None | ✅ Tree-sitter, repo map, LSP research | **We're way ahead** |
| **Agent identity** (self-awareness) | ❌ None | ✅ Identity card with capabilities, progress | **We're ahead** |
| **Multi-stakeholder visibility** | ❌ None | ✅ Audience-specific views | **We're ahead** |
| **Cloud storage** | ✅ S3, GCS, E2B, mounts | ❌ Local only | Mastra better |
| **Navigation layers** (universal vs code) | ❌ Flat search only | ✅ 5 graduated layers | **We're ahead** |

**Bottom line:**
- Mastra has a **clean, production-ready API** for the basics: file ops + search + sandbox + skills. Good provider abstraction (S3/GCS/E2B). Well-designed safety features (`requireReadBeforeWrite`).
- Our research covers **much more ground**: git workflows, scratchpad, workspace modes, code-specific navigation (tree-sitter/LSP), agent self-awareness, multi-stakeholder visibility, layered navigation. These are the hard problems Mastra doesn't address.
- **What we should steal from Mastra:**
  1. **BM25 as a search mode** — better than raw grep for relevance-ranked results, still keyword-based (no embeddings needed). Sits between grep and semantic search.
  2. **`requireReadBeforeWrite`** — simple safety mechanism. Add to our workspace tool config.
  3. **Auto-indexing on init** — when workspace initializes, auto-index specified directories.
  4. **Skills concept** — reusable instruction packages. Could complement our identity card.
  5. **Cloud provider abstraction** — if we ever need S3/GCS workspace backends.

---

## 3. Proposed Model: 4-Zone Agent Environment

Based on the research, here's a model that fits Ping's architecture:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     AGENT ENVIRONMENT (Per Task)                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────┐      │
│  │  ZONE 1: SCRATCHPAD (Private, Ephemeral)                      │      │
│  │  • NOT git-tracked                                            │      │
│  │  • Research notes, investigation logs, decision reasoning     │      │
│  │  • Trial scripts, small experiments, schema checks            │      │
│  │  • TODOs, bookmarks, "remember this" notes                    │      │
│  │  • Deleted after task completes (or archived if debug mode)   │      │
│  │                                                               │      │
│  │  Storage: .scratch/ directory (gitignored) or in-memory       │      │
│  └───────────────────────────────────────────────────────────────┘      │
│                          │ agent decides what's ready                    │
│                          ▼                                               │
│  ┌───────────────────────────────────────────────────────────────┐      │
│  │  ZONE 2: WORKSPACE (Committable Deliverables)                 │      │
│  │  • Git-tracked on task branch                                 │      │
│  │  • Code, docs, reports — actual output                        │      │
│  │  • Agent makes semantic commits ("Implement auth handler")    │      │
│  │  • Publishes to L2 on task completion                         │      │
│  │  • Reviewable by humans / manager agent                       │      │
│  │                                                               │      │
│  │  Storage: artifacts/ directory (existing L1 workspace)        │      │
│  └───────────────────────────────────────────────────────────────┘      │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────┐      │
│  │  ZONE 3: TOOLBELT (External Capabilities)                     │      │
│  │  • MCP servers (filesystem, database, API, etc.)              │      │
│  │  • Git CLI (clone external repos, create PRs)                 │      │
│  │  • Code generation (Claude CLI, local model)                  │      │
│  │  • Web browsing, search                                       │      │
│  │  • Custom tools per agent role                                │      │
│  │  • Introspectable: agent can query "what tools do I have?"    │      │
│  │                                                               │      │
│  │  Config: toolbelt.yaml per agent role + runtime tool registry │      │
│  └───────────────────────────────────────────────────────────────┘      │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────┐      │
│  │  ZONE 4: IDENTITY CARD (Self-Awareness)                       │      │
│  │  • Role, skills, current task, goal                           │      │
│  │  • Loaded context (which knowledge docs)                      │      │
│  │  • Current inventory (what files I've created)                │      │
│  │  • Tool manifest (what I can do)                              │      │
│  │  • Progress (what I've accomplished vs what remains)          │      │
│  │                                                               │      │
│  │  Storage: Injected into system prompt + queryable tool        │      │
│  └───────────────────────────────────────────────────────────────┘      │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Zone 1: Scratchpad (Private Thinking)

### What Goes Here

The scratchpad is for things that **aren't deliverables**. Code itself belongs in the workspace — the agent can iterate and fix it there (that's what git is for). The scratchpad is for the *meta-work* around the task.

| Content | Example | Why Not Git? |
|---------|---------|--------------|
| **Research notes** | "Found 3 approaches: A, B, C. A seems best because..." | Internal reasoning, not a deliverable |
| **Trial scripts** | `test-db-connection.ts` — quick script to verify DB access works | Throwaway experiment, not project code |
| **Investigation logs** | "Traced the bug: call chain is A→B→C, C fails when X is null" | Debugging notes, not for reviewers |
| **Small experiments** | `try-regex.ts` — testing whether a regex handles edge cases | Disposable — results matter, script doesn't |
| **Internal TODOs** | "TODO: check if the API supports pagination before implementing" | Agent's own planning |
| **Bookmarks** | "Remember: the auth config is at src/config/auth.ts" | Navigational aid |
| **Decision logs** | "Chose approach A over B because B requires a new dependency" | Reasoning behind choices |
| **Data exploration** | `check-schema.py` — script to print CSV headers and sample rows | Understanding data before writing the real pipeline |

### How It Works

```typescript
interface Scratchpad {
  // Simple key-value notes
  setNote(key: string, value: string): void;
  getNote(key: string): string | undefined;
  getAllNotes(): Record<string, string>;
  deleteNote(key: string): void;
  
  // Structured scratch files (NOT committed)
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  listFiles(): Promise<string[]>;
  
  // Internal TODO tracking
  addTodo(item: string, priority?: number): void;
  getTodos(): ScratchTodo[];
  completeTodo(id: string): void;
  
  // "Remember this for later" — injected into next LLM call
  remember(fact: string): void;
  getRemembered(): string[];
  
  // Lifecycle
  clear(): void;
  archive(): Promise<string>;  // For debugging — dump to archive
}

interface ScratchTodo {
  id: string;
  item: string;
  priority: number;
  done: boolean;
  createdAt: Date;
}
```

### Storage Options

| Option | Pros | Cons | When to Use |
|--------|------|------|-------------|
| **`.scratch/` directory (gitignored)** | Survives agent restart, inspectable | Disk I/O, needs cleanup | Default — most production systems use this |
| **In-memory Map** | Fast, auto-cleans on restart | Lost on crash | Quick tasks, no persistence needed |
| **LangGraph state** | Checkpointed, resumable | Bloats state, all in memory | When using LangGraph checkpointing already |
| **Temp file system (`/tmp/`)** | OS handles cleanup | Not portable | Containerized agents |

### Recommendation: `.scratch/` with gitignore

```
workspace-{taskId}/
├── .scratch/                    # ← NEW: gitignored, agent-private
│   ├── notes.json              # Key-value notes
│   ├── todos.json              # Internal TODOs
│   ├── remembered.json         # Facts to inject into context
│   ├── research/               # Research & investigation
│   │   ├── approaches.md       # "3 approaches I considered"
│   │   └── api-analysis.md     # "Traced the auth flow: A→B→C"
│   ├── trials/                 # Throwaway experiments
│   │   ├── test-db-conn.ts     # Quick script: "can I connect to the DB?"
│   │   ├── try-regex.ts        # "Does this regex handle unicode?"
│   │   └── check-schema.py     # Print CSV headers + sample rows
│   └── decisions.jsonl         # Why I chose approach A over B
├── .gitignore                   # Includes .scratch/
├── artifacts/                   # ← This is ZONE 2 (committed)
├── activity/
└── workspace.json
```

### How Agent Uses the Scratchpad

The key insight: **code goes straight to the workspace** (iterate there — that's what git is for). The scratchpad is for research, experiments, and reasoning that *support* the work but aren't the work itself.

```
Agent Thinking Process:
                                                         
1. Read task: "Implement JWT auth handler"               

2. Research (scratchpad):                                
   scratch.remember("Auth config at src/config/auth.ts")  
   scratch.writeFile("research/jwt-approaches.md",         
     "3 options: jose lib, jsonwebtoken, manual. jose is    
      maintained and has TypeScript types.")               

3. Trial script (scratchpad):                            
   scratch.writeFile("trials/test-jose.ts",               
     "import * as jose from 'jose'; ...verify works...")  
   // Run it → works → now confident in approach          

4. Write real code (workspace — directly):               
   workspace.createFile("src/auth/handler.ts", impl)      
   // Iterate here. Fix errors here. This IS the work.    
   workspace.commit("Implement JWT auth handler using jose")

5. Clean up:                                             
   scratch.clear()  // Trial scripts + research gone      
   // Workspace has the real code, committed              
```

---

## 5. Zone 2: Git Workspace (Deliverables)

This is the existing L1 workspace. Two key changes: **only deliberate output goes here**, and **the folder structure can come from the user**.

### Current vs. Proposed

| Aspect | Current L1 | Proposed |
|--------|-----------|----------|
| **What's tracked** | Everything agent writes | Only files agent explicitly promotes |
| **Commit timing** | After every file operation (auto) | Agent decides when to commit (semantic) |
| **Commit messages** | Generic ("WIP: file created") | Meaningful ("Implement JWT validation logic") |
| **Draft content** | Mixed with final output | Lives in scratchpad until ready |
| **Activity log** | In workspace | Stays in workspace (this is deliberate activity tracking) |
| **Folder structure** | Always `artifacts/code/docs/data/` | Adapts to project or user-provided layout |

### The Folder Structure Problem

**Current code** (`AgentWorkspace.initialize()`) always creates:

```
workspace-{taskId}/
├── artifacts/code/
├── artifacts/docs/
├── artifacts/data/
├── activity/
├── context/knowledge/
└── context/dependencies/
```

This is wrong for most real tasks:

| Task Type | What Agent Actually Needs | What We Create |
|-----------|--------------------------|----------------|
| "Fix bug in auth-service repo" | Clone of `auth-service/` with its `src/`, `test/`, `package.json` | Empty `artifacts/code/` — useless |
| "Write a Next.js app" | Standard Next.js layout: `app/`, `public/`, `components/` | `artifacts/code/` — doesn't match |
| "Create marketing report" | User's report template: `sections/`, `assets/`, `output/` | `artifacts/docs/` — too generic |
| "Update Terraform infra" | Clone of `infra/` with `modules/`, `environments/` | `artifacts/code/` — wrong structure |

### Proposed: Workspace Modes

The workspace should support **three modes** depending on what the task needs:

```typescript
type WorkspaceMode = 
  | 'greenfield'      // Agent creates from scratch (current behavior, improved)
  | 'clone'           // Clone an existing repo/folder, agent works in it
  | 'custom';         // User provides a folder structure template

interface WorkspaceInitOptions {
  mode: WorkspaceMode;
  
  // For 'greenfield' — optional user-defined structure
  structure?: WorkspaceStructure;
  
  // For 'clone' — source repo to clone
  cloneSource?: {
    repoUrl?: string;         // Git URL to clone
    localPath?: string;       // OR local folder to copy
    branch?: string;          // Branch to clone (default: main)
    sparse?: string[];        // Sparse checkout paths (clone only these dirs)
  };
  
  // For 'custom' — template definition
  template?: WorkspaceTemplate;
}
```

#### Mode 1: Greenfield (Improved Default)

Agent creates new work from scratch. Instead of hardcoded `artifacts/code/docs/data/`, the structure adapts:

```typescript
interface WorkspaceStructure {
  // User can define top-level directories
  directories?: string[];                // e.g., ['src', 'tests', 'docs']
  
  // OR use a preset
  preset?: 'generic' | 'node' | 'python' | 'report' | 'custom';
  
  // Files to create on init (templates)
  initFiles?: Record<string, string>;   // path → content
}

// Presets
const STRUCTURE_PRESETS: Record<string, WorkspaceStructure> = {
  generic: {
    directories: ['artifacts/code', 'artifacts/docs', 'artifacts/data'],  // Current behavior
  },
  node: {
    directories: ['src', 'tests', 'docs'],
    initFiles: {
      'package.json': '{ "name": "workspace", "version": "1.0.0" }',
      'tsconfig.json': '{ "compilerOptions": { "target": "ES2022" } }',
    },
  },
  python: {
    directories: ['src', 'tests', 'docs'],
    initFiles: {
      'requirements.txt': '',
      'setup.py': '',
    },
  },
  report: {
    directories: ['sections', 'assets', 'references', 'output'],
    initFiles: {
      'outline.md': '# Report Outline\n\n## Sections\n',
    },
  },
};
```

#### Mode 2: Clone (Work on Existing Code)

The most important mode for real development agents. Agent clones a user's repo and works inside its natural structure.

```typescript
// Example: "Fix bug in auth-service"
const workspace = await workspaceManager.createWorkspace(agentId, taskId, {
  mode: 'clone',
  cloneSource: {
    repoUrl: 'https://github.com/company/auth-service.git',
    branch: 'main',
  },
});

// Result:
// workspace-{taskId}/
// ├── .scratch/                    # Agent's private space (Zone 1)
// ├── .ping/                      # Ping metadata (replaces workspace.json at root)
// │   ├── workspace.json
// │   ├── activity.jsonl
// │   └── decisions.jsonl
// ├── src/                        # ← FROM THE CLONED REPO
// │   ├── auth/
// │   ├── middleware/
// │   └── config/
// ├── tests/
// ├── package.json
// └── README.md
```

**Key Design Decisions for Clone Mode:**

| Decision | Approach | Why |
|----------|----------|-----|
| **Where does Ping metadata go?** | `.ping/` directory (gitignored from target repo) | Don't pollute the cloned repo with our metadata |
| **What branch does agent work on?** | Creates `task-{taskId}` branch from cloned HEAD | Standard git workflow — PR-ready |
| **How does agent commit?** | Normal `git commit` in the repo structure | Commits are in the repo's native format |
| **What gets published to L2?** | The diff/patch between base and agent's branch | Not the entire repo — just the changes |
| **How to merge?** | Create PR upstream via git/GitHub MCP tool | Or merge locally if no remote |

```typescript
class AgentWorkspace {
  // New initialization for clone mode
  async initializeClone(source: CloneSource): Promise<void> {
    this._status = 'initializing';
    
    await this.gitManager.withLock(async () => {
      if (source.repoUrl) {
        // Clone external repo
        await this.gitManager.clone(source.repoUrl, this.basePath, {
          branch: source.branch,
          sparse: source.sparse,
        });
      } else if (source.localPath) {
        // Copy local folder
        await fs.promises.cp(source.localPath, this.basePath, { recursive: true });
        // Init git if not already a repo
        if (!await this.dirExists(path.join(this.basePath, '.git'))) {
          await this.gitManager.initRepo();
        }
      }
      
      // Create task branch
      await this.gitManager.createBranch(this.branchName);
      
      // Create .ping/ metadata directory (NOT tracked in target repo's git)
      const pingDir = path.join(this.basePath, '.ping');
      await fs.promises.mkdir(pingDir, { recursive: true });
      
      // Create .scratch/ (gitignored)
      await fs.promises.mkdir(path.join(this.basePath, '.scratch'), { recursive: true });
      
      // Add .ping/ and .scratch/ to .gitignore if not already there
      await this.ensureGitignore(['.ping/', '.scratch/']);
      
      // Write metadata
      await this.writeWorkspaceMetadata();  // Into .ping/workspace.json
      
      this._status = 'active';
    });
  }
  
  // Ensure entries in .gitignore
  private async ensureGitignore(entries: string[]): Promise<void> {
    const gitignorePath = path.join(this.basePath, '.gitignore');
    let content = '';
    try {
      content = await fs.promises.readFile(gitignorePath, 'utf-8');
    } catch { /* no existing .gitignore */ }
    
    const lines = content.split('\n');
    const toAdd = entries.filter(e => !lines.includes(e));
    
    if (toAdd.length > 0) {
      const newContent = content + (content.endsWith('\n') ? '' : '\n') +
        '# Ping agent workspace\n' + toAdd.join('\n') + '\n';
      await fs.promises.writeFile(gitignorePath, newContent, 'utf-8');
    }
  }
}
```

#### Mode 3: Custom Template

User provides a template definition — useful for teams with specific project structures:

```typescript
interface WorkspaceTemplate {
  name: string;
  description: string;
  
  // Directory structure
  directories: string[];
  
  // Template files (with variable substitution)
  files: Record<string, string>;
  
  // Variables that get replaced in template files
  variables?: Record<string, string>;
}

// Example: Company-specific API project template
const apiTemplate: WorkspaceTemplate = {
  name: 'company-api',
  description: 'Standard API service layout',
  directories: [
    'src/routes',
    'src/middleware',
    'src/models',
    'src/services',
    'tests/unit',
    'tests/integration',
    'docs/api',
    'scripts',
  ],
  files: {
    'src/index.ts': 'import express from "express";\n// ${PROJECT_NAME} API\n',
    'package.json': '{ "name": "${PROJECT_NAME}", "version": "0.1.0" }',
    'README.md': '# ${PROJECT_NAME}\n\n${PROJECT_DESCRIPTION}\n',
    '.env.example': 'PORT=3000\nDATABASE_URL=\n',
  },
  variables: {
    PROJECT_NAME: 'my-api',         // Overridden per task
    PROJECT_DESCRIPTION: '',
  },
};
```

Templates can be stored in L3 Knowledge Base and loaded by the orchestrator when creating workspaces.

### How Clone Mode Changes the Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│              WORKSPACE MODES COMPARISON                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  GREENFIELD (current, improved)     CLONE (new)                          │
│  ─────────────────────────────      ──────────────────────────────       │
│  workspace-{taskId}/                workspace-{taskId}/                   │
│  ├── .scratch/                      ├── .scratch/                         │
│  ├── .git/      ← our repo         ├── .git/      ← cloned repo         │
│  ├── artifacts/ ← our structure     ├── .ping/     ← our metadata        │
│  │   ├── code/                      │   ├── workspace.json                │
│  │   ├── docs/                      │   ├── activity.jsonl                │
│  │   └── data/                      │   └── decisions.jsonl               │
│  ├── activity/                      ├── src/       ← repo's structure    │
│  │   └── activity.jsonl             ├── tests/     ← repo's structure    │
│  ├── context/                       ├── package.json                      │
│  └── workspace.json                 └── README.md                        │
│                                                                          │
│  Agent creates new files            Agent edits existing files            │
│  Our folder structure               Repo's folder structure               │
│  Merge = our branch → main          Merge = PR to upstream                │
│  Output = full artifacts             Output = patch/diff                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Metadata Location: workspace.json vs .ping/

For **greenfield** mode, `workspace.json` at root is fine — it's our repo.

For **clone** mode, we can't put `workspace.json` at root — it would pollute the cloned repo. Instead:

```typescript
// Where to read/write metadata based on mode
private getMetadataDir(): string {
  if (this.mode === 'clone') {
    return path.join(this.basePath, '.ping');
  }
  // greenfield/custom: metadata at root
  return this.basePath;
}

private getMetadataPath(): string {
  return path.join(this.getMetadataDir(), 'workspace.json');
}

private getActivityPath(): string {
  if (this.mode === 'clone') {
    return path.join(this.basePath, '.ping', 'activity.jsonl');
  }
  return path.join(this.basePath, 'activity', 'activity.jsonl');
}
```

### File Operations: Path Handling

In **greenfield** mode, all paths are relative to workspace root. In **clone** mode, the agent works with the repo's actual paths:

```typescript
// Greenfield: "artifacts/code/handler.ts" 
// Clone: "src/auth/handler.ts" (actual repo path)

async createFile(relativePath: string, content: string): Promise<FileInfo> {
  this.assertActive();
  const safePath = this.sanitizePath(relativePath);
  
  // In clone mode, no restriction to 'artifacts/' prefix
  // Agent writes anywhere in the repo structure
  const fullPath = path.join(this.basePath, safePath);
  
  // Still prevent escape (../ etc.)
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, content, 'utf-8');
  
  // ...same as before
}
```

### Publish Behavior by Mode

| Mode | `publish()` Produces | What Goes to L2 |
|------|---------------------|-----------------|
| **Greenfield** | All files in `artifacts/` | Full files as artifacts |
| **Clone** | Diff between base branch and task branch | Patch/changeset + summary |
| **Custom** | All files in user-defined output dirs | Files from output directories |

```typescript
async publish(): Promise<Artifact[]> {
  if (this.mode === 'clone') {
    return this.publishCloneMode();
  }
  return this.publishGreenfieldMode();  // Current behavior
}

private async publishCloneMode(): Promise<Artifact[]> {
  // Get the diff between base and current branch
  const diff = await this.gitManager.getDiff(this.branchName, this.baseBranch);
  const changedFiles = await this.gitManager.getChangedFilesList(this.branchName, this.baseBranch);
  
  const artifacts: Artifact[] = [];
  
  // Each changed file becomes an artifact
  for (const file of changedFiles) {
    const content = await this.readFile(file.path);
    artifacts.push({
      id: `${this.id}-${file.path}`,
      taskId: this.taskId,
      agentId: this.agentId,
      path: file.path,
      content,
      category: this.inferCategory(file.path),
      changeType: file.status,  // 'added' | 'modified' | 'deleted'
    });
  }
  
  // Also include the full patch as a meta-artifact
  artifacts.push({
    id: `${this.id}-patch`,
    taskId: this.taskId,
    agentId: this.agentId,
    path: '_patch.diff',
    content: diff,
    category: 'other',
  });
  
  return artifacts;
}
```

### Semantic Commits

The agent should commit like a good developer:

```
Good: "Add JWT token validation with refresh logic"
Good: "Fix edge case in session timeout handling"
Good: "Add unit tests for auth handler"

Bad:  "WIP: created file"
Bad:  "auto-commit"
Bad:  "changes"
```

**Guide the agent via system prompt:**
> When your work is ready to share, commit to the workspace with a clear message describing WHAT you did and WHY. Group related changes into one commit.

### Scratchpad → Workspace: What Crosses the Line?

Most scratchpad content **stays in scratch and gets deleted**. Only specific outputs get promoted:

```
SCRATCHPAD (Zone 1)                    WORKSPACE (Zone 2)
                                       
research/approaches.md (internal)      
  ↓ agent extracts key decisions        
  ─────promote_to_workspace──────────→ docs/design-decisions.md (committed)
                                       (valuable for the team to know WHY)
                                       
trials/test-jose.ts (experiment)       
  ↓ STAYS IN SCRATCH — throwaway       
  ✗ not promoted                        src/auth/handler.ts (written directly)
                                       (code goes straight to workspace)
                                       
research/api-analysis.md              
  ↓ useful findings                    
  ─────promote_to_workspace──────────→ docs/api-integration-notes.md
```

**Key rule:** Code is written directly in the workspace. Only *documentation of reasoning* (decision logs, analysis) gets promoted if the team would benefit from it.

Tools for promotion (rare — most scratch content just gets deleted):

```typescript
const promoteToWorkspaceTool = {
  name: 'promote_to_workspace',
  description: 'Move a research/analysis file from scratchpad to workspace. ' +
    'Use for decision docs or findings that the team should see. ' +
    'NOT for code — write code directly in the workspace.',
  parameters: {
    scratchPath: { type: 'string', description: 'Path in .scratch/' },
    workspacePath: { type: 'string', description: 'Target path in workspace (e.g., docs/decisions.md)' },
    commitMessage: { type: 'string', description: 'Descriptive commit message' },
  },
};
```

### Priority for Implementation

| Priority | What | Effort |
|----------|------|--------|
| **P0** | Clone mode (most real tasks need this) | 2-3 days |
| **P1** | `.ping/` metadata separation | 1 day |
| **P1** | User-provided structure in greenfield | 1 day |
| **P2** | Template system | 2 days |
| **P2** | Patch-based publish for clone mode | 1 day |

---

## 6. Workspace Navigation: How Agents Search & Understand Their Files

### The Problem

Creating or cloning a workspace is only half the story. Once an agent has access to a workspace — whether it's a code repo, a documentation library, a data folder, or a config tree — it needs to **navigate, search, and understand** the contents. Our current `AgentWorkspace` only offers `listFiles()` and `readFile(path)` by exact path. There is no grep, no pattern search, no semantic understanding. The agent is essentially blind unless it already knows the exact file to open.

This is NOT just a coding agent problem. **Any agent** working with more than a handful of files needs navigation:

| Agent Role | Workspace Content | Navigation Need |
|-----------|-------------------|----------------|
| **Code developer** | Cloned repo (src/, tests/, config) | Find functions, trace dependencies, understand types |
| **Documentation writer** | 200+ markdown files across folders | Find where a topic is discussed, avoid duplication |
| **Data analyst** | CSV/JSON/Parquet files across directories | Find the right dataset, understand schemas |
| **DevOps engineer** | Terraform/K8s/Docker configs | Find which module defines a resource, trace variables |
| **Research agent** | Notes, PDFs, reference materials | Find relevant prior research, connect ideas |
| **Report writer** | Templates, sections, prior reports | Find relevant sections to reference or update |
| **QA/Testing agent** | Test files, fixtures, specs | Find existing test coverage, locate test utilities |

The real question is: **"I have a workspace with files. How do I find what I need?"** The answer applies universally. Code-specific tools (LSP, tree-sitter) are enhancements on top of the universal basics.

This section covers what we learned from studying production coding agents (Claude Code, Aider, SWE-Agent, Cursor) — their core navigation primitives are content-agnostic and apply to any workspace.

### How Production Agents Navigate Workspaces

These approaches were developed for coding agents but **Layers 1-2 and 4 work on any text-based workspace**. Layer 3 (AST) and Layer 5 (LSP) are code-specific enhancements.

#### Approach 1: Text Search (Grep/Ripgrep)

**Who uses it:** Claude Code, VS Code Copilot, Cursor, SWE-Agent, GitHub Copilot

The most fundamental navigation tool. Fast, works on **any content type**, no setup required.

```
Code agent: "Where is the authentication logic?"
  → grep -r "jwt\|token\|auth" --include="*.ts" src/
  → Finds: src/middleware/auth.ts, src/services/tokenService.ts

Docs agent: "Where do we discuss pricing?"
  → grep -r "pricing\|price\|cost" --include="*.md" docs/
  → Finds: docs/product/pricing.md, docs/features/billing/overview.md

DevOps agent: "Which config defines the database?"
  → grep -r "rds\|database\|postgres" --include="*.tf" modules/
  → Finds: modules/data/rds.tf, modules/shared/variables.tf
```

**Claude Code's implementation:**

| Tool | What It Does | Permission |
|------|-------------|-----------|
| **Grep** | Searches for regex patterns in file contents | Read-only |
| **Glob** | Finds files by name pattern (e.g., `**/*.test.ts`) | Read-only |
| **Read** | Reads file contents (with optional line range) | Read-only |

Claude Code bundles **ripgrep** (`rg`) as its search engine. Key env var: `USE_BUILTIN_RIPGREP=0` to use system `rg` instead.

**Why it works:** Text search doesn't need language understanding. It's O(n) over file content, cached by the OS. An agent searching for "handleLogin" will find every reference in milliseconds.

**Limitation:** Returns raw text matches. Agent must interpret context from surrounding lines. No understanding of whether a result is a definition, a call, or a comment.

#### Approach 2: File System Exploration (ls/find/glob)

**Who uses it:** Claude Code, SWE-Agent, Codex, all agents

Before searching content, agents need to understand the folder structure. This works identically for code, docs, data, or any file type.

```
Code agent: "What kind of project is this?"
  → ls → Sees: package.json, tsconfig.json, src/, tests/
  → "This is a Node.js TypeScript project"

Docs agent: "What topics are covered?"
  → ls docs/ → Sees: architecture/, features/, product/, developer-guide/
  → glob docs/**/*.md → 47 markdown files across these directories

Data agent: "What datasets are available?"
  → glob data/**/*.{csv,json,parquet}
  → Sees: data/sales/2025-q4.csv, data/users/active.json, data/reports/summary.parquet
```

**SWE-Agent's exploration tools:**

SWE-Agent organizes tools into **bundles** — each is a folder with executables:

| Tool Bundle | Commands | Purpose |
|-------------|----------|---------|
| **windowed** | `open <file>`, `scroll_down`, `scroll_up`, `goto <line>` | File viewer with paging (agent sees ~100 lines at a time) |
| **search** | `find_file <name>`, `search_dir <pattern>`, `search_file <pattern>` | Text search |
| **edit_anthropic** | `str_replace_editor` | Search-and-replace editing (with tree-sitter validation) |
| **filemap** | `filemap <file>` | Show file structure (skipping function bodies) |
| **submit** | `submit` | Submit the final patch |

SWE-Agent's **windowed file viewer** is clever — instead of dumping an entire file, it shows a "window" of ~100 lines at a time. The agent scrolls through it, maintaining a `CURRENT_FILE` and `CURRENT_LINE` state. This prevents context overflow.

**Codex/OpenAI:** Full shell access. Agent runs `find`, `ls -la`, `tree` — standard Unix tools. The working directory is a sandboxed clone of the repo.

#### Approach 3: AST/Tree-sitter (Structural Understanding) — Code-Specific

**Who uses it:** Aider (primary), SWE-Agent (for edit validation), Cursor (for indexing)

> ⚠️ **This is a code-specific enhancement.** For non-code workspaces, skip to Approach 4 (LSP) or Approach 5 (Semantic Search) which works on any content.

Instead of treating code as text, parse it into an Abstract Syntax Tree (AST) to extract *structure*: classes, functions, imports, type signatures.

**Aider's Repo Map (the gold standard for this approach):**

```
Aider uses tree-sitter to build a "repo map" — a compressed view of the 
entire codebase showing only class/function signatures:

src/auth/handler.ts:
⋮...
│export class AuthHandler:
│    constructor(private tokenService: TokenService)
⋮...
│    async validateToken(token: string): Promise<boolean>
⋮...
│    async refreshToken(refreshToken: string): Promise<TokenPair>
⋮...

src/middleware/auth.ts:
⋮...
│export function authMiddleware(req, res, next)
⋮...
│function extractBearerToken(header: string): string | null
⋮...
```

**How Aider's repo map works:**

1. **Parse everything:** Tree-sitter parses every file in the repo into ASTs
2. **Extract symbols:** Pull out class names, function names, method signatures, type definitions
3. **Build dependency graph:** Track which files reference which symbols (imports, calls)
4. **Rank by relevance:** Graph ranking algorithm (like PageRank) identifies the most-referenced symbols
5. **Budget tokens:** Default ~1K tokens for the map. Expands dynamically when the agent needs more context
6. **Include critical lines:** Show the *definition lines* — just enough to understand the API, not the implementation

**Why it matters:** The repo map lets the LLM understand the entire codebase architecture in ~1K tokens. Without it, the agent would need to read dozens of files (50K+ tokens) to get the same understanding. This is a **10-50x context compression**.

**Key insight from Aider:** The *most important symbols* are the most cross-referenced ones. A utility function called from 20 files is more important than a helper used once. The graph ranking algorithm surfaces exactly what the LLM needs.

```typescript
// What we'd need to implement this:
interface RepoMap {
  // Map of file → symbols with their signatures
  files: Map<string, SymbolEntry[]>;
  
  // Dependency graph (which file references which symbols)
  dependencies: Map<string, Set<string>>;  // file → set of referenced symbols
  
  // Ranked symbols (most important first)
  rankedSymbols: RankedSymbol[];
}

interface SymbolEntry {
  name: string;
  kind: 'class' | 'function' | 'method' | 'interface' | 'type' | 'variable' | 'export';
  signature: string;          // The definition line(s) — just enough to understand the API
  line: number;
  file: string;
  referenceCount: number;     // How many other files reference this symbol
}

interface RankedSymbol extends SymbolEntry {
  score: number;              // PageRank-style score
  referencedBy: string[];     // Files that use this symbol
}
```

**Language support:** Tree-sitter has parsers for ~100+ languages. For TypeScript: [`tree-sitter-typescript`](https://github.com/tree-sitter/tree-sitter-typescript).

#### Approach 4: LSP (Language Server Protocol) — Semantic Understanding

**Who uses it:** VS Code Copilot (this tool), Cursor, Claude Code (via code intelligence plugins), JetBrains AI

LSP provides **semantic** code intelligence — it understands types, definitions, references, diagnostics at the language level.

| LSP Capability | What It Gives the Agent | Example |
|----------------|------------------------|---------|
| `textDocument/definition` | Jump to where a symbol is defined | "Where is `AuthHandler` defined?" → `src/auth/handler.ts:15` |
| `textDocument/references` | Find all usages of a symbol | "Who calls `validateToken()`?" → 12 files |
| `workspace/symbol` | Search symbols across the workspace | "Find all classes matching `*Service`" |
| `textDocument/hover` | Get type info for any position | "What type is `user.roles`?" → `Role[]` |
| `textDocument/diagnostic` | Get type errors, lint warnings | After edit: "Error on line 42: Property 'tokn' does not exist" |
| `textDocument/completion` | Code completions | "What methods does `tokenService.` have?" |
| `callHierarchy/incoming` | What calls this function | Trace callers of `refreshToken` |
| `callHierarchy/outgoing` | What does this function call | Trace what `refreshToken` invokes |

**Claude Code's LSP integration:**

Claude Code recently added an `LSP` tool through its plugin system. From the docs:

> **LSP** — Code intelligence via language servers. Reports type errors and warnings automatically after file edits. Also supports navigation operations: jump to definitions, find references, get type info, list symbols, find implementations, trace call hierarchies. Requires a code intelligence plugin and its language server binary.

This is significant — Claude Code treats LSP as a **plugin** that adds tool capabilities. The agent gets automatic error feedback after edits plus on-demand navigation.

**VS Code Copilot** (what I am right now) has deep LSP integration:
- `list_code_usages` — Find all references to a symbol
- `semantic_search` — Language-aware search across the workspace
- `get_errors` — Get diagnostics (type errors, lint) for any file
- These work because VS Code runs the TypeScript language server (tsserver) in the background

**Key insight:** LSP requires a running language server (e.g., `tsserver` for TypeScript, `pyright` for Python). This means:
- ✅ Perfect for IDE-embedded agents (VS Code, Cursor, JetBrains)
- ⚠️ Harder for headless/terminal agents — must start and manage the language server process
- ⚠️ Startup cost: Language servers can take 5-30 seconds to index a large project
- ✅ Worth it for long-running agents that edit code repeatedly

#### Approach 5: Embedding-Based Semantic Search (RAG)

**Who uses it:** Cursor (primary differentiator), GitHub Copilot, Continue.dev

Instead of searching for exact text, search by *meaning*. "Find the code that validates user permissions" matches `checkAccess()` even though the words are completely different.

```
Agent thinks: "How does this project handle database migrations?"
  → semantic_search("database migration schema changes")
  → Returns:
    1. src/db/migrations/runner.ts (0.92 similarity)
    2. scripts/migrate.ts (0.87 similarity)
    3. docs/database-setup.md (0.84 similarity)
    4. src/db/schema.ts (0.81 similarity)
```

**How it works:**

1. **Index:** Split all files into chunks (functions, classes, or fixed-size blocks)
2. **Embed:** Convert each chunk to a vector using an embedding model (e.g., `text-embedding-3-small`)
3. **Store:** Save vectors in a vector store (in-memory, SQLite, or dedicated like Pinecone)
4. **Query:** Convert the agent's question to a vector, find nearest neighbors
5. **Return:** Top-K most similar code chunks with their file paths and line numbers

```typescript
interface WorkspaceIndex {
  // Build index for a workspace (any content type)
  indexWorkspace(rootDir: string, options?: IndexOptions): Promise<void>;
  
  // Search by meaning
  semanticSearch(query: string, topK?: number): Promise<SearchResult[]>;
  
  // Hybrid search (semantic + keyword)
  hybridSearch(query: string, topK?: number): Promise<SearchResult[]>;
  
  // Update index incrementally (after file changes)
  updateIndex(changedFiles: string[]): Promise<void>;
}

interface SearchResult {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
  symbolName?: string;    // If the chunk is a known symbol
}

interface IndexOptions {
  // What to index
  include?: string[];      // Glob patterns (e.g., ['src/**/*.ts'])
  exclude?: string[];      // Patterns to skip (e.g., ['node_modules/**'])
  
  // Chunking strategy
  chunkStrategy?: 'ast' | 'heading' | 'fixed' | 'hybrid';  // AST for code, heading for markdown, fixed for data
  maxChunkTokens?: number;  // Max tokens per chunk (default: 500)
  
  // Embedding
  embeddingModel?: string;  // Default: 'text-embedding-3-small'
  
  // Storage
  storageBackend?: 'memory' | 'sqlite' | 'pinecone';
}
```

**Cursor's approach:**
- Indexes entire codebase on project open
- Uses embeddings + AST for smart chunking (function-level chunks, not arbitrary line splits)
- Hybrid search: combines semantic similarity with keyword matching
- Re-indexes on file save (incremental)
- The index enables "@codebase" queries — agent can ask natural language questions about the code
- **For non-code content:** Same approach works — chunk markdown by headings, CSV by rows, JSON by top-level keys

**Pros:** Finds conceptually related content even when naming is different. Great for "how does X work?" questions. Works on **any text-based content** — code, docs, config, data.

**Cons:** Requires embedding model (cost + latency), index build time (can be minutes for large repos), index can go stale.

#### Approach 6: Repo Map + Compressed Context (Aider's Innovation)

This deserves special attention because it's the **most token-efficient** approach.

Instead of dumping full files or search results into context, Aider builds a compressed "map" of the repo showing just enough to navigate:

```
Traditional approach (expensive):
  "Read these 10 files" → 50,000 tokens → Agent understands the codebase

Aider approach (efficient):
  Repo map → 1,024 tokens → Agent understands the codebase structure
  Agent: "I need to see src/auth/handler.ts in detail"
  Read that one file → 2,000 tokens → Focused understanding
  
  Total: ~3,000 tokens vs 50,000 tokens (16x more efficient)
```

The map is **dynamic** — Aider adjusts it based on what the agent is working on. If the agent is editing `handler.ts`, the map emphasizes symbols that `handler.ts` imports from and exports to.

### Comparison Matrix: Navigation Approaches

| Approach | Speed | Setup | Any Content? | Code-Specific? | Token Cost | Best For |
|----------|-------|-------|-------------|---------------|------------|----------|
| **Text Search (grep/rg)** | ⚡ Instant | None | ✅ Yes | No | Low (just results) | Finding exact strings in any file type |
| **File System (ls/glob)** | ⚡ Instant | None | ✅ Yes | No | Low | Understanding folder structure |
| **AST/Tree-sitter** | 🔵 Fast (parse once) | Install parser | ❌ Code only | Yes | Very low (compressed map) | Code overview, API discovery, cross-file deps |
| **LSP** | 🟡 Medium (server startup) | Language server | ❌ Code only | Yes | Medium (per-query) | Type checking, go-to-definition, find references |
| **Semantic Search** | 🟡 Medium (embed time) | Embedding model + index | ✅ Yes | No | Higher (embeddings) | "How does X work?" — any content, by meaning |
| **Repo Map** | 🔵 Fast (cached) | Tree-sitter | ❌ Code only | Yes | Very low (~1K tokens) | Codebase overview with minimal context |

**Key insight:** The two approaches that work on **any content type** (grep + semantic search) are also the most universally useful. Code-specific tools (AST, LSP, repo map) are powerful enhancements **for code agents only**.

### What Claude Code Actually Uses (Full Tool List)

Based on the official documentation, Claude Code provides these tools to the agent:

| Tool | Category | What It Does |
|------|----------|-------------|
| **Read** | File ops | Read file contents (with optional line range) |
| **Write** | File ops | Create or overwrite files |
| **Edit** | File ops | Targeted edits to specific files |
| **NotebookEdit** | File ops | Modify Jupyter notebook cells |
| **Glob** | Search | Find files by pattern matching |
| **Grep** | Search | Search for regex patterns in file contents |
| **Bash** | Execution | Run shell commands (git, npm, python, etc.) |
| **WebSearch** | Web | Search the web |
| **WebFetch** | Web | Fetch content from URLs |
| **LSP** | Code intelligence | Type errors, jump to def, find refs, symbols (plugin required) |
| **Task** | Orchestration | Run a sub-agent for complex tasks |
| **AskUserQuestion** | Interaction | Ask the user for clarification |
| **Skill** | Extension | Execute a skill within the conversation |
| **MCPSearch** | Extension | Search for and load MCP tools dynamically |

**Key pattern:** Claude Code gives agents **simple, composable primitives** — not a monolithic "understand workspace" tool. The agent combines `Glob` + `Grep` + `Read` to navigate. It's the LLM's intelligence that turns these basic tools into effective workspace exploration. This pattern works equally well for code, docs, data, and config files.

### Recommended Approach for Ping Agents

Given our architecture (headless agents, not IDE-embedded), the right approach is **layered navigation tools**. Layers 1-2 are universal (every agent gets them). Layers 3-5 are opt-in enhancements:

```
┌─────────────────────────────────────────────────────────────────────────┐
│              AGENT WORKSPACE NAVIGATION LAYERS                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  LAYER 1: FILE SYSTEM (Every agent, zero setup)              UNIVERSAL  │
│  ├── list_files(dir, pattern?)       → Directory listing                │
│  ├── glob(pattern)                   → Find files by name pattern       │
│  ├── read_file(path, startLine?, endLine?) → Read file contents         │
│  └── file_stats(path)               → Size, modified date, extension   │
│                                                                          │
│  LAYER 2: TEXT SEARCH (Every agent, needs ripgrep)           UNIVERSAL  │
│  ├── grep(pattern, options?)         → Regex search across files        │
│  │   options: { include, exclude, maxResults, caseSensitive }           │
│  ├── search_and_replace(file, old, new) → Find-and-edit                │
│  └── find_in_files(name)            → search across all files           │
│                                                                          │
│  LAYER 2.5: BM25 KEYWORD SEARCH (Any agent, needs indexing) UNIVERSAL  │
│  ├── keyword_search(query, topK?)    → Relevance-ranked keyword results │
│  │   Uses BM25 algorithm (tf-idf family) — no embeddings needed        │
│  │   Better than grep: ranks by relevance, handles multi-word queries  │
│  │   Worse than semantic: no synonym/concept matching                  │
│  ├── index_workspace(paths?)         → Build/refresh BM25 index        │
│  └── hybrid_search(query, options?)  → Combined BM25 + vector search   │
│      options: { vectorWeight: 0-1, topK, filter }                      │
│      ↑ Inspired by Mastra: best of both worlds when embeddings exist   │
│                                                                          │
│  LAYER 3: REPO MAP (Code agents only, tree-sitter)          CODE ONLY  │
│  ├── get_repo_map(budget?)           → Compressed codebase overview     │
│  ├── get_symbols(file)              → Classes, functions, exports       │
│  ├── find_symbol(name, opts?)        → Cross-file symbol search         │
│  │   opts: { mode: 'exact'|'prefix'|'fuzzy', maxResults }              │
│  │   Returns: definition location + all reference locations            │
│  ├── get_dependencies(file)          → What this file imports/exports   │
│  └── get_file_summary(file)          → Structure without implementation │
│                                                                          │
│  LAYER 4: SEMANTIC SEARCH (Any agent, if embeddings configured) UNIV.  │
│  ├── semantic_search(query, topK?)   → Find by meaning                 │
│  ├── find_related(filePath)          → Find conceptually similar files  │
│  └── explain_workspace(question)     → Answer questions about content   │
│                                                                          │
│  LAYER 5: LSP (Code agents only, if language server configured) CODE   │
│  ├── go_to_definition(file, line, col) → Jump to definition            │
│  ├── find_references(file, line, col)  → All usages of a symbol        │
│  ├── get_diagnostics(file?)          → Type errors, warnings           │
│  ├── get_symbols_in_workspace(query) → Search symbols by name          │
│  └── get_hover_info(file, line, col) → Type information                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Implementation: Navigation Tools as Agent Toolbelt

These navigation tools fit into Zone 3 (Toolbelt) as **Tier 1 workspace tools**. Here's how they integrate:

```typescript
// Navigation tools are StructuredTools exposed to the LangGraph agent

// --- LAYER 1: File System ---

const listFilesTool = new StructuredTool({
  name: 'list_files',
  description: 'List files and directories at a given path. Use to explore project structure.',
  schema: z.object({
    directory: z.string().default('.').describe('Directory to list (relative to workspace root)'),
    pattern: z.string().optional().describe('Glob pattern to filter (e.g., "*.ts")'),
    recursive: z.boolean().default(false).describe('If true, list recursively'),
  }),
  func: async ({ directory, pattern, recursive }) => {
    // Uses workspace.listFiles() internally
    const files = await workspace.listFiles(directory, { pattern, recursive });
    return files.map(f => `${f.type === 'directory' ? '📁' : '📄'} ${f.path}`).join('\n');
  },
});

const globTool = new StructuredTool({
  name: 'glob',
  description: 'Find files matching a glob pattern across the entire workspace. ' +
    'Examples: "**/*.test.ts" (all test files), "src/**/*.ts" (all TS in src/)',
  schema: z.object({
    pattern: z.string().describe('Glob pattern to match'),
    maxResults: z.number().default(50).describe('Max results to return'),
  }),
  func: async ({ pattern, maxResults }) => {
    const matches = await workspace.glob(pattern, { maxResults });
    return matches.join('\n');
  },
});

// --- LAYER 2: Text Search ---

const grepTool = new StructuredTool({
  name: 'grep',
  description: 'Search for a text pattern (regex) across files in the workspace. ' +
    'Returns matching lines with file paths and line numbers. ' +
    'Use includePattern to narrow search to specific file types.',
  schema: z.object({
    pattern: z.string().describe('Regex pattern to search for'),
    includePattern: z.string().optional().describe('Glob to filter files (e.g., "**/*.ts")'),
    excludePattern: z.string().optional().describe('Glob to exclude (e.g., "node_modules/**")'),
    maxResults: z.number().default(30).describe('Max matching lines to return'),
    caseSensitive: z.boolean().default(false),
  }),
  func: async ({ pattern, includePattern, excludePattern, maxResults, caseSensitive }) => {
    const results = await workspace.grep(pattern, {
      include: includePattern,
      exclude: excludePattern,
      maxResults,
      caseSensitive,
    });
    return results.map(r => `${r.file}:${r.line}: ${r.text}`).join('\n');
  },
});

// --- LAYER 3: Repo Map (requires tree-sitter indexing) ---

const repoMapTool = new StructuredTool({
  name: 'get_repo_map',
  description: 'Get a compressed overview of the codebase showing class/function signatures ' +
    'and their relationships. Uses minimal tokens to convey maximum understanding. ' +
    'Call this FIRST when working with an unfamiliar codebase.',
  schema: z.object({
    budgetTokens: z.number().default(1024).describe('Token budget for the map'),
    focusFiles: z.array(z.string()).optional()
      .describe('Files to emphasize in the map (shows more detail for these)'),
  }),
  func: async ({ budgetTokens, focusFiles }) => {
    const map = await workspace.getRepoMap({ budgetTokens, focusFiles });
    return map;
  },
});

const getSymbolsTool = new StructuredTool({
  name: 'get_symbols',
  description: 'Get all classes, functions, interfaces, and exports defined in a file. ' +
    'Shows signatures without implementation bodies.',
  schema: z.object({
    filePath: z.string().describe('File to extract symbols from'),
  }),
  func: async ({ filePath }) => {
    const symbols = await workspace.getSymbols(filePath);
    return symbols.map(s => `${s.kind} ${s.name}: ${s.signature}`).join('\n');
  },
});
```

### Implementation Priority for Navigation

| Priority | Layer | What | Implementation Notes | Effort |
|----------|-------|------|---------------------|--------|
| **P0** | Layer 1 | `list_files`, `glob`, `read_file` (with ranges) | Extend existing `AgentWorkspace` — `listFiles` exists, add glob and line ranges | 1 day |
| **P0** | Layer 2 | `grep` (via ripgrep or Node.js) | Use `@vscode/ripgrep` npm package or spawn `rg` process. Add as workspace method | 1-2 days |
| **P1** | Layer 2.5 | `keyword_search` (BM25) | **Any agent.** Use `wink-bm25-text-search` or similar. Index workspace on init (`autoIndexPaths`), re-index on file change. No embeddings needed — pure keyword relevance. Inspired by Mastra's search system | 2-3 days |
| **P1** | Layer 3 | `get_repo_map`, `get_symbols` | **Code agents only.** Use `tree-sitter` + `tree-sitter-typescript` npm packages. Build indexer that extracts symbols per file, rank by reference count | 3-5 days |
| **P2** | Layer 4 | `semantic_search` | **Any agent with embeddings.** Use embedding model + in-memory vector store. Chunk files at file/section boundaries (AST for code, headings for markdown, rows for CSV) | 3-5 days |
| **P2** | Layer 2.5+4 | `hybrid_search` (BM25 + vector) | **Combine keyword + semantic.** Configurable `vectorWeight` (0=pure BM25, 1=pure vector). Returns unified `{ score, scoreDetails: { bm25, vector } }`. Best accuracy for large workspaces | 1 day (after BM25 + semantic) |
| **P3** | Layer 5 | LSP integration | **Code agents only.** Start `tsserver` or `pyright` as subprocess. Complex lifecycle management. Consider only if agents run long enough to justify startup cost | 5+ days |

### Ripgrep Integration (P0)

The simplest high-impact addition. Options:

```typescript
import { rgPath } from '@vscode/ripgrep';   // Ships ripgrep binary
import { execFile } from 'child_process';

class AgentWorkspace {
  async grep(pattern: string, options?: GrepOptions): Promise<GrepResult[]> {
    const args = [
      '--json',                                    // Structured output
      '--max-count', String(options?.maxResults ?? 30),
      pattern,
      options?.caseSensitive ? '' : '-i',           // Case insensitive
    ];
    
    if (options?.include) args.push('--glob', options.include);
    if (options?.exclude) args.push('--glob', `!${options.exclude}`);
    
    const { stdout } = await execFileAsync(rgPath, args, { cwd: this.basePath });
    return this.parseRipgrepJson(stdout);
  }
  
  async glob(pattern: string, options?: { maxResults?: number }): Promise<string[]> {
    // Use fast-glob or ripgrep --files --glob
    const args = ['--files', '--glob', pattern];
    const { stdout } = await execFileAsync(rgPath, args, { cwd: this.basePath });
    return stdout.trim().split('\n').slice(0, options?.maxResults ?? 50);
  }
}
```

### BM25 Keyword Search (P1) — Inspired by Mastra

BM25 fills the gap between grep (exact match, no ranking) and semantic search (needs embeddings). It gives **relevance-ranked keyword results** using tf-idf statistics. No embeddings, no GPU, no external API — pure algorithmic ranking.

**When to use which:**
| Approach | Use When | Example Query |
|----------|----------|---------------|
| **Grep** | You know the exact string or regex | `"class AgentWorker"`, `TODO:.*fix` |
| **BM25** | You have keywords but want ranked results | `"agent task assignment priority"` |
| **Semantic** | You want conceptual matching | `"how do workers get their jobs?"` |
| **Hybrid** | Maximum recall on large workspaces | Any of the above |

```typescript
// BM25 search implementation — no embeddings needed
// Uses wink-bm25-text-search or similar library

interface SearchResult {
  id: string;       // file path or chunk ID
  content: string;
  score: number;
  lineRange?: { start: number; end: number };
  metadata?: Record<string, unknown>;
}

class WorkspaceSearchIndex {
  private bm25: BM25Index;
  private indexed: boolean = false;

  constructor(private workspace: AgentWorkspace) {}

  // Auto-index on workspace init (like Mastra's autoIndexPaths)
  async indexWorkspace(paths?: string[]): Promise<void> {
    const files = paths
      ? await this.resolveFiles(paths)
      : await this.workspace.listFiles('.', { recursive: true });

    for (const file of files) {
      const content = await this.workspace.readFile(file.path);
      // Index by chunks (paragraphs, functions, or fixed-size windows)
      const chunks = this.chunkContent(content, file.path);
      for (const chunk of chunks) {
        this.bm25.addDocument(chunk.id, chunk.text, {
          file: file.path,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
        });
      }
    }
    this.bm25.build(); // Finalize index (compute IDF statistics)
    this.indexed = true;
  }

  async keywordSearch(query: string, topK: number = 10): Promise<SearchResult[]> {
    if (!this.indexed) await this.indexWorkspace();
    return this.bm25.search(query, topK);
  }

  // Hybrid: combine BM25 + vector scores (if embeddings available)
  async hybridSearch(
    query: string,
    options: { vectorWeight?: number; topK?: number } = {}
  ): Promise<SearchResult[]> {
    const { vectorWeight = 0.5, topK = 10 } = options;
    const bm25Weight = 1 - vectorWeight;

    const [bm25Results, vectorResults] = await Promise.all([
      this.keywordSearch(query, topK * 2),
      this.semanticSearch?.(query, topK * 2) ?? [],
    ]);

    // Merge and re-rank by weighted score
    return this.mergeResults(bm25Results, vectorResults, bm25Weight, vectorWeight, topK);
  }
}
```

**Key design decisions (learned from Mastra):**
- **Auto-index on init**: Index workspace files when workspace is created. Re-index on file changes (debounced).
- **Chunking strategy**: Split by logical boundaries — paragraphs for docs, functions for code, rows for data.
- **BM25 parameters**: Tunable `k1` (term saturation, default 1.2) and `b` (length normalization, default 0.75).
- **Hybrid mode**: Only available when both BM25 and vector search are configured. `vectorWeight: 0` = pure BM25, `vectorWeight: 1` = pure semantic.

### Tree-sitter Repo Map (P1)

```typescript
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';

class RepoMapBuilder {
  private parser: Parser;
  
  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(TypeScript.typescript);
  }
  
  // Extract symbols from a single file
  extractSymbols(source: string, filePath: string): SymbolEntry[] {
    const tree = this.parser.parse(source);
    const symbols: SymbolEntry[] = [];
    
    this.walkTree(tree.rootNode, (node) => {
      if (node.type === 'class_declaration') {
        symbols.push({
          name: node.childForFieldName('name')?.text ?? '',
          kind: 'class',
          signature: this.getSignatureLine(source, node),
          line: node.startPosition.row + 1,
          file: filePath,
          referenceCount: 0,
        });
      }
      if (node.type === 'function_declaration' || node.type === 'method_definition') {
        symbols.push({
          name: node.childForFieldName('name')?.text ?? '',
          kind: node.type === 'method_definition' ? 'method' : 'function',
          signature: this.getSignatureLine(source, node),
          line: node.startPosition.row + 1,
          file: filePath,
          referenceCount: 0,
        });
      }
      if (node.type === 'interface_declaration' || node.type === 'type_alias_declaration') {
        symbols.push({
          name: node.childForFieldName('name')?.text ?? '',
          kind: node.type === 'interface_declaration' ? 'interface' : 'type',
          signature: this.getSignatureLine(source, node),
          line: node.startPosition.row + 1,
          file: filePath,
          referenceCount: 0,
        });
      }
    });
    
    return symbols;
  }
  
  // Build full repo map
  async buildRepoMap(rootDir: string, budgetTokens: number = 1024): Promise<string> {
    const files = await glob('**/*.ts', { cwd: rootDir, ignore: ['node_modules/**'] });
    const allSymbols: Map<string, SymbolEntry[]> = new Map();
    
    for (const file of files) {
      const source = await fs.promises.readFile(path.join(rootDir, file), 'utf-8');
      const symbols = this.extractSymbols(source, file);
      allSymbols.set(file, symbols);
    }
    
    // Count cross-references
    this.countReferences(allSymbols);
    
    // Rank and budget
    return this.formatMap(allSymbols, budgetTokens);
  }
  
  private getSignatureLine(source: string, node: any): string {
    // Extract just the declaration line (before the body)
    const lines = source.substring(node.startIndex, node.endIndex).split('\n');
    // Return first line (or up to opening brace)
    const firstLine = lines[0].trim();
    return firstLine.replace(/\{.*$/, '{...}');
  }
}
```

### How This Connects to the 4-Zone Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│         NAVIGATION TOOLS IN THE 4-ZONE MODEL                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Zone 1 (Scratchpad)                                                    │
│  └── Agent stores search results, bookmarks, "remember this file"       │
│      e.g., .scratch/research/relevant-files.md                          │
│                                                                          │
│  Zone 2 (Workspace)                                                      │
│  └── Navigation tools OPERATE ON this zone                              │
│      grep, glob, read_file all target workspace files                   │
│      Works regardless of content type (code, docs, data, config)        │
│                                                                          │
│  Zone 3 (Toolbelt) ← Navigation lives here                             │
│  └── Layers 1-2: EVERY agent gets these (universal file search)         │
│      Layer 3: Code agents only (tree-sitter/AST)                        │
│      Layer 4: Any agent with embeddings configured (semantic search)    │
│      Layer 5: Code agents only (LSP — when language server available)   │
│                                                                          │
│  Zone 4 (Identity)                                                       │
│  └── Identity card includes "available navigation capabilities"         │
│      Agent knows which search tools it has                              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Agent Workflow Examples

**Example A: Code agent navigating an unfamiliar repo**

```
Step 1: Orientation
  → list_files(".") → package.json, tsconfig.json, src/, tests/
  → "This is a Node.js TypeScript project"

Step 2: Overview (code-specific)
  → get_repo_map(budgetTokens: 2048)
  → Sees all classes, interfaces, key functions

Step 3: Targeted Search
  → grep("validateToken", { include: "**/*.ts" })
  → Finds: src/auth/handler.ts:45, tests/auth.test.ts:78

Step 4: Deep Dive → read_file("src/auth/handler.ts", { startLine: 40, endLine: 80 })
Step 5: Edit + verify → get_diagnostics("src/auth/handler.ts")

Total context: ~5K tokens (vs 50K+ reading everything)
```

**Example B: Docs agent navigating a documentation library**

```
Step 1: Orientation
  → list_files("docs/") → architecture/, features/, product/, developer-guide/
  → glob("docs/**/*.md") → 47 files
  → "Large docs repo with 4 main sections"

Step 2: Find Topic
  → grep("authentication\|auth\|login", { include: "docs/**/*.md" })
  → Finds: docs/architecture/auth-design.md, docs/features/auth/overview.md

Step 3: Check for Overlap
  → semantic_search("how user authentication works", topK: 5)
  → Finds related docs to avoid duplicating content

Step 4: Read & Write
  → read_file("docs/features/auth/overview.md")
  → Now writes new section with knowledge of what already exists

Total context: ~3K tokens
```

**Example C: Data agent finding the right dataset**

```
Step 1: Discover
  → glob("data/**/*.{csv,json,parquet}")
  → 23 data files across data/sales/, data/users/, data/reports/

Step 2: Identify
  → read_file("data/sales/2025-q4.csv", { startLine: 1, endLine: 5 })  # Just headers
  → Headers: date, product_id, amount, region, channel

Step 3: Search
  → grep("revenue\|total_sales", { include: "data/**" })
  → Finds the aggregated report file

Total context: ~1K tokens
```

---

## 7. Zone 3: Toolbelt (External Capabilities)

### The Toolbelt Concept

An agent's **toolbelt** is the set of external software/services it can use to accomplish its task. This is bigger than "LangChain tools" — it's the agent's full software environment.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      AGENT TOOLBELT                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  TIER 1: WORKSPACE TOOLS (Built-in)                                      │
│  ├── create_file, read_file, update_file, list_files                    │
│  ├── commit, promote_to_workspace                                       │
│  ├── scratch_note, scratch_remember, scratch_todo                       │
│  ├── workspace_status, get_activity_log                                 │
│  ├── keyword_search, grep  (Layer 2-2.5 navigation)                    │
│  └── 🛡️ Safety: requireReadBeforeWrite, path containment               │
│                                                                          │
│  TIER 2: MCP SERVERS (Configured per agent/team)                        │
│  ├── @modelcontextprotocol/server-filesystem  → File I/O on target repos│
│  ├── @modelcontextprotocol/server-github      → PRs, issues, reviews    │
│  ├── @modelcontextprotocol/server-postgres    → Database queries        │
│  ├── custom-server/company-api                → Internal APIs           │
│  └── custom-server/jira                       → Task management         │
│                                                                          │
│  TIER 3: CLI TOOLS (Shell access, sandboxed)                            │
│  ├── git          → Clone repos, create branches, push                  │
│  ├── claude       → Claude CLI for complex coding subtasks              │
│  ├── npm/yarn     → Install deps, run scripts, run tests               │
│  ├── python       → Run scripts, data processing                       │
│  └── curl/httpie  → API calls                                           │
│                                                                          │
│  TIER 4: AGENT-TO-AGENT (Delegation)                                    │
│  ├── delegate_to(role, subtask)  → Ask another agent for help           │
│  ├── group_chat(topic, roles)    → Start collaborative discussion       │
│  └── query_agent(role, question) → Ask without full delegation          │
│                                                                          │
│  TIER 5: KNOWLEDGE (Read-only)                                          │
│  ├── search_knowledge(query)     → Search L3 knowledge base             │
│  ├── get_project_docs(projectId) → Project context                      │
│  └── get_team_context()          → L2 shared artifacts/decisions        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### How to Configure the Toolbelt

**Per-role toolbelt definition** (extends existing AgentDefinition YAML):

```yaml
# agents/code-developer.yaml
id: code-developer
name: "Code Developer"
role: code-developer
type: internal
goal: "Write production-quality code with tests"

config:
  model:
    provider: anthropic
    model: claude-sonnet-4-20250514
  
  tools:
    # Tier 1: Always available (workspace tools injected automatically)
    
    # Tier 2: MCP servers
    - name: github
      type: mcp
      config:
        server: "@modelcontextprotocol/server-github"
        env:
          GITHUB_TOKEN: "${GITHUB_TOKEN}"
    
    - name: filesystem
      type: mcp
      config:
        server: "@modelcontextprotocol/server-filesystem"
        args: ["--root", "/projects/target-repo"]
    
    # Tier 3: CLI tools
    - name: git
      type: cli
      config:
        command: git
        allowedSubcommands: [clone, checkout, branch, add, commit, push, pull, diff, log, status]
        workingDir: "${WORKSPACE_PATH}"
    
    - name: claude-cli
      type: cli  
      config:
        command: claude
        description: "Use Claude CLI for complex multi-file coding tasks"
        allowedArgs: ["--print", "--output-format", "json"]
        timeout: 300000  # 5 min
    
    - name: npm
      type: cli
      config:
        command: npm
        allowedSubcommands: [install, test, run, build]
        workingDir: "${WORKSPACE_PATH}"
    
    # Tier 4: Agent-to-agent (configured at team level)
    # Tier 5: Knowledge (always available if L3 configured)
```

### CLI Tool Execution (Sandboxed)

The agent shouldn't have unrestricted shell access. Instead, configured CLI tools with guardrails:

```typescript
interface CLIToolConfig {
  command: string;                    // Base command (git, npm, claude, etc.)
  allowedSubcommands?: string[];      // Whitelist of subcommands
  allowedArgs?: string[];             // Whitelist of flags
  blockedPatterns?: string[];         // Patterns to reject (e.g., "rm -rf /")
  workingDir?: string;                // Locked working directory
  timeout?: number;                   // Max execution time (ms)
  env?: Record<string, string>;       // Environment variables
  captureOutput?: boolean;            // Capture stdout/stderr for the agent
  requireApproval?: boolean;          // Human approval before execution
}

// Runtime execution
class CLITool extends StructuredTool {
  name: string;
  description: string;
  
  async _call(input: { args: string[] }): Promise<string> {
    // 1. Validate against whitelist
    this.validateArgs(input.args);
    
    // 2. Check approval if required
    if (this.config.requireApproval) {
      await this.requestApproval(input);
    }
    
    // 3. Execute in sandbox
    const result = await execInSandbox(
      this.config.command,
      input.args,
      {
        cwd: this.config.workingDir,
        timeout: this.config.timeout,
        env: this.config.env,
      }
    );
    
    // 4. Log to activity
    this.workspace.logActivity({
      type: 'tool_call',
      tool: `cli:${this.config.command}`,
      input: { args: input.args },
      output: result.stdout,
      duration: result.duration,
    });
    
    return result.stdout;
  }
}
```

### Workspace Safety Mechanisms (Inspired by Mastra)

Production agents need guardrails to prevent accidental data loss. These are **built into the workspace layer**, not optional middleware:

```typescript
interface WorkspaceSafetyConfig {
  requireReadBeforeWrite: boolean;     // Must read_file before writing to existing file
  containPaths: boolean;               // Prevent path traversal (../) attacks
  readOnlyPaths?: string[];            // Paths that cannot be modified
  maxFileSize?: number;                // Prevent writing excessively large files
  requireApprovalFor?: string[];       // Tool names that need human approval
}

class SafeAgentWorkspace extends AgentWorkspace {
  private readFiles: Set<string> = new Set();  // Track what agent has read
  private config: WorkspaceSafetyConfig;

  async readFile(filePath: string, options?: ReadOptions): Promise<string> {
    const resolved = this.resolvePath(filePath);
    this.readFiles.add(resolved);  // Track this read
    return super.readFile(resolved, options);
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const resolved = this.resolvePath(filePath);

    // 1. Path containment — prevent escaping workspace
    if (this.config.containPaths && !resolved.startsWith(this.basePath)) {
      throw new Error(`Path traversal blocked: ${filePath} resolves outside workspace`);
    }

    // 2. Read-only check
    if (this.config.readOnlyPaths?.some(p => resolved.startsWith(this.resolve(p)))) {
      throw new Error(`Read-only path: ${filePath}`);
    }

    // 3. requireReadBeforeWrite — MUST have read the file before overwriting
    const exists = await this.fileExists(resolved);
    if (exists && this.config.requireReadBeforeWrite && !this.readFiles.has(resolved)) {
      throw new Error(
        `Safety: Cannot write to "${filePath}" — you haven't read it yet. ` +
        `Call read_file("${filePath}") first to see current contents.`
      );
    }

    // 4. Max file size
    if (this.config.maxFileSize && Buffer.byteLength(content) > this.config.maxFileSize) {
      throw new Error(`File too large: ${Buffer.byteLength(content)} bytes exceeds ${this.config.maxFileSize}`);
    }

    return super.writeFile(resolved, content);
  }

  private resolvePath(filePath: string): string {
    const resolved = path.resolve(this.basePath, filePath);
    if (this.config.containPaths && !resolved.startsWith(this.basePath)) {
      throw new Error(`Path traversal blocked: ${filePath}`);
    }
    return resolved;
  }
}
```

**Why `requireReadBeforeWrite` matters:**
- Agents hallucinate file contents — they "remember" what a file *might* contain and overwrite it with their assumption
- Force-reading first ensures the agent sees the **actual** current state before modifying
- Cheap to implement, prevents entire classes of bugs (wrong file, stale content, merge conflicts)
- Mastra uses this as a default safety layer — we should too

### Claude CLI as a Sub-Agent Tool

This is powerful — agent can use Claude CLI to delegate complex coding tasks:

```typescript
const claudeCliTool = {
  name: 'claude_code',
  description: 'Use Claude CLI to perform complex multi-file coding tasks. ' +
    'Useful for: implementing features across many files, refactoring, ' +
    'writing tests, debugging complex issues.',
  schema: z.object({
    prompt: z.string().describe('Detailed coding task description'),
    workingDir: z.string().optional().describe('Directory to work in'),
    printOnly: z.boolean().default(true).describe('If true, returns response without executing'),
  }),
  handler: async ({ prompt, workingDir, printOnly }) => {
    const args = ['--print'];
    if (workingDir) args.push('--cwd', workingDir);
    args.push(prompt);
    
    const result = await execInSandbox('claude', args, { timeout: 300000 });
    return result.stdout;
  },
};
```

### MCP Server as Dynamic Tool Provider

MCP servers provide tools at runtime — the agent discovers what's available:

```typescript
interface MCPToolProvider {
  // Discovery — agent can ask "what tools does this server give me?"
  listTools(): Promise<ToolDescription[]>;
  
  // Invocation
  callTool(name: string, args: Record<string, any>): Promise<any>;
  
  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

// Agent's tool manifest includes both static tools and MCP-provided tools
interface ToolManifest {
  workspace: Tool[];       // Built-in workspace tools
  mcp: {                   // Grouped by MCP server
    [serverName: string]: ToolDescription[];
  };
  cli: CLIToolConfig[];    // CLI tools
  delegation: string[];    // Roles this agent can delegate to
  knowledge: boolean;      // Whether L3 search is available
}
```

---

## 8. Zone 4: Agent Identity Card (Self-Awareness)

### The Problem

An agent today doesn't know:
- What tools it has available (beyond what's in the system prompt)
- What files it's already created
- What knowledge context was loaded
- Where it is in the overall plan
- What other agents are working on related tasks

### The Identity Card Concept

Every agent gets a **live, queryable self-description** — like a person who can answer "what are my capabilities?" and "what's my current status?"

```typescript
interface AgentIdentityCard {
  // ═══════ WHO AM I ═══════
  identity: {
    id: string;
    name: string;
    role: string;
    goal: string;
    systemPrompt: string;            // The agent's "personality"
    skills: string[];                 // Human-readable capabilities
  };
  
  // ═══════ WHAT'S MY TASK ═══════
  currentTask: {
    id: string;
    description: string;
    priority: number;
    dependencies: { taskId: string; status: string; output?: string }[];
    deadline?: Date;
    attempt: number;                  // 1st, 2nd, 3rd try?
  } | null;
  
  // ═══════ WHAT HAVE I DONE ═══════
  progress: {
    filesCreated: string[];           // In workspace (Zone 2)
    filesInScratch: string[];         // In scratchpad (Zone 1)
    commits: { hash: string; message: string; timestamp: Date }[];
    toolCallCount: number;
    elapsedTime: number;              // ms since task start
    activitySummary: string;          // LLM-generated summary of activity so far
  };
  
  // ═══════ WHAT DO I HAVE ═══════
  capabilities: {
    tools: ToolManifest;              // Full tool inventory
    loadedContext: {                   // What knowledge is in my context
      knowledgeDocs: string[];        // L3 docs loaded
      dependencyOutputs: string[];    // Outputs from prerequisite tasks
      teamContext: string[];          // L2 shared artifacts accessed
    };
    canDelegate: boolean;             // Can I ask other agents for help?
    delegationTargets: string[];      // Roles I can delegate to
  };
  
  // ═══════ WHERE AM I IN THE BIG PICTURE ═══════
  context: {
    teamId: string;
    teamGoal: string;
    planOverview: string;             // High-level plan summary
    myTasksInPlan: string[];          // All tasks assigned to my role
    currentTaskIndex: number;         // Which one am I on?
    relatedAgents: {                  // Who else is working on related stuff
      role: string;
      currentTask: string;
      status: string;
    }[];
  };
}
```

### How the Agent Uses It

The identity card is available as a tool:

```typescript
const introspectionTools = [
  {
    name: 'whoami',
    description: 'Get your identity, role, skills, and current task',
    handler: async () => {
      const card = await getIdentityCard();
      return JSON.stringify({
        identity: card.identity,
        currentTask: card.currentTask,
      }, null, 2);
    },
  },
  {
    name: 'my_progress',
    description: 'See what you have accomplished so far on the current task',
    handler: async () => {
      const card = await getIdentityCard();
      return JSON.stringify(card.progress, null, 2);
    },
  },
  {
    name: 'my_tools',
    description: 'List all tools/capabilities available to you',
    handler: async () => {
      const card = await getIdentityCard();
      return JSON.stringify(card.capabilities, null, 2);
    },
  },
  {
    name: 'my_context',
    description: 'See the big picture — team goal, plan, related agents',
    handler: async () => {
      const card = await getIdentityCard();
      return JSON.stringify(card.context, null, 2);
    },
  },
];
```

### System Prompt Injection

The identity card summary is injected into the agent's system prompt at task start:

```
You are ${name}, a ${role}.
Your goal: ${goal}

Current Task: ${currentTask.description}
Attempt: ${currentTask.attempt} of 3

Your Tools:
- Workspace: create_file, read_file, update_file, commit
- Scratchpad: scratch_note, scratch_todo, scratch_remember
- CLI: git, npm, claude (for complex coding)
- MCP: github (PRs, issues), filesystem (target repo)
- Knowledge: search_knowledge, get_project_docs

Context Loaded:
- Project docs: auth-service/how-it-works.md, auth-service/working-on.md
- Dependency outputs: task-001 output (API schema)

Team Context:
- Team: Backend Engineering
- Goal: "Implement auth microservice"
- Your tasks: 3 of 8 (currently on task 4/8)
- Related: "api-designer" is working on API schema (completed)
```

---

## 9. Multi-Stakeholder Visibility Model

### The Audience Problem

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    WHO NEEDS TO KNOW WHAT?                                │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  AGENT (me)                                                              │
│  └── Everything: scratchpad, workspace, tools, context, progress         │
│                                                                          │
│  MY HUMAN (the person I report to)                                       │
│  └── Progress, decisions made, blockers, approval requests               │
│  └── Deliverables (workspace), NOT scratchpad                            │
│  └── Activity log (what tools I used, what I tried)                      │
│  └── "Plain language status update"                                      │
│                                                                          │
│  MANAGER AGENT (orchestrator)                                            │
│  └── Task status, output summary, any blockers/failures                  │
│  └── Enough detail to replan if something goes wrong                     │
│  └── NOT implementation details                                          │
│                                                                          │
│  OTHER TEAM AGENTS (collaborators)                                       │
│  └── Published artifacts (L2) — what I produced                          │
│  └── Interface contracts (API schemas, shared types)                     │
│  └── Shared context updates                                              │
│  └── "What did the auth agent decide about token format?"                │
│                                                                          │
│  OTHER TEAMS (cross-team visibility)                                     │
│  └── High-level summary only                                             │
│  └── Published artifacts tagged for cross-team consumption               │
│  └── "Backend team completed auth service, here's the API spec"          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### View Model: Same Work, Different Lenses

```typescript
interface AgentView {
  // Everything — agent's own view
  full(): AgentEnvironment;
}

interface HumanView {
  // What the supervising human sees
  status(): {
    taskDescription: string;
    status: 'working' | 'blocked' | 'needs_approval' | 'completed' | 'failed';
    progress: string;           // "3 of 5 subtasks done"
    summary: string;            // Plain language: "I've implemented the JWT handler and tests pass"
    timeElapsed: string;
    deliverables: FileInfo[];   // What's in workspace (Zone 2)
    decisions: Decision[];      // Key decisions made during work
    blockers: Blocker[];        // What's stopping me
    approvalRequests: ApprovalRequest[];
  };
  
  activityTimeline(): ActivityEntry[];  // Filtered — no internal reasoning
  deliverables(): Artifact[];
}

interface ManagerView {
  // What the orchestrator agent sees
  taskReport(): {
    taskId: string;
    status: TaskStatus;
    outputSummary: string;      // Brief: "Auth handler implemented with 12 tests, all passing"
    duration: number;
    retries: number;
    blockers: string[];
    suggestedNextSteps?: string[];
  };
}

interface TeamView {
  // What other agents on the team see
  publishedArtifacts(): Artifact[];
  sharedContext(): Record<string, any>;
  decisions(): Decision[];
}

interface CrossTeamView {
  // What other teams see
  summary(): {
    teamGoal: string;
    completedTasks: string[];
    publishedInterfaces: Artifact[];  // API specs, shared types
  };
}
```

### How Reporting Works

The agent doesn't write separate reports for each audience. Instead, the system generates **views** from the agent's work:

```
Agent's Work (raw)
       │
       ├──→ activity.jsonl              → Filtered per audience
       ├──→ workspace files (Zone 2)    → Visible to team+
       ├──→ scratchpad (Zone 1)         → Agent only
       ├──→ commits                     → Visible to human+
       └──→ workspace.json (metadata)   → Status for all
       
System generates:
       │
       ├──→ HumanView:    LLM summarizer → "Here's what I did and why"
       ├──→ ManagerView:  Structured extract → { status, output, blockers }
       ├──→ TeamView:     Published artifacts → L2 collaboration space
       └──→ CrossTeamView: Summary generator → "Backend completed auth"
```

### Decision Log (Important for Humans + Teams)

```typescript
interface Decision {
  id: string;
  timestamp: Date;
  description: string;          // "Chose JWT over session cookies"
  reasoning: string;            // "JWT is stateless, better for microservices"
  alternatives: string[];       // ["Session cookies", "OAuth tokens"]
  impact: 'low' | 'medium' | 'high';
  reversible: boolean;
  relatedFiles?: string[];      // Files affected by this decision
}
```

Agent logs decisions during work:

```typescript
// Tool available to agent
const logDecisionTool = {
  name: 'log_decision',
  description: 'Record an important decision for your team and manager. ' +
    'Use this when you choose between alternatives that affect the output.',
  schema: z.object({
    description: z.string(),
    reasoning: z.string(),
    alternatives: z.array(z.string()),
    impact: z.enum(['low', 'medium', 'high']),
  }),
};
```

---

## 10. How This Maps to Current L1 Architecture

### Changes to AgentWorkspace

```diff
+ # GREENFIELD MODE (our own repo):
  workspace-{taskId}/
+ ├── .scratch/                    # NEW: Zone 1 (gitignored)
+ │   ├── notes.json
+ │   ├── todos.json
+ │   ├── remembered.json
+ │   └── drafts/
  ├── .git/
+ ├── .gitignore                   # Includes .scratch/
- ├── artifacts/                   # Hardcoded structure
- │   ├── code/
- │   ├── docs/
- │   └── data/
+ ├── {user-defined dirs}          # Or default: artifacts/code, docs, data
  ├── activity/
  │   └── activity.jsonl
+ ├── decisions/                   # NEW: Decision log (committed)
+ │   └── decisions.jsonl
  ├── context/
  │   ├── knowledge/
  │   └── dependencies/
  └── workspace.json

+ # CLONE MODE (user's repo):
+ workspace-{taskId}/
+ ├── .scratch/                    # Zone 1 (gitignored from target repo)
+ ├── .ping/                      # NEW: Our metadata (gitignored)
+ │   ├── workspace.json
+ │   ├── activity.jsonl
+ │   └── decisions.jsonl
+ ├── .git/                        # Cloned repo's git
+ ├── src/                         # ← Repo's actual structure
+ ├── tests/
+ ├── package.json
+ └── README.md
```

### New Tools to Add

| Tool | Zone | Purpose |
|------|------|---------|
| `scratch_note` | 1 | Write/read private notes |
| `scratch_todo` | 1 | Internal TODO tracking |
| `scratch_remember` | 1 | Facts to keep in context |
| `scratch_file` | 1 | Write draft files |
| `promote_to_workspace` | 1→2 | Move draft to deliverables |
| `whoami` | 4 | Identity and role info |
| `my_progress` | 4 | What I've done so far |
| `my_tools` | 4 | Full tool inventory |
| `my_context` | 4 | Team/plan context |
| `log_decision` | 2 | Record important decisions |
| `cli_exec` | 3 | Run CLI tools (sandboxed) |

### Integration Points

```typescript
// WorkerPool.runTask() — enhanced
async runTask(taskId: string, role: string, input: string): Promise<TaskResult> {
  const workspace = await this.memoryCoordinator.workspaces.createWorkspace(agentId, taskId);
  
  // NEW: Initialize scratchpad
  const scratchpad = new Scratchpad(workspace.basePath);
  
  // NEW: Build identity card
  const identityCard = await this.buildIdentityCard(worker, taskId, workspace);
  
  // NEW: Resolve toolbelt from agent definition
  const toolbelt = await this.resolveToolbelt(worker.definition, workspace);
  
  // Inject all zones into agent
  const agentEnv = {
    workspace,       // Zone 2
    scratchpad,      // Zone 1
    toolbelt,        // Zone 3
    identityCard,    // Zone 4
  };
  
  // Execute with full environment
  const result = await worker.execute(input, agentEnv);
  
  // Generate views for different audiences
  const humanView = await generateHumanView(workspace, result);
  const managerView = await generateManagerView(workspace, result);
  
  // Publish to L2
  await workspace.publish();
  
  // Clean up scratchpad (unless debug mode)
  if (!this.debugMode) {
    scratchpad.clear();
  }
  
  return result;
}
```

---

## 11. Recommendations

### Priority Order

| Priority | What | Why | Effort |
|----------|------|-----|--------|
| **P0** | Scratchpad (Zone 1) | Agents currently pollute workspace with drafts | 1-2 days |
| **P0** | Identity card injection (Zone 4) | Agents don't know their capabilities | 1 day |
| **P1** | CLI tool framework (Zone 3) | Needed for real coding agents (git, npm) | 2-3 days |
| **P1** | Decision logging | Humans and managers need this for oversight | 1 day |
| **P2** | MCP dynamic tools (Zone 3) | Already partially exists — extend YAML config | 2 days |
| **P2** | Audience views (Visibility) | Generate reports from activity log | 2-3 days |
| **P3** | Claude CLI integration (Zone 3) | Powerful for coding tasks, but complex | 2 days |
| **P3** | Cross-team view | Needs L2 to be more mature first | 3 days |

### Architecture Decisions to Make

| Decision | Options | Recommendation |
|----------|---------|----------------|
| **Scratchpad storage** | `.scratch/` dir vs in-memory | `.scratch/` dir — survives restart, debuggable |
| **Commit control** | Auto-commit vs agent-controlled | Agent-controlled with guardrails (max uncommitted time) |
| **CLI sandbox** | Docker/container vs process-level | Process-level with whitelist — simpler, good enough |
| **Identity card update frequency** | Static (task start) vs live | Live queryable — stale identity causes bad decisions |
| **View generation** | Real-time vs on-demand | On-demand with caching — views are expensive to generate |

### What This Enables

Once all 4 zones are implemented:

```
Before:
  Agent = LLM + flat workspace + hardcoded tools
  
After:
  Agent = LLM + scratchpad (thinking) 
             + workspace (deliverables) 
             + toolbelt (git, CLI, MCP, other agents)
             + identity (self-awareness)
             + views (audience-appropriate reporting)
             
  → Agent that works like a real team member:
    - Thinks privately (scratchpad)
    - Delivers cleanly (workspace)
    - Uses real tools (git, CLI, APIs)
    - Knows itself (capabilities, progress)
    - Reports appropriately (human gets summary, manager gets status, team gets artifacts)
```

---

## 12. Should We Migrate to Mastra?

**The question:** Mastra has production-ready workspace, search, sandbox, and memory. Would migrating be faster than building all this ourselves?

### Quick Answer: No Full Migration. Selective Adoption.

| Factor | Full Migration to Mastra | Build on Current Stack | Selective Adoption |
|--------|-------------------------|----------------------|-------------------|
| **Effort** | 5-8 weeks (full rewrite) | 8-12 weeks (build everything) | 3-5 weeks (cherry-pick) |
| **Risk** | High — Mastra 1.0 is 1 month old | Low — known stack | Low — gradual |
| **Git/workspace** | ❌ Must keep custom (Mastra has none) | ✅ Already built | ✅ Keep what we have |
| **LSP/code nav** | ❌ Mastra doesn't have this | Must build either way | Must build either way |
| **Multi-agent orchestration** | 🔄 Rebuild on Mastra primitives | ✅ Already working | ✅ Keep what we have |
| **Memory** | ✅ Mastra's 4-tier is richer | 🔄 Build ourselves | Can adopt later |
| **MCP tools** | ✅ Better than @langchain/mcp-adapters | ✅ Works today | Can swap later |

### Why Not Full Migration

**1. Mastra replaces LangChain/LangGraph — it's not an add-on.**

```
Current stack:          Mastra stack:
LangChain               @mastra/core
LangGraph (agents)       Mastra Agent (different API)
@langchain/openai        @ai-sdk/azure (Vercel AI SDK)
MemorySaver              Mastra Memory (different)
@langchain/mcp-adapters  @mastra/mcp (different)
```

Migration = rewrite every agent, every tool binding, every graph, every checkpoint. Not a library swap.

**2. Mastra doesn't have what makes us different.**

| Our Unique Features | Mastra Equivalent | Migration Impact |
|--------------------|--------------------|-----------------|
| Git branch per task | ❌ None | Must keep custom `GitBranchManager` |
| Scratchpad (private thinking) | ❌ None | Must keep custom |
| Workspace modes (repo URL / basic) | ❌ Just basePath | Must keep custom |
| Tree-sitter repo map | ❌ None | Must build either way |
| LSP integration | ❌ None | Must build either way |
| Agent identity card | ❌ None | Must keep custom |
| Multi-stakeholder visibility | ❌ None | Must keep custom |
| Dynamic role discovery (builder agents) | ❌ Different model | Must rebuild |
| MemoryManager task lifecycle | ❌ Different model | Must rebuild |

**Bottom line:** We'd migrate to Mastra and then **still have to build 80% of what we're building anyway** — just on an unfamiliar framework that's 1 month into its 1.0.

**3. Mastra is young.**

- v1.0 released ~January 2026. Breaking changes likely
- 21k GitHub stars but that's hype-driven (Y Combinator W25 batch)
- 328 contributors is strong, but core team is small
- Our current stack (LangChain + LangGraph) is more battle-tested

### What We SHOULD Adopt from Mastra (Selectively)

Instead of migrating, steal the good ideas and implement them on our existing stack:

| Concept | What to Steal | Our Implementation | Priority | Effort |
|---------|--------------|-------------------|----------|--------|
| **BM25 search** | Relevance-ranked keyword search | ✅ Already added as Layer 2.5 (`wink-bm25-text-search`) | P1 | 2-3 days |
| **requireReadBeforeWrite** | Safety: must read before overwriting | ✅ Already added as `SafeAgentWorkspace` | P1 | Done |
| **Auto-indexing** | Index workspace on init | ✅ Already added to `WorkspaceSearchIndex` | P1 | Done |
| **Hybrid search** | BM25 + vector combined scoring | ✅ Already designed in Layer 2.5 | P2 | 1 day (after BM25 + vector) |
| **Skills** | Reusable instruction packages | Extend our identity card with skill packages | P2 | 2-3 days |
| **Cloud providers** | S3/GCS filesystem abstraction | Add `WorkspaceProvider` interface when needed | P3 | 3-5 days |
| **Sandbox safety** | Contained execution, read-only paths | ✅ Already in `SafeAgentWorkspace` + CLI whitelist | P1 | Done |

### What About LSP?

LSP (Language Server Protocol) is **not something Mastra helps with**. Neither Mastra nor any other agent framework provides LSP integration. This is a build-it-yourself feature regardless of framework choice.

**LSP is independent of framework:** It's a protocol for talking to language servers (TypeScript's `tsserver`, Python's `pyright`, etc.). The implementation is:

1. Start a language server as a subprocess
2. Communicate via JSON-RPC over stdin/stdout
3. Expose results as agent tools (go_to_definition, find_references, get_diagnostics)

This works the same whether we use LangChain, Mastra, or raw API calls. **No framework saves us this work.**

```
LSP integration effort: ~5+ days regardless of framework
├── Start/manage language server process lifecycle
├── JSON-RPC client for LSP protocol
├── Map LSP responses to agent-friendly tool outputs
├── Handle workspace indexing delays (tsserver needs time to index)
└── Manage per-workspace server instances (memory considerations)
```

The real question for LSP is **whether it's worth it**, not which framework to use:

| LSP Tool | Value for Agents | Complexity |
|----------|-----------------|------------|
| `get_diagnostics` | ⭐⭐⭐⭐⭐ — Agent sees type errors before committing | Medium |
| `go_to_definition` | ⭐⭐⭐⭐ — Navigate imports, understand code flow | Medium |
| `find_references` | ⭐⭐⭐⭐ — Know what breaks if you change something | Medium |
| `get_hover_info` | ⭐⭐⭐ — Type information without reading source | Low |
| `rename_symbol` | ⭐⭐⭐ — Safe refactoring across files | High |
| `code_actions` | ⭐⭐ — Auto-fix suggestions | High |

**Recommendation:** Start with `get_diagnostics` (highest value, catches errors) + `go_to_definition` + `find_references`. Skip the rest until proven needed.

### Decision: Selective Adoption Roadmap

```
Phase 1 (NOW — 1-2 weeks): Keep current stack, add workspace improvements
├── BM25 search (MiniSearch — see §13 library analysis)
├── requireReadBeforeWrite (already designed)
├── Auto-indexing (already designed)
└── Ripgrep integration (already designed)

Phase 2 (Weeks 3-5): Code navigation
├── Tree-sitter repo map (our research, no Mastra equivalent)
├── LSP: get_diagnostics + go_to_definition + find_references
└── Skills concept (adapt from Mastra's SKILL.md spec)

Phase 3 (Weeks 6-8): Advanced features
├── Hybrid search (BM25 + vector)
├── Semantic search (embedding model + vector store)
└── Cloud workspace providers (IF needed — premature optimization otherwise)

Phase 4 (Future): Evaluate Mastra again
├── If Mastra reaches 2.0 with stable APIs, reconsider
├── If our MCP needs outgrow @langchain/mcp-adapters, consider @mastra/mcp
├── If we need multi-tenant memory, evaluate Mastra Memory vs custom
└── Migration at that point would be informed by production experience
```

**The verdict:** Building on our current stack is the right call. We get the same end result, keep our unique advantages (git, scratchpad, workspace modes, identity), avoid rewrite risk, and can adopt Mastra's good ideas without adopting its framework. LSP is framework-independent — we build it either way.

---

## 13. Library & Reference Code Analysis

> **Purpose:** Identify open-source libraries and reference implementations that can simplify or replace custom code in our implementation plan.  
> **Date:** February 2026  
> **Methodology:** Researched npm packages, GitHub projects, and production agent codebases (Aider, Continue.dev) for reusable components.

### The Question

Our plan (Phases 5-10) calls for building grep, glob, BM25 search, tree-sitter repo map, and symbol indexing. Before writing custom implementations, can existing open-source projects do the heavy lifting?

### Phase 5: grep + glob — Confirmed + Improved

**grep — `@vscode/ripgrep` (keep as planned)**
| Metric | Value |
|--------|-------|
| Weekly downloads | 225K |
| Maintained by | Microsoft |
| How it works | Postinstall downloads platform-specific `rg` binary. Exports `rgPath`. Spawn as child process. |
| License | MIT |

No change. Ripgrep is the standard for fast regex search. Used by VS Code, Continue.dev, and most coding agents.

**glob — Add `fast-glob` (new, replaces ripgrep `--files --glob`)**
| Metric | Value |
|--------|-------|
| Weekly downloads | 90M |
| Dependencies | 5 (all small, well-maintained) |
| TypeScript | Built-in declarations |
| License | MIT |

Our original plan used `@vscode/ripgrep --files --glob` for file listing. `fast-glob` is better because:
- **Pure JavaScript** — no process spawning for file listing
- **Ergonomic API** — `fg('**/*.ts', { cwd: workspaceRoot, ignore: ['node_modules/**'] })`
- **90M weekly downloads** — the most popular glob library in the Node.js ecosystem
- Returns file paths directly (no output parsing)
- Supports `objectMode` with `fs.Stats` (useful for `file_stats`)

```typescript
// Before (ripgrep process spawn):
const { rgPath } = require('@vscode/ripgrep');
const proc = spawn(rgPath, ['--files', '--glob', '**/*.ts', workspaceRoot]);
// parse stdout line by line...

// After (fast-glob):
import fg from 'fast-glob';
const files = await fg('**/*.ts', { cwd: workspaceRoot, ignore: ['node_modules/**'] });
// → ['src/index.ts', 'src/worker/agent.ts', ...]
```

**Decision:** Use `@vscode/ripgrep` for text search (grep), `fast-glob` for file pattern matching (glob). Best tool for each job.

---

### Phase 8: BM25 Search — Swap to MiniSearch

**Why we're replacing `wink-bm25-text-search`:**

| Criteria | `wink-bm25-text-search` | `MiniSearch` |
|----------|------------------------|-------------|
| Weekly downloads | 11K | 705K (62x more) |
| Last published | 3 years ago (2022) | 5 months ago |
| Dependencies | 4 (needs `wink-nlp` + language model for NLP) | **0** |
| TypeScript | No built-in types | Built-in TypeScript declarations |
| Fuzzy search | No (must DIY with wink-nlp stemming) | Built-in (`fuzzy: 0.2`) |
| Prefix search | No | Built-in (`prefix: true`) |
| Auto-suggest | No | Built-in (`autoSuggest()`) |
| Runtime add/remove | **No** — `consolidate()` locks index permanently | Yes — `add()`, `remove()`, `update()` anytime |
| Field boosting | Yes (`fldWeights`) | Yes (`boost: { title: 2 }`) |
| API complexity | 5 mandatory steps | 2 steps |

**The critical problem:** `wink-bm25-text-search` requires calling `consolidate()` before searching, which permanently locks the index — you cannot add, update, or remove documents after consolidation. For a workspace search index that must **re-index on every file change**, this is a fundamental design mismatch. You'd have to rebuild the entire index from scratch on every file create/update/delete.

`MiniSearch` supports incremental updates natively — exactly what a workspace search index needs.

```typescript
// wink-bm25 — must rebuild entire index on any file change:
const engine = bm25();
engine.defineConfig({ fldWeights: { path: 1, content: 2 } });
engine.definePrepTasks([tokenizer]);
allDocs.forEach((doc, i) => engine.addDoc(doc, i));
engine.consolidate();  // ← LOCKED. Can't add/remove/update.
engine.search('auth handler');
// File changed? Start over from scratch.

// MiniSearch — incremental updates:
const index = new MiniSearch({ fields: ['path', 'content'], storeFields: ['path'] });
index.addAll(allDocs);
index.search('auth handler', { fuzzy: 0.2, prefix: true });
// File changed? Just update:
index.remove(oldDoc);
index.add(newDoc);  // ← No rebuild needed.
```

**Also considered:** `FlexSearch` (916K weekly downloads, fastest performance, persistent indexes for MongoDB/SQLite). Rejected because: more complex API, overkill for workspace-scoped search, and we don't need persistence at this level (index lives in memory, rebuilt on workspace init).

**Also considered:** Continue.dev's approach (SQLite FTS5 with trigram tokenizer + BM25 ranking). Robust and battle-tested, but adds SQLite dependency and is more complex than needed for per-workspace search.

**Decision:** Replace `wink-bm25-text-search` with `MiniSearch`. Zero deps, TypeScript-native, incremental updates, built-in fuzzy/prefix.

---

### Phase 10: Tree-sitter — Major Simplification

This is the **biggest win** from this research. Two discoveries:

#### Discovery 1: `web-tree-sitter` + `tree-sitter-wasms` eliminates C++ compilation

Our original plan used native `tree-sitter` + `tree-sitter-typescript` npm packages. These require:
- C++ compilation during `npm install`
- Platform-specific native binaries
- Build tools (node-gyp, Python, C++ compiler) on every machine
- Separate parser package per language

The WASM alternative:

| Package | Downloads | What it does |
|---------|-----------|-------------|
| `web-tree-sitter` | 2M/week | WASM version of tree-sitter. Same API. Works in Node.js. No C++ build. |
| `tree-sitter-wasms` | 72K/week | Pre-compiled `.wasm` files for 19+ languages. Just `npm install`. |

```typescript
// Before (native — requires C++ compilation):
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript/typescript';
const parser = new Parser();
parser.setLanguage(TypeScript);

// After (WASM — just works everywhere):
import Parser from 'web-tree-sitter';
await Parser.init();
const parser = new Parser();
const lang = await Parser.Language.load('path/to/tree-sitter-typescript.wasm');
parser.setLanguage(lang);
```

The API is identical. The only difference: WASM loads async, native loads sync. WASM is ~2x slower than native for parsing, but for our use case (index workspace files on init, re-parse changed files) this is negligible.

#### Discovery 2: Continue.dev has a complete TypeScript reference implementation

**Continue.dev** (31K GitHub stars, Apache 2.0 license, TypeScript) has built exactly what we need for Phase 10. Their code in `core/indexing/` and `core/util/treeSitter.ts` provides:

**1. Language support (`treeSitter.ts`):**
- `LanguageName` enum: 23 languages (TypeScript, JavaScript, Python, Go, Rust, Java, C++, C#, Ruby, PHP, Lua, etc.)
- `supportedLanguages` map: file extension → language name (50+ extensions mapped)
- `getParserForFile(filepath)`: auto-detects language, loads correct WASM parser
- `getLanguageForFile(filepath)`: loads and caches `Language` objects (avoids re-loading WASM)
- `getSymbolsForFile(filepath, contents)`: extracts classes, functions, methods with name, type, range, content
- `getSymbolsForManyFiles(uris, ide)`: batch processing across workspace
- `IGNORE_PATH_PATTERNS`: e.g., skip `node_modules` for TypeScript/JavaScript

**2. Code snippet extraction (`CodeSnippetsIndex.ts`):**
- Uses tree-sitter **query files** (`code-snippet-queries/{language}.scm`) for structured extraction
- Extracts: title (symbol name), signature (type info), content (body), startLine, endLine
- Handles language-specific patterns: interface declarations treated as signatures, not bodies
- SQLite storage with tag-based indexing for multi-branch support

**3. Full-text search (`FullTextSearchCodebaseIndex.ts`):**
- SQLite FTS5 with trigram tokenizer + BM25 ranking
- Path-weighted search (file paths boosted 10x over content)
- Configurable BM25 threshold filtering
- Incremental indexing with content-addressed caching

**4. Key design patterns we can study (not copy):**
- Language → WASM loader with caching (`nameToLanguage` Map)
- Symbol node types: `class_declaration`, `class_definition`, `function_item`, `function_definition`, `method_declaration`, `method_definition`, `generator_function_declaration`
- Recursive tree traversal with `findNamedNodesRecursive()`
- "Last identifier" heuristic: for languages where return type precedes function name, the actual name is the last `identifier` child node
- Tree-sitter query files per language for precise extraction (more robust than node-type matching)

**Impact on Phase 10:**

| Aspect | Original Plan | With Libraries |
|--------|-------------|----------------|
| Parser | Native C++ `tree-sitter` | WASM `web-tree-sitter` — no compilation |
| Language support | `tree-sitter-typescript` only | `tree-sitter-wasms` — 19+ languages out of the box |
| Symbol extraction | Build from scratch | Study Continue.dev's patterns (node types, traversal, query files) |
| WASM loading | N/A | Cache per-language (Continue.dev pattern) |
| Cross-platform | Requires C++ toolchain | Just works (WASM) |
| Estimated effort | 3-5 days | **2-3 days** |

---

### Summary: Updated Dependencies

| Phase | Before | After | Reason |
|-------|--------|-------|--------|
| 5 (grep) | `@vscode/ripgrep` | `@vscode/ripgrep` (no change) | Still best for regex text search |
| 5 (glob) | `@vscode/ripgrep --files --glob` | `fast-glob` | Pure JS, ergonomic API, 90M downloads |
| 8 (BM25) | `wink-bm25-text-search` | `MiniSearch` | Zero deps, incremental updates, fuzzy+prefix built-in |
| 10 (tree-sitter) | `tree-sitter` + `tree-sitter-typescript` | `web-tree-sitter` + `tree-sitter-wasms` | No C++ build, cross-platform, 19+ languages |

**Updated dependency block:**
```json
{
  "dependencies": {
    "simple-git": "^3.x",
    "@vscode/ripgrep": "^1.x",
    "fast-glob": "^3.x",
    "minisearch": "^7.x",
    "web-tree-sitter": "^0.x",
    "tree-sitter-wasms": "^0.x"
  }
}
```

**Estimated days saved: ~3-4 days** across Phases 5, 8, and 10.

**Reference projects:**
- [Continue.dev](https://github.com/continuedev/continue) — Apache 2.0, TypeScript. Study `core/indexing/` and `core/util/treeSitter.ts` for tree-sitter patterns.
- [Aider](https://github.com/Aider-AI/aider) — Apache 2.0, Python. Study repo map algorithm (graph ranking by cross-file references).

---

## Related Documents

- [feature_architecture.md](./feature_architecture.md) — Memory system architecture (L1/L2/L3)
- [v1.0/feature_implementation_planning.md](./v1.0/feature_implementation_planning.md) — Current L1 workspace implementation
- [WORKER_INTEGRATION.md](./WORKER_INTEGRATION.md) — How memory integrates with workers
- [agent.md](../../ping/agent.md) — Unified agent architecture
- [architecture.md](../../ping/architecture.md) — Ping system architecture
