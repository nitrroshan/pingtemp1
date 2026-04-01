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
* **A team can be an agent** — any team can expose itself as an ExternalAgent to a parent team

**Example Teams:**

* Product Team (contains Engineering + Design as child teams)
* Marketing Team
* Operations Team

Each team:

* Has its **own planner agent** (plans autonomously)
* Has its **own agents** (internal workers + child teams as external agents)
* Has its **own task graph**
* Produces its **own outputs**
* Can be **composed into a parent team** — the parent sees it as just another agent
* Can collaborate with sibling teams via shared artifacts

**The key insight:** A team IS an agent. When a parent team assigns a task to a child team, that team's planner breaks it down, assigns to its own workers, and returns results — exactly like any other agent. This is recursive: teams of teams of teams.

---

## 3. Mental Model

```
Organization = Team of Teams
 │
 ├─ Team (Product)                          ← exposed as ExternalAgent to Org
 │   ├─ Planner Agent
 │   ├─ Humans
 │   ├─ Agents (internal workers)
 │   ├─ Team (Engineering)                  ← exposed as ExternalAgent to Product
 │   │   ├─ Planner Agent
 │   │   ├─ Backend Worker
 │   │   ├─ Frontend Worker
 │   │   └─ Shared Docs
 │   ├─ Team (Design)                       ← exposed as ExternalAgent to Product
 │   │   ├─ Planner Agent
 │   │   ├─ UX Researcher
 │   │   └─ Shared Docs
 │   ├─ Tasks
 │   └─ Artifacts
 │
 ├─ Team (Marketing)                        ← exposed as ExternalAgent to Org
 │   ├─ Planner Agent
 │   ├─ Content Writer
 │   ├─ SEO Agent
 │   └─ Shared Docs
 │
 └─ Team (Operations)                       ← exposed as ExternalAgent to Org
     ├─ Planner Agent
     ├─ DevOps Worker
     └─ Shared Docs
```

Ping orchestrates **within teams**, **across teams**, and **through team hierarchies**. Every team is a self-contained unit with its own planner — and can be composed into larger teams as an external agent.

---

## 4. High-Level System Architecture

```
Human
  ↓
Ping Team Workspace
  ↓
Team Orchestrator
  ├─ Planner Agent (research → reason → plan → monitor)
  ├─ Agent Manager
  ├─ CRDT Shared Docs (source of truth — agents read/write directly)
  ├─ MongoDB Index (derived — aggregation, search, analytics)
  ├─ Approval System
  ├─ Progress Monitor (watchdog + AIMD)
  └─ MCP Protocol Layer (external agents + child teams speak MCP or HTTP)
  ↓
Agents
  ├─ Internal — AI SDK workers (backend, frontend, researcher...)
  │    Uses Vercel AI SDK `streamText` + tools (migrating from LangChain)
  ├─ External — MCP/HTTP (third-party agents)
  └─ Child Teams — each a full Ping team exposed as ExternalAgent
       ├─ Has its own Planner, Workers, Shared Docs
       ├─ Plans and executes autonomously
       └─ Returns results as AgentEvent stream (same as any agent)
```

### Team Stacking: Teams as Agents

Any Ping team can expose itself as an ExternalAgent to a parent team. The parent's planner assigns tasks to child teams exactly like it assigns to individual agents. The child team's planner then breaks the task down further, assigns to its own workers, and returns results.

```
Parent Team assigns "Build feature X" to child Engineering Team (ExternalAgent)
  ↓
Engineering Team’s Planner receives task, researches domain, creates sub-plan:
  ├─ Task 1: Design API schema → Backend Worker
  ├─ Task 2: Implement endpoints → Backend Worker
  ├─ Task 3: Build UI components → Frontend Worker
  └─ Task 4: Write tests → QA Worker
  ↓
Results flow back to Parent Team as single AgentEvent stream
Parent sees: "Engineering Team completed 'Build feature X'" + output manifest
```

