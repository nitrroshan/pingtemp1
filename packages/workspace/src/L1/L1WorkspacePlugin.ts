/**
 * L1 Workspace Plugin — Concrete implementation
 *
 * Wraps WorkspaceManager + createWorkspaceTools as an IL1WorkspacePlugin.
 * Instantiated externally and registered with MemoryCoordinator.
 */

import { rootLogger } from "../logging.js";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { IL1WorkspacePlugin } from "../types/plugins.js";
import type { WorkspaceConfig, WorkspaceFilter } from "../types/index.js";
import { WorkspaceManager } from "./workspace/WorkspaceManager.js";
import { createWorkspaceTools } from "./workspace/tools/workspace-tools.js";

const logger = rootLogger.child({ module: "L1Plugin" });

export class L1WorkspacePlugin implements IL1WorkspacePlugin {
  readonly layerId = "L1" as const;
  readonly name = "Git Workspace";

  private _manager: WorkspaceManager;
  private _ready = false;

  constructor(private config: WorkspaceConfig) {
    this._manager = new WorkspaceManager(config);
  }

  get isReady(): boolean {
    return this._ready;
  }

  get workspacesRoot(): string {
    return this._manager.workspacesRoot;
  }

  async initialize(): Promise<void> {
    await this._manager.initializeWorkspace();
    this._ready = true;
    logger.info(`L1 initialized at: ${this.config.repoPath}`);
  }

  async dispose(): Promise<void> {
    this._ready = false;
    logger.info("L1 disposed");
  }

  async createWorkspace(agentId: string, taskId: string, initOptions?: any): Promise<any> {
    return this._manager.createWorkspace(agentId, taskId, initOptions);
  }

  getWorkspace(taskId: string): any | undefined {
    return this._manager.getWorkspace(taskId);
  }

  listWorkspaces(filter?: WorkspaceFilter): any[] {
    return this._manager.listWorkspaces(filter);
  }

  getRepoPath(): string {
    return this._manager.getRepoPath();
  }

  getConfig(): WorkspaceConfig {
    return this._manager.getConfig();
  }

  createTools(workspace: any): StructuredToolInterface[] {
    return createWorkspaceTools(workspace);
  }

  async initializeWorkspace(): Promise<void> {
    await this._manager.initializeWorkspace();
  }

  /** Expose the underlying manager for backward compat */
  get manager(): WorkspaceManager {
    return this._manager;
  }
}
