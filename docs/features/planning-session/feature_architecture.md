# Planning Session — Feature Architecture

**Date:** May 6, 2026
**Status:** Design
**Priority:** P1 — Core workflow enhancement
**Depends on:** Team ownership (Phase 2), CRDT collaboration, Planner agent
**Related:** [approval-system](../approval-system/), [crdt-team-memory](../crdt-team-memory/)

---

## Problem

The current plan → approve → execute flow is a one-shot handoff. The planner creates a plan, the user gets a task list, and their only options are "approve" or "reject everything." This creates several pain points:

1. **User approves blind** — PlanApproval shows a task list, but not the planner's reasoning (approach, architecture decisions, risks). The planner writes a rich plan document to CRDT, but the approval dialog doesn't show it.
2. **No interactive planning** — The user can't steer the plan during creation. It's create → review → accept/reject wholesale.
3. **Research is invisible** — The planner can run research tasks (`submit_research`), but there's no UI showing the "researching" state or findings.
4. **No plan editing** — The user can't modify individual tasks, change role assignments, add constraints, or split/merge tasks. The only option is a full reject with text feedback.
5. **No transition ritual** — Moving from "planning zone" to "execution zone" is a single button click with no ceremony. No final checklist, no resource verification, no configuration review.

---

## Solution: Planning Sessions

A **Planning Session** is a structured collaboration between the user and the planner agent that produces a complete, reviewed, and approved execution plan. The session has explicit phases, a rich document trail, and a deliberate transition to execution.

### Core Concepts

**Planning Zone** — An interactive workspace where the user and planner co-create the plan. The planner proposes, researches, and writes documents. The user reviews, asks questions, requests changes, and adds constraints.

**Execution Zone** — The workspace where approved tasks are dispatched to workers. Workers execute, stream results, and produce deliverables. The plan document becomes a read-only reference.

**Planning Documents** — A set of CRDT documents created during the planning session that collectively form the "plan package." These are linked to tasks and persist through execution for reference.

---

## Planning Session Lifecycle

Three session states. Session state tracks the **user's decision point**, not the system's internal activity.

```
idle → gathering → ready → done
         ↑           │
         └───────────┘  (user requests changes / replan)
```

### `idle`
No active goal. User can send a new goal.

### `gathering` — The Planning Workspace
The planner and user collaborate to build the plan. This is a **document-centric workspace**, not just a chat.

What happens here:
- Planner analyzes the goal, asks clarifying questions
- Planner runs research (findings written to CRDT `research` doc)
- Planner writes plan documents (approach, architecture, task specs)
- **User participates actively:**
  - Chats with the planner (ask questions, add constraints)
  - Opens the document pane to see plan docs in real-time
  - Co-edits documents (add requirements, correct assumptions)
  - Asks planner to create specific documents ("write an architecture doc")
  - Writes their own documents (reference material, constraints)
- Planner calls `submit_plan` when ready → state transitions to `ready`

The document pane and chat live side-by-side. The user sees the planner writing in real-time (CRDT). This is the core planning experience — a shared workspace, not a one-way handoff.

**Documents created during gathering:**

| Document | Created By | Purpose |
|----------|-----------|---------|
| `plan` | Planner + User | Plan overview: approach, decisions, risks, task breakdown |
| `research` | Planner | Research findings, domain analysis |
| `architecture` | Planner + User | Architecture decisions, tech choices (optional, on request) |
| `requirements` | User | User-written requirements, constraints, reference material |
| Any custom doc | Either | User or planner can create arbitrary docs for planning context |

### `ready` — Plan Review + Execution
Plan exists. User reviews, modifies, approves tasks, and monitors execution. Workers may be running — task-level status (`in_progress`, `completed`) tracks that, not session state.

What happens here:
- User sees plan documents + task list together
- User can approve individual tasks or all at once
- User can request changes → planner gets another turn → back to `gathering`
- User can edit tasks directly (role, priority, dependencies)
- Approved tasks dispatch to workers automatically
- Workers reference plan documents for context
- User monitors progress via task status, not session state
- User can still chat with planner (ask to modify unstarted tasks, replan)

### `done`
All tasks completed (or goal cancelled). Reports available, plan archived.

---

## Why Three States, Not Seven

The compressed model works because:

1. **Task-level status replaces session-level execution tracking.** If 3 of 5 tasks are `in_progress`, the UI shows workers are active. No need for a separate `executing` session state.

2. **`gathering` is a workspace, not a phase.** Research, drafting, document creation, user Q&A — these aren't sequential phases. They happen concurrently in a collaborative workspace.

3. **`ready` supports "replan while executing."** Some tasks are running, the user can still modify unstarted tasks or ask the planner to add new ones. No artificial barrier between "approved" and "executing."

4. **Session state tracks the user's decision point:**
   - `gathering`: "I'm still defining what I want"
   - `ready`: "The plan is defined, work can happen"
   - `done`: "Everything is finished"

---

## Planning Documents (CRDT)

Each planning session produces a linked set of CRDT documents under `{teamId}/{goalId}/`:

