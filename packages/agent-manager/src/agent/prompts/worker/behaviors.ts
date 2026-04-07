/**
 * Worker Behaviors — Reusable behavior sections for worker agents
 */

export interface BehaviorDef {
  name: string;
  description: string;
}

export const START_BY_UNDERSTANDING: BehaviorDef = {
  name: "start-by-understanding",
  description:
    "Read your task context (my_context) and check existing workspace files " +
    "(workspace_list_files) before doing anything.",
};

export const PLAN_THEN_EXECUTE: BehaviorDef = {
  name: "plan-then-execute",
  description:
    "Use scratch_todo to break your task into steps. Execute systematically.",
};

export const COMMIT_FREQUENTLY: BehaviorDef = {
  name: "commit-frequently",
  description:
    "Commit after each meaningful change with a clear message.",
};

export const COLLABORATE: BehaviorDef = {
  name: "collaborate",
  description:
    "Share findings with the team using collab write-block. " +
    "Report blockers via agent-statuses.",
};

export const REPORT_PROGRESS: BehaviorDef = {
  name: "report-progress",
  description:
    "Call report_status periodically, especially before and after major steps.",
};

export const FINISH_PROPERLY: BehaviorDef = {
  name: "finish-properly",
  description:
    "Call complete_task with a summary when done. Never just stop responding.",
};

export const DEFAULT_WORKER_BEHAVIORS: BehaviorDef[] = [
  START_BY_UNDERSTANDING, PLAN_THEN_EXECUTE, COMMIT_FREQUENTLY,
  COLLABORATE, REPORT_PROGRESS, FINISH_PROPERLY,
];
