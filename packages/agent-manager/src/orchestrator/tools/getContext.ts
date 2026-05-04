import fs from "fs";
import path from "path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { OrchestratorContext } from "../types.js";
import type { OutputManifest } from "../../memory/types/output-manifest.types.js";
import { PromptLoader } from "../PromptLoader.js";

/**
 * Tool for retrieving context from previous task executions.
 *
 * Reads OutputManifest files from `.ping/outputs/` in each workspace.
 * Replaces the old ArtifactRegistry-based implementation (v1.1).
 */
export function createGetContextTool(context: OrchestratorContext) {
  return tool(
    async ({ taskId, role, limit }) => {
      try {
        // Discover all manifest files
        const manifests = await discoverManifests(context);

        let filtered = manifests;

        // Filter by current goal — planner only sees its own goal's outputs
        if (context.currentGoalId) {
          filtered = filtered.filter((m) => m.goalId === context.currentGoalId);
        }

        // Filter by taskId
        if (taskId) {
          filtered = filtered.filter((m) => m.taskId === taskId);
        }

        // Filter by role
        if (role) {
          filtered = filtered.filter(
            (m) => m.role.toLowerCase() === role.toLowerCase(),
          );
        }

        // Apply limit
        const max = limit || 10;
        filtered = filtered.slice(0, max);

        if (filtered.length === 0) {
          return taskId
            ? `No output manifest found for task ${taskId}`
            : "No task output manifests found matching the query";
        }

        // Format output for LLM consumption
        const summary = filtered
          .map((m) => {
            const files = m.outputs
              .map((o) => `  - ${o.path} (${o.category}, ${o.sizeBytes}b)`)
              .join("\n");
            return `[Task: ${m.taskId}] Role: ${m.role} | Files: ${m.outputs.length} | Published: ${m.publishedAt}
Activity: ${m.activitySummary.substring(0, 300)}${m.activitySummary.length > 300 ? "..." : ""}
Outputs:
${files || "  (none)"}`;
          })
          .join("\n\n---\n\n");

        return summary;
      } catch (error: any) {
        return `Error retrieving context: ${error.message}`;
      }
    },
    {
      name: "get_context",
      description: PromptLoader.loadTemplate("tools", "get_context"),
      schema: z.object({
        taskId: z
          .string()
          .optional()
          .describe("Specific task ID to get context for"),
        role: z
          .string()
          .optional()
          .describe("Filter manifests by role (e.g., 'backend', 'frontend')"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of manifests to return (default: 10)"),
      }),
    },
  );
}

/**
 * Discover all OutputManifest JSON files from workspaces.
 * Scans `.ping/outputs/*.json` in workspace directories.
 */
async function discoverManifests(
  context: OrchestratorContext,
): Promise<OutputManifest[]> {
  const manifests: OutputManifest[] = [];

  // Access workspace manager if available
  const memMgr = context.taskProvider as any;
  const workspaceMgr = memMgr._workspaceManager || memMgr.workspaceManager;
  if (!workspaceMgr) return manifests;

  const repoPath =
    typeof workspaceMgr.getRepoPath === "function"
      ? workspaceMgr.getRepoPath()
      : null;
  if (!repoPath) return manifests;

  // Scan .ping/workspaces/*/.ping/outputs/*.json
  const workspacesRoot = path.join(repoPath, ".ping", "workspaces");
  try {
    const entries = await fs.promises.readdir(workspacesRoot, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const outputsDir = path.join(
        workspacesRoot,
        entry.name,
        ".ping",
        "outputs",
      );
      try {
        const jsonFiles = await fs.promises.readdir(outputsDir);
        for (const file of jsonFiles) {
          if (!file.endsWith(".json")) continue;
          try {
            const raw = await fs.promises.readFile(
              path.join(outputsDir, file),
              "utf-8",
            );
            manifests.push(JSON.parse(raw) as OutputManifest);
          } catch {
            // Skip corrupt manifests
          }
        }
      } catch {
        // No outputs dir for this workspace
      }
    }
  } catch {
    // No workspaces directory
  }

  return manifests;
}
