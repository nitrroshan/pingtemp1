# Task 002: TaskQueue Implementation

**Status:** `not-started`
**Assignee:** 
**Estimated:** 1-2 days
**Priority:** 🟠 High
**Branch:** `feature/task-queue`

## Description

Implement a central TaskQueue that manages task distribution by role. Agents poll for tasks matching their role, and the Orchestrator queues tasks with context from dependencies. This replaces direct task assignment with a decoupled polling model.

## Context

The documented architecture specifies:
- Orchestrator **queues** tasks by role
- Agents **poll** for their role's tasks
- Context (dependency outputs, artifacts) is attached when queuing
- Event-driven completion notifications

Currently:
- ❌ No central TaskQueue exists
- Tasks are directly assigned in `assignTasksToWorkers()`
- No polling mechanism

## Acceptance Criteria

- [ ] Create `src/worker/agentManager/TaskQueue.ts`
- [ ] Implement role-based task queuing: `enqueue(role: string, task: TaskWithContext)`
- [ ] Implement polling: `poll(role: string): TaskWithContext | undefined`
- [ ] Implement availability check: `hasTasksFor(role: string): boolean`
- [ ] Emit `task:available` events when tasks are queued
- [ ] Support subscribing to task availability: `onTaskAvailable(callback)`
- [ ] Include context (previousOutputs, artifacts) in TaskWithContext
- [ ] Thread-safe for concurrent agent polling

## Implementation Notes

**Files to create/modify:**
- Create: `src/worker/agentManager/TaskQueue.ts`
- Create: `src/worker/agentManager/types/TaskQueue.types.ts`
- Modify: `src/worker/agentManager/types/index.ts` - Export types

**Key interfaces:**
```typescript
interface TaskWithContext {
  id: string;
  description: string;
  status: TaskStatus;
  assigned_role: string;
  context: {
    previousOutputs: Array<{ taskId: string; output: any }>;
    artifacts: string[];
  };
}

interface TaskQueue {
  enqueue(role: string, task: TaskWithContext): void;
  poll(role: string): TaskWithContext | undefined;
  hasTasksFor(role: string): boolean;
  onTaskAvailable(callback: (data: { role: string; taskId: string }) => void): void;
}
```

**Design decisions:**
- Use `Map<string, TaskWithContext[]>` for role -> tasks storage
- Use `EventEmitter` for notifications
- Queue is FIFO per role
- Polling removes task from queue (shift)

**Dependencies:**
- Task-001 (InternalAgent) - Agents need to poll
- Node.js `events` module

## Code TODOs

_To be added when implementation begins_

## Testing

**Unit tests:**
- Enqueue adds task to correct role queue
- Poll returns and removes first task
- Empty poll returns undefined
- Event emission on enqueue
- Multiple roles isolated

**Integration tests:**
- Multiple agents polling same role
- Context attached correctly
- Event handlers called

## Blockers

- Depends on Task-001 (InternalAgent) for agent integration testing

## Notes

This replaces the direct `worker.execute(task)` pattern in `assignTasksToWorkers()` with a decoupled queue. The Orchestrator will use `queue_task` tool to add tasks, and agents will poll during their execution loop.

---

**Related Tasks:**
- Task-001: InternalAgent (prerequisite)
- Task-003: Orchestrator (uses TaskQueue)