**Why this works:**
* **No new infrastructure** — ExternalAgent class + MCP endpoint. Each team exposes itself as an MCP server.
* **Each child team has full autonomy** — its own planner, workers, shared docs, approval flow.
* **Parent planner is unaware of internals** — treats child team as a black box, like any agent.
* **Recursive** — a child team can itself have child teams. No depth limit.
* **Natural org structure** — hierarchy emerges from composition, not from hardcoded levels.

**Ping vs Paperclip hierarchy:**
```
Paperclip: CEO agent → CTO agent → Dev agent
  → Individual agents in rigid hierarchy, no planning at each level.

Ping: Board team → Product team → Engineering team
  → Full teams with planners at every level. Each level reasons independently.
```

### Architectural Principles

**Docs-primary, DB-secondary.** Agents are file-native — they read and write documents. CRDT shared docs (Hocuspocus + Yjs) are the source of truth for plans, tasks, and output manifests. MongoDB is a derived index for aggregation queries. If the index is lost, rebuild from docs.

**Planner is an agent, not a schema.** The planner researches, reasons, and creates plans using tools — not a single structured-output LLM call. It has knowledge tools (research domain, analyze requirements, discover team capabilities) and execution tools (submit plan, get status, replan).

**Protocol over adapters.** External agents connect via MCP endpoints or HTTP contracts — one `ExternalAgent` class handles all. No per-runtime adapter code. The Agent Registry discovers capabilities via vector similarity search.

---

## 5. Core Modules & Services

---

### A. Team Service (Foundational)

**Role:** Defines how Ping behaves like "Teams" — and how teams compose into organizations.

**Responsibilities:**
* Team creation & membership
* Agent ownership by team
* Task & artifact scoping
* Cross-team collaboration rules
* **Team-as-agent exposure** — register a team as an ExternalAgent for a parent team

**Features:**

**MVP**
* Single team per workspace
* Humans + agents belong to team
* All tasks scoped to team

**Stable**
* Multiple teams per org
* Team-level permissions
* Shared artifacts (read-only)
* **Team exposes MCP endpoint** — can be consumed as ExternalAgent

**Incremental 1**
* Cross-team task dependencies
* Output handoff between teams
* **Parent-child team relationships** — parent team's planner assigns to child teams

**Incremental 2**
* Team performance analytics
* Agent utilization per team
* **Recursive team composition** — org hierarchy emerges from team stacking

---

### B. Orchestrator (Team-Aware)

**Role:** Coordinates execution **inside a team** and **delegates to child teams**.

**Responsibilities:**
* Receive team goals
* Trigger planning
* Coordinate agents (internal workers, external agents, child teams)
* Maintain execution state
* Delegate sub-goals to child teams via ExternalAgent interface

**Features:**

**MVP**
* One goal → multiple tasks
* Sequential execution
* Single team scope

**Stable**
* Parallel tasks within team
* Failure recovery
* Delegation to child teams (ExternalAgent)

**Incremental 1**
* Conditional workflows
* Re-planning mid-execution
* Cross-team task dependencies (child team A's output → child team B's input)

**Incremental 2**
* Cross-team orchestration
* Goal dependency graphs across team hierarchy

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

### D. Planner Agent

**Role:** A full agent that researches, reasons, and creates plans — not a structured-output LLM call.

**Cognitive Workflow:**
1. **Research** — use knowledge tools to understand the domain (separate focused LLM calls, MCP servers, L2 search for prior plans/failures)
2. **Analyze** — break down requirements, identify risks, estimate complexity
3. **Assess Team** — query agent registry for available capabilities, match roles to tasks
4. **Reason** — weigh alternatives, consider past failures, choose strategy
5. **Plan** — produce DAG of tasks with dependencies, priorities, risk assessment
6. **Monitor & Adapt** — watch execution, replan when tasks fail or new info emerges

