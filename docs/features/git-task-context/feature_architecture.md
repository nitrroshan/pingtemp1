# Git-Based Task Context — Feature Architecture

**Status:** New  
**Date:** March 30, 2026  
**ID:** A8  
**Depends on:** A4 (Worker Sandboxing)

---

## Overview

Two git repositories per team: one for **L1 Memory** (per-role reasoning, notes, tool history) and one for **L1 Workspace** (shared deliverables — code, documents, artifacts). Each role owns its memory repo; all roles share the workspace repo.

### Current State
- `GitBranchManager` exists — creates branch per task, commits, merges
- Part of `AgentWorkspace` in memory system
- Not fully wired into task lifecycle
- Single repo model — no separation between memory and deliverables

### Target State
- **Two repos per team:**
  - **Memory Repo** (per-role) — the agent's private play area. Reasoning logs, drafts, experiments, scratch code, tool history, working notes. The agent works HERE freely — tries things, fails, iterates. Role's `main` = accumulated knowledge. Task branches for isolation, merged back on completion.
  - **Workspace Repo** (shared) — deliverables only. Code, documents, artifacts that the agent **promotes** from its play area when ready. Task branches for isolation, merged to main on user approval.
- Git commit history serves as **resumable context** — if the same task comes again, the role's memory repo has the history.
- Workspace repo is the **single source of truth** for project deliverables.

---

## Two-Repo Architecture

```
Team: "Marketing Campaign"
│
├── MEMORY REPOS (one per role — private play area + knowledge)
│
│   researcher-memory/          ← git repo, owned by researcher role
│   ├── main                     ← accumulated knowledge across all tasks
│   │   ├── findings/            ← research notes, analysis
│   │   ├── drafts/              ← work-in-progress files
│   │   ├── scratch/             ← experiments, test scripts, intermediate data
│   │   ├── tool-history/        ← what tools were called, what worked
│   │   └── reasoning-log.md     ← decision rationale
│   │
│   ├── task/T-001               ← branch for current task (agent's sandbox)
│   │   ├── draft-report-v1.md   ← first attempt
│   │   ├── draft-report-v2.md   ← revised after feedback
│   │   ├── scraped-data.json    ← intermediate data
│   │   ├── test-parser.py       ← scratch code to validate approach
│   │   └── reasoning-log.md     ← task-specific reasoning
│   │
│   └── task/T-007               ← another concurrent task
│
│   writer-memory/              ← git repo, owned by writer role
│   ├── main                     ← writer's accumulated knowledge
│   ├── task/T-004               ← branch for current task
│   └── ...
│
│   designer-memory/            ← git repo, owned by designer role
│   └── ...
│
└── WORKSPACE REPO (shared — deliverables)
    │
    workspace/                   ← git repo, shared by all roles
    ├── main                      ← approved deliverables (merged after review)
    │   ├── src/                  ← code
    │   ├── docs/                 ← documents
    │   ├── assets/               ← design files
    │   └── output/               ← final artifacts
    │
    ├── task/T-001/researcher     ← researcher's deliverables for T-001
    ├── task/T-004/writer         ← writer's deliverables for T-004
    ├── task/T-005/designer       ← designer's deliverables for T-005
    └── ...
```

### Why Two Repos, Not One

```
❌ One repo for everything:
   Researcher's reasoning notes mixed with production code
   Writer's draft iterations alongside API endpoints
   Can't give a role access to its own history without exposing others
   Merge conflicts between reasoning logs and code changes
   Browsing commit history is noise — 80% is internal notes

✅ Two repos:
   Memory = private, per-role, never leaves the role
   Workspace = shared, reviewed, merged to main on approval
   Clean separation: thinking vs delivering
   Role can browse its own memory history freely
   Workspace history is meaningful — only deliverables
```

---

## Memory Repo: Per-Role Knowledge + Play Area

Each role has its own git repo. This is **L1-Memory + the agent's sandbox** — a private space where the agent thinks, experiments, and works before promoting deliverables to the shared workspace.

### It's Not Just Notes — It's the Agent's Play Area

