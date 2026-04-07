/**
 * WorkerPromptFactory — Assembles worker system prompts at runtime
 *
 * Responsibility: Compose a worker prompt from capabilities + behaviors + rules + task context.
 * Uses PromptBuilder for XML assembly. Selects capabilities based on available plugins.
 *
 * Called by WorkerPool.createWorker() at task dispatch time.
 */

import { PromptBuilder } from "../PromptBuilder.js";
import { DEFAULT_WORKER_CAPABILITIES, type CapabilityDef } from "./capabilities.js";
import { DEFAULT_WORKER_BEHAVIORS, type BehaviorDef } from "./behaviors.js";
import { DEFAULT_WORKER_RULES, type RuleDef } from "./rules.js";

export interface WorkerPromptConfig {
  role: string;
  taskId: string;
  taskDescription: string;
  taskContext?: Record<string, any>;

  /** Override default capabilities (e.g., exclude workspace if no plugin) */
  capabilities?: CapabilityDef[];
  /** Override default behaviors */
  behaviors?: BehaviorDef[];
  /** Override default rules */
  rules?: RuleDef[];
}

export function buildWorkerPrompt(config: WorkerPromptConfig): string {
  const capabilities = config.capabilities ?? DEFAULT_WORKER_CAPABILITIES;
  const behaviors = config.behaviors ?? DEFAULT_WORKER_BEHAVIORS;
  const rules = config.rules ?? DEFAULT_WORKER_RULES;

  const builder = new PromptBuilder();

  // Identity
  builder.identity(
    `You are a **${config.role}** agent in a multi-agent team. ` +
    `Execute tasks assigned to your role with expertise and precision.`,
  );

  // Capabilities
  for (const cap of capabilities) {
    builder.capability(cap.name, cap.description, cap.tools);
  }

  // Behaviors
  for (const beh of behaviors) {
    builder.behavior(beh.name, beh.description);
  }

  // Rules
  for (const rule of rules) {
    builder.rule(rule.name, rule.description);
  }

  // Task context (injected at runtime)
  const ctx = config.taskContext || {};
  const contextLines: string[] = [
    `Task ID: ${config.taskId}`,
    `Role: ${config.role}`,
    `Description: ${config.taskDescription}`,
  ];

  if (ctx.goal) contextLines.push(`Goal: ${ctx.goal}`);
  if (ctx.expectedOutput) contextLines.push(`Expected Output: ${ctx.expectedOutput}`);
  if (ctx.priority) contextLines.push(`Priority: ${ctx.priority}`);

  // Notes array — research findings, prior context, planner instructions
  const notes: string[] = Array.isArray(ctx.notes)
    ? ctx.notes
    : ctx.notes ? [ctx.notes] : [];

  if (notes.length > 0) {
    contextLines.push("");
    contextLines.push("Notes:");
    for (const note of notes) {
      contextLines.push(`- ${note}`);
    }
  }

  // Related files from planner
  const files: string[] = Array.isArray(ctx.files) ? ctx.files : [];
  if (files.length > 0) {
    contextLines.push("");
    contextLines.push("Relevant files:");
    for (const file of files) {
      contextLines.push(`- ${file}`);
    }
  }

  builder.section("task-context", contextLines.join("\n"));

  return builder.build();
}
