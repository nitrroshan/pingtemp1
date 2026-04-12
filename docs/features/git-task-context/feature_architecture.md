# Git-Based Task Context — Feature Architecture

**Status:** New  
**Date:** March 30, 2026 (Updated April 12, 2026)  
**ID:** A8  
**Depends on:** Worker Architecture (3-layer model)  
**See also:** [MASTER-ARCHITECTURE.md](../MASTER-ARCHITECTURE.md) — Repo Access Model section

---

## Overview

Two git repositories per team: one for **Workspace** (shared deliverables — code, documents, artifacts) and one for **Memory** (per-role personal desk — identity, scratchpad, experiments, activity log). Team-wide knowledge goes to **L2** (CRDT docs via `collab` tool).

### Mapping to Three-Layer Model

| Layer | Workspace Repo (git) | Memory (CRDT) | L2 Team Knowledge (CRDT) |
|---|---|---|---|
| **L1 Planner** | No access | No access | Read (context) |
| **L2 Chat Agent** | **Read-only** (browse, search, answer questions) | **Read + Write** (notes, identity, check history) | Read + Write |
| **L3 Worker** | **Read + Write** (on task branch) | **Read + Write** (activity, scratch) | Read + Write |

**Why memory moved from git to CRDT:** The original design used a per-role git repo for memory. This creates merge conflicts when Chat Agent and Worker(s) both write simultaneously. Memory is personal notes — no need for git's merge workflow. CRDT (same infrastructure as L2 collab) gives real-time sync with zero conflicts.

**CRDT namespace layout:**
```
collab/
├── team/{docName}                     ← Team knowledge (existing L2)
│   "expertise-pricing", "lessons-api", "style-guide"
│
└── memory/{roleId}/                   ← Per-role persistent memory
    ├── identity                       ← role, capabilities, tools (seeded on creation)
    ├── lessons                        ← things worth remembering across tasks
    ├── preferences                    ← personal approach, tool tips, style
    └── activity/{taskId}              ← per-task activity log (kept for history)
```

**Scratchpad (ephemeral, NOT in CRDT):**
```
workspace-clone/task-{taskId}/.scratch/   ← or in-memory map
├── notes.md                              ← rough thinking, temp observations
├── approach.md                           ← current approach being tried
└── data/                                 ← temp files, test outputs

Lifetime: dies when task completes and clone is deleted.
Agent promotes valuable findings → Memory CRDT or Team Knowledge.
```

**Three tiers of agent memory:**

| Tier | Lifetime | Storage | Promote to | Example |
|------|----------|---------|-----------|--------|
| **Scratchpad** | Dies with task | Temp files in clone or in-memory | Memory or Team | "trying approach X...", "API returns 429 at 50/min" |
| **Memory** | Persists across tasks | CRDT (`memory/{roleId}/...`) | Team Knowledge | "batch API is 10x faster", "prefer pandas for data" |
| **Team Knowledge** | Persists across roles | CRDT (`team/{docName}`) | — | "Competitor X uses freemium", "API rate limit is 100/min" |

**Worker identification:** Workers are scoped by `roleId + taskId`. Multiple workers for the same role write to different task-scoped CRDT documents — `memory/{roleId}/activity/{taskId}` — no conflicts ever.

**Sandboxing:** Workers run sandboxed (Crush in container, external agents are already isolated). Chat Agents run in-process — safe because they only have read-only workspace access. Memory writes via CRDT are just personal notes, no code execution risk.

