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
  planStore?: any;
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
    const { task, role, teamRoles, crdtRefs, planStore } = input;
    const taskCtx = (typeof task.context === "object" ? task.context : {}) as Record<string, any>;

    const previousOutputs = Array.isArray(taskCtx.upstreamOutputs) ? taskCtx.upstreamOutputs : [];
    const artifacts = [
      ...(Array.isArray(taskCtx.upstreamArtifacts) ? taskCtx.upstreamArtifacts : []),
      ...(Array.isArray(taskCtx.files) ? taskCtx.files : []),
      ...(Array.isArray(taskCtx.artifacts) ? taskCtx.artifacts : []),
    ];

    let enrichedDescription = task.description;

    // ── Upstream task outputs ───────────────────────────────────────
    if (previousOutputs.length > 0) {
      enrichedDescription += `\n\n## Completed Upstream Work`;
      enrichedDescription += `\nThese tasks completed before yours. Their output files are already in your workspace (merged to main).`;
      for (const po of previousOutputs) {
        enrichedDescription += `\n\n### ${po.taskId} (${po.role})${po.status === "failed" ? " ❌ FAILED" : ""}`;
        enrichedDescription += `\n${po.summary}`;
      }
      if (artifacts.length > 0) {
        enrichedDescription += `\n\n**Files/artifacts from upstream:** ${artifacts.join(", ")}`;
      }
      enrichedDescription += `\n\nUse \`workspace_list_files\` to see all available files in your workspace.`;
    }

    // ── Notes + expected output ─────────────────────────────────────
    const allNotes: string[] = [
      ...(Array.isArray(taskCtx.notes) ? taskCtx.notes : taskCtx.notes ? [taskCtx.notes] : []),
      ...(Array.isArray(taskCtx.upstreamNotes) ? taskCtx.upstreamNotes : []),
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
    if (references.length > 0 && planStore) {
      const priorOutputs: string[] = [];
      for (const ref of references) {
        try {
          const [refPlanOrGoal, refTaskId] = ref.split("/");
          if (!refTaskId) {
            unresolvedRefs.push(`${ref} (invalid format)`);
            continue;
          }
          const allPlans = await planStore.listAllPlans();
          const matchPlan = allPlans.find((p: any) => p.planId === refPlanOrGoal || p.goalId === refPlanOrGoal);
          if (matchPlan) {
            const stored = await planStore.loadPlan(matchPlan.planId, matchPlan.goalId);
            const refTask = stored?.plan?.tasks?.find((t: any) => t.id === refTaskId);
            if (refTask?.output) {
              const summary = typeof refTask.output === "string" ? refTask.output : JSON.stringify(refTask.output).slice(0, 500);
              priorOutputs.push(`- ${ref}: ${summary}`);
            } else {
              unresolvedRefs.push(`${ref} (task found, no output)`);
            }
          } else {
            unresolvedRefs.push(`${ref} (plan/goal not found)`);
          }
        } catch (err) {
          unresolvedRefs.push(`${ref} (error: ${err})`);
        }
      }
      if (priorOutputs.length > 0) {
        enrichedDescription += `\n\n## Prior Work (from previous plans)\n${priorOutputs.join("\n")}`;
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
