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
  - **Workspace Repo** (shared) — where agents **actually do their work**. Code, documents, artifacts. Agents commit directly here, just like real developers working in a shared codebase. Task branches for isolation, merged to `main` on user approval. This is the primary working area.
  - **Memory Repo** (per-role) — the agent's **personal knowledge store**, like how Copilot stores memories or how AI agents store context/preferences/learnings. NOT a working area. Contains: reasoning patterns, tool preferences, domain expertise notes, lessons learned, approach summaries. Role's `main` = accumulated knowledge. Updated after tasks complete (learnings extracted, not raw work).
- Git commit history in workspace serves as **project history** — what was built, when, by whom.
- Memory repo serves as **resumable context** — if the same role gets a similar task, its memory has learned patterns from prior work.
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
└── MEMORY REPOS (one per role — personal knowledge store, like Copilot memory)
    │
    researcher-memory/          ← git repo, NOT a working area
    ├── main                     ← accumulated knowledge across all tasks
    │   ├── expertise/           ← domain knowledge summaries
    │   ├── patterns/            ← "what works" for common task types
    │   ├── tool-notes/          ← tool preferences, quirks, tips
    │   ├── lessons-learned/     ← agent-saved + hook-extracted from tasks
    │   └── profile.md           ← role preferences, style, approach patterns
    │
    writer-memory/              ← writer's personal knowledge
    ├── main
    │   ├── expertise/           ← writing style notes, tone preferences
    │   ├── patterns/            ← what structures work for different content types
    │   └── lessons-learned/     ← agent-saved during execution + hook-extracted
    │
    designer-memory/            ← designer's personal knowledge
    └── ...
```

### Why Two Repos, Not One

```
❌ One repo for everything:
   Agent's accumulated knowledge mixed with project code
   Tool preferences and lessons learned pollute commit history
   Can't give a role access to its own learnings without exposing project
   No separation between "what I know" and "what I built"

✅ Two repos:
   Workspace = where agents WORK. Shared, reviewed, merged on approval.
   Memory = what agents KNOW. Private, per-role, accumulated over time.
   Clean separation: working vs knowing.
   Workspace history is meaningful — actual work committed by agents.
   Memory is portable — role's knowledge survives team changes.
   Like real devs: work in shared repo, keep personal notes separately.
```

---

## Memory Repo: Per-Role Knowledge Store

Each role has its own git repo. This is the agent's **personal knowledge base** — like how Copilot stores memories, or how experienced developers keep personal notes and cheatsheets.

### What Memory Is (and Isn't)

```
❌ Wrong: "Memory repo = the agent's workspace"
   Agents work in the WORKSPACE repo, not here.
   Memory is NOT for drafts, experiments, or scratch code.

✅ Right: "Memory repo = the agent's personal memory — like Copilot memory"
   Just like how GitHub Copilot remembers your preferences, or how Claude saves
   memories during conversation, agents actively save knowledge as they work.

   - Domain expertise ("competitors use freemium models")
   - Approach patterns ("for data analysis tasks, start with pandas")
   - Tool preferences ("web-search gives better results with quoted phrases")
   - Lessons learned ("API X has 100/min rate limit, use batch endpoint")
   - Style notes ("team prefers formal B2B tone, short paragraphs")
   - In-progress notes ("found 3 promising leads, need to verify pricing")
   
   Think of it as the agent's BRAIN — what it knows, not what it's doing.
   Agents do their actual work in the workspace repo.
```

### When Does Memory Get Written?

Memory is written in **two ways** — exactly like how Copilot/Claude handle memory:

**1. Agent saves actively during execution** (like Copilot's "remember this"):
- Agent encounters something worth remembering → calls `memory_save` tool
- "This API has a 100/min rate limit" → saved immediately to `lessons-learned/`
- "User prefers formal tone" → saved immediately to `profile.md`
- "Pandas + batch approach works best" → saved to `patterns/`
- Agent decides what's worth saving — it's their personal notebook

**2. Automated post-task extraction** (bonus, catches what agent missed):
- After task completes/fails, a post-task hook runs
- Analyzes workspace diff + task result → distills additional learnings
- Especially valuable for failures: "tried X, didn't work because Y"
- Supplements what agent saved manually — catches implicit knowledge

```
During task execution:
  Agent calls memory_save("lesson", "api-rate-limit", "100/min, use batch")
  Agent calls memory_save("expertise", "competitor-pricing", "freemium model")
  Agent calls memory_save("tool-note", "web-search", "quoted phrases 3x better")
  → Committed to memory repo immediately

