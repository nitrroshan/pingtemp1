/**
 * DependencyResolver
 *
 * DAG validation and query engine for task plans.
 * - Cycle detection via DFS (returns cycle path)
 * - Topological sort via Kahn's algorithm
 * - Ready/blocked/critical-path queries
 * - Re-resolves after every mutation
 *
 * Our DAGs are 10-50 nodes — no external dependency needed.
 *
 * NOTE: Does NOT depend on MemoryManager or TaskStore directly.
 * Uses a minimal interface (TaskSource) so any store can provide tasks.
 */

import type { ITaskProvider } from "./ITaskProvider.js";

/** Minimal interface — anything with getAllTasks() works (MemoryManager, TaskStore, etc.) */
type TaskSource = ITaskProvider;

interface TaskNode {
  id: string;
  dependencies: string[];
  status: string;
}

export class DependencyResolver {
  private nodes = new Map<string, TaskNode>();

  /**
   * Build the DAG from any task source (MemoryManager, TaskStore, etc.)
   */
  rebuild(source: TaskSource): void {
    this.nodes.clear();
    const allTasks = source.getAllTasks();
    for (const task of allTasks) {
      const deps = task.prerequisites
        ? Array.from(task.prerequisites.keys())
        : [];
      this.nodes.set(task.id, {
        id: task.id,
        dependencies: deps,
        status: task.status,
      });
    }
  }

  /**
   * @deprecated Use rebuild() instead. Kept for backward compatibility.
   */
  rebuildFromMemoryManager(source: TaskSource): void {
    this.rebuild(source);
  }

  /**
   * Build from a plan's task array (before tasks are in MemoryManager).
   */
  buildFromTasks(tasks: Array<{ id: string; dependencies: string[] }>): void {
    this.nodes.clear();
    for (const task of tasks) {
      this.nodes.set(task.id, {
        id: task.id,
        dependencies: task.dependencies,
        status: "pending",
      });
    }
  }

  /**
   * Validate an entire plan's DAG. Returns error string if invalid, null if valid.
   */
  validate(): string | null {
    // Check for references to nonexistent tasks
    for (const [id, node] of this.nodes) {
      for (const dep of node.dependencies) {
        if (!this.nodes.has(dep)) {
          return `Task '${id}' depends on '${dep}' which does not exist`;
        }
      }
    }

    // Check for cycles
    const cycle = this.detectCycle();
    if (cycle) {
      return `Dependency cycle detected: ${cycle.join(" → ")}`;
    }

    return null;
  }

  /**
   * Validate that changing a task's dependencies won't create a cycle.
   * Returns error string if invalid, null if valid.
   */
  validateDependencies(taskId: string, newDependencies: string[]): string | null {
    // Temporarily update
    const original = this.nodes.get(taskId);
    if (!original) return `Task '${taskId}' not found`;

    const saved = original.dependencies;
    original.dependencies = newDependencies;

    const cycle = this.detectCycle();
    original.dependencies = saved; // Restore

    if (cycle) {
      return `Dependency cycle would be created: ${cycle.join(" → ")}`;
    }
    return null;
  }

  /**
   * Validate new tasks can be added without creating cycles.
   */
  validateNewTasks(
    newTasks: Array<{ id: string; dependencies: string[] }>,
    source: TaskSource,
  ): string | null {
    // Temporarily add all new tasks
    const saved = new Map(this.nodes);

    for (const task of newTasks) {
      this.nodes.set(task.id, {
        id: task.id,
        dependencies: task.dependencies,
        status: "pending",
      });
    }

    // Check references
    for (const task of newTasks) {
      for (const dep of task.dependencies) {
        if (!this.nodes.has(dep)) {
          this.nodes = saved; // Restore
          return `New task '${task.id}' depends on '${dep}' which does not exist`;
        }
      }
    }

    const cycle = this.detectCycle();
    this.nodes = saved; // Restore

    if (cycle) {
      return `Adding tasks would create cycle: ${cycle.join(" → ")}`;
    }
    return null;
  }

  /**
   * Detect cycles in the DAG via DFS. Returns the cycle path or null.
   */
  detectCycle(): string[] | null {
    const WHITE = 0; // Unvisited
    const GRAY = 1;  // In current DFS path
    const BLACK = 2; // Fully processed

    const color = new Map<string, number>();
    const parent = new Map<string, string>();

    for (const id of this.nodes.keys()) {
      color.set(id, WHITE);
    }

    for (const id of this.nodes.keys()) {
      if (color.get(id) === WHITE) {
        const cycle = this.dfs(id, color, parent);
        if (cycle) return cycle;
      }
    }

    return null;
  }