### Current State
- `GitBranchManager` exists — creates branch per task, commits, merges
- Part of `AgentWorkspace` in memory system
- Not fully wired into task lifecycle
- Single repo model — no separation between scratchpad and deliverables
- **31 tools currently in `workspace-tools.ts`** — but 10 are agent-personal tools that belong in memory, not workspace:
  - **Workspace-native (21 tools, stay in workspace-tools.ts):**
    - **File CRUD:** `workspace_create_file`, `workspace_read_file`, `workspace_write_file`, `workspace_delete_file`, `workspace_file_exists`, `workspace_list_files`
    - **Status & Info:** `workspace_status`, `workspace_info`
    - **Version control:** `workspace_commit`, `workspace_get_history`
    - **Lifecycle:** `workspace_publish`, `workspace_reactivate`, `workspace_discard`
    - **Search & navigation:** `workspace_grep`, `workspace_glob`, `workspace_search_and_replace`, `workspace_file_stats`, `keyword_search`
    - **Code intelligence (optional, tree-sitter):** `get_repo_map`, `get_symbols`, `find_symbol`, `get_dependencies`, `get_file_summary`
  - **Moving to memory-tools.ts (10 tools — agent-personal, not workspace-related):**
    - **Scratchpad:** `scratch_note`, `scratch_todo`, `scratch_remember`, `scratch_file`, `promote_to_workspace` → become memory tools
    - **Identity:** `whoami`, `my_progress`, `my_tools`, `my_context` → backed by memory repo identity
    - **Activity:** `workspace_log_activity` → becomes `memory_log_activity`
- **L2 collaboration tool:** `collab` — unified progressive-discovery tool for CRDT docs, plans, and output manifests. **This is where team-wide knowledge lives** — any agent can read/write via `collab({ action: "write", docName: "expertise-pricing", ... })`

### Target State
- **Two repos per team:**
  - **Workspace Repo** (shared) — where agents **actually do their work**. Code, documents, artifacts. Agents commit directly here, just like real developers working in a shared codebase. Task branches for isolation, merged to `main` on user approval. This is the primary working area. Workspace tools handle file CRUD, search, version control, lifecycle, code intelligence — purely about the shared deliverables.
  - **Memory Repo** (per-role) — the agent's **personal desk**. Scratchpad, experiments, drafts, todos, identity, activity log — everything personal to the agent lives here. Initialized with the agent's **identity** (role name, capabilities, assigned tools). Also stores **backlinks to L2** (doc IDs/references). NOT the main working area (that's workspace) and NOT the team knowledge base (that's L2).
- **Three tool layers:**
  - **Workspace tools** (21, in `workspace-tools.ts`) → operate on workspace repo. File CRUD, search, version control, lifecycle, code intelligence. Purely about shared deliverables.
  - **Memory tools** (~25, in `memory-tools.ts`) → operate on memory repo. Scratchpad (note, todo, remember, file), identity (whoami, my_progress, my_tools, my_context), activity logging, CRUD, search, experiments, drafts, profile, L2 backlinks. Everything personal to the agent.
  - **L2 collab tool** (1, existing) → team-wide knowledge. When an agent discovers something valuable for the whole team (domain expertise, patterns, lessons learned), it writes to L2 via `collab`. Any agent can read it.
- Agents get **all three tool layers injected** — workspace for deliverables, memory for agent-personal tools, L2 for shared team knowledge.
- **Memory repo initialized with identity** — on role creation, memory repo is seeded with the agent's identity (role, description, capabilities, assigned tools). Identity tools (`whoami`, etc.) read from this.
- Git commit history in workspace serves as **project history** — what was built, when, by whom.
- Memory repo serves as **resumable personal context** — experiments, drafts, approach notes from prior tasks.
- **L2 serves as team knowledge base** — expertise, patterns, lessons learned that benefit all agents.
- Workspace repo is the **single source of truth** for project deliverables.

---

## Two-Repo Architecture

