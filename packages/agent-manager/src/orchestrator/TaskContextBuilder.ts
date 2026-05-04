/**
 * TaskContextBuilder — Pure data assembly for task dispatch.
 *
 * Extracted from OrchestratorService.dispatchTask() (Phase 4.5, SRP refactor).
 * No side effects, no state mutation — pure function that builds enriched descriptions.
 */

import { rootLogger } from "../logging.js";

const log = rootLogger.child({ module: "TaskContextBuilder" });

export interface TaskContextInput {
  task: {
    id: string;
    description: string;
    type?: string;
    priority?: number;
    context?: Record<string, any>;
    goalId?: string;
  };
  role: string;
  teamRoles: string[];
  crdtRefs?: Record<string, any>;
  /** @deprecated Use taskPersistence instead */
  planStore?: any;
  /** Task persistence for cross-plan reference resolution (replaces PlanStore) */
  taskPersistence?: { getTasksByGoal?(goalId: string): Promise<any[]> } | null;
}

export interface EnrichedTaskResult {
  enrichedDescription: string;
  previousOutputs: any[];
  artifacts: string[];
  crdtRefs?: Record<string, any>;
}

export class TaskContextBuilder {
  /**
   * Enrich a task description with upstream context, CRDT refs,
   * cross-plan references, team roster, and discussion protocol.
   * Pure function — no side effects, no state mutation.
   */
  static async enrich(input: TaskContextInput): Promise<EnrichedTaskResult> {
    const { task, role, teamRoles, crdtRefs, planStore, taskPersistence } = input;
    const taskCtx = (typeof task.context === "object" ? task.context : {}) as Record<string, any>;

    const previousOutputs: any[] = []; // kept for backward compat in return type
    const artifacts = [
      ...(Array.isArray(taskCtx.upstreamArtifacts) ? taskCtx.upstreamArtifacts : []),
      ...(Array.isArray(taskCtx.files) ? taskCtx.files : []),
      ...(Array.isArray(taskCtx.artifacts) ? taskCtx.artifacts : []),
    ];

    let enrichedDescription = task.description;

    // ── Input Documents (DocumentRef — agents read via collab) ──────
    const inputDocs = Array.isArray(taskCtx.inputDocs) ? taskCtx.inputDocs : [];
    if (inputDocs.length > 0) {
      enrichedDescription += `\n\n## Input Documents`;
      enrichedDescription += `\nThese documents were produced by upstream tasks. Read them for context:`;
      for (const doc of inputDocs) {
        const scheme = doc.uri?.startsWith("crdt:") ? "collab read" : doc.uri?.startsWith("workspace:") ? "workspace_read_file" : "fetch";
        const path = doc.uri?.replace(/^(crdt:|workspace:)/, "") || doc.uri;
        enrichedDescription += `\n- **${doc.name}**: \`${scheme} ${path}\`${doc.description ? ` — ${doc.description}` : ""}${doc.hint ? ` (${doc.hint})` : ""}`;
      }
    }

    // ── Upstream Decisions ───────────────────────────────────────────
    const upstreamDecisions = Array.isArray(taskCtx.upstreamDecisions) ? taskCtx.upstreamDecisions : [];
    if (upstreamDecisions.length > 0) {
      enrichedDescription += `\n\n## Upstream Decisions`;
      enrichedDescription += `\nThese decisions were made by upstream tasks. Respect them:`;
      for (const d of upstreamDecisions) {
        enrichedDescription += `\n- ${d}`;
      }
    }

    // ── Workspace artifacts ─────────────────────────────────────────
    if (artifacts.length > 0) {
      enrichedDescription += `\n\n## Workspace Files`;
      enrichedDescription += `\nFiles from upstream tasks (already merged to your workspace):`;
      enrichedDescription += `\n${artifacts.map((a: string) => `- ${a}`).join("\n")}`;
      enrichedDescription += `\nUse \`workspace_list_files\` to see all available files.`;
    }

    // ── Notes + expected output ─────────────────────────────────────
    const allNotes: string[] = [
      ...(Array.isArray(taskCtx.notes) ? taskCtx.notes : taskCtx.notes ? [taskCtx.notes] : []),
    ];
    if (allNotes.length > 0) {
      enrichedDescription += `\n\nNotes:\n${allNotes.map((n: string) => `- ${n}`).join("\n")}`;
    }
    if (taskCtx.expectedOutput) {
      enrichedDescription += `\n\nExpected output: ${taskCtx.expectedOutput}`;
    }

    // ── Cross-plan reference resolution ─────────────────────────────
    const references = Array.isArray(taskCtx.references) ? taskCtx.references : [];
    const unresolvedRefs: string[] = [];
    if (references.length > 0 && (taskPersistence || planStore)) {
      const resolvedRefs: Array<{ uri: string; name: string; description: string }> = [];
      for (const ref of references) {
        try {
          const [refGoalOrPlan, refTaskId] = ref.split("/");
          if (!refTaskId) {
            unresolvedRefs.push(`${ref} (invalid format)`);
            continue;
          }

          // Try MongoDB task lookup first (preferred — no PlanStore dependency)
          let resolved = false;
          if (taskPersistence?.getTasksByGoal) {
            const goalTasks = await taskPersistence.getTasksByGoal(refGoalOrPlan);
            const refTask = goalTasks.find((t: any) => t.taskId === refTaskId || t.taskId?.endsWith(`-${refTaskId}`));
            if (refTask) {
              resolvedRefs.push({
                uri: `crdt:${refTask.taskId}/task`,
                name: `${ref} (${refTask.assignedRole || "unknown"})`,
                description: refTask.title || refTask.description?.slice(0, 100) || "Prior task output",
              });
              resolved = true;
            }
          }

          // Fallback to PlanStore if MongoDB didn't find it (backward compat)
          if (!resolved && planStore) {
            const allPlans = await planStore.listAllPlans();
            const matchPlan = allPlans.find((p: any) => p.planId === refGoalOrPlan || p.goalId === refGoalOrPlan);
            if (matchPlan) {
              const stored = await planStore.loadPlan(matchPlan.planId, matchPlan.goalId);
              const refTask = stored?.plan?.tasks?.find((t: any) => t.id === refTaskId);
              if (refTask) {
                resolvedRefs.push({
                  uri: `crdt:${refTaskId}/task`,
                  name: `${ref} (${refTask.assignedRole || "unknown"})`,
                  description: refTask.title || refTask.description?.slice(0, 100) || "Prior task output",
                });
                resolved = true;
              }
            }
          }

          if (!resolved) unresolvedRefs.push(`${ref} (not found)`);
        } catch (err) {
          unresolvedRefs.push(`${ref} (error: ${err})`);
        }
      }
      if (resolvedRefs.length > 0) {
        enrichedDescription += `\n\n## Prior Work (from previous plans)`;
        for (const doc of resolvedRefs) {
          enrichedDescription += `\n- **${doc.name}**: \`collab read ${doc.uri.replace("crdt:", "")}\` — ${doc.description}`;
        }
      }
      if (unresolvedRefs.length > 0) {
        log.warn(`Task ${task.id}: ${unresolvedRefs.length}/${references.length} cross-plan refs unresolved`);
        enrichedDescription += `\n\n⚠️ Unresolved references (${unresolvedRefs.length}): ${unresolvedRefs.join(", ")}`;
      }
    }

    // ── CRDT references ─────────────────────────────────────────────
    if (crdtRefs) {
      enrichedDescription += `\n\n## Context Sources (use collab read to access)`;
      enrichedDescription += `\n- Your task: collab read ${crdtRefs.task}`;
      enrichedDescription += `\n- Plan: collab read ${crdtRefs.plan}`;
      enrichedDescription += `\n- Goal: collab read ${crdtRefs.goal}`;
      if (crdtRefs.dependencies?.length) {
        enrichedDescription += `\n- Completed dependencies: ${crdtRefs.dependencies.join(", ")}`;
      }
      if (crdtRefs.dependants?.length) {
        enrichedDescription += `\n- Downstream (depends on you): ${crdtRefs.dependants.join(", ")}`;
      }
    }

    // ── Team roster ─────────────────────────────────────────────────
    if (teamRoles.length > 0) {
      const otherRoles = teamRoles.filter(r => r.toLowerCase() !== role.toLowerCase());
      if (otherRoles.length > 0) {
        enrichedDescription += `\n\n## Your Team`;
        enrichedDescription += `\nOther roles you can collaborate with or create tasks for:`;
        enrichedDescription += otherRoles.map(r => `\n- ${r}`).join("");
        enrichedDescription += `\n\nIf you need work from another role, use request_task({ targetRole: "role-name", relationship: "blocks-me" }).`;
        enrichedDescription += `\nIf this task is wrong for your role, use bounce_task().`;
      }
    }

    // ── Discussion protocol ─────────────────────────────────────────
    if (task.type === "collaboration" || task.type === "discussion" || taskCtx.type === "collaboration") {
      const discussionDocName = `${task.id}/discussion`;
      const otherRoles = teamRoles.filter(r => r.toLowerCase() !== role.toLowerCase());
      enrichedDescription += `\n\n## ⚡ Discussion Task`;
      enrichedDescription += `\nYou are participating in a cross-role discussion. Other team roles: ${otherRoles.join(", ")}.`;

      const agendaLines = task.description
        .split("\n")
        .filter((l: string) => /^\d+\./.test(l.trim()))
        .map((l: string) => l.trim().replace(/^\d+\.\s*/, ""));
      if (agendaLines.length > 0) {
        enrichedDescription += `\n\n### Agenda:`;
        enrichedDescription += agendaLines.map((a, i) => `\n${i + 1}. ${a}`).join("");
        enrichedDescription += `\nAddress each item. Use decide with matching key to resolve each.`;
      }
      enrichedDescription += `\n\n### Protocol (follow these steps exactly):`;
      enrichedDescription += `\n1. **Read** existing discussion:`;
      enrichedDescription += `\n   \`collab({ action: "discuss", docName: "${discussionDocName}", key: "read" })\``;
      enrichedDescription += `\n2. **Post** your perspective (mention other roles for their input):`;
      enrichedDescription += `\n   \`collab({ action: "discuss", docName: "${discussionDocName}", key: "post", value: { content: "YOUR INPUT HERE", mentions: [${otherRoles.map(r => `"${r}"`).join(", ")}] } })\``;
      enrichedDescription += `\n3. **Read** again to check for responses:`;
      enrichedDescription += `\n   \`collab({ action: "discuss", docName: "${discussionDocName}", key: "read" })\``;
      enrichedDescription += `\n4. **Decide** when consensus is reached:`;
      enrichedDescription += `\n   \`collab({ action: "discuss", docName: "${discussionDocName}", key: "decide", value: { key: "outcome", decision: "...", agreedBy: ["${role}", ...] } })\``;
      enrichedDescription += `\n5. **Complete**: \`complete_task({ summary: "Decision: ..." })\``;
      enrichedDescription += `\n\n### Rules:`;
      enrichedDescription += `\n- Post ONCE with your expert perspective. Don't repeat yourself.`;
      enrichedDescription += `\n- Read other participants' posts before recording a decision.`;
      enrichedDescription += `\n- Do NOT use write-block — only use discuss post/read/decide.`;
      enrichedDescription += `\n- Keep it brief — this is alignment, not implementation.`;
    }

    return { enrichedDescription, previousOutputs, artifacts, crdtRefs };
  }
}
