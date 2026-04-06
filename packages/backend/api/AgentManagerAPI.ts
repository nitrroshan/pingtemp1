/**
 * AgentManagerAPI - Unified API combining HTTP and Socket.IO servers
 *
 * This class initializes both servers and coordinates them to work together.
 */

import { createServer } from "http";
import { Logger } from "tslog";
import { AgentManager } from "../agentManager/AgentManagerV2.js";
import { HttpServer } from "./HttpServer.js";
import { SocketServerV2 } from "./SocketServerV2.js";
import { TeamService } from "../team/index.js";

const logger = new Logger({ name: "AgentManagerAPI" });

export class AgentManagerAPI {
  private agentManager: AgentManager;
  private teamService: TeamService;
  private httpServer: HttpServer;
  private socketServerV2: SocketServerV2;
  private server: any;

  constructor(port: number = 3002) {
    logger.info("[AgentManagerAPI] Initializing API services...");

    // Initialize AgentManager
    this.agentManager = new AgentManager();

    // Initialize TeamService
    this.teamService = new TeamService();

    // Initialize HTTP Server
    this.httpServer = new HttpServer({
      agentManager: this.agentManager,
      teamService: this.teamService,
    });

    // Create HTTP server and start listening
    this.server = createServer(this.httpServer.getApp());
    this.server.listen(port, () => {
      logger.info(`[AgentManagerAPI] HTTP server listening on port ${port}`);
    });

    // Initialize Socket.IO Server V2
    this.socketServerV2 = new SocketServerV2(this.server);

    logger.info("[AgentManagerAPI] All services initialized successfully");
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

    // Close Socket.IO connections (V1 and V2)
    this.socketServer.close();
    this.socketServerV2.close();

    // Close HTTP server
    await this.httpServer.close();

    logger.info("[AgentManagerAPI] All services stopped");
  }
}
