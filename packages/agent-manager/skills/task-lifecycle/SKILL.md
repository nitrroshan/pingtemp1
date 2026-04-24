---
name: task-lifecycle
description: >
  Core orchestration tools that every agent MUST use correctly. Covers task completion,
  status reporting, task creation for other roles, and escalation when context is missing.
  These tools are the control plane of the multi-agent system — incorrect usage breaks
  the entire workflow.
---

# Task Lifecycle — How You Operate in the Team

You are one agent in a coordinated team. The orchestrator assigns you tasks, tracks your progress, and routes your output to dependent tasks. **These tools are how you communicate with the system.** Use them correctly — the entire team depends on it.

---

## Core Tools

### report_status — Tell the system where you are

Call this **frequently** — before major steps, after completing sub-steps, and whenever your state changes.

| Status | When to Use |
|--------|------------|
| `"in_progress"` | You're actively working. Include progress % if possible. |
| `"blocked"` | You can't continue. Something is missing or broken. **Always explain what's blocking you.** |
| `"need_clarification"` | The task description is ambiguous. You need human input. |
| `"ready_for_review"` | Work is done but you want the user to check before you call complete_task. |

**Rules:**
- Call `report_status` at least once before starting real work (progress: 0, "Starting task")
- Call it again after each significant milestone
- If you're blocked, say exactly what you need — "Can't read task context" is better than nothing but "collab read returned empty for plan and goal docs" is actionable

### complete_task — Signal you're done

Call this when your deliverables are ready. **Never just stop — always call complete_task.**

- `summary`: What you accomplished — **include key content, not just "done"**
- `deliverables`: List of concrete outputs (files created, APIs built, docs written)
- `nextSteps`: Recommendations for downstream tasks

**Rules:**
- Only call when you have **real output**. If you couldn't do the work, use `bounce_task` or `report_status(blocked)` instead.
- Do NOT call with hallucinated or fabricated output.
- Always commit your workspace changes before completing.
- **Share deliverable content before completing:** Use `collab write-block` to publish key outputs (schemas, API contracts, specs) to a shared doc that downstream agents can read. File paths alone aren't enough — other agents can't access your workspace branch.

**Example — good summary vs bad:**
```
❌ BAD:  summary: "Database schema created"
✅ GOOD: summary: "Created database schema with 4 tables: users (id, email, name, role), 
         products (id, name, price, category), orders (id, user_id, total, status), 
         payments (id, order_id, amount, method, status). Files: db/schema.sql, 
         db/migrations/001-004. Schema uses foreign keys with CASCADE deletes."
```

**Before calling complete_task:**
1. Commit all workspace changes: `workspace_commit`
2. Share key deliverables to the team: `collab({ action: "write-block", docName: "shared-outputs", key: "Your Role — Task Output", value: "...content..." })`
3. Then call `complete_task` with detailed summary

### request_task — Create work for another role

This is your primary tool for inter-agent coordination. Use it when you need input, output, or work from another team member.

- `targetRole`: The role to assign (check "Your Team" section in your task for available roles)
- `type`: What kind of task to create:
  - `"work"` — Clear deliverable. You know what needs to be built.
  - `"collaboration"` — You need to ALIGN with another role. Multiple valid approaches, need their input.
  - `"review"` — You've built something and need validation.
  - `"subtask"` — A sub-piece of your own task.
- `relationship`:
  - `"blocks-me"` — **You need the result before you can finish.** Your task pauses until the new task completes. After creating it, call `bounce_task` to hand back your task.
  - `"subtask"` — Related sub-work. You can continue while it runs.
  - `"independent"` — Unrelated work you noticed. Doesn't affect your task.
- `priority`: 2 (high) to 5 (deferred). Priority 1 is reserved for the planner.

**Guard rails:**
- Maximum 5 tasks per agent per plan
- Priority 1 is planner-only

### Choosing the Right Task Type

> **The test: How many valid answers are there?**
> - **One right answer** → `type: "work"` (just delegate with a clear spec)
> - **Multiple valid answers, need agreement** → `type: "collaboration"` (align first)
> - **Don't know what you need** → `report_status` with blockers (planner problem)

**Create `type: "work"` when:**
- You know exactly what needs to be built: "Build a REST endpoint for /users with fields X, Y, Z"
- You found a bug with clear reproduction steps: "Fix SQL injection in /search"
- The spec is unambiguous — the other role just needs to execute

**Create `type: "collaboration"` when:**
- You're building something structural (schema, API contract, interface) and need the other role's input on format
- You hit something unexpected that crosses domain boundaries: "Security issue in auth — need both backend and infra input"
- Two valid approaches exist and you need shared agreement before building

**Create `type: "review"` when:**
- You've finished work and need validation before downstream tasks depend on it
- You want a QA check or code review

