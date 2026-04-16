/**
 * Task Lifecycle Skill — System-level instructions for core orchestration tools
 *
 * Loaded from `skills/task-lifecycle/SKILL.md` and injected into EVERY worker agent's
 * system prompt via WorkerPool. This ensures all agents (plugin-based and generic)
 * know how to use report_status, complete_task, request_task, and bounce_task.
 *
 * Same pattern as workspace-guide (from @ping/workspace) and collab-guide (from @ping/collaboration),
 * but injected directly by WorkerPool since these are system tools, not plugin tools.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

let cachedInstructions: string | null = null;

/**
 * Load the task-lifecycle SKILL.md content, stripping YAML frontmatter.
 * Cached after first load.
 */
export function loadTaskLifecycleSkill(): string | null {
  if (cachedInstructions !== null) return cachedInstructions;

  // Resolve relative to this file's location
  // At runtime: dist/skills/taskLifecycleSkill.js → need to find skills/task-lifecycle/SKILL.md
  // In source: src/skills/taskLifecycleSkill.ts → need ../../skills/task-lifecycle/SKILL.md
  const paths = [
    // Monorepo dev: from dist/ or src/
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills", "task-lifecycle", "SKILL.md"),
    // From package root
    join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "task-lifecycle", "SKILL.md"),
    // Fallback: resolve from package
    join(process.cwd(), "packages", "agent-manager", "skills", "task-lifecycle", "SKILL.md"),
  ];

  for (const skillPath of paths) {
    try {
      if (existsSync(skillPath)) {
        let content = readFileSync(skillPath, "utf-8");
        // Strip YAML frontmatter
        if (content.startsWith("---")) {
          const endIndex = content.indexOf("---", 3);
          if (endIndex !== -1) {
            content = content.slice(endIndex + 3).trim();
          }
        }
        cachedInstructions = content;
        return cachedInstructions;
      }
    } catch {
      // Try next path
    }
  }

  // If skill file not found, return null (non-fatal — tools still work, just undocumented)
  cachedInstructions = "";
  return null;
}