```
Team: "Marketing Campaign"
│
├── WORKSPACE REPO (shared — where agents DO their work)
│   │
│   workspace/                   ← git repo, shared by all roles
│   ├── main                      ← approved work (merged after review)
│   │   ├── src/                  ← code
│   │   ├── docs/                 ← documents
│   │   ├── assets/               ← design files
│   │   └── output/               ← final artifacts
│   │
│   ├── task/T-001/researcher     ← researcher works HERE on T-001
│   │   ├── research-report.md    ← created directly in workspace
│   │   ├── competitor-matrix.csv ← committed as agent works
│   │   └── test-parser.py        ← even scratch code lives here until cleanup
│   │
│   ├── task/T-004/writer         ← writer works HERE on T-004
│   │   ├── marketing-copy.md     ← written directly in workspace branch
│   │   └── taglines.md           ← all work happens here
│   │
│   └── task/T-005/designer       ← designer works HERE on T-005
│
├── MEMORY REPOS (one per role — agent's personal desk)
│   │
│   researcher-memory/          ← git repo, agent's personal desk
│   ├── main                     ← identity (seeded) + accumulated notes, experiments, activity
│   │   ├── identity/            ← seeded on creation: role, capabilities, tools
│   │   ├── experiments/         ← trial-and-error, prototype approaches
│   │   ├── drafts/              ← work-in-progress that isn't ready for workspace
│   │   ├── tool-notes/          ← personal tool preferences, quirks, tips
│   │   ├── scratch/             ← quick notes, ideas, temporary thoughts
│   │   ├── todos/               ← things to investigate, learn, try later
│   │   ├── activity/            ← activity log (moved from workspace)
│   │   ├── refs/                ← backlinks to L2 docs this agent contributed to
│   │   └── profile.md           ← personal preferences, style, approach
│   │
│   writer-memory/              ← writer's personal desk
│   ├── main
│   │   ├── experiments/         ← tone experiments, draft variations
│   │   ├── drafts/              ← copy drafts not ready for workspace
│   │   ├── refs/                ← backlinks to L2 team knowledge
│   │   └── profile.md           ← writing style preferences
│   │
│   designer-memory/            ← designer's personal area
│   └── ...
│
└── L2 COLLABORATION (team-wide knowledge — ALL agents can access)
    │
    └── collab tool → CRDT docs, plans, output manifests
        ├── "expertise-pricing"    ← team knowledge: competitor pricing research
        ├── "patterns-data"        ← team knowledge: what analysis approaches work
        ├── "lessons-api-limits"   ← team knowledge: API rate limits, gotchas
        └── "style-guide"          ← team knowledge: tone, format preferences
```

### Why Two Repos (+ L2), Not One

```
❌ One repo for everything:
   Agent's experiments and scratch work mixed with project deliverables
   Personal drafts and notes pollute commit history
   No separation between "what I'm trying" and "what I ship"

✅ Two repos + L2:
   Workspace = where agents WORK. Shared, reviewed, merged on approval.
   Memory = agent's PERSONAL DESK. Experiments, drafts, scratchpad, identity, activity log.
   L2 = what the TEAM KNOWS. Domain expertise, patterns, lessons learned.
   
   Clean three-way separation:
   - Working (workspace) → shared deliverables
   - Experimenting (memory) → personal desk (identity, scratchpad, activity), private
   - Knowing (L2) → team knowledge, accessible to all agents
   
   Agent discovers something valuable? Write to L2 so everyone benefits.
   Agent wants to try something? Use memory repo — no one else sees it.
   Agent has a final deliverable? Commit to workspace for team review.
```

---

## Memory Repo: Per-Role Scratchpad & Experiment Area

Each role has its own git repo. This is the agent's **personal desk** — scratchpad, experiments, drafts, identity, activity log, and personal notes. Initialized with the agent's **identity** on creation. Team-wide knowledge goes to L2 (via `collab` tool), not here.

### What Memory Is (and Isn't)

```
❌ Wrong: "Memory repo = the team's knowledge base"
   Team knowledge goes to L2 — all agents can access it via collab tool.
   Memory is NOT for things the whole team should know.

❌ Wrong: "Memory repo = the agent's workspace"
   Agents work in the WORKSPACE repo, not here.
   Memory is NOT for deliverables or final artifacts.

✅ Right: "Memory repo = the agent's personal desk / scratchpad"
   Like a developer's scratch directory, experiment folder, or personal notes:
   
   - Identity ("I am the researcher role, my tools are..., my capabilities are...")
   - Activity log ("worked on T-001, called 5 tools, produced 2 files")
   - Experiments ("tried approach X with batch API — results inconclusive")
   - Drafts ("rough outline of report, not ready for workspace yet")
   - Personal notes ("this API is quirky, auth header must be lowercase")
   - Tool preferences ("grep with -C3 context works best for this codebase")
   - Todos ("investigate batch API limits — might be higher than standard")
   - Scratch code & prototypes (code the agent is experimenting with)
   - Backlinks to L2 ("contributed expertise-pricing doc, see ref/L2-pricing-doc-id")
   
   Think of it as the agent's DESK — initialized with who they are, enriched as they work.
   When something is good enough for the team → write to L2 via collab tool.
   When something is a final deliverable → commit to workspace.

✅ Also right: "Agent can keep personal knowledge here too"
   Some things are personal, not worth sharing team-wide:
   - "I prefer starting with pandas for data tasks" (personal approach)
   - "Last time I tried X it was slow" (personal lesson)
   But if it's useful to ALL agents → put it in L2 instead.
```

