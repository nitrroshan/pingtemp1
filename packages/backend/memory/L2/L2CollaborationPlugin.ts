/**
 * L2 Collaboration Plugin — Concrete implementation
 *
 * Wraps CollabServer + CollaborationSpace + PlanStore + GroupChatManager
 * as an IL2CollaborationPlugin. Instantiated externally and registered
 * with MemoryCoordinator.
 */

import * as fs from "fs/promises";
import * as path from "path";
import fg from "fast-glob";
import { Logger } from "tslog";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { IL2CollaborationPlugin } from "../types/plugins.js";
import { CollabServer } from "./collaboration/HocuspocusServer.js";
import { CollaborationSpace } from "./collaboration/CollaborationSpace.js";
import { PlanStore } from "./collaboration/PlanStore.js";
import { GroupChatManager } from "./collaboration/GroupChatManager.js";
import { createCollabTool } from "./tools/index.js";
import type { ICollabProvider } from "./collaboration/types/collab-provider.types.js";
import type {
  OutputManifest,
  OutputEntry,
} from "./collaboration/types/output-manifest.types.js";

const logger = new Logger({ name: "L2Plugin" });

export interface L2CollaborationPluginConfig {
  teamId: string;
  collabStorageDir?: string;
  repoPath?: string;
  /** Port to expose Hocuspocus WebSocket for frontend editors (default: disabled) */
  collabPort?: number;
  /** External collab provider (e.g., RemoteCollabClient for remote server). If set, no embedded server is created. */
  collabProvider?: ICollabProvider;
}

export class L2CollaborationPlugin implements IL2CollaborationPlugin {
  readonly layerId = "L2" as const;
  readonly name = "CRDT Collaboration";

  private _collabServer: CollabServer | null;
  private _collabProvider: ICollabProvider;
  private _planStore: PlanStore;
  private _spaces = new Map<string, CollaborationSpace>();
  private _groupChatManagers = new Map<string, GroupChatManager>();
  private _ready = false;
  private _teamId: string;

  constructor(private config: L2CollaborationPluginConfig) {
    this._teamId = config.teamId;

    if (config.collabProvider) {
      // Remote mode — use external provider, no embedded server
      this._collabProvider = config.collabProvider;
      this._collabServer = null;
      logger.info(`L2 using external collab provider (remote mode)`);
    } else {
      // Embedded mode — create in-process Hocuspocus server
      this._collabServer = new CollabServer(
        config.collabStorageDir || "./data/collab",
        config.repoPath,
      );
      this._collabProvider = this._collabServer;
    }

    this._planStore = new PlanStore(config.teamId, config.repoPath || ".");
  }

  get isReady(): boolean {
    return this._ready;
  }

  get isCollabAvailable(): boolean {
    return this._ready;
  }

  get planStore(): PlanStore {
    return this._planStore;
  }

  /** Expose underlying CollabServer (null in remote mode) */
  get collabServer(): CollabServer | null {
    return this._collabServer;
  }

  /** Expose the collab provider (works in both embedded and remote mode) */
  get collabProvider(): ICollabProvider {
    return this._collabProvider;
  }

  async initialize(): Promise<void> {
    // Start WebSocket server for frontend collaborative editing if embedded + port configured
    if (this._collabServer && this.config.collabPort) {
      try {
        await this._collabServer.start(this.config.collabPort);
        logger.info(
          `L2 CollabServer WebSocket listening on port ${this.config.collabPort}`,
        );
      } catch (err: any) {
        if (err?.code === "EADDRINUSE") {
          logger.warn(
            `L2 CollabServer port ${this.config.collabPort} already in use — skipping (another team may already be serving)`,
          );
        } else {
          throw err;
        }
      }
    }
    this._ready = true;
    logger.info(`L2 initialized for team '${this._teamId}'`);
  }

  async dispose(): Promise<void> {
    // Stop embedded WebSocket server if running
    if (this._collabServer) {
      await this._collabServer.stop();
    }
    // Disconnect all spaces
    for (const space of this._spaces.values()) {
      space.disconnectAll();
    }
    for (const gcm of this._groupChatManagers.values()) {
      gcm.dispose();
    }
    this._spaces.clear();
    this._groupChatManagers.clear();
    this._ready = false;
    logger.info("L2 disposed");
  }

  getOrCreateSpace(goalId: string): CollaborationSpace {
    const key = `${this._teamId}/${goalId}`;
    if (!this._spaces.has(key)) {
      this._spaces.set(
        key,
        new CollaborationSpace(key, this._teamId, goalId, this._collabProvider),
      );
    }
    return this._spaces.get(key)!;
  }

  async archiveSpace(goalId: string): Promise<void> {
    const key = `${this._teamId}/${goalId}`;
    const space = this._spaces.get(key);
    if (space) {
      space.disconnectAll();
      this._spaces.delete(key);
      const gcm = this._groupChatManagers.get(key);
      if (gcm) {
        gcm.dispose();
        this._groupChatManagers.delete(key);
      }
      logger.info(`Archived space: ${key}`);
    }
  }

  getGroupChatManager(goalId: string): GroupChatManager {
    const key = `${this._teamId}/${goalId}`;
    if (!this._groupChatManagers.has(key)) {
      const space = this.getOrCreateSpace(goalId);
      this._groupChatManagers.set(key, new GroupChatManager(space));
    }
    return this._groupChatManagers.get(key)!;
  }

  async getOutputManifest(
    repoPath: string,
    taskId: string,
  ): Promise<OutputManifest | null> {
    const manifestPath = path.join(
      repoPath,
      ".ping",
      "outputs",
      `${taskId}.json`,
    );
    try {
      return JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    } catch {
      return null;
    }
  }

  async getAllManifests(repoPath: string): Promise<OutputManifest[]> {
    const outputsDir = path.join(repoPath, ".ping", "outputs");
    try {
      const files = await fg("*.json", { cwd: outputsDir, absolute: true });
      const manifests: OutputManifest[] = [];
      for (const file of files) {
        try {
          manifests.push(JSON.parse(await fs.readFile(file, "utf-8")));
        } catch {
          logger.warn(`Failed to parse manifest: ${file}`);
        }
      }
      return manifests;
    } catch {
      return [];
    }
  }

  async queryOutputs(
    repoPath: string,
    filter?: { role?: string; type?: string },
  ): Promise<OutputEntry[]> {
    const manifests = await this.getAllManifests(repoPath);
    let entries = manifests.flatMap((m) => m.outputs);
    if (filter?.role) {
      const roleManifests = manifests.filter((m) => m.role === filter.role);
      entries = roleManifests.flatMap((m) => m.outputs);
    }
    if (filter?.type)
      entries = entries.filter((e) => e.category === filter.type);
    return entries;
  }

  /**
   * Create the unified collab tool for an agent.
   */
  createTools(
    space: any,
    agentRole: string,
    repoPath: string,
  ): StructuredToolInterface[] {
    return [createCollabTool(space, agentRole, this, repoPath)];
  }
}
