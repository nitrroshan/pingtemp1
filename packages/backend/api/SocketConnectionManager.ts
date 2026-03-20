/**
 * SocketConnectionManager - Manages Socket.IO connections
 *
 * Design: Database-ready abstraction layer
 * - Currently uses in-memory Map
 * - TODO: Migrate to Redis/MongoDB for persistence and scalability
 */

import { Socket } from "socket.io";
import { Logger } from "tslog";
import type { SocketConnection } from "./types/index.js";

const logger = new Logger({ name: "SocketConnectionManager" });

export type { SocketConnection };

export class SocketConnectionManager {
  // TODO: Replace with Redis/database connection
  // private redis: Redis;
  private connections: Map<string, SocketConnection>; // connectionId -> SocketConnection
  private userConnections: Map<string, Set<string>>; // userId -> Set<connectionId>

  constructor() {
    // TODO: Initialize Redis/database connection
    // this.redis = await connectToRedis();
    this.connections = new Map();
    this.userConnections = new Map();
    logger.info("[SocketConnectionManager] Initialized with in-memory storage");
  }

  /**
   * Add a new socket connection
   */
  addConnection(connection: SocketConnection): void {
    // TODO: Redis implementation
    // await this.redis.hset(`connection:${connectionId}`, connection);
    // await this.redis.sadd(`user:${userId}:connections`, connectionId);

    const { connectionId, userId } = connection;

    this.connections.set(connectionId, connection);

    // Track user's connections
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(connectionId);

    logger.info(
      `[SocketConnectionManager] Connection ${connectionId} added for user ${userId}`
    );
  }

  /**
   * Get connection by connectionId
   */
  getConnection(connectionId: string): SocketConnection | undefined {
    // TODO: Redis implementation
    // return await this.redis.hgetall(`connection:${connectionId}`);

    return this.connections.get(connectionId);
  }

  /**
   * Get all connections for a user
   */
  getUserConnections(userId: string): SocketConnection[] {
    // TODO: Redis implementation
    // const connectionIds = await this.redis.smembers(`user:${userId}:connections`);
    // return Promise.all(connectionIds.map(id => this.getConnection(id)));

    const connectionIds = this.userConnections.get(userId);
    if (!connectionIds) return [];

    const connections: SocketConnection[] = [];
    for (const connectionId of connectionIds) {
      const conn = this.connections.get(connectionId);
      if (conn) connections.push(conn);
    }

    return connections;
  }

  /**
   * Remove a connection
   */
  removeConnection(connectionId: string): boolean {
    // TODO: Redis implementation
    // const connection = await this.getConnection(connectionId);
    // await this.redis.del(`connection:${connectionId}`);
    // await this.redis.srem(`user:${connection.userId}:connections`, connectionId);

    const connection = this.connections.get(connectionId);
    if (!connection) return false;

    const { userId } = connection;

    // Remove from user's connections
    const userConns = this.userConnections.get(userId);
    if (userConns) {
      userConns.delete(connectionId);
      if (userConns.size === 0) {
        this.userConnections.delete(userId);
      }
    }

    this.connections.delete(connectionId);
    logger.info(
      `[SocketConnectionManager] Connection ${connectionId} removed for user ${userId}`
    );

    return true;
  }

  /**
   * Send message to specific connection
   */
  sendToConnection(connectionId: string, event: string, data: any): boolean {
    const connection = this.connections.get(connectionId);
    if (connection && connection.socket.connected) {
      logger.debug(
        `[SocketConnectionManager] Sending '${event}' to connection ${connectionId}`
      );
      connection.socket.emit(event, data);
      return true;
    } else {
      logger.warn(
        `[SocketConnectionManager] Connection ${connectionId} not found or disconnected`
      );
      return false;
    }
  }

  // /**
  //  * Subscribe connection to an agent
  //  */
  // subscribeToAgent(connectionId: string, agentRole: string): boolean {
  //   // TODO: Redis implementation
  //   // await this.redis.sadd(`connection:${connectionId}:agents`, agentRole);

  //   const connection = this.connections.get(connectionId);
  //   if (!connection) return false;

  //   connection.subscribedAgents.add(agentRole);
  //   logger.debug(
  //     `[SocketConnectionManager] Connection ${connectionId} subscribed to ${agentRole}`
  //   );

  //   return true;
  // }

  // /**
  //  * Unsubscribe connection from an agent
  //  */
  // unsubscribeFromAgent(connectionId: string, agentRole: string): boolean {
  //   // TODO: Redis implementation
  //   // await this.redis.srem(`connection:${connectionId}:agents`, agentRole);

  //   const connection = this.connections.get(connectionId);
  //   if (!connection) return false;

  //   connection.subscribedAgents.delete(agentRole);
  //   logger.debug(
  //     `[SocketConnectionManager] Connection ${connectionId} unsubscribed from ${agentRole}`
  //   );

  //   return true;
  // }

  // /**
  //  * Get all connections subscribed to an agent
  //  */
  // getConnectionsForAgent(agentRole: string): SocketConnection[] {
  //   // TODO: Redis implementation
  //   // Use Redis sets/indexes for efficient lookups

  //   const subscribed: SocketConnection[] = [];

  //   for (const connection of this.connections.values()) {
  //     if (connection.subscribedAgents.has(agentRole)) {
  //       subscribed.push(connection);
  //     }
  //   }

  //   return subscribed;
  // }

  // /**
  //  * Get statistics
  //  */
  // getStatistics() {
  //   // TODO: Redis implementation
  //   // const stats = await this.redis.info('stats');

  //   let totalSubscriptions = 0;

  //   for (const connection of this.connections.values()) {
  //     totalSubscriptions += connection.subscribedAgents.size;
  //   }

  //   return {
  //     totalConnections: this.connections.size,
  //     totalUsers: this.userConnections.size,
  //     totalSubscriptions,
  //     averageConnectionsPerUser:
  //       this.userConnections.size > 0
  //         ? this.connections.size / this.userConnections.size
  //         : 0,
  //   };
  // }

  /**
   * Clear all connections (for testing/reset)
   */
  clearAll(): void {
    // TODO: Redis implementation
    // await this.redis.flushdb();

    this.connections.clear();
    this.userConnections.clear();
    logger.warn("[SocketConnectionManager] All connections cleared");
  }
}

// Singleton instance
export const socketConnectionManager = new SocketConnectionManager();
