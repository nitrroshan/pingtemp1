# Ping — Product Vision

**(Orchestration + Teams + Agent Supervision Platform)**

---

## 1. Core Goal of Ping

**Ping is a team-based orchestration platform where humans and AI agents collaborate to execute real work, with full visibility, control, and accountability.**

Ping acts as:

* A **Team Workspace**
* A **Task Orchestrator**
* An **Agent Supervisor**
* A **Single Source of Truth for outputs**

> **Ping = Teams + Project Manager + Orchestrator for AI Agents**

---

## 2. What "Teams" Means in Ping

Ping does **not** replicate Microsoft Teams or Slack.

Instead:

### In Ping:

* A **Team is an execution boundary**
* Teams own **goals, tasks, agents, and artifacts**
* Agents behave like **team members**
* Humans behave like **approvers, supervisors, and planners**

**Example Teams:**

* Product Team
* Marketing Team
* Sales Team

Each team:

* Has its **own agents**
* Has its **own task graph**
* Produces **its **own outputs**
* Can collaborate with other teams via shared artifacts

---

## 3. Mental Model

```
Organization
 ├─ Team (Product)
 │   ├─ Humans
 │   ├─ Agents
 │   ├─ Tasks
 │   └─ Artifacts
 ├─ Team (Marketing)
 │   ├─ Humans
 │   ├─ Agents
 │   ├─ Tasks
 │   └─ Artifacts
 └─ Team (Sales)
     ├─ Humans
     ├─ Agents
     ├─ Tasks
     └─ Artifacts
```

Ping orchestrates **within teams** and **across teams**.

---

## 4. High-Level System Architecture

```
Human
  ↓
Ping Team Workspace
  ↓
Team Orchestrator
  ├─ Task Planner
  ├─ Agent Manager
  ├─ Artifact Store
  ├─ Approval System
  ├─ Progress Monitor
  └─ Adapter Layer
  ↓
Agents (Internal / External)
```

---

## 5. Core Modules & Services

---

### A. Team Service (Foundational)

**Role:** Defines how Ping behaves like "Teams".

**Responsibilities:**
* Team creation & membership
* Agent ownership by team
* Task & artifact scoping
* Cross-team collaboration rules

**Features:**

**MVP**
* Single team per workspace
* Humans + agents belong to team
* All tasks scoped to team

**Stable**
* Multiple teams per org
* Team-level permissions
* Shared artifacts (read-only)

**Incremental 1**
* Cross-team task dependencies
* Output handoff between teams

**Incremental 2**
* Team performance analytics
* Agent utilization per team

---

### B. Orchestrator (Team-Aware)

**Role:** Coordinates execution **inside a team**.

**Responsibilities:**
* Receive team goals
* Trigger planning
* Coordinate agents
* Maintain execution state

**Features:**

**MVP**
* One goal → multiple tasks
* Sequential execution
* Single team scope

**Stable**
* Parallel tasks within team
* Failure recovery

**Incremental 1**
* Conditional workflows
* Re-planning mid-execution

**Incremental 2**
* Cross-team orchestration
* Goal dependency graphs

---

### C. Agent Manager (Team-Owned Agents)

**Role:** Manages agents as **team members**.

**Responsibilities:**
* Assign tasks to agents
* Track agent progress
* Collect outputs

**Features:**

**MVP**
* Static agent registry per team
* Manual assignment

**Stable**
* Capability-based selection
* Progress checkpoints

**Incremental 1**
* Agent performance history
* Agent replacement logic

**Incremental 2**
* Auto team composition
* Multi-agent collaboration

---

### D. Task Planner / Decomposer

**Role:** Transforms a team goal into executable tasks.

**Responsibilities:**
* Task breakdown
* Output expectations
* Dependencies

**Features:**

**MVP**
* Linear task list

**Stable**
* Hierarchical task trees
* Output contracts

**Incremental 1**
* Parallelizable task detection
* Human override

**Incremental 2**
* Adaptive planning via feedback

---

### E. Artifact Store (Team-Centric)

**Role:** Acts as a **team-owned knowledge & output system** with Git-like branching.

**Responsibilities:**
* Store agent outputs (code, docs, binary files)
* Track versions using hybrid storage (Git + Object Storage)
* Enable inspection, diffs, and approvals
* Support agent branching workflows

**Model:**