**Don't create a task at all when:**
- Your task description is vague → `report_status` with blockers (planner problem)
- Task is wrong for you → `bounce_task` immediately
- You just want to share findings → use `write-block` (informational, not a task)

### Inside a Collaboration Task

If you're ASSIGNED a collaboration task (another agent invited you to align):
1. Read the discussion: `collab discuss read` — see what they're asking
2. Contribute your expertise: `collab discuss post` — be specific and concrete
3. Record the decision: `collab discuss decide` — so everyone can reference it
4. Complete immediately: `complete_task` with the decision summary
5. **Keep it brief** — this is alignment, not work. Get in, decide, get out.

**When to use request_task:**

| Situation | What to do |
|-----------|-----------|
| You need data another role has | `request_task({ targetRole: "...", relationship: "blocks-me" })` then `bounce_task()` |
| You found a bug another role should fix | `request_task({ targetRole: "...", relationship: "independent" })` |
| You need a code review | `request_task({ targetRole: "qa", type: "review", relationship: "independent" })` |
| You need an API contract before building UI | `request_task({ targetRole: "backend", relationship: "blocks-me" })` then `bounce_task()` |
| A subtask needs specialist work | `request_task({ targetRole: "...", relationship: "subtask" })` |

**Example — you need the database schema from backend:**
```
request_task({
  title: "Provide database schema",
  description: "Need table definitions for users, products, orders, and payments. Include column types and relationships.",
  targetRole: "backend",
  relationship: "blocks-me",
  priority: 2
})
// Your task is now blocked. Hand it back:
bounce_task({ reason: "Waiting for database schema from backend" })
```

**Example — you found a security issue:**
```
request_task({
  title: "Fix SQL injection in search endpoint",
  description: "The /api/search endpoint doesn't sanitize the 'q' parameter. Needs parameterized queries.",
  targetRole: "backend",
  relationship: "independent",
  priority: 2,
  context: { files: ["src/api/search.ts"], reason: "Security vulnerability found during frontend integration" }
})
// This doesn't block you — continue your work
```

### bounce_task — Return a misassigned task

Use when:
- The task requires expertise you don't have
- The task description is fundamentally wrong for your role
- You lack access to required resources

Provides: reason (why you can't do it) and optionally suggestedRole (who should do it).
This marks your task as failed. The planner will reassign it.

---

## When Context Is Missing

If tools return empty data or you can't access what you need:

```
collab read returns empty for your task or dependencies?
  ├─ Is this data another role should produce?
  │   ├─ Yes → request_task({ targetRole: "...", relationship: "blocks-me" })
  │   │        bounce_task({ reason: "Waiting for [what] from [role]" })
  │   └─ No → bounce_task({ reason: "System data unavailable: [describe]" })
  │
  └─ Can you do the work without it?
      ├─ Yes → Do partial work, note what's missing in complete_task summary
      └─ No → bounce_task({ reason: "Cannot proceed without [what]" })
```

**Critical rules:**
1. **Never fabricate work.** If you don't have the input you need, say so.
2. **Never call complete_task with hallucinated output.** The system REJECTS completion when you're blocked.
3. **Always explain what's missing.** "I need the database schema from task-3" is actionable.
4. **Use bounce_task when truly blocked.** This returns the task to the planner — it will be re-dispatched when your dependency completes.
5. **Use request_task + bounce_task together** when you need another role to provide something first.

---

## Task Workflow

```
1. Read your prompt    → Your task description and deliverables are already in the message
2. report_status       → "Starting task" (progress: 0)
3. Check context       → Can you access everything you need?
   ├─ YES → Continue to step 4
   └─ NO  → request_task (if someone else has what you need)
            bounce_task (hand back until dependency completes)
4. [Do the work]       → Use workspace, collab, scratchpad tools
5. report_status       → Progress updates as you go
6. workspace_commit    → Commit your changes frequently
7. complete_task       → When deliverables are ready
```

## When Your Task Has Downstream Dependants

If your task description mentions "Downstream tasks depend on you" or lists dependant tasks:

- **Your output is structural** — other agents will build on top of what you produce
- Include ALL key decisions in your `complete_task` summary (schemas, interfaces, contracts, format choices)
- File paths in `deliverables` aren't enough alone — describe WHAT you built and WHY you made the choices you did
- If your output format is ambiguous and could be done multiple ways, consider creating a `type: "collaboration"` task to align with the downstream role BEFORE finalizing

If at any point you can't continue:
- **Need work from another role** → `request_task({ relationship: "blocks-me" })` then `bounce_task()`
- **Wrong role for this task** → `bounce_task({ reason: "...", suggestedRole: "..." })`
- **Partial progress possible** → Do what you can, then `complete_task` with honest summary of what's done and what's missing
