---
title: Task State Machine
---

```mermaid
stateDiagram-v2
    [*] --> pending: taskStore.create()
    pending --> ready: all prerequisites met
    ready --> in_progress: dispatched to worker
    in_progress --> completed: worker calls complete_task
    in_progress --> failed: error or timeout
    failed --> ready: retry (planner decision)
    completed --> [*]
    failed --> [*]: abort

    note right of pending: CRDT: status="pending"
    note right of in_progress: CRDT: status="in_progress"
    note right of completed: CRDT: status="completed",<br/>output stored, completedAt set
```