**Two Tool Categories:**
* **Knowledge Tools:** `research_domain`, `analyze_requirements`, `get_team_capabilities`, `get_context` (read CRDT docs of past plans/outputs)
* **Execution Tools:** `submit_plan`, `replan`, `get_status`, `get_blocked`, `present_artifact`

**Research flows into tasks** — planner findings land in task context so workers start with curated domain knowledge, not from zero.

**Features:**

**MVP**
* Agent-based planning with research phase
* DAG task breakdown with dependencies
* Risk assessment per task

**Stable**
* Multi-model strategy (cheap for research, smart for planning, fast for monitoring)
* Learns from past plan outcomes via CRDT docs + MongoDB index
* Mid-execution replanning

**Incremental 1**
* Domain-specific MCP servers for specialized knowledge
* Cross-team plan coordination

**Incremental 2**
* Adaptive planning from team_learnings (background-extracted patterns)

---

### E. Shared Docs & Artifacts (Docs-Primary)

**Role:** Acts as the **single source of truth** for all team data — plans, tasks, outputs, artifacts.

**Core Principle:** Agents work with documents, not databases. CRDT shared docs are the primary store. MongoDB indexes them for aggregate queries. If the index is lost, rebuild from docs.

**Why docs-primary:**
* Agents already have tools to read/write docs (`collab`, `read_file`, `write_file`)
* Humans and agents edit the same CRDT docs in real-time (BlockNote + Hocuspocus)
* Zero new tooling needed vs custom DB query tools per collection
* Filesystem projection (`.ping/collaboration/`) gives free keyword search

**Model:**

```
CRDT Shared Docs (Hocuspocus + Yjs) — Source of Truth
├── plans/{goalId}/plan.json          Planner writes, orchestrator reads
├── tasks/{taskId}.json               Orchestrator creates, workers update
├── manifests/{taskId}.json           Workers write output manifests
├── goals/{goalId}.json               User creates, planner consumes
└── context/{teamId}/notes.json       Planner research, shared knowledge

MongoDB Index (derived via onChange hook) — Query Layer
├── tasks_index    { taskId, status, role, goalId, durationMs }
├── plans_index    { goalId, status, taskCount, createdAt }
├── manifests_index { taskId, role, category, artifactCount }
└── execution_events (append-only log — not derived, supplementary)

Git Workspace — Code Artifacts
├── Per-agent branches for code tasks
├── .ping/collaboration/ filesystem projection of CRDT docs
└── .ping/outputs/ output manifest files
```

**Data flows:**
```
Agent writes → CRDT doc updates → onChange fires
  → project to filesystem (.ping/collaboration/) — already built
  → sync to MongoDB index — lean schema, just queryable fields
```

**Features:**

**MVP**
* CRDT docs for plans, tasks, manifests (migrate from JSON files + in-memory Maps)
* MongoDB index synced via onChange
* Agents use existing `collab` tool — no new tooling
* Git workspace for code artifacts

**Stable**
* Background learning pipeline (post-goal summarization → team_learnings collection)
* Execution event log for planner episodic memory
* Cross-team document references

**Incremental 1**
* Collaborative editing UI (BlockNote + Hocuspocus)
* Semantic diffs on CRDT docs
* Auto-merge for trusted agent code PRs

**Incremental 2**
* Data retention policies (archive old goals, compact event logs)
* CRDT binary state backup + mongodump for index

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

### G. External Agent Layer (Protocol-Based)

**Role:** Connects external agents AND child teams via standardized protocols.

**Core Principle:** External agents speak MCP or HTTP, and they're in. One `ExternalAgent` class handles all external agents — including child Ping teams.

**Why this is better than adapters:**
* MCP is converging as the standard (Claude Code, Cursor, Windsurf, Cline all support it)
* One class vs N adapter classes — less code, fewer bugs
* Tool discovery is automatic via MCP `tools/list`
* Agent Registry discovers capabilities via vector similarity search
* **Child teams are just another ExternalAgent** — no special-casing