```
Team Artifact Workspace (Git-like)
├── main (protected)
│   ├── code/
│   ├── docs/
│   └── configs/
├── agent/backend-dev (branch)
│   └── code/feature.ts
├── agent/content-writer (branch)
│   └── docs/blog-post.md
└── agent/designer (branch)
    └── assets/mockup.png → s3://artifacts/...
```

**Storage Strategy:**
* **Code/Documents** → Git branches + Pull Requests
* **Binary Files** → Object Storage (S3/Blob) + Git LFS-style pointers
* **Agent Branching** → Each agent works in isolated branch
* **Approval** → PRs reviewed by humans before merge to main

**Features:**

**MVP**
* Git storage for code/docs
* Object storage for binaries
* Per-agent branches
* Manual PR creation

**Stable**
* Auto PR creation by agents
* Incremental commits
* Diff viewer UI

**Incremental 1**
* Collaborative editing (OT/CRDT)
* Semantic diffs
* Cross-team artifact refs

**Incremental 2**
* Git LFS integration
* Binary diff tools
* Auto-merge for trusted agents

---

### F. Approval & Governance

**Role:** Human control & accountability layer.

**Responsibilities:**
* Validate outputs
* Control merges
* Maintain audit trail

**Features:**

**MVP**
* Approve / reject outputs

**Stable**
* Inline diffs
* Partial approvals

**Incremental 1**
* Role-based approvals

**Incremental 2**
* Auto-approval rules

---

### G. Adapter / Integration Layer

**Role:** Allows Ping to integrate **unchanged external agents**.

**Responsibilities:**
* Normalize I/O
* Capture context
* Act as sidecar

**Features:**

**MVP**
* HTTP adapters

**Stable**
* MCP-compatible adapters

**Incremental 1**
* Streaming + checkpoints

**Incremental 2**
* Deep introspection (optional)

---

### H. Progress Monitoring & Supervision

**Role:** Visibility into team execution.

**Responsibilities:**
* Track progress
* Detect stalls
* Show partial outputs

**Features:**

**MVP**
* Task status

**Stable**
* Checkpoints

**Incremental 1**
* Alerts & SLAs

**Incremental 2**
* Predictive delays

---

### I. Ping UI (Team Workspace)

**Role:** Human control plane for teams.

**Responsibilities:**
* Define goals
* Monitor agents
* Review outputs

**Features:**

**MVP**
* Team task list
* Artifact tree
* Approvals

**Stable**
* Diff viewer
* Agent output panes

**Incremental 1**
* Timeline & progress views

**Incremental 2**
* Multi-team dashboards

---

## 6. Implementation Plan (Phases)

---

### Phase 1 — MVP (Single Team, Real Value)

**Goal:** One team completes real work using agents.

**Includes:**
* Team Service (single team)
* Orchestrator (basic)
* Agent Manager (static)
* Task Planner (simple)
* Artifact Store (BaseArtifact)
* Approval system
* One external agent adapter
* Minimal UI

**Proves:**
* Teams + agents can execute work
* Humans stay in control
* Outputs are inspectable

---

### Phase 2 — Stable (Team Workflows)

**Goal:** Teams can rely on Ping daily.

**Adds:**
* Multiple teams
* Versioning & diffs
* Progress checkpoints
* Parallel tasks
* Better UI

---

### Phase 3 — Incremental 1 (Efficiency)

**Goal:** Smarter execution.

**Adds:**
* Agent metrics
* Conditional workflows
* Cross-team references
* Partial approvals

---

### Phase 4 — Incremental 2 (Defensibility)

**Goal:** Ping becomes the coordination backbone.

**Adds:**
* Adaptive orchestration
* Auto team composition
* Semantic diffs
* Cross-team goal graphs

---

## 7. Final Positioning

> **Ping is where teams and AI agents work together—structured, supervised, and accountable.**

Not chat.
Not prompts.
**Execution.**

---

## 8. Next Steps

1. Freeze **MVP data models** (Team, Task, Artifact, Agent)
2. Draw **Team → Task → Artifact lifecycle**
3. Define **one concrete end-to-end use case** (e.g., "Product launch with 3 teams")
4. Build **Team Builder** (design mode) for creating teams and synthesizing agents
5. Build **Ping Runtime** (execution mode) for running team workflows

---

## Related Documentation

- [Architecture](./architecture.md) - Technical architecture and module design
- [Team Builder](./team-builder.md) - Design mode for creating teams and agents
- [Developer Guide](../developer-guide/monorepo-architecture.md) - Monorepo structure and implementation
