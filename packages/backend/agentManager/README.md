# AgentManager

Top-level orchestrator for multi-agent workflows.

## Responsibilities
- Plan tasks across roles (via Plan Builder)
- Add tasks to `MemoryManager`
- Create/obtain workers for roles (via `RoleManager`)
- Assign tasks and subscribe to `taskComplete` events for non-blocking execution

## Key entry points
- `planTasksForRoles(task, roles)`: prompt plan builder, returns `{ tasks, rationale }`.
- `addTasksToMemoryManager(tasks)`: normalizes and stores tasks.
- `assignTasksToWorkers(roles, workers)`: subscribes to worker events and fires off tasks.
- `runAgentManager(task)`: convenience runner used by debugger.

## Conventions
- Use lowercase role keys when indexing workers and tasks.
- Always pass `thread_id` in agent invocations (workers and builders).
- Event-driven: listen for `worker.events.on("taskComplete", handler)` and remove listeners after completion.

## Debug tips
- If you see `Invalid response format`, relax builder `responseFormat` or tighten prompts to return only the expected JSON.
- If you see `missing thread_id`, add `{ configurable: { thread_id } }` to `.invoke` calls.