After task completes:
  Post-task hook runs → analyzes workspace diff + output
  → Extracts additional learnings agent didn't explicitly save
  → Committed to memory repo as supplementary knowledge

Both paths feed the same memory repo. Agent is always in control.
```

### Branch Strategy

Memory repos are simpler than workspace repos — no task branches needed. Knowledge is committed directly to `main` (it's not collaborative, no conflicts).

```
researcher-memory/
│
└── main                          ← all knowledge lives here
    ├── expertise/
    │   ├── competitor-pricing.md  ← saved by agent during T-001
    │   └── market-trends.md      ← saved by agent during T-007
    ├── patterns/
    │   └── data-analysis.md      ← agent noted "pandas + batch works best"
    ├── tool-notes/
    │   └── web-search.md         ← agent noted "quoted phrases work better"
    ├── lessons-learned/
    │   ├── T-001-learnings.md    ← agent saved during + hook extracted after
    │   └── T-003-learnings.md    ← hook extracted from failure
    └── profile.md                ← agent saves preferences as it learns them

Role gets SMARTER over time — knowledge accumulates from both:
  - Agent actively saving (like you telling Copilot "remember this")
  - Post-task hooks extracting implicit learnings
```

### What Gets Committed to Memory Repo

Memory is written **both during execution and after task completion** — the agent saves actively (like Copilot remembering preferences) and the post-task hook catches anything the agent missed.

| Content | When Written | How | Example |
|---|---|---|---|
| **Domain expertise** | During execution | Agent calls `memory_save` | "Competitor X uses freemium model, 3-tier pricing" |
| **Approach patterns** | During execution | Agent calls `memory_save` | "For data analysis: pandas + matplotlib + batch API" |
| **Tool preferences** | During execution | Agent calls `memory_save` | "web-search: quoted phrases give 3x better results" |
| **Lessons learned** | During + post-task | Agent saves + hook extracts | "API has undocumented 100/min rate limit" |
| **Style preferences** | During execution | Agent calls `memory_save` after user feedback | "Team prefers formal B2B tone, short paragraphs" |
| **Anti-patterns** | Post-task (failures) | Hook extracts from failure context | "Don't try scraping X.com — CAPTCHA blocks" |
| **In-progress notes** | During execution | Agent calls `memory_save` | "3 leads found, need to verify pricing tier" |
| **Supplementary knowledge** | Post-task | Hook distills from workspace diff | Implicit learnings agent didn't explicitly save |

### How Memory Helps Future Tasks

When the same role gets a similar task, the memory repo provides context — knowledge the agent saved during prior tasks AND learnings extracted post-task:

```
New task T-015: "Research pricing strategies"

Researcher's memory repo already has (accumulated from prior tasks):
  ├── expertise/competitor-pricing.md   (agent saved during T-001 via memory_save)
  ├── expertise/market-trends.md        (agent saved during T-007 via memory_save)
  ├── patterns/data-analysis.md         (agent saved: "pandas + batch works best")
  ├── tool-notes/web-search.md          (agent saved: "quoted phrases 3x better")
  └── lessons-learned/T-001.md          (agent saved + hook extracted: "rate limit 100/min")

Agent prompt includes:
  "Your prior knowledge on this topic:
   - Competitor X uses freemium model (from expertise/competitor-pricing.md)
   - Rate limit on data API: use batch endpoint (from lessons-learned/T-001.md)
   - Use pandas + batch approach for analysis (from patterns/data-analysis.md)"

Result: Agent doesn't start from scratch. It builds on knowledge it saved +
knowledge extracted from prior work. Like an experienced developer who keeps notes.
```

### Memory Commit Convention

```
During execution (agent saves actively):
  [T-001/researcher] expertise: Competitor X uses freemium, 3-tier pricing
  [T-001/researcher] lesson: API rate limit at 100/min, use batch endpoint
  [T-001/researcher] tool-note: web-search works better with quoted phrases
  [T-004/writer] style: Team prefers formal B2B tone, short paragraphs

