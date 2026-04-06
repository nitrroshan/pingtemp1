/**
 * @ping/agent-manager — Shared Types
 *
 * Public contract types for the AgentManager orchestration layer.
 * These interfaces form the package boundary between @ping/agent-manager
 * and its consumers (@ping/backend, @ping/frontend, etc.).
 *
 * Phase 3C Note: Source implementations remain in @ping/backend until
 * Phase 3C Step 2. These types are defined here to be the canonical
 * source of truth for the public API surface.
 */

// ---------------------------------------------------------------------------
// Plan types
// ---------------------------------------------------------------------------

/**
 * Additional context attached to a planned task.
 */
export interface TaskContext {
  previousOutputs?: Record<string, string>;
  teamGoal?: string;
  additionalContext?: string;
}

/**
 * A single task item within an execution plan.
 */
export interface TaskItem {
  /** Unique task identifier */
  id: string;
  /** Short task title */
  title: string;
  /** Detailed task description */
  description: string;
  /** Role responsible for this task */
  assignedRole: string;
  /** Priority level (1 = highest, 5 = lowest) */
  priority: number;
  /** Estimated effort */
  complexity: "low" | "medium" | "high";
  /** Task IDs that must complete before this one */
  dependencies: string[];
  /** What to do if a dependency fails */
  onDependencyFail: "skip" | "fail" | "replan";
  /** Description of expected output */
  expectedOutput: string;
  /** Additional context for the task */
  context: TaskContext;
}

/**
 * A phase groups related tasks and controls execution order.
 */
export interface PlanPhase {
  id: string;
  name: string;
  description: string;
  tasks: string[];
  order: number;
}

/**
 * Complete plan output returned by the plan builder agent.
 */
export interface AgentPlanOutput {
  planId: string;
  goal: string;
  tasks: TaskItem[];
  phases: PlanPhase[];
  estimatedDuration: string;
  successCriteria: string[];
}

/** Alias for AgentPlanOutput — used for semantic clarity in orchestrator contexts. */
export type TaskPlan = AgentPlanOutput;

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

/**
 * Orchestrator state machine states.
 */
export type OrchestratorState =
  | "idle"             // No active session
  | "gathering"        // Gathering requirements through conversation
  | "awaiting_approval" // Plan created, waiting for user approval
  | "executing";       // Plan approved, tasks being executed

/**
 * Emitted when the orchestrator proposes a plan for user review.
 */
export interface PlanProposedEvent {
  plan: AgentPlanOutput;
  teamId: string;
  timestamp: string;
}

/**
 * Emitted after a plan is approved and tasks have been queued.
 */
export interface PlanApprovedEvent {
  planId: string;
  teamId: string;
  tasksQueued: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Callback interfaces
// ---------------------------------------------------------------------------

/**
 * Per-worker event callbacks consumed by WorkerPool.
 */
export interface WorkerCallbacks {
  onStream?: (data: { taskId: string; agentId: string; part: unknown }) => void;
  onEvent?: (data: { taskId: string; event: unknown }) => void;
  onDone?: (data: { taskId: string; role: string; output: unknown }) => void;
  onError?: (data: { taskId: string; error: string }) => void;
  onAgentComplete?: (data: {
    taskId: string;
    role: string;
    summary: string;
    deliverables: string[];
    nextSteps: string[];
    timestamp: number;
  }) => void;
  onStatusUpdate?: (data: {
    taskId: string;
    role: string;
    status: string;
    summary: string;
    progress?: number;
    timestamp: number;
  }) => void;
}

/**
 * Callbacks emitted by OrchestratorService during planning and execution.
 */
export interface OrchestratorCallbacks {
  onStream?: (data: { taskId: string; agentId: string; part: unknown }) => void;
  onEvent?: (data: { taskId: string; event: unknown }) => void;
  onDone?: (data: { taskId: string; role: string; output: unknown }) => void;
  onError?: (data: { taskId: string; error: string }) => void;
  onPlanProposed?: (data: PlanProposedEvent) => void;
  onPlanApproved?: (data: PlanApprovedEvent) => void;
  onTaskUpdate?: (data: {
    taskId: string;
    status: string;
    role?: string;
    output?: unknown;
    timestamp?: number;
  }) => void;
  onProgress?: (data: {
    teamId: string;
    state: string;
    message: string;
    [key: string]: unknown;
  }) => void;
}

/**
 * Top-level stream callbacks registered with AgentManager.
 * These are forwarded to WorkerPool and OrchestratorService.
 */
export interface ManagerStreamCallbacks {
  onStream?: (data: { taskId: string; agentId: string; part: unknown }) => void;
  onEvent?: (data: { taskId: string; event: unknown }) => void;
  onDone?: (data: { taskId: string; role: string; output: unknown }) => void;
  onError?: (data: { taskId: string; error: string }) => void;
  onTaskUpdate?: (data: {
    taskId: string;
    status: string;
    role?: string;
    output?: unknown;
  }) => void;
  onPlanUpdate?: (data: {
    action: string;
    tasksQueued?: number;
    timestamp: number;
  }) => void;
  onPlanProposed?: (data: PlanProposedEvent) => void;
}

// ---------------------------------------------------------------------------
// Registry types
// ---------------------------------------------------------------------------

/**
 * Team data shape used to configure an AgentManager instance.
 */
export interface TeamData {
  id: string;
  name: string;
  goal: string;
  roles: Array<{
    id: string;
    role: string;
    name: string;
    goal: string;
    systemPrompt?: string;
  }>;
}