### Knowledge Flow: Memory → L2

```
Agent working on task T-001:
  │
  ├── Tries an experiment in memory repo (personal)
  │   memory_write("experiments", "batch-api-test", "tried batch, 10x faster")
  │
  ├── Discovers something team-valuable
  │   collab({ action: "write", docName: "lessons-api-limits", 
  │            key: "batch-api", value: "Batch endpoint is 10x faster..." })
  │
  └── Stores backlink in memory repo
      memory_write("refs", "L2-api-limits", "doc: lessons-api-limits, key: batch-api")

Result: Team knowledge is in L2 (all agents can find it).
        Agent's personal notes/experiments stay in memory repo.
        Backlink connects the two.
```

### When Does Memory Get Written?

Memory is the agent's personal scratch area. The agent uses it **during execution** — freely, like a developer using their scratch directory:

**1. Agent uses memory tools during execution** (identity, scratchpad, activity, CRUD):
- Agent checks its identity → `whoami()` reads from `identity/role.md`
- Agent logs what it's doing → `log_activity("searched 5 competitor sites")`
- Agent makes a quick note → `scratch_note("API requires lowercase auth header")`
- Agent tracks a todo → `scratch_todo("test batch rate limits")`
- Agent wants to try something → writes experiment to memory
- Agent has a rough draft → saves to memory drafts, later `promote_to_workspace`
- Agent discovers team-valuable knowledge → writes to **L2** via `collab`, stores **backlink** in memory
- Agent checks what it tried before → searches memory for prior experiments

**2. Automated post-task extraction** (bonus, catches implicit learnings):
- After task completes/fails, a post-task hook runs
- Analyzes workspace diff + task result → distills learnings
- **Team-relevant learnings** → written to L2 (via collab) + backlink stored in memory
- **Personal notes** (approach, tool quirks) → written to memory directly
- Especially valuable for failures: "tried X, didn't work because Y"

```
During task execution (agent uses identity + scratchpad + collab actively):
  Agent calls whoami()                                                        ← identity
  Agent calls log_activity("searched 5 competitor sites")                     ← activity
  Agent calls scratch_note("this API requires lowercase auth header")         ← scratchpad
  Agent calls scratch_todo("test if batch endpoint has higher rate limit")    ← scratchpad
  Agent calls memory_experiment("approach-a", "batch API test results...")    ← experiment
  Agent calls memory_draft("report-outline", "rough structure...")            ← draft
  Agent calls collab({ action: "write", docName: "expertise-pricing", ... }) ← L2
  Agent calls memory_ref("expertise-pricing")                                 ← backlink
  → Memory commits are immediate (agent's personal desk, no review needed)

After task completes:
  Post-task hook runs → analyzes workspace diff + output
  → Team learnings → L2 (via collab)
  → Personal notes → memory repo
  → Backlinks stored in memory for cross-reference
```

### Branch Strategy