```
❌ Too narrow: "Memory repo = reasoning logs"
   Just a diary. Agent writes notes and that's it.

✅ Full picture: "Memory repo = the agent's private workspace"
   Reasoning logs, yes — but also:
   - Draft files the agent is experimenting with
   - Code it's testing before committing to workspace
   - Scratch analysis, intermediate data processing
   - Failed attempts (kept as learnings)
   - Prototypes, explorations, proof-of-concepts
   
   Think of it as the agent's DESK — messy, private, productive.
   Only the finished work goes to the shared workspace.
```

The memory repo is where an agent can **try things without consequences**. Write a draft, delete it, rewrite it. Run a script, see it fail, fix it. None of this noise reaches the shared workspace — only the polished deliverable does.

### Branch Strategy

```
researcher-memory/
│
├── main                          ← role's accumulated knowledge
│   (merged from completed task branches)
│
├── task/T-001  ──────────────┐   ← created when task assigned
│   Working notes, reasoning  │
│   Tool call logs            │   Task completes → merge to main
│   Discoveries, findings     │   Task fails → branch preserved (learnings kept)
│   └──────────────────────────┘
│
├── task/T-007  (active)          ← another concurrent task
│
└── main now contains:
    T-001 findings + T-007 findings + ...
    Role gets SMARTER over time
```

### What Gets Committed to Memory Repo

| Content | When | Example |
|---|---|---|
| **Reasoning log** | During execution | "Tried approach A, failed due to rate limits. Switching to B." |
| **Tool call history** | After each tool call | "Called web-search('competitor analysis'), got 12 results" |
| **Working notes** | During execution | "Key finding: top competitor uses freemium model" |
| **Discoveries** | On significant finding | "API has undocumented rate limit of 100/min" |
| **Drafts & experiments** | During work | Draft v1 of marketing copy, test script for data parsing |
| **Scratch code** | During prototyping | Quick script to validate API response format works |
| **Intermediate data** | During analysis | Scraped data, transformed CSVs, partial results |
| **Failed attempts** | On failure | "Tried scraping approach — blocked by CAPTCHA. Keeping for reference." |
| **Task summary** | On task completion | "Completed market research. 3 direct threats identified." |

### The Promotion Flow: Play Area → Workspace

```
Memory Repo (private play area)         Workspace Repo (shared deliverables)
┌────────────────────────────┐         ┌─────────────────────────────┐
│                            │         │                             │
│  draft-v1.md  ← bad       │         │                             │
│  draft-v2.md  ← better    │         │                             │
│  draft-v3.md  ← good!     │ ──────▶ │  marketing-copy.md  ✓      │
│  test-script.py            │         │                             │
│  scraped-data.json         │         │                             │
│  analysis-notes.md         │ ──────▶ │  competitor-matrix.csv  ✓  │
│  reasoning-log.md          │         │                             │
│  tool-history.md           │         │                             │
│                            │         │                             │
│  (everything stays here)   │         │  (only final deliverables)  │
└────────────────────────────┘         └─────────────────────────────┘

Agent decides what to promote:
  "draft-v3.md is ready → copy to workspace as marketing-copy.md"
  "analysis-notes.md → distill into competitor-matrix.csv for workspace"
  "test-script.py → stays in memory, not a deliverable"
```

The agent explicitly promotes files from its play area to the workspace when they're ready. The workspace only receives polished output.

### Resumable Context

When the same role gets a similar task again, the memory repo provides history:

```
New task T-015: "Research pricing strategies"

Researcher's memory repo (main branch) already has:
  ├── task/T-001 findings (market research — includes competitor pricing)
  ├── task/T-007 findings (industry analysis — includes pricing trends)
  └── reasoning-log.md mentions pricing in 3 prior tasks

Agent prompt includes: "Your prior research history is available in your memory.
Relevant past work: [git log --grep='pricing' → 3 commits found]"

Result: Agent doesn't start from scratch. It builds on accumulated knowledge.
```

### Memory Commit Convention

```
[T-001] reasoning: Tried API approach, switching to scraping due to rate limits

Role: researcher
Task: Market competitor analysis  
Tools: web-search (3 calls), read-url (5 calls)
Duration: 4m 23s
```

---

## Workspace Repo: Shared Deliverables

One repo per team. All roles commit their deliverables here. This is the project's source of truth.

### Branch Strategy

