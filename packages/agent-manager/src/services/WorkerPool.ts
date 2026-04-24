/**
 * WorkerPool - Simple registry for active workers
 *
 * Core responsibilities:
 * - Cache AgentDefinitions by role
 * - Create AiSdkAgent instances for tasks
 * - Bridge AsyncGenerator → EventEmitter for Socket.IO
 * - Clean up workers when done
 */

import { rootLogger } from "../logging.js";
import { AiSdkAgent } from "../agent/internal/AiSdkAgent.js";
import { assembleLifecycleTools } from "./tools/index.js";
import { PluginRegistry } from "../plugin/PluginRegistry.js";
import type { ToolContext } from "../plugin/types.js";
import { loadTaskLifecycleSkill } from "../skills/taskLifecycleSkill.js";
import type {
  AgentDefinition,
  AgentInput,
  AgentEvent,
  InternalConfig,
} from "../agent/types.js";
import type { TaskWithContext } from "../util/RoleTaskQueue.types.js";
import dotenv from "dotenv";

dotenv.config();

const logger = rootLogger.child({ module: "WorkerPool" });

export interface WorkerCallbacks {
  onStream?: (data: { taskId: string; agentId: string; part: any }) => void;
  onEvent?: (data: { taskId: string; event: any }) => void;
  onDone?: (data: { taskId: string; role: string; output: any }) => void;
  onError?: (data: { taskId: string; error: string }) => void;
  onAgentComplete?: (data: { taskId: string; role: string; summary: string; deliverables: string[]; nextSteps: string[]; timestamp: number }) => void;
  onStatusUpdate?: (data: { taskId: string; role: string; status: string; summary: string; progress?: number; timestamp: number }) => void;
  /** Fired when an agent creates a task via request_task tool */
  onTaskCreated?: (data: { taskId: string; createdBy: string; targetRole: string; relationship: string; parentTaskId: string }) => void;
  /** Fired when an agent bounces a task via bounce_task tool */
  onBounce?: (data: { taskId: string; role: string; reason: string; suggestedRole?: string; timestamp: number }) => void;
  /** Fired when an agent mentions roles in a discussion — triggers priority collab worker spawn */
  onMentionedRoles?: (data: { roles: string[]; sourceTaskId: string; docName: string; sourceRole?: string; postContent?: string }) => void;
}

/**
 * Default model config - uses environment variables
 * This overrides any LLM-generated deployment names
 */
const DEFAULT_MODEL_CONFIG = {
  provider: "azure-openai" as const,
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o-2",
  temperature: 0.7,
  maxTokens: 4096,
};

export class WorkerPool {
  /** Cached definitions by role */
  private definitions = new Map<string, AgentDefinition>();

  /** Active workers by task ID */
  private workers = new Map<string, AiSdkAgent>();

  /** Plugin registry for plugin-based tool assembly */
  private pluginRegistry: PluginRegistry | null = null;

  /** Current team ID */
  private teamId: string | null = null;

  /** Maps role → agent MongoDB _id (for DB skill lookup) */
  private roleAgentIdMap = new Map<string, string>();

  /** Base (non-skill) tools per worker — skills are refreshed per request */
  private workerBaseTools = new Map<string, any[]>();

  /** Callbacks for worker lifecycle events */
  private callbacks: WorkerCallbacks = {};

  /** Shared services for agent-initiated task tools (injected by AgentManager) */
  private taskStore: { getAll(): any[]; get(id: string): any; create(t: any): void; remove(id: string): boolean; updateStatus(id: string, s: string): void } | null = null;
  private dagResolver: { rebuild(source: any): void; validateDependencies?(taskId: string, deps: string[]): string | null } | null = null;
  private teamRoles: string[] = [];
  private crdtTaskSync: { persistTask(t: any): Promise<void>; syncStatus(id: string, s: string, o?: any): Promise<void>; updateIndex(tasks: any[]): Promise<void> } | null = null;
  private currentPlanId: string | null = null;
  private currentGoalId: string | null = null;

  // ===========================================================================
  // Definition Management
  // ===========================================================================

  /**
   * Set plugin registry for plugin-based tool assembly.
   */
  setPluginRegistry(registry: PluginRegistry): void {
    this.pluginRegistry = registry;
    logger.info("PluginRegistry set for WorkerPool");
  }