Memory repos are simpler than workspace repos — no task branches needed. Personal scratch notes committed directly to `main` (it's not collaborative, no conflicts).

```
researcher-memory/
│
└── main                          ← all personal notes/experiments live here
    ├── identity/
    │   ├── role.md               ← "researcher" — description, capabilities
    │   └── tools.md              ← assigned tools, skills, permissions
    ├── experiments/
    │   ├── batch-api-test.md     ← tried batch API during T-001
    │   └── pandas-vs-polars.md   ← compared approaches during T-007
    ├── drafts/
    │   └── report-outline.md     ← rough draft, not ready for workspace
    ├── tool-notes/
    │   └── web-search.md         ← "quoted phrases work 3x better"
    ├── scratch/
    │   └── quick-notes.md        ← random ideas, temporary thoughts
    ├── todos/
    │   └── investigate.md        ← "test batch rate limits", "try polars"
    ├── activity/
    │   └── T-001.md              ← activity log for task T-001
    ├── refs/
    │   ├── L2-expertise-pricing  ← backlink: contributed to L2 pricing doc
    │   └── L2-lessons-api        ← backlink: contributed to L2 API lessons
    └── profile.md                ← personal preferences (approach, style)

Agent's personal desk gets richer over time. Experiments accumulate,
drafts evolve, todos get checked off, tool notes grow.
Team-valuable discoveries live in L2 — backlinks in refs/ connect them.
```

### What Gets Committed to Memory Repo

Memory is the agent's **personal desk** — identity, scratchpad, activity log, experiments, drafts, notes. Team knowledge goes to L2.

| Content | When Written | Where | Example |
|---|---|---|---|
| **Identity** | On role creation | `identity/` | "Role: researcher. Capabilities: web search, data analysis" |
| **Activity log** | During execution | `activity/` | "T-001: called 5 tools, produced research-report.md" |
| **Experiments** | During execution | `experiments/` | "Tried batch API — 10x faster than individual calls" |
| **Drafts** | During execution | `drafts/` | "Rough report outline, needs competitor data" |
| **Tool notes** | During execution | `tool-notes/` | "web-search: quoted phrases give 3x better results" |
| **Quick notes** | During execution | `scratch/` | "Found 3 promising leads, need to verify pricing" |
| **Personal todos** | During execution | `todos/` | "Test batch API rate limits", "Try polars vs pandas" |
| **Profile/preferences** | During execution | `profile.md` | "I prefer starting with data exploration first" |
| **L2 backlinks** | After L2 write | `refs/` | "doc: expertise-pricing, key: competitor-x" |
| **Post-task notes** | Post-task hook | `scratch/` or `tool-notes/` | Personal learnings from workspace diff |
| **Domain expertise** | During execution | **L2** (via `collab`) | "Competitor X uses freemium, 3-tier pricing" (team knowledge) |
| **Patterns** | During execution | **L2** (via `collab`) | "For data analysis: pandas + batch API works best" (team knowledge) |
| **Lessons learned** | During + post-task | **L2** (via `collab`) | "API has 100/min rate limit" (team should know) |
| **Anti-patterns** | Post-task (failures) | **L2** (via `collab`) | "Don't scrape X.com — CAPTCHA blocks" (team should know) |

### How Memory + L2 Help Future Tasks

When the same role gets a similar task, it draws from **both** sources — personal memory (identity, scratchpad, activity) AND team knowledge (L2):

```
New task T-015: "Research pricing strategies"

L2 team knowledge (accessible to ALL agents):
  ├── expertise-pricing         (researcher contributed via collab during T-001)
  ├── lessons-api-limits        (extracted post-T-003, shared to L2)
  └── patterns-data-analysis    (researcher contributed during T-007)

Researcher's personal memory repo (private to this role):
  ├── identity/role.md                  (seeded on creation: "researcher, web search + data analysis")
  ├── experiments/batch-api-test.md   (tried batch approach during T-001)
  ├── tool-notes/web-search.md       (personal tip: "quoted phrases 3x better")
  ├── todos/investigate.md            ("test batch rate limits" — still open)
  ├── activity/T-001.md              (activity log from T-001)
  └── refs/L2-expertise-pricing       (backlink: "I wrote the pricing doc")

Agent prompt includes:
  "Team knowledge on this topic:
   - Competitor X uses freemium model (from L2: expertise-pricing)
   - API rate limit: use batch endpoint (from L2: lessons-api-limits)
  Your identity: researcher role, web search + data analysis
  Your personal notes:
   - You previously experimented with batch API (experiments/batch-api-test)
   - You noted: quoted phrases 3x better for web-search (tool-notes/web-search)
   - Open todo: test batch rate limits
   - Activity: you worked on T-001 (searched 3 sources, produced report)"

Result: Agent has team knowledge (L2) + personal experience (memory).
Team knowledge benefits ALL agents. Personal experiments benefit THIS agent.
```

### Memory Commit Convention

```
On role creation (identity seed):
  [system] identity: Initialize researcher role — capabilities, tools, description

During execution (agent saves to personal desk):
  [T-001/researcher] activity: Searched 5 sources, found 3 leads
  [T-001/researcher] scratch-note: this API requires lowercase auth header
  [T-001/researcher] scratch-todo: test if batch endpoint has higher rate limit
  [T-001/researcher] experiment: Tried batch API — 10x faster than sequential
  [T-001/researcher] draft: Rough report outline for competitor analysis
  [T-001/researcher] tool-note: web-search works better with quoted phrases
  [T-001/researcher] todo: Test batch API rate limits
  [T-001/researcher] ref: Contributed to L2 expertise-pricing doc
  [T-004/writer] draft: Initial copy variations for product X
  [T-004/writer] profile: Prefer short paragraphs, formal B2B tone

Post-task extraction (automated hook):
  [post-T-001] scratch: API auth header must be lowercase (personal quirk)
  [post-T-003] → L2 lesson: CAPTCHA blocks scraping after 5 requests (team knowledge)
  [post-T-003] ref: Contributed to L2 lessons-scraping doc
```

---

## Workspace Repo: Where Agents Do Their Work

One repo per team. All roles work directly here. This is the project's source of truth — **agents commit their actual work here, just like real developers.**

### Branch Strategy

```
workspace/
│
├── main                              ← approved work (merged after review)
│   (only gets commits after user approval)
│
├── task/T-001/researcher  ─────────┐     ← researcher WORKS HERE on T-001
│   research-report.md          │     created, edited, iterated directly
│   competitor-matrix.csv       │     User approves → merge to main
│   test-parser.py              │     (scratch files cleaned up before merge)
│   └───────────────────────────┘
│
├── task/T-004/writer  ────────────┐     ← writer WORKS HERE on T-004
│   marketing-copy.md           │     drafts, rewrites, all happen here
│   taglines.md                 │     User reviews → request changes → writer revises
│   └───────────────────────────┘     User approves → merge to main
│
├── task/T-005/designer  ───────┐     ← designer's deliverables for T-005
│   hero-banner.png             │
│   social-cards/               │     (binary files — consider LFS for large assets)
│   └───────────────────────────┘
│
└── main (after all merges):
    ├── research-report.md          ← from T-001
    ├── competitor-matrix.csv       ← from T-001
    ├── marketing-copy.md           ← from T-004
    ├── taglines.md                 ← from T-004
    ├── hero-banner.png             ← from T-005
    └── social-cards/               ← from T-005
```

### Workspace Commit Convention

```
[T-004/writer] complete: Marketing copy for product X

Artifacts: marketing-copy.md, taglines.md
Acceptance: Formal tone, B2B audience, includes 3 CTAs
Status: pending-approval
```

### Merge Flow (Artifact Approval)

```
Worker completes task
  │
  ├── Commits deliverables to task branch in workspace repo
  │   git commit -m "[T-004/writer] complete: Marketing copy"
  │
  ├── Orchestrator emits: present_artifact tool call
  │   → User sees preview in chat + approve/reject buttons
  │
  ├── User approves
  │   → Orchestrator merges: task/T-004/writer → main
  │   → Branch deleted (or preserved for audit)
  │
  ├── User requests changes
  │   → Writer continues on same branch
  │   → Commits revision: "[T-004/writer] revision: Added pricing section"
  │   → Re-submitted for approval
  │
  └── User rejects
      → Branch preserved (for reference)
      → Task marked 'rejected'
      → Planner may reassign or skip
```

### Merge Conflict Handling

Two workers on different tasks may touch the same file in the workspace repo:

```
T-004/writer modifies README.md (adds copy section)
T-005/designer modifies README.md (adds image references)
Both branches merge to main → CONFLICT

Resolution:
  1. Orchestrator detects conflict during merge
  2. Orchestrator creates a merge task: "Resolve conflict in README.md"
  3. Assigns to a worker (or asks user)
  4. Worker resolves conflict, commits merge
```

This is rare in practice — tasks usually produce distinct files. When it happens, it's handled through the normal task system.

---

## Task Lifecycle Integration

```
Task assigned (Orchestrator dispatches):
  │
  ├── Workspace repo: create branch task/T-001/researcher
  │   └── git checkout -b task/T-001/researcher main
  │   └── Agent's working directory points HERE
  │
  └── Worker starts with workspace repo mounted

Worker executes:
  │
  └── Workspace repo: agent creates/edits files directly
      ├── Creates research-report.md (draft v1)
      ├── Rewrites to v2, v3 (all on same branch)
      ├── Creates test-parser.py (scratch work)
      └── Committed periodically (auto-commit every N ops or M minutes)
      └── Agent works like a real dev: edit, commit, iterate

During execution:
  │
  ├── Memory repo: agent uses as personal desk (identity, scratchpad, activity)
  │   ├── whoami() → reads identity/ (role name, capabilities, tools)
  │   ├── my_progress() → reads activity/ + task context
  │   ├── log_activity("searched 5 sources, found 3 leads")
  │   ├── scratch_note("this API requires lowercase auth header")
  │   ├── scratch_todo("test if batch endpoint has higher rate limit")
  │   ├── memory_write("experiments", "approach-a", "batch API test — results...")
  │   ├── memory_write("drafts", "rough-outline", "report structure draft...")
  │   └── All committed immediately — agent's personal desk
  │
  └── L2 collaboration: agent shares team-valuable knowledge
      ├── collab({ action: "write", docName: "expertise-pricing", ... })
      ├── memory_write("refs", "L2-pricing", "doc: expertise-pricing") ← backlink
      └── All agents on the team can now access this knowledge

Task completes:
  │
  ├── Workspace repo: final commit, awaits approval
  │   └── User approves → merge to main (optional: squash commits)
  │   └── User rejects → branch preserved, agent continues or replans
  │
  └── Memory repo: post-task hook extracts learnings
      ├── Analyzes workspace diff for insights
      ├── Team-relevant → writes to L2 (via collab) + backlink in memory refs/
      ├── Personal notes → writes to memory scratch/ or tool-notes/
      └── All committed — agent's scratchpad enriched, team knowledge updated

Task fails:
  │
  ├── Workspace repo: branch preserved (partial work may be salvageable)
  │   └── Planner may retry with a new branch: task/T-001-retry/researcher
  │
  └── Memory repo: agent may have saved experiments during execution +
      post-task hook extracts failure learnings (ESPECIALLY valuable)
      ├── Agent already saved: "Tried approach X, didn't scale past 100/min"
      ├── Hook adds personal note: "API auth header must be lowercase"
      ├── Hook adds team lesson → L2: "Don't use endpoint Z for bulk queries"
      ├── Backlink stored: refs/L2-bulk-query-lesson
      └── Next time: agent has personal experiments + team knows the anti-pattern
```

---

## How Memory + L2 History Helps

### Same Task Retried

```
T-001 failed. Planner retries with T-001-retry.

L2 now has (team knowledge):
  "lessons-api-limits" doc: "API rate limit at 100/min, use batch endpoint"
  (written by post-task hook after T-001 failure)

researcher-memory/main has (personal notes):
  experiments/batch-api-test.md: "Tried sequential calls, hit rate limit at 4 min"
  refs/L2-api-limits: backlink to the L2 lesson doc

New worker for T-001-retry gets BOTH injected:
  - Team knowledge: "batch endpoint is faster" (from L2)
  - Personal notes: "I tried sequential, it failed at 4 min" (from memory)
Result: Worker avoids the same mistake + knows exactly what was tried.
```

### Similar Future Task

```
6 months later, new team, new goal: "Research our competitors"

L2 team knowledge (accessible to ALL agents):
  expertise-pricing, patterns-data, lessons-api-limits, ...
  10+ CRDT docs with team knowledge from prior tasks

researcher-memory/main (personal desk — identity, scratchpad, activity):
  experiments/ — 5 experiment logs from prior tasks
  tool-notes/ — personal tool preferences
  todos/ — open items to investigate

Both sources searched. Team knowledge benefits everyone.
Personal experiments benefit this specific role.

Result: Agent is experienced, not naive. Team knowledge + personal history.
```

### Role Transfer

```
Researcher role reassigned from Agent A to Agent B (model upgrade, etc.)

Memory repo transfers — new agent gets the role's identity, activity history, and personal notes.
L2 team knowledge is already accessible to everyone — no transfer needed.
Like onboarding: new employee reads predecessor's desk notes + identity + has access to team wiki.
```

---

## Storage & Cleanup

### Memory Repos
- **Size:** Small (experiments, drafts, notes — not final deliverables)
- **Retention:** Permanent per role. This IS the role's personal history.
- **Cleanup:** Agent can delete stale experiments/drafts. Todos get resolved.
- **Location:** `data/teams/{teamId}/memory/{role}/` (local git repos)

### Workspace Repo
- **Size:** Varies — code is small, binary assets can be large
- **Retention:** Permanent per team. Main branch is the project output.
- **Cleanup:** Delete merged task branches after approval (keep main). Squash-merge to keep history clean.
- **Large files:** Git LFS for images, binaries > 1MB
- **Location:** `data/teams/{teamId}/workspace/` (local git repo)

---

## Implementation Checklist

| Component | Status | Action |
|---|---|---|
| `GitBranchManager` | ✅ Exists | Refactor into `RepoManager` pattern |
| Workspace tools (21 tools in `workspace-tools.ts`) | ✅ Exists → REFACTOR | File CRUD, grep/glob, search & replace, keyword search, code intel (repo map, symbols, find, deps, summary), commit, history, publish, lifecycle, status, info. Operate on **workspace repo** only. **Remove** scratchpad, identity, and log_activity tools (moving to memory). |
| L2 collaboration tool | ✅ Done | `collab` — progressive-discovery over CRDT docs, plans, and output manifests |
| Workspace repo creation | ❌ Missing | Create per-team repo on team creation |
| Memory repo creation + identity seed | ❌ Missing | Create per-role repo on role creation. **Initialize with identity:** seed `identity/role.md` (role name, description, capabilities) + `identity/tools.md` (assigned tools, skills) + `profile.md`. Identity tools (`whoami`, `my_progress`, etc.) read from this. |
| Memory tools (~25 tools in `memory-tools.ts`) | ❌ Missing | **Separate toolset** for memory repo (agent's personal desk). Includes: **Moved from workspace:** scratchpad (`scratch_note`, `scratch_todo`, `scratch_remember`, `scratch_file`, `promote_to_workspace`), identity (`whoami`, `my_progress`, `my_tools`, `my_context`), activity (`log_activity`). **New:** CRUD (`memory_read`, `memory_write`, `memory_delete`, `memory_exists`, `memory_list`), search (`memory_search`, `memory_search_by_task`), scratchpad-specific (`memory_experiment`, `memory_draft`), profile (`memory_profile`), status (`memory_status`, `memory_history`), L2 backlinks (`memory_ref`). Operate on **memory repo** only. |
| L2 knowledge integration | ⚠️ Partial | `collab` tool exists but post-task hook doesn't write team learnings to L2 yet. Hook should route team-relevant learnings → L2 (via collab), personal notes → memory repo, and store backlinks in `refs/`. |
| Tool injection (all three layers) | ❌ Missing | WorkerPool injects workspace tools (21) + memory tools (~25) + L2 collab (1) per agent |
| Task lifecycle hooks | ⚠️ Partial | Wire `onTaskStart` (create workspace branch), `onTaskComplete` (mark ready + extract learnings), `onTaskFail` (preserve branch + extract failure learnings) |
| Auto-commit during execution | ❌ Missing | Periodic commits in workspace repo |
| Merge-to-main on approval | ⚠️ Partial | Workspace: merge after user approval |
| Conflict detection | ❌ Missing | Detect + create resolution task |
| Post-task learning extraction | ❌ Missing | LLM distills learnings from workspace diff → team learnings to L2 (via collab) + personal notes to memory repo + backlinks |
| Memory search for context | ❌ Missing | Grep memory repo for personal experiments/notes + search L2 for team knowledge |
| Git LFS for binaries | ❌ Missing | Configure for workspace repo |

**Effort:** Medium (2-3 weeks)