```
workspace/
│
├── main                              ← approved, merged deliverables
│   (only gets commits after user approval)
│
├── task/T-001/researcher  ─────┐     ← researcher's deliverables for T-001
│   research-report.md          │
│   competitor-matrix.csv       │     User approves → merge to main
│   └───────────────────────────┘
│
├── task/T-004/writer  ─────────┐     ← writer's deliverables for T-004
│   marketing-copy.md           │
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
  ├── Memory repo: create branch task/T-001
  │   └── git checkout -b task/T-001 main
  │
  ├── Workspace repo: create branch task/T-001/researcher
  │   └── git checkout -b task/T-001/researcher main
  │
  └── Worker starts with both repos mounted

Worker executes:
  │
  ├── Memory repo: worker writes reasoning, notes, tool history
  │   └── auto-committed periodically (every N tool calls or every M minutes)
  │
  └── Workspace repo: worker writes deliverables (code, docs, assets)
      └── committed on meaningful milestones

Task completes:
  │
  ├── Memory repo: final commit + merge to main
  │   └── git merge task/T-001 → main (always fast-forward or auto-merge)
  │   └── Role's main now includes this task's learnings
  │
  └── Workspace repo: final commit, awaits approval
      └── User approves → merge to main
      └── User rejects → branch preserved

Task fails:
  │
  ├── Memory repo: commit what was learned, merge to main anyway
  │   └── Failure learnings are VALUABLE — "tried X, it broke because Y"
  │   └── Next time this role gets a similar task, it knows what NOT to do
  │
  └── Workspace repo: branch preserved (partial work may be salvageable)
      └── Planner may retry with a new branch: task/T-001-retry/researcher
```

---

## How Memory History Helps

### Same Task Retried

```
T-001 failed. Planner retries with T-001-retry.

researcher-memory/main now has:
  commit: "[T-001] failed: API rate limit at 100/min, approach A doesn't scale"

New worker for T-001-retry sees this history.
Agent prompt: "Previous attempt failed due to rate limits. See memory for details."
Result: Worker avoids the same mistake.
```

### Similar Future Task

```
6 months later, new team, new goal: "Research our competitors"

researcher-memory/main has commit history from 20+ prior research tasks.
Agent can search its own memory: git log --grep="competitor" --oneline
Finds: 7 relevant prior tasks with findings, approaches, tools used.

Result: Agent is experienced, not naive. It knows what works.
```

### Role Transfer

```
Researcher role reassigned from Agent A to Agent B (model upgrade, etc.)

Memory repo is the same. New agent inherits the role's FULL history.
Like onboarding a new employee — they read the predecessor's notes.
```

---

## Storage & Cleanup

### Memory Repos
- **Size:** Small (text only — reasoning logs, notes, tool history)
- **Retention:** Permanent per role. This IS the role's knowledge.
- **Cleanup:** None needed — accumulated knowledge is the point
- **Location:** `data/teams/{teamId}/memory/{role}/` (local git repos)

### Workspace Repo
- **Size:** Varies — code is small, binary assets can be large
- **Retention:** Permanent per team. Main branch is the project output.
- **Cleanup:** Delete merged task branches after approval (keep main)
- **Large files:** Git LFS for images, binaries > 1MB
- **Location:** `data/teams/{teamId}/workspace/` (local git repo)

---

## Implementation Checklist

| Component | Status | Action |
|---|---|---|
| `GitBranchManager` | ✅ Exists | Extend for two-repo model |
| Memory repo creation | ❌ Missing | Create per-role repo on team/role creation |
| Workspace repo creation | ❌ Missing | Create per-team repo on team creation |
| Task lifecycle hooks | ⚠️ Partial | Wire `onTaskStart`, `onTaskComplete`, `onTaskFail` |
| Auto-commit during execution | ❌ Missing | Periodic commits in memory repo |
| Merge-to-main on completion | ⚠️ Partial | Memory: auto-merge. Workspace: after approval. |
| Conflict detection | ❌ Missing | Detect + create resolution task |
| Memory search for context | ❌ Missing | `git log --grep` for relevant prior work |
| Git LFS for binaries | ❌ Missing | Configure for workspace repo |

**Effort:** Medium (2-3 weeks)
