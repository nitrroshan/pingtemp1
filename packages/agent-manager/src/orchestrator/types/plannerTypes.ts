/**
 * Planner Types
 *
 * Core type definitions for the Planner-as-Agent feature.
 * The planner is the top-level strategic agent that owns the cognitive loop:
 * CLARIFY → RESEARCH → ANALYSE → DISCUSS → ASSESS TEAM → REASON → PLAN → MONITOR
 */

/**
 * Task priority levels — lower number = higher urgency.
 * Affects dispatch order in RoleTaskQueue.
 */
export type TaskPriority = 1 | 2 | 3 | 4 | 5;

/**
 * A full plan produced by the planner agent.
 * Submitted via submit_plan tool → validated by DependencyResolver.
 */
export interface Plan {
  planId: string;
  goal: string;
  tasks: PlanTask[];
  metadata?: {
    requiresApproval?: boolean;
    estimatedDuration?: string;
    createdAt?: string;
  };
}

/**
 * A single task within a plan.
 * The planner constructs these directly (no PlanBuilder intermediary).
 */
export interface PlanTask {
  id: string;
  title: string;
  description: string;
  assignedRole: string;
  priority: TaskPriority;
  complexity: "low" | "medium" | "high";
  dependencies: string[];
  onDependencyFail?: "fail" | "skip" | "replan";
  expectedOutput: string;
  context?: TaskContext;
}

/**
 * Structured context injected into a task for workers.
 */
export interface TaskContext {
  notes?: string;
  files?: string[];
  artifacts?: string[];
  relatedTasks?: string[];
}

/**
 * Patch object for update_task mutations.
 * All fields optional — only provided fields are applied.
 */
export interface TaskPatch {
  title?: string;
  description?: string;
  assignedRole?: string;
  priority?: TaskPriority;
  dependencies?: string[];
  expectedOutput?: string;
  context?: Partial<TaskContext>;
}

// ─── User Interaction Types ───────────────────────────────────────────────────

/**
 * A question the planner (or worker) asks the user.
 * Stored in UserInteractionManager until resolved or timed out.
 */
export interface UserQuestion {
  id: string;
  from: "planner" | "worker";
  /** Task ID if from a worker, planner session ID if from planner */
  sourceId: string;
  question: string;
  /** Optional list of choices for discuss_approach */
  options?: UserQuestionOption[];
  category?: "clarification" | "decision" | "approval" | "feedback";
  timestamp: number;
}

export interface UserQuestionOption {
  label: string;
  description?: string;
}

/**
 * The user's response to a question.
 */
export interface UserChoice {
  questionId: string;
  answer: string;
  /** Index of selected option if options were provided */
  selectedOptionIndex?: number;
  timestamp: number;
}

// ─── Notification Types ───────────────────────────────────────────────────────
// SIMPLIFIED: Notifications are now plain strings batched by NotificationQueue.
// The old typed PlannerNotification union and check_notifications tool are removed.
// OrchestratorService pushes string messages → NotificationQueue debounces →
// onPlannerInput callback starts a new planner turn.
//
// Kept for reference: NotificationSeverity was "info" | "warning" | "urgent"
// Now handled by NotificationQueue.push() vs .pushUrgent()

/**
 * Categories for tell_user messages (fire-and-forget updates).
 */
export type TellUserCategory = "finding" | "progress" | "warning" | "status";
