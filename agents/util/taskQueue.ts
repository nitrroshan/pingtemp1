export class DependencyTaskQueue<T = any> {
  // Core data structures
  private tasks = new Map<string, T>();
  private taskPriority = new Map<string, number>();
  private taskPrerequisites = new Map<string, Set<string>>();
  private remainingDeps = new Map<string, number>();
  private blockedTasks = new Map<string, Set<string>>();
  private readyQueue = new MinHeap<string>();
  private completedTasks = new Set<string>();

  // Event system
  private eventListeners = new Map<string, Set<Function>>();

  // Metrics and debugging
  private metrics = {
    tasksAdded: 0,
    tasksCompleted: 0,
    maxQueueSize: 0,
    assignmentLatency: [] as number[],
  };

  // Timers for timeouts
  private taskTimestamps = new Map<string, number>();

  constructor(
    private options: {
      timeout?: number;
      autoRemoveCompleted?: boolean;
    } = {}
  ) {
    this.options = {
      timeout: 30000,
      autoRemoveCompleted: false,
      ...options,
    };
  }

  // Add task to the system
  addTask(
    taskId: string,
    task: T,
    prerequisites: string[] = [],
    priority = 0
  ): void {
    // Validation
    if (this.tasks.has(taskId)) throw new Error(`Duplicate task ID: ${taskId}`);
    if (prerequisites.includes(taskId))
      throw new Error(`Self-referential task: ${taskId}`);

    // Initialize data structures
    this.tasks.set(taskId, task);
    this.taskPriority.set(taskId, priority);
    this.taskPrerequisites.set(taskId, new Set(prerequisites));
    this.taskTimestamps.set(taskId, Date.now());

    // Check for missing prerequisites
    const missingPrerequisites = prerequisites.filter(
      (p) => !this.tasks.has(p)
    );
    if (missingPrerequisites.length > 0) {
      this.emit("missing-prerequisites", {
        taskId,
        missing: missingPrerequisites,
      });
    }

    // Detect cycles
    if (this.detectCycle(taskId)) {
      this.cleanupTask(taskId);
      throw new Error(`Cycle detected involving task: ${taskId}`);
    }

    // Process dependencies
    this.processTaskDependencies(taskId);
    this.metrics.tasksAdded++;
    this.updateQueueMetrics();
  }

  updateTask(
    taskId: string,
    changes: {
      priority?: number;
      prerequisites?: string[];
      task?: T;
    }
  ) {
    if (!this.tasks.has(taskId)) throw new Error("Unknown task");

    // Update priority if needed
    if (changes.priority !== undefined) {
      this.taskPriority.set(taskId, changes.priority);

      // If task is in ready queue, re-add it with new priority
      if (this.readyQueue.contains(taskId)) {
        // This requires heap implementation to support removal
        // For simplicity, we'll just re-add when dequeued
      }
    }

    // Update prerequisites
    if (changes.prerequisites) {
      // Full dependency recalculation
      this.taskPrerequisites.set(taskId, new Set(changes.prerequisites));
      this.remainingDeps.delete(taskId);
      this.processTaskDependencies(taskId);
    }

    // Update task payload
    if (changes.task) {
      this.tasks.set(taskId, changes.task);
    }
  }

  // Add multiple tasks at once
  addTasks(
    tasks: {
      id: string;
      task: T;
      prerequisites?: string[];
      priority?: number;
    }[]
  ) {
    // First pass: add all tasks without dependency checks
    for (const { id, task, prerequisites = [], priority = 0 } of tasks) {
      if (this.tasks.has(id)) continue;
      this.tasks.set(id, task);
      this.taskPriority.set(id, priority);
      this.taskPrerequisites.set(id, new Set(prerequisites));
    }

    // Second pass: process dependencies
    for (const { id } of tasks) {
      this.processTaskDependencies(id);
    }
  }

  // Process task dependencies
  private processTaskDependencies(taskId: string): void {
    const prerequisites =
      this.taskPrerequisites.get(taskId) || new Set<string>();
    let uncompletedCount = 0;

    for (const p of prerequisites) {
      if (!this.completedTasks.has(p)) {
        uncompletedCount++;

        // Add to blocked tasks mapping
        if (!this.blockedTasks.has(p)) {
          this.blockedTasks.set(p, new Set());
        }
        this.blockedTasks.get(p)!.add(taskId);
      }
    }

    // Add to ready queue if no dependencies
    if (uncompletedCount === 0) {
      this.addToReadyQueue(taskId);
    } else {
      this.remainingDeps.set(taskId, uncompletedCount);
    }
  }

  // Add task to ready queue with event notification
  private addToReadyQueue(taskId: string): void {
    const priority = this.taskPriority.get(taskId) || 0;
    this.readyQueue.push(priority, taskId);

    // Notify when queue transitions from empty to non-empty
    if (this.readyQueue.size() === 1) {
      this.emit("ready");
    }

    this.emit("task-ready", taskId);
  }

  // Mark task as completed
  completeTask(taskId: string): void {
    if (!this.tasks.has(taskId)) throw new Error(`Unknown task: ${taskId}`);
    if (this.completedTasks.has(taskId))
      throw new Error(`Task already completed: ${taskId}`);

    // Record latency
    if (this.taskTimestamps.has(taskId)) {
      const latency = Date.now() - this.taskTimestamps.get(taskId)!;
      this.metrics.assignmentLatency.push(latency);
    }

    this.completedTasks.add(taskId);
    this.metrics.tasksCompleted++;

    // Process dependent tasks
    const dependents = this.blockedTasks.get(taskId) || new Set<string>();
    for (const dependent of dependents) {
      const newCount = (this.remainingDeps.get(dependent) || 1) - 1;

      if (newCount === 0) {
        this.remainingDeps.delete(dependent);
        this.addToReadyQueue(dependent);
      } else {
        this.remainingDeps.set(dependent, newCount);
      }
    }

    // Cleanup
    this.blockedTasks.delete(taskId);
    this.taskTimestamps.delete(taskId);

    if (this.options.autoRemoveCompleted) {
      this.tasks.delete(taskId);
      this.taskPriority.delete(taskId);
      this.taskPrerequisites.delete(taskId);
    }

    this.emit("task-completed", taskId);
  }

  // Get next available task
  getNextTask(): { id: string; task: T } | null {
    const taskId = this.readyQueue.pop();
    if (!taskId) return null;

    const task = this.tasks.get(taskId);
    if (!task) return null;

    return { id: taskId, task };
  }

  // Detect dependency cycles
  private detectCycle(taskId: string): boolean {
    const visited = new Set<string>();
    const stack = new Set<string>();

    const visit = (current: string): boolean => {
      if (stack.has(current)) return true;
      if (visited.has(current)) return false;

      visited.add(current);
      stack.add(current);

      const deps = this.taskPrerequisites.get(current) || new Set<string>();
      for (const dep of deps) {
        if (visit(dep)) return true;
      }

      stack.delete(current);
      return false;
    };

    return visit(taskId);
  }

  // Clean up task data
  private cleanupTask(taskId: string): void {
    this.tasks.delete(taskId);
    this.taskPriority.delete(taskId);
    this.taskPrerequisites.delete(taskId);
    this.remainingDeps.delete(taskId);
    this.taskTimestamps.delete(taskId);

    // Remove from blocked tasks
    for (const [key, tasks] of this.blockedTasks) {
      if (tasks.has(taskId)) {
        tasks.delete(taskId);
        if (tasks.size === 0) {
          this.blockedTasks.delete(key);
        }
      }
    }
  }

  // Check for timed out tasks
  checkTimeouts(): string[] {
    const now = Date.now();
    const timeout = this.options.timeout || 30000;
    const timedOutTasks: string[] = [];

    for (const [taskId, timestamp] of this.taskTimestamps) {
      if (now - timestamp > timeout) {
        timedOutTasks.push(taskId);
        this.cleanupTask(taskId);
        this.emit("task-timeout", taskId);
      }
    }

    return timedOutTasks;
  }

  // Event system
  on(
    event:
      | "ready"
      | "task-ready"
      | "task-completed"
      | "task-timeout"
      | "missing-prerequisites",
    handler: Function
  ): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
  }

  off(event: string, handler: Function): void {
    this.eventListeners.get(event)?.delete(handler);
  }

  private emit(event: string, ...args: any[]): void {
    this.eventListeners.get(event)?.forEach((handler) => handler(...args));
  }

  // Metrics
  private updateQueueMetrics(): void {
    this.metrics.maxQueueSize = Math.max(
      this.metrics.maxQueueSize,
      this.readyQueue.size() + this.remainingDeps.size
    );
  }

  getMetrics() {
    return {
      ...this.metrics,
      avgAssignmentLatency: this.metrics.assignmentLatency.length
        ? this.metrics.assignmentLatency.reduce((a, b) => a + b, 0) /
          this.metrics.assignmentLatency.length
        : 0,
      pendingTasks: this.remainingDeps.size,
      readyTasks: this.readyQueue.size(),
      completedTasks: this.completedTasks.size,
    };
  }

  // Additional utility methods
  hasPendingTasks(): boolean {
    return this.readyQueue.size() > 0 || this.remainingDeps.size > 0;
  }

  getTaskStatus(taskId: string): "pending" | "ready" | "completed" | "unknown" {
    if (this.completedTasks.has(taskId)) return "completed";
    if (this.readyQueue.contains(taskId)) return "ready";
    if (this.remainingDeps.has(taskId)) return "pending";
    return "unknown";
  }
}