| Document | Written By | Phase | Purpose |
|----------|-----------|-------|---------|
| `plan` | Planner + User | DRAFTING | Plan overview: approach, decisions, risks, task breakdown |
| `research` | Planner | RESEARCHING | Research findings, analysis, domain knowledge |
| `architecture` | Planner + User | DRAFTING | Architecture decisions, tech choices, diagrams (optional) |
| `{taskId}/task` | System + Planner | DRAFTING → EXECUTING | Per-task specs: description, acceptance criteria, context |
| `{taskId}/report` | Workers | EXECUTING | Completion reports, deliverables, notes |
| `_index` | System | All | Task index by role, status |
| `_checklist` | System | READINESS | Pre-execution verification results |

### Document Linking

Tasks reference plan documents via `context.planDocs`:
```typescript
task.context = {
  planDocs: ["plan", "architecture"],  // CRDT docs this task should read
  expectedOutput: "REST API with auth endpoints",
  notes: "See architecture doc for schema decisions",
};
```

Workers auto-read linked plan docs before starting work, getting full planning context without manual copy-paste.

---

## Readiness Gate

The transition from Planning Zone to Execution Zone requires passing a **readiness check**:

```typescript
interface ReadinessCheck {
  planDocumentWritten: boolean;     // Plan CRDT doc has content
  allTasksAssigned: boolean;        // Every task has an assigned role
  validDependencyGraph: boolean;    // DAG is acyclic, all refs exist
  rolesExist: boolean;              // All assigned roles are registered
  repoConfigured: boolean;         // If tasks need code, repo URL is set
  estimatesReviewed: boolean;       // User has seen time/cost estimates (future)
}
```

Approval is blocked until all required checks pass. The frontend shows the checklist visually, highlighting what's missing.

---

## Planning Session States

```
idle → gathering → ready → done
         ↑           │
         └───────────┘  (replan / request changes)
```

| State | Description | User Can | Planner Can |
|-------|-------------|----------|------------|
| `idle` | No active goal | Send new goal | — |
| `gathering` | Planning workspace active | Chat, create/edit docs, add constraints | Research, write docs, ask questions, submit plan |
| `ready` | Plan defined, work can happen | Review tasks, approve, modify, monitor workers | Modify unstarted tasks on request |
| `done` | All tasks completed | View reports, start new goal | — |

---

## User Interactions During Planning

### In-Plan Chat
The user can chat with the planner at any phase. The planner's responses are contextual — it knows what phase it's in and what documents exist.

### Document Co-Editing
Plan documents are CRDT-based (BlockNote editor). The user can:
- Edit the plan overview to add constraints or requirements
- Modify task descriptions directly
- Add notes that the planner and workers can read

### Task-Level Actions (Reviewing phase)
- **Approve task** — Mark as ready for execution
- **Request changes** — Send feedback to planner for specific task
- **Modify task** — Change role, priority, dependencies, description
- **Add task** — User creates a new task in the plan
- **Remove task** — User removes a task (with dependency check)
- **Split task** — Break a large task into subtasks
- **Reorder** — Change execution order via dependency modification

### Planner Questions
The planner can ask the user questions during planning:
- "Should the API use REST or GraphQL?"
- "Do you want the auth system to support social login?"
- These appear as interactive prompts in the chat, not just text.

---

## Implementation Approach

### Phase 1: Document-First Planning (v1.0)
- Enforce plan document content before approval (done)
- Show plan document alongside task list in approval dialog
- Add research document support
- Add readiness checklist

### Phase 2: Interactive Planning (v2.0)
- Extended state machine (gathering → researching → drafting → reviewing → ready)
- User can chat with planner during any planning phase
- Task-level approve/reject/modify actions
- Document co-editing in the approval flow

### Phase 3: Planning Intelligence (v3.0)
- Plan versioning with diff view
- Automatic cost/time estimation
- Template plans for common goals
- Plan comparison (try multiple approaches)
- Historical plan learning

---

## Architecture Changes

### Backend
- `GoalManager` — Extended state machine, readiness check, per-task approval
- `OrchestratorService` — Planning session lifecycle management
- `CrdtTaskSync` — Research doc, architecture doc, checklist doc support
- `PlannerTools` — `ask_user` tool for interactive questions, `create_document` for arbitrary docs

### Frontend
- `PlanApproval` → `PlanningSession` — Full planning session UI with document pane, task list, chat, and checklist
- `DocumentPane` — Shows plan docs alongside task list during approval
- `ReadinessChecklist` — Visual pre-execution verification
- `TaskEditor` — Inline task editing during review phase

### CRDT
- New document types: `research`, `architecture`, `_checklist`
- Document linking: tasks reference plan docs
- Worker auto-read: workers load linked plan docs as context before starting

---

## Key Design Decisions

1. **CRDT-first, not DB-first** — Planning documents live in CRDT, not PostgreSQL. They're collaborative, real-time, and version-tracked by Yjs. The DB stores structured task metadata only.

2. **Planner stays autonomous** — The planner decides what to research, what docs to create, how to structure the plan. The user steers via constraints and feedback, not micromanagement.

3. **Execution is mutable for unstarted tasks** — Once execution starts, running and completed tasks are locked. But unstarted tasks can still be modified, added, or removed by chatting with the planner. This is the "replan while executing" principle from the `ready` state. A full replan (new plan version) is only needed if fundamental assumptions change.

4. **Documents outlive the session** — Plan documents persist after execution completes. They form a knowledge base for future goals (Phase 3).

5. **Readiness is mandatory** — No shortcuts to execution. The checklist ensures the plan is complete and reviewed. This prevents the "approve and hope" anti-pattern.