Post-task extraction (automated hook):
  [post-T-001] expertise: Market segmentation shows 3 pricing tiers common
  [post-T-003] anti-pattern: CAPTCHA blocks scraping after 5 requests
  [post-T-004] pattern: Short paragraphs + 3 CTAs drove highest engagement
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
  └── Memory repo: agent saves knowledge actively (via memory_save tool)
      ├── "API has 100/min rate limit" → lessons-learned/
      ├── "User wants formal tone" → profile.md
      ├── "Pandas approach works best" → patterns/
      └── Committed immediately — agent's personal notebook

Task completes:
  │
  ├── Workspace repo: final commit, awaits approval
  │   └── User approves → merge to main (optional: squash commits)
  │   └── User rejects → branch preserved, agent continues or replans
  │
  └── Memory repo: post-task hook extracts ADDITIONAL learnings
      ├── Analyzes workspace diff for knowledge agent didn't explicitly save
      ├── Supplements agent's active saves — catches implicit knowledge
      ├── Especially valuable for failures ("tried X, failed because Y")
      └── All committed directly to memory/main

Task fails:
  │
  ├── Workspace repo: branch preserved (partial work may be salvageable)
  │   └── Planner may retry with a new branch: task/T-001-retry/researcher
  │
  └── Memory repo: agent may have saved learnings during execution +
      post-task hook extracts failure learnings (ESPECIALLY valuable)
      ├── Agent already saved: "API rate limit hit at 100/min after 4 minutes"
      ├── Hook adds: "Tried approach X, failed because Y — full context"
      ├── Hook adds: "Anti-pattern: don't use endpoint Z for bulk queries"
      └── Next time this role gets similar task, it knows what NOT to do
```

---

## How Memory History Helps

### Same Task Retried

```
T-001 failed. Planner retries with T-001-retry.

researcher-memory/main now has:
  lessons-learned/T-001-learnings.md:
    "API rate limit at 100/min, approach A doesn't scale. Use batch endpoint."

New worker for T-001-retry gets this injected into prompt.
Result: Worker avoids the same mistake.
```

### Similar Future Task

```
6 months later, new team, new goal: "Research our competitors"

researcher-memory/main has:
  expertise/competitor-pricing.md, expertise/market-trends.md, ...
  patterns/data-analysis.md
  20+ lessons-learned files from prior tasks

Relevant files found via: search memory repo for "competitor" related content.
Finds: 7 relevant knowledge files.

Result: Agent is experienced, not naive. It knows what works.
```

### Role Transfer

```
Researcher role reassigned from Agent A to Agent B (model upgrade, etc.)

Memory repo is the same. New agent inherits the role's FULL knowledge.
Like onboarding a new employee — they read the predecessor's notes.
Expertise, patterns, lessons learned — all preserved.
```

---

## Storage & Cleanup

### Memory Repos
- **Size:** Very small (structured knowledge summaries, not raw work)
- **Retention:** Permanent per role. This IS the role's knowledge.
- **Cleanup:** Prune stale/contradicted knowledge entries over time
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
| Workspace repo creation | ❌ Missing | Create per-team repo on team creation |
| Memory repo creation | ❌ Missing | Create per-role knowledge store on role creation |
| Task lifecycle hooks | ⚠️ Partial | Wire `onTaskStart` (create workspace branch), `onTaskComplete` (mark ready + extract learnings), `onTaskFail` (preserve branch + extract failure learnings) |
| Auto-commit during execution | ❌ Missing | Periodic commits in workspace repo |
| Merge-to-main on approval | ⚠️ Partial | Workspace: merge after user approval |
| Conflict detection | ❌ Missing | Detect + create resolution task |
| Post-task learning extraction | ❌ Missing | LLM distills learnings from workspace diff → memory repo |
| Memory search for context | ❌ Missing | Grep memory repo for relevant prior knowledge |
| Git LFS for binaries | ❌ Missing | Configure for workspace repo |

**Effort:** Medium (2-3 weeks)