  private dfs(
    nodeId: string,
    color: Map<string, number>,
    parent: Map<string, string>,
  ): string[] | null {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;

    color.set(nodeId, GRAY);
    const node = this.nodes.get(nodeId);

    if (node) {
      for (const dep of node.dependencies) {
        if (color.get(dep) === GRAY) {
          // Found cycle — reconstruct path
          const cycle = [dep, nodeId];
          let current = nodeId;
          while (parent.has(current) && parent.get(current) !== dep) {
            current = parent.get(current)!;
            cycle.push(current);
          }
          cycle.push(dep);
          return cycle.reverse();
        }

        if (color.get(dep) === WHITE) {
          parent.set(dep, nodeId);
          const result = this.dfs(dep, color, parent);
          if (result) return result;
        }
      }
    }

    color.set(nodeId, BLACK);
    return null;
  }

  /**
   * Topological sort via Kahn's algorithm.
   * Returns sorted task IDs or throws if cycle exists.
   */
  topologicalSort(): string[] {
    const inDegree = new Map<string, number>();
    for (const id of this.nodes.keys()) {
      inDegree.set(id, 0);
    }

    for (const node of this.nodes.values()) {
      for (const dep of node.dependencies) {
        inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
      }
    }

    // Wait — inDegree should be the count of edges INTO a node
    // A depends on B means A has an edge from B to A
    // In Kahn's: inDegree counts how many prerequisites each node has
    inDegree.clear();
    for (const id of this.nodes.keys()) {
      inDegree.set(id, 0);
    }
    for (const node of this.nodes.values()) {
      // node.dependencies = tasks that must complete before this node
      inDegree.set(node.id, node.dependencies.length);
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const result: string[] = [];
    const adjList = this.buildReverseAdj();

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      // Find tasks that depend on 'current'
      const dependants = adjList.get(current) || [];
      for (const dependantId of dependants) {
        const newDegree = (inDegree.get(dependantId) || 1) - 1;
        inDegree.set(dependantId, newDegree);
        if (newDegree === 0) queue.push(dependantId);
      }
    }

    if (result.length !== this.nodes.size) {
      throw new Error("Cycle detected in dependency graph — topological sort failed");
    }

    return result;
  }

  /**
   * Build reverse adjacency list: taskId → tasks that depend on it.
   */
  private buildReverseAdj(): Map<string, string[]> {
    const adj = new Map<string, string[]>();
    for (const [id, node] of this.nodes) {
      for (const dep of node.dependencies) {
        if (!adj.has(dep)) adj.set(dep, []);
        adj.get(dep)!.push(id);
      }
    }
    return adj;
  }

  /**
   * Get tasks that are ready (all dependencies completed).
   */
  getReady(): string[] {
    const ready: string[] = [];
    for (const [id, node] of this.nodes) {
      if (node.status === "completed" || node.status === "in_progress" || node.status === "failed") {
        continue;
      }

      const allDepsComplete = node.dependencies.every((dep) => {
        const depNode = this.nodes.get(dep);
        return depNode?.status === "completed";
      });

      if (allDepsComplete) {
        ready.push(id);
      }
    }
    return ready;
  }

  /**
   * Get tasks that are blocked (have uncompleted dependencies).
   */
  getBlocked(): Array<{ taskId: string; blockedBy: string[] }> {
    const blocked: Array<{ taskId: string; blockedBy: string[] }> = [];
    for (const [id, node] of this.nodes) {
      if (node.status === "completed" || node.status === "in_progress" || node.status === "failed") {
        continue;
      }

      const incompleteDeps = node.dependencies.filter((dep) => {
        const depNode = this.nodes.get(dep);
        return depNode && depNode.status !== "completed";
      });

      if (incompleteDeps.length > 0) {
        blocked.push({ taskId: id, blockedBy: incompleteDeps });
      }
    }
    return blocked;
  }

  /**
   * Get the critical path (longest dependency chain by count).
   */
  getCriticalPath(): string[] {
    // Use dynamic programming on topological order
    try {
      const sorted = this.topologicalSort();
      const dist = new Map<string, number>();
      const prev = new Map<string, string | null>();

      for (const id of sorted) {
        dist.set(id, 0);
        prev.set(id, null);
      }

      for (const id of sorted) {
        const node = this.nodes.get(id)!;
        for (const dep of node.dependencies) {
          const newDist = (dist.get(dep) || 0) + 1;
          if (newDist > (dist.get(id) || 0)) {
            dist.set(id, newDist);
            prev.set(id, dep);
          }
        }
      }

      // Find the node with the max distance
      let maxId = sorted[0];
      let maxDist = 0;
      for (const [id, d] of dist) {
        if (d > maxDist) {
          maxDist = d;
          maxId = id;
        }
      }

      // Reconstruct path
      const path: string[] = [];
      let current: string | null | undefined = maxId;
      while (current) {
        path.unshift(current);
        current = prev.get(current) ?? null;
      }

      return path;
    } catch {
      return []; // Cycle detected
    }
  }

  /**
   * Update a node's status (call after task status changes).
   */
  updateStatus(taskId: string, status: string): void {
    const node = this.nodes.get(taskId);
    if (node) node.status = status;
  }

  /**
   * Get the total number of tasks in the DAG.
   */
  get size(): number {
    return this.nodes.size;
  }
}