// Enhanced MinHeap implementation
class MinHeap<T> {
  private heap: [number, number, T][] = [];
  private counter = 0;
  private indexMap = new Map<T, number>();

  push(priority: number, value: T): void {
    const entry: [number, number, T] = [priority, this.counter++, value];
    this.heap.push(entry);
    this.indexMap.set(value, this.heap.length - 1);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | null {
    if (this.heap.length === 0) return null;

    const min = this.heap[0][2];
    this.indexMap.delete(min);

    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.indexMap.set(last[2], 0);
      this.sinkDown(0);
    }
    return min;
  }

  size(): number {
    return this.heap.length;
  }

  contains(value: T): boolean {
    return this.indexMap.has(value);
  }

  private bubbleUp(index: number): void {
    const element = this.heap[index];
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.heap[parentIndex];

      if (this.compare(element, parent) >= 0) break;

      this.swap(index, parentIndex);
      index = parentIndex;
    }
  }

  private sinkDown(index: number): void {
    const length = this.heap.length;
    const element = this.heap[index];

    while (true) {
      let leftIndex = 2 * index + 1;
      let rightIndex = 2 * index + 2;
      let swapIndex: number | null = null;

      if (leftIndex < length) {
        if (this.compare(this.heap[leftIndex], element) < 0) {
          swapIndex = leftIndex;
        }
      }

      if (rightIndex < length) {
        const comparisonTarget =
          swapIndex === null ? element : this.heap[leftIndex];
        if (this.compare(this.heap[rightIndex], comparisonTarget) < 0) {
          swapIndex = rightIndex;
        }
      }

      if (swapIndex === null) break;
      this.swap(index, swapIndex);
      index = swapIndex;
    }
  }

  private compare(a: [number, number, T], b: [number, number, T]): number {
    // First compare by priority, then by insertion order
    return a[0] - b[0] || a[1] - b[1];
  }

  private swap(i: number, j: number): void {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
    this.indexMap.set(this.heap[i][2], i);
    this.indexMap.set(this.heap[j][2], j);
  }
}