  /**
   * Set role → MongoDB agent ID map (for DB skill lookup)
   */
  setRoleAgentIdMap(map: Record<string, string>): void {
    this.roleAgentIdMap.clear();
    for (const [role, id] of Object.entries(map)) {
      this.roleAgentIdMap.set(role.toLowerCase(), id);
    }
    logger.debug(`RoleAgentIdMap set: ${Object.keys(map).join(", ")}`);
  }

  /**
   * Set team ID
   */
  setTeamId(teamId: string): void {
    this.teamId = teamId;
  }

  /**
   * Set shared services for agent-initiated task tools (request_task, bounce_task).
   * Called by AgentManager after orchestrator initialization.
   */
  setTaskServices(services: {
    taskStore: any;
    dagResolver: any;
    teamRoles: string[];
    crdtTaskSync?: any;
    planId?: string | null;
    goalId?: string | null;
  }): void {
    this.taskStore = services.taskStore;
    this.dagResolver = services.dagResolver;
    this.teamRoles = services.teamRoles;
    this.crdtTaskSync = services.crdtTaskSync || null;
    this.currentPlanId = services.planId || null;
    this.currentGoalId = services.goalId || null;
  }

  /**
   * Get the current team ID
   */
  getTeamId(): string | null {
    return this.teamId;
  }

