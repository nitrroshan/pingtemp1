/**
 * Session routes — session restore + goal-scoped session snapshot.
 */

import { Router } from "express";
import { rootLogger } from "../../logging/index.js";
import { safeError } from "./shared.js";
import type { ServiceRegistry } from "../../services/ServiceRegistry.js";

const logger = rootLogger.child({ module: "SessionRoutes" });

export function createSessionRoutes(services?: ServiceRegistry): Router {
  const router = Router();

  // Session restore — returns everything needed to rebuild UI in one call
  router.get("/sessions/:teamId/restore", async (req, res) => {
    try {
      const { teamId } = req.params;
      const requestedGoalId = req.query.goalId as string | undefined;

      let sessionMessages: any[] = [];
      let workerMessages: any[] = [];
      let goals: any[] = [];

      if (services) {
        const [sessionResult, goalsResult] = await Promise.all([
          services.chat.getSessionMessages(teamId, {
            sessionLimit: 100,
            workerLimit: 50,
          }),
          services.goals.getGoals(teamId, { limit: 10 }),
        ]);
        sessionMessages = sessionResult.session;
        workerMessages = sessionResult.worker;
        goals = goalsResult;

        // Re-classify: move planner/chat-agent messages from worker bucket to session bucket
        const reclassified: any[] = [];
        for (const msg of workerMessages) {
          if (msg.agentId === "manager" || msg.agentId === "orchestrator" || msg.agentId === "planner" || msg.agentId?.startsWith("chat-")) {
            sessionMessages.push(msg);
          } else {
            reclassified.push(msg);
          }
        }
        workerMessages = reclassified;
      }

      // Get current plan/tasks from AgentManager
      let plan = null;
      let tasks: any[] = [];
      let orchestratorState: string | null = null;
      let activeGoalId: string | null = requestedGoalId || null;
      let allGoalSummaries: any[] = [];
      try {
        const { agentManagerRegistry } =
          await import("../../agentManager/AgentManagerRegistry.js");
        const manager = await agentManagerRegistry.getForTeam(teamId);

        orchestratorState = manager.getOrchestratorState();
        if (!activeGoalId) {
          activeGoalId = manager.getCurrentGoalId();
        }

        allGoalSummaries = manager.getAllGoalSummaries?.() ?? [];

        const pendingPlan = manager.getOrchestratorPendingPlan(activeGoalId || undefined);
        if (pendingPlan) {
          plan = pendingPlan.tasks || pendingPlan;
        }

        const taskStore = manager.getTaskStore();
        if (taskStore) {
          const allTasks = activeGoalId
            ? taskStore.getByGoal(activeGoalId)
            : taskStore.getAllTasks();
          if (allTasks.length > 0) {
            tasks = allTasks.map((t: any) => ({
              id: t.id,
              title: t.title || t.description?.slice(0, 80) || t.id,
              description: t.description,
              status: t.status,
              assignedRole: t.assigned_role,
              priority: t.priority,
              dependencies: t.dependants || [],
              goalId: t.goalId,
            }));
            if (!plan) {
              plan = tasks;
            }
          }
        }

        // v3.0: If in-memory TaskStore is empty, try database
        if (tasks.length === 0 && services?.tasks && activeGoalId) {
          try {
            const dbTasks = await services.tasks.getTasksByGoal(activeGoalId);
            if (dbTasks.length > 0) {
              tasks = dbTasks.map(t => ({
                id: t.taskId,
                title: t.title || t.description?.slice(0, 80),
                description: t.description,
                status: t.status,
                assignedRole: t.assignedRole,
                priority: t.priority,
                dependencies: t.dependencies || [],
                goalId: t.goalId,
              }));
              if (!plan) plan = tasks;
            }
          } catch { /* database fallback is best-effort */ }
        }
      } catch {
        // Manager not initialized — return empty plan/tasks
      }

      if (requestedGoalId) {
        sessionMessages = sessionMessages.filter(m => m.goalId === requestedGoalId);
        workerMessages = workerMessages.filter(m => m.goalId === requestedGoalId);
      }

      const conversations: Record<string, any[]> = {};
      for (const msg of sessionMessages) {
        const key = msg.agentId;
        if (!conversations[key]) conversations[key] = [];
        conversations[key].push(msg);
      }

      res.json({
        teamId,
        conversations,
        workerMessages,
        goals,
        plan,
        tasks,
        orchestratorState,
        activeGoalId,
        allGoalSummaries,
      });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  // v4.0: Goal-scoped session endpoint — DB-primary with in-memory live overlay
  router.get("/goals/:goalId/session", async (req: any, res) => {
    try {
      const { goalId } = req.params;
      const teamId = req.query.teamId as string;
      if (!teamId) { res.status(400).json({ error: "teamId query param required" }); return; }

      let tasks: any[] = [];
      if (services?.tasks) {
        const dbTasks = await services.tasks.getTasksByGoal(goalId);
        tasks = dbTasks.map(t => ({
          id: t.taskId, title: t.title, description: t.description,
          status: t.status, assignedRole: t.assignedRole,
          priority: t.priority, dependencies: t.dependencies || [],
          goalId: t.goalId, planId: t.planId,
        }));
      }

      let messages: any[] = [];
      if (services) {
        messages = await services.chat.getGoalMessages(teamId, goalId, { limit: 100 });
      }

      let goalMeta: any = null;
      if (services) {
        const goals = await services.goals.getGoals(teamId, { limit: 50 });
        goalMeta = goals.find((g: any) => g.goalId === goalId);
      }

      let pendingPlan = null;
      let autoExecute = false;
      let allGoalSummaries: any[] = [];
      let sessionState: string | null = null;
      try {
        const { agentManagerRegistry } = await import("../../agentManager/AgentManagerRegistry.js");
        const manager = await agentManagerRegistry.getForTeam(teamId);
        pendingPlan = manager.getOrchestratorPendingPlan(goalId);
        autoExecute = manager.getAutoExecute();
        allGoalSummaries = manager.getAllGoalSummaries?.() ?? [];

        const taskStore = manager.getTaskStore();
        if (taskStore) {
          const liveTasks = taskStore.getByGoal(goalId);
          if (liveTasks.length > 0) {
            for (const lt of liveTasks) {
              const dbTask = tasks.find((t: any) => t.id === lt.id);
              if (dbTask && lt.status !== dbTask.status) {
                dbTask.status = lt.status;
              }
            }
            for (const lt of liveTasks) {
              if (!tasks.find((t: any) => t.id === lt.id)) {
                tasks.push({
                  id: lt.id, title: lt.title, description: lt.description,
                  status: lt.status, assignedRole: lt.assigned_role || lt.assignedRole,
                  priority: lt.priority, dependencies: lt.dependencies || [],
                  goalId: lt.goalId,
                });
              }
            }
          }
        }

        if (tasks.length === 0) {
          sessionState = pendingPlan ? "awaiting_approval" : "idle";
        } else {
          const allCompleted = tasks.every((t: any) => t.status === "completed");
          const hasInProgress = tasks.some((t: any) => t.status === "in_progress");
          sessionState = allCompleted ? "completed" : hasInProgress ? "executing" : "ready";
        }
      } catch { /* Manager not initialized — DB-only response */ }

      res.json({
        goalId, teamId,
        title: goalMeta?.goal || tasks[0]?.title || "Goal",
        status: goalMeta?.status || sessionState || "unknown",
        tasks, messages,
        pendingPlan: pendingPlan?.tasks || null,
        sessionState, autoExecute, allGoalSummaries,
        repoUrl: goalMeta?.repoUrl,
        repoBranch: goalMeta?.repoBranch,
      });
    } catch (err: any) {
      res.status(500).json({ error: safeError(err) });
    }
  });

  logger.info("[SessionRoutes] Mounted: /sessions/:teamId/restore, /goals/:goalId/session");
  return router;
}
