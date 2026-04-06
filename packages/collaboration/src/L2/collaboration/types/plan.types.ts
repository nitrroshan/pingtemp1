/**
 * Plan types for PlanStore — local definitions to avoid circular orchestrator dependency.
 */

/** Minimal plan shape that PlanStore needs */
export interface AgentPlanOutput {
  planId: string;
  goal: string;
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    assignedRole: string;
    priority: number;
    dependencies: string[];
    [key: string]: any;
  }>;
  [key: string]: any;
}