**Architecture:**
```
InternalAgent  → AI SDK streamText + tools → AgentEvent stream
ExternalAgent  → MCP endpoint or HTTP     → AgentEvent stream (normalized)
ChildTeam      → Ping team as MCP server  → AgentEvent stream (same as external)

All implement IAgent — orchestrator treats them identically.
```

**Team-as-Agent exposure:**
```
Ping Team exposes MCP endpoint:
  tools/list → returns team's capabilities (derived from workers + skills)
  execute    → parent sends task → team's planner receives → plans → executes → returns
  status     → parent queries progress → team returns aggregated status
```

The parent team's planner doesn't know or care whether it's talking to a single agent or an entire team. The MCP interface abstracts that away.

**Agent Registry** (`packages/registry/`):
* Standalone service with MongoDB + vector search
* Agents AND teams register with name, description, capabilities, `mcpEndpoint`
* Teams register with `type: 'team'` + child capability summary
* Planner queries registry to discover available agents/teams for a goal
* Vector similarity: "find me an agent that can do ML prediction" (might return a team)

**Features:**

**MVP**
* `ExternalAgent` class implementing `IAgent` interface
* HTTP contract (POST task, get response, wrap in AgentEvent stream)

**Stable**
* MCP endpoint support (MCP client SDK — replaces `@langchain/mcp-adapters`)
* Registry integration — planner discovers external agents
* Streaming from external agents
* **Team-as-MCP-server — expose a Ping team as an ExternalAgent endpoint**