  /**
   * Set callbacks for worker lifecycle events
   */
  setCallbacks(callbacks: WorkerCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Register agent definitions (from DefinitionBuilder)
   */
  registerDefinitions(definitions: AgentDefinition[]): void {
    for (const def of definitions) {
      const role = def.role.toLowerCase();
      this.definitions.set(role, def);
      logger.debug(`Registered: ${role}`);
    }
  }

  /**
   * Get a role's definition
   */
  getDefinition(role: string): AgentDefinition | undefined {
    return this.definitions.get(role.toLowerCase());
  }

  /**
   * Check if a worker with the given taskId is currently active
   */
  hasActiveWorker(taskId: string): boolean {
    return this.workers.has(taskId);
  }

  /**
   * Check if role exists
   */
  hasRole(role: string): boolean {
    return this.definitions.has(role.toLowerCase());
  }

  // ===========================================================================
  // Task Execution (combines create + execute)
  // ===========================================================================

  /**
   * Run a task: creates worker if needed, executes, emits events
   *
   * Overload 1: Chat mode - simple params
   * @param taskId - Unique task identifier
   * @param role - Role to use for this task
   * @param message - Message to send to the agent
   */
  async runTask(taskId: string, role: string, message: string): Promise<any>;

  /**
   * Overload 2: Queue mode - TaskWithContext (includes dependency context)
   * @param task - Task with context from RoleTaskQueue
   */
  async runTask(task: TaskWithContext): Promise<any>;

  /**
   * Implementation handles both signatures
   */
  async runTask(
    taskIdOrTask: string | TaskWithContext,
    role?: string,
    message?: string,
  ): Promise<any> {
    let taskId: string;
    let roleKey: string;
    let finalMessage: string;

    if (typeof taskIdOrTask === "string") {
      // Chat mode: simple params
      taskId = taskIdOrTask;
      roleKey = role!.toLowerCase();
      finalMessage = message!;
    } else {
      // Queue mode: TaskWithContext
      const task = taskIdOrTask;
      taskId = task.id;
      roleKey = task.assigned_role.toLowerCase();
      finalMessage = this.buildMessageWithContext(task);
      logger.debug(
        `Queue mode: ${taskId} with ${task.context.previousOutputs.length} previous outputs`,
      );
    }

    // Get or create worker
    let agent: AiSdkAgent | undefined = this.workers.get(taskId);

    if (!agent) {
      const definition = this.definitions.get(roleKey);
      if (!definition) {
        throw new Error(`Role not registered: ${role}`);
      }

      // Override model config with defaults (LLM-generated deployments don't exist)
      const config = definition.config as InternalConfig;
      const fixedDefinition: AgentDefinition = {
        ...definition,
        id: `${roleKey}-${taskId}`,
        config: {
          ...config,
          model: {
            ...config.model,
            ...DEFAULT_MODEL_CONFIG, // Override with real deployment
          },
        },
      };

      logger.debug(
        `Creating worker for ${roleKey} with deployment: ${DEFAULT_MODEL_CONFIG.deployment}`,
      );

      agent = new AiSdkAgent(fixedDefinition);
      await agent.initialize();

      // Assemble task-lifecycle tools (report_status, complete_task, request_task, bounce_task)
      const { tools: lifecycleTools } = assembleLifecycleTools({
        taskId,
        roleKey,
        callbacks: this.callbacks,
        taskServices: {
          taskStore: this.taskStore,
          dagResolver: this.dagResolver,
          teamRoles: this.teamRoles || [],
          crdtTaskSync: this.crdtTaskSync,
          planId: this.currentPlanId || null,
          goalId: this.currentGoalId || null,
        },
      });
      const additionalTools: any[] = [...lifecycleTools];

      // ── Plugin-based tool assembly ──────────────────────────────────────
      if (this.pluginRegistry) {
        const toolContext: ToolContext = {
          consumer: "worker",
          role: roleKey,
          taskId,
        };

        // Prepare plugins (e.g. create workspace branch) before resolving tools
        await this.pluginRegistry.prepareForTask(toolContext);

        const pluginTools = this.pluginRegistry.getTools(toolContext);
        additionalTools.push(...pluginTools);

        // Inject plugin skill instructions into agent system prompt
        const skillInstructions = this.pluginRegistry.getSkillInstructions({
          role: roleKey,
          taskId,
        });
        if (skillInstructions.length > 0) {
          agent.appendSystemPrompt(skillInstructions);
        }

        logger.debug(
          `Plugin tools: ${pluginTools.length} tools, ${skillInstructions.length} skills for ${roleKey}`,
        );
      }

      // ── System skill: task-lifecycle (always injected) ─────────────────
      // Core orchestration instructions — report_status, complete_task,
      // request_task, bounce_task, and the missing-context protocol.
      // This reaches ALL agents (plugin-based and generic) since it's
      // injected here, not in any plugin or worker prompt.
      const taskLifecycleInstructions = loadTaskLifecycleSkill();
      if (taskLifecycleInstructions) {
        agent.appendSystemPrompt([taskLifecycleInstructions]);
      }

      // Inject base (non-skill) tools
      const currentTools = (agent as any).loadedTools || {};
      const currentToolsArray = Array.isArray(currentTools) ? currentTools : Object.values(currentTools);
      const baseTools = [...currentToolsArray, ...additionalTools];
      await agent.setTools(baseTools);

      // ── Write identity file to workspace ─────────────────────────────────────────
      // Simple JSON file the agent can read via workspace_read_file(".ping/identity.json")
      if (this.pluginRegistry) {
        const wsPlugin = this.pluginRegistry.get("workspace");
        if (wsPlugin && typeof (wsPlugin as any).writeIdentityFile === "function") {
          try {
            const definition = this.definitions.get(roleKey);
            await (wsPlugin as any).writeIdentityFile({
              taskId,
              role: roleKey,
              name: definition?.name || roleKey,
              goal: definition?.goal || `Execute ${roleKey} tasks`,
              skills: (definition?.config as any)?.skills,
              teamId: this.teamId,
              teamRoles: this.teamRoles,
            });
          } catch (err) {
            logger.debug(`Identity file write skipped for ${taskId}: ${err}`);
          }
        }
      }

      // Store base tools for per-request skill refresh
      this.workerBaseTools.set(taskId, baseTools);
      this.workers.set(taskId, agent);
      this.workerRoles.set(taskId, roleKey);
      logger.info(
        `Created worker: ${taskId} (${roleKey}) with ${additionalTools.length} additional tools`,
      );
    }

    // Skills are loaded via PluginRegistry — no per-request DB refresh needed

    // Execute and stream events
    let output: any = null;

    if (!agent) {
      throw new Error(`Worker for task ${taskId} was not created`);
    }

    try {
      const input: AgentInput = {
        message: finalMessage,
        threadId: taskId, // Use taskId as thread for conversation continuity
      };

      for await (const event of agent.execute(input)) {
        // Forward stream_part events directly on onStream callback
        if (event.type === "stream_part") {
          this.callbacks.onStream?.({
            taskId,
            agentId: roleKey,
            part: event.part,
          });
          continue; // Don't emit stream_parts on onEvent (legacy channel)
        }

        // Invoke event callback for all other events (legacy progress channel)
        this.callbacks.onEvent?.({ taskId, event });

        // Capture output
        if (event.type === "done") {
          output = event.output;
          this.lastResponses.set(taskId, output); // Store for getLastResponse
          const role = this.workerRoles.get(taskId) || "worker";
          this.callbacks.onDone?.({ taskId, role, output });


        }

        if (event.type === "error") {
          this.callbacks.onError?.({ taskId, error: event.error });
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.callbacks.onError?.({ taskId, error: msg });

      throw error;
    }

    return output;
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Dispose a specific worker
   */
  async dispose(taskId: string): Promise<void> {
    const agent = this.workers.get(taskId);
    if (agent) {
      await agent.stop();
      this.workers.delete(taskId);
      this.workerRoles.delete(taskId);
      this.lastResponses.delete(taskId);
      logger.info(`Disposed: ${taskId}`);
    }
  }

  /**
   * Check if workspace support is enabled (via plugins)
   */
  isWorkspaceEnabled(): boolean {
    return this.pluginRegistry !== null;
  }

  /**
   * Dispose all workers
   */
  async disposeAll(): Promise<void> {
    await Promise.all(
      Array.from(this.workers.keys()).map((id) => this.dispose(id)),
    );
    // Fix #4: Clear all Maps to prevent memory leaks from orphaned tasks
    this.workerBaseTools.clear();
    // Fix #16: Clear stale task service references
    this.taskStore = null;
    this.dagResolver = null;
    this.crdtTaskSync = null;
  }

  // ===========================================================================
  // Status
  // ===========================================================================

  get workerCount(): number {
    return this.workers.size;
  }

  get roleCount(): number {
    return this.definitions.size;
  }

  /** Store role per task for getActiveWorkers */
  private workerRoles = new Map<string, string>();

  // ===========================================================================
  // Agent Status CRDT (auto-update on task lifecycle)
  // ===========================================================================

  /**
   * Get active workers info
   */
  getActiveWorkers(): Array<{ taskId: string; role: string; status: string }> {
    const result: Array<{ taskId: string; role: string; status: string }> = [];
    for (const [taskId] of this.workers.entries()) {
      result.push({
        taskId,
        role: this.workerRoles.get(taskId) || "unknown",
        status: "active",
      });
    }
    return result;
  }

  /**
   * Store last response per task for completion
   */
  private lastResponses = new Map<string, any>();

  /**
   * Get last response from a worker
   */
  getLastResponse(taskId: string): any {
    return this.lastResponses.get(taskId);
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Build message with context from dependency outputs and orchestrator conversation
   * Injects previous task outputs and orchestrator context into the message for the agent
   */
  private buildMessageWithContext(task: TaskWithContext): string {
    let msg = task.description;

    if (task.context.previousOutputs.length > 0) {
      msg += "\n\n## Context from previous tasks:\n";
      for (const prev of task.context.previousOutputs) {
        msg += `\n### Task ${prev.taskId}:\n`;
        msg += JSON.stringify(prev.output, null, 2) + "\n";
      }
    }

    if (task.context.artifacts.length > 0) {
      msg += `\n\n## Deliverables from Upstream Tasks`;
      msg += `\nThese are references to work produced by completed tasks you depend on.`;
      msg += `\n\n**How to access:**`;
      msg += `\n- **File paths** (e.g. \`src/schema.ts\`): Use \`workspace_read_file\` — files are already merged into your workspace`;
      msg += `\n- **CRDT docs** (e.g. \`task-1/task\`): Use \`collab read\` to retrieve structured data`;
      msg += `\n- **Directories**: Use \`workspace_list_files\` to explore and discover related files`;
      msg += `\n- **Search**: Use \`workspace_grep\` to search file contents, \`workspace_glob\` to find files by pattern`;
      msg += `\n\nAlways read deliverables before starting work — don't rely solely on summaries.`;
      msg += `\n\n${task.context.artifacts.join("\n")}`;
    }

    return msg;
  }
}
