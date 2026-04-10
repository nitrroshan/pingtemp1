/**
 * AgentManagerAPI - Unified API combining HTTP and Socket.IO servers
 *
 * This class initializes both servers and coordinates them to work together.
 */

import { createServer } from "http";
import { rootLogger } from "../logging/index.js";
import { AgentManager } from "../agentManager/AgentManagerV2.js";
import { HttpServer } from "./HttpServer.js";
import { SocketServerV2 } from "./SocketServerV2.js";
import type { ServiceRegistry } from "../services/ServiceRegistry.js";
import { agentManagerRegistry } from "../agentManager/AgentManagerRegistry.js";

const logger = rootLogger.child({ module: "AgentManagerAPI" });

export class AgentManagerAPI {
  private agentManager: AgentManager;
  private httpServer: HttpServer;
  private socketServerV2: SocketServerV2;
  private server: any;

  constructor(port: number = 3002, services?: ServiceRegistry) {
    logger.info("[AgentManagerAPI] Initializing API services...");

    // Initialize AgentManager
    this.agentManager = new AgentManager();

    // Wire ServiceRegistry into AgentManagerRegistry singleton
    if (services) {
      agentManagerRegistry.setServices(services);
    }

    // Initialize HTTP Server with ServiceRegistry
    this.httpServer = new HttpServer({
      agentManager: this.agentManager,
      services,
    });

    // Create HTTP server and start listening
    this.server = createServer(this.httpServer.getApp());
    this.server.listen(port, () => {
      logger.info(`[AgentManagerAPI] HTTP server listening on port ${port}`);
    });

    // Initialize Socket.IO Server V2 with ServiceRegistry
    this.socketServerV2 = new SocketServerV2(this.server, services);

    logger.info(`[AgentManagerAPI] All services initialized (mode: ${services?.mode ?? "legacy"})`);
  }

  /**
   * Start the API server
   */
  async start() {
    logger.info("[AgentManagerAPI] All services started successfully");
  }

  /**
   * Stop the API server
   */
  async stop() {
    logger.info("[AgentManagerAPI] Stopping all services...");

    this.socketServerV2.close();

    // Close HTTP server
    await this.httpServer.close();

    logger.info("[AgentManagerAPI] All services stopped");
  }
}