**Incremental 1**
* A2A protocol support
* External agent health monitoring
* **Team stacking — parent/child team hierarchies via ExternalAgent**
* Cross-team shared doc references (child team's artifacts visible to parent)

**Incremental 2**
* External agent marketplace
* **Recursive team composition — teams of teams of teams**

**Secret Management:**
* Use Azure Key Vault (already on Azure for OpenAI) — not local crypto
* Per-team API key scoping
* Secrets loaded at startup into memory — agents never touch the vault
* Build own vault only if specific need arises

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
* Orchestrator with planner agent (research → reason → plan)
* Agent Manager (capability-based)
* CRDT shared docs for plans, tasks, manifests (docs-primary)
* MongoDB index synced via onChange
* Approval system
* ExternalAgent class (HTTP contract)
* Azure Key Vault for secrets
* Minimal UI

**Proves:**
* Planner agent creates intelligent plans (not just structured output)
* Agents read/write shared docs naturally
* Humans and agents share the same data in real-time
* Outputs are inspectable

---

### Phase 2 — Stable (Team Workflows)

**Goal:** Teams can rely on Ping daily.

**Adds:**
* Multiple teams
* Execution event log (episodic memory for planner)
* Background learning pipeline (team_learnings)
* MCP external agent support via registry
* **Team-as-MCP-server** — any team can expose itself as an ExternalAgent endpoint
* Cost tracking per task/agent
* Streaming UI with real-time agent output
* Progress checkpoints

---

### Phase 3 — Incremental 1 (Intelligence)

**Goal:** Planner gets smarter, teams compose into orgs.

**Adds:**
* Planner queries past plans/failures to improve strategy
* Domain-specific MCP servers for planner research
* Cross-team document references
* Agent Registry vector search for capability discovery
* Collaborative editing UI (BlockNote + Hocuspocus)
* **Team stacking** — parent team assigns tasks to child teams (ExternalAgent)
* **Cross-team task dependencies** — child team A's output feeds child team B's input

---

### Phase 4 — Incremental 2 (Defensibility)

**Goal:** Ping becomes the coordination backbone — at any scale.

**Adds:**
* Adaptive orchestration (planner learns from team_learnings)
* Auto team composition from registry
* A2A protocol for external agents
* Cross-team goal graphs
* Data retention policies + archival
* **Recursive team composition** — org hierarchies of arbitrary depth

---

## 7. Ping as a Living System

Ping is not just a tool—it's an **intelligent organism** that coordinates work between humans and AI agents. This section defines the core capabilities that make Ping a living, adaptive system.

---

### 🧬 The Ping Organism Model

```
┌─────────────────────────────────────────────────────────────┐
│                     PING ORGANISM                            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  SENSE ──────► REACT ──────► COMMUNICATE                     │
│    │             │                │                          │
│    │             ▼                ▼                          │
│    │          FOCUS ◄────── COLLABORATE                      │
│    │             │                │                          │
│    ▼             ▼                ▼                          │
│  ANTICIPATE    ADAPT          PROTECT                        │
│    │             │                │                          │
│    │             ▼                │                          │
│    │           GROW ◄─────────────┘                          │
│    │             │                                           │
│    └───────────► │                                           │
│                  ▼                                           │
│              REMEMBER                                        │
│                  │                                           │
│                  ▼                                           │
│              REPRODUCE                                       │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

### Core Capabilities

#### 1. SENSE (Perceive Environment)

Ping perceives its environment, detects changes, and maintains resource awareness.

| Aspect | What Ping Senses |
|--------|------------------|
| **Resources** | Budget remaining, API rate limits, compute availability |
| **Time** | Deadlines, durations, scheduling constraints |
| **Dependencies** | External API status, blocked tasks, waiting states |
| **Context** | User activity, team state, environmental changes |
| **Quality** | Error rates, success patterns, performance metrics |

```typescript
interface SenseCapabilities {
  resources: {
    budget: BudgetStatus;
    rateLimits: RateLimitStatus[];
    compute: ComputeAvailability;
  };
  time: {
    deadlines: Deadline[];
    estimatedDurations: Map<TaskId, Duration>;
  };
  environment: {
    apiStatus: Map<string, HealthStatus>;
    userActivity: ActivityStatus;
    teamState: TeamState;
  };
}
```

---

#### 2. REMEMBER (State & Context)

Ping maintains three types of memory, mapped to how cognitive systems work (CoALA framework).

| Memory Type | What's Stored | Source |
|-------------|---------------|--------|
| **Episodic** | Sequences of past actions — "what happened and in what order" | `execution_events` log (append-only) |
| **Semantic** | Facts about the world — outputs, research, team knowledge | CRDT docs (tasks, manifests, plans with `researchNotes`) |
| **Procedural** | How to perform tasks — successful strategies, patterns | `team_learnings` collection (background-extracted) + agent YAML definitions |

**Docs-primary storage:** All three memory types are accessible to agents via existing tools:
* Episodic → `collab read` on execution history docs, or MongoDB index for aggregate queries
* Semantic → `collab read/write` on CRDT docs, `read_file` on `.ping/collaboration/` projections
* Procedural → agent skill files, successful plan patterns from past goals

**Background Learning Pipeline:**
* **Hot path** (during execution): state changes write to CRDT doc + append event — synchronous
* **Background** (after goal completes): summarize execution via LLM, extract reusable patterns, store in `team_learnings` for fast planner retrieval

| Specific Memory | What's Stored |
|-----------------|---------------|
| **Team Memory** | Shared facts, decisions, preferences across all agents |
| **Task Context** | Why each task exists, dependency outputs, planner research notes |
| **Decision Log** | Why X was chosen over Y, with rationale (in execution_events) |
| **User Preferences** | Communication style, approval patterns, working hours |
| **Execution History** | What worked, what failed, durations, costs |

---

#### 3. REPRODUCE (Learn & Create)

Ping creates new knowledge, patterns, and agents based on experience.

| Reproduction Type | Description |
|-------------------|-------------|
| **Pattern Recognition** | "Users always reject X, stop suggesting it" |
| **Agent Cloning** | Duplicate successful agent with modifications |
| **Prompt Evolution** | Improve prompts based on approval/rejection |
| **Template Creation** | Generalize successful workflows for reuse |
| **Knowledge Synthesis** | Combine learnings into actionable insights |

```typescript
interface ReproductionCapabilities {
  learnFromFeedback(rejection: Rejection): PromptImprovement;
  cloneAgent(source: Agent, modifications: Partial<AgentConfig>): Agent;
  createTemplate(workflow: Workflow): WorkflowTemplate;
  synthesizeKnowledge(executions: ExecutionRecord[]): Insight[];
}
```

---

#### 4. REACT (Respond to Stimuli)

Ping acts on what it senses—both reflexively and deliberately.

| Reaction Type | Examples |
|---------------|----------|
| **Reflexes** (instant, no approval) | Rate limit → queue; Crash → restart; Timeout → retry |
| **Deliberate** (approval needed) | Pivot approach; Involve another team; Exceed budget |
| **Triggers** | Deadline < 24h → Alert; Error rate > 3 → Escalate |

```typescript
interface ReactSystem {
  reflexes: Reflex[];  // Instant responses
  triggers: Trigger[]; // Condition → Action rules
  
  // Example trigger
  interface Trigger {
    condition: () => boolean;
    action: () => Promise<void>;
    requiresApproval: boolean;
  }
}
```

---

#### 5. COMMUNICATE (Express & Negotiate)

Ping doesn't just route messages—it expresses intent and negotiates between parties.

| Communication Type | Description |
|--------------------|-------------|
| **Express** | Status, confidence, uncertainty, intent |
| **Negotiate** | Priority conflicts, resource sharing, handoffs |
| **Broadcast** | Announcements, discoveries, warnings |
| **Report** | Progress summaries, blockers, recommendations |

```typescript
interface CommunicationCapabilities {
  express: {
    status(task: Task): StatusUpdate;
    confidence(output: Artifact): ConfidenceScore;
    uncertainty(decision: Decision): ClarificationRequest;
    intent(plan: Plan): IntentExplanation;
  };
  negotiate: {
    resolvePriority(tasks: Task[]): PriorityResolution;
    requestResource(resource: Resource): ResourceRequest;
    handoff(from: Agent, to: Agent, context: Context): Handoff;
  };
  broadcast: {
    announce(event: SystemEvent): void;
    warn(issue: Issue): void;
    discover(insight: Insight): void;
  };
}
```

---

#### 6. FOCUS (Attention & Priority)

Ping determines what to work on RIGHT NOW among competing demands.

| Focus Aspect | How It Works |
|--------------|--------------|
| **Prioritization** | Urgency × Importance × Dependency × Momentum |
| **Attention Allocation** | Which tasks get compute now |
| **Interruption Handling** | Urgent → switch; Can wait → queue |
| **Context Preservation** | Save state before switching |

```typescript
interface FocusSystem {
  prioritize(tasks: Task[]): PrioritizedQueue;
  allocateAttention(agents: Agent[], tasks: Task[]): Allocation;
  handleInterrupt(interrupt: Interrupt, current: Task): InterruptResponse;
  preserveContext(task: Task): SavedContext;
}
```

---

#### 7. ADAPT (Change Strategy)

Ping changes behavior based on situation—not just learns, but adapts mid-execution.

| Adaptation Type | Description |
|-----------------|-------------|
| **Strategy Switch** | "Sequential isn't working, try parallel" |
| **Agent Substitution** | "Agent X keeps failing, use Agent Y" |
| **Plan Revision** | "New info invalidates step 3, replan" |
| **Self-Correction** | "My output was rejected, try different approach" |

```typescript
interface AdaptSystem {
  switchStrategy(current: Strategy, reason: FailureReason): Strategy;
  substituteAgent(failing: Agent, task: Task): Agent;
  revisePlan(plan: Plan, newInfo: Context): RevisedPlan;
  selfCorrect(rejection: Rejection): CorrectedApproach;
}
```

---

#### 8. PROTECT (Safety & Boundaries)

Ping protects itself, users, and the environment from harm.

| Protection Type | What It Covers |
|-----------------|----------------|
| **Self-Preservation** | Don't exhaust budget; Don't overload systems |
| **Containment** | Agent can't exceed permissions; Runaway loop detection |
| **Safety** | No PII in outputs; No harmful content; Audit trail |
| **Recovery** | Checkpoints; Rollback capability; Graceful degradation |

```typescript
interface ProtectionSystem {
  checkBudget(operation: Operation): BudgetCheck;
  enforcePermissions(agent: Agent, action: Action): PermissionCheck;
  detectRunaway(execution: Execution): RunawayDetection;
  createCheckpoint(state: State): Checkpoint;
  rollback(checkpoint: Checkpoint): void;
  sanitizeOutput(output: Artifact): SanitizedArtifact;
}
```

---

#### 9. GROW (Evolve Capabilities)

Ping becomes more capable over time through learning and evolution.

| Growth Type | Description |
|-------------|-------------|
| **Agent Evolution** | Agents gain new capabilities, expertise |
| **Team Evolution** | Teams become faster, more efficient |
| **Skill Acquisition** | Learn new tools, develop domain expertise |
| **Inheritance** | Clone successful patterns, share across orgs |

```typescript
interface GrowthSystem {
  evolveAgent(agent: Agent, learnings: Learning[]): EvolvedAgent;
  evolveTeam(team: Team, metrics: PerformanceMetrics): EvolvedTeam;
  acquireSkill(agent: Agent, skill: Skill): void;
  inheritPattern(pattern: Pattern, target: Team): void;
}
```

---

#### 10. COLLABORATE (Joint Work)

Ping enables true collaboration—not just communication, but shared ownership.

| Collaboration Type | Description |
|--------------------|-------------|
| **Within Team** | Shared artifacts, handoffs, pair work |
| **Across Teams** | Shared dependencies, cross-team reviews |
| **Up/Down Hierarchy** | Parent delegates to child team, child returns results |
| **With Humans** | Co-authoring, review loops, supervised execution |
| **With External** | A2A protocol, third-party agents, child Ping teams |

```typescript
interface CollaborationSystem {
  sharedArtifact(artifact: Artifact, participants: Agent[]): SharedArtifact;
  handoff(from: Agent, to: Agent, work: Work): Handoff;
  pairWork(agents: [Agent, Agent], task: Task): PairSession;
  crossTeamReview(artifact: Artifact, reviewer: Team): Review;
  coAuthor(human: User, agent: Agent, document: Document): CoAuthorSession;
}
```

---

#### 11. ANTICIPATE (Predict & Prepare)

Ping doesn't just react—it prepares for what's coming.

| Anticipation Type | Description |
|-------------------|-------------|
| **Prediction** | Estimate durations, predict rejection likelihood |
| **Preparation** | Pre-fetch data, warm up agents, cache queries |
| **Planning Ahead** | Queue weekend tasks, prepare alternatives |

```typescript
interface AnticipationSystem {
  predict: {
    duration(task: Task): Duration;
    approvalLikelihood(artifact: Artifact): Probability;
    resourceNeeds(plan: Plan): ResourceEstimate;
  };
  prepare: {
    prefetch(data: DataRequirement[]): void;
    warmUp(agents: Agent[]): void;
    cache(queries: Query[]): void;
  };
  planAhead: {
    queueForLater(tasks: Task[], when: Schedule): void;
    prepareAlternative(task: Task): AlternativeApproach;
  };
}
```

---

### Capability Summary

| # | Capability | One-liner | Priority |
|---|------------|-----------|----------|
| 1 | **SENSE** | Perceive environment, resources, changes | MVP |
| 2 | **REMEMBER** | State, context, history, decisions | MVP |
| 3 | **REACT** | Triggers → Conditions → Actions | MVP |
| 4 | **COMMUNICATE** | Express, negotiate, broadcast | MVP |
| 5 | **PROTECT** | Safety, boundaries, recovery | MVP |
| 6 | **FOCUS** | Prioritize, allocate attention | Stable |
| 7 | **ADAPT** | Change strategy mid-execution | Stable |
| 8 | **COLLABORATE** | Joint work, shared ownership | Stable |
| 9 | **REPRODUCE** | Learn, create patterns, evolve | Incremental |
| 10 | **GROW** | Evolve capabilities over time | Incremental |
| 11 | **ANTICIPATE** | Predict and prepare for future | Incremental |

---

## 8. Final Positioning

> **Ping is a living system where teams of humans and AI agents collaborate through shared documents — sensing, planning, adapting, and evolving — with full human control and accountability. Teams compose into organizations: any team is an agent to its parent.**

Not chat. Not prompts. Not a database with agent wrappers. Not rigid org charts of individual agents.
**A docs-native coordination organism where teams stack, planners think at every level, and hierarchy emerges from composition.**

---

## 9. Key Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Data primary** | CRDT shared docs (Hocuspocus + Yjs) | Agents are file-native. Zero new tooling. Humans and agents share same data. |
| **Database role** | MongoDB as derived index | Aggregation, search, analytics. Rebuildable from docs. |
| **Planner model** | Full agent with tools | Research-first planning vs one-shot structured output. Domain knowledge matters. |
| **External agents** | MCP protocol + HTTP | Protocol-based, not adapter-per-runtime. One class handles all. |
| **Team composition** | Teams as ExternalAgents | Any team exposes MCP endpoint. Parent treats child team as just another agent. Org hierarchy from composition, not hardcoded levels. |
| **Memory types** | Episodic + Semantic + Procedural | Planner learns from event logs, doc outputs, and extracted patterns. |
| **Secret management** | Azure Key Vault (existing infra) | Already on Azure. Don't build own crypto. |
| **Event model** | CRUD docs + append-only event log | Simple reads for hot-path, rich history for planner. Path to event sourcing later. |

---

## 10. Next Steps

1. Implement **Planner Agent** with knowledge tools (research_domain, analyze_requirements, get_team_capabilities)
2. Migrate **plans/tasks/manifests to CRDT shared docs** with MongoDB index
3. Build **ExternalAgent class** — IAgent implementation over HTTP/MCP
4. **Team-as-MCP-server** — expose a Ping team as an ExternalAgent endpoint
5. Integrate **Azure Key Vault** for secret management
6. Add **execution_events** append-only log for planner episodic memory
7. Build **background learning pipeline** (post-goal summarization → team_learnings)
8. Connect **Agent Registry** vector search to planner's research phase (register teams alongside agents)
9. **Team stacking prototype** — parent team delegates to 2-3 child teams via ExternalAgent

---

## Related Documentation

- [Architecture](./architecture.md) - Technical architecture and module design
- [Team Builder](./team-builder.md) - Design mode for creating teams and agents
- [Ping Organism](./ping-organism.md) - Deep dive into living system capabilities
- [Developer Guide](../developer-guide/monorepo-architecture.md) - Monorepo structure and implementation

### Feature Architecture Docs (Detailed Decisions)
- [Planner as Agent](../features/planner-as-agent/feature_architecture.md) - Research-first planning agent design
- [Data Persistence](../features/data-persistence/feature_architecture.md) - Docs-primary storage, MongoDB index, event log
- [External Agent Invocation](../features/external-agent-invocation/feature_architecture.md) - MCP/HTTP protocol-based integration
- [Paperclip Research](../features/opensource-research/paperclip-research.md) - Competitive analysis and adoption decisions
