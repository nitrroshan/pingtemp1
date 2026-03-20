import type { Socket } from "socket.io";

/**
 * Socket Connection interface
 * Represents an active WebSocket connection with subscription tracking
 */
export interface SocketConnection {
  /** Unique connection identifier */
  connectionId: string;

  /** User ID associated with this connection */
  userId: string;

  /** Socket.IO socket instance */
  socket: Socket;

  /** Set of agent IDs this connection is subscribed to */
  subscribedAgents: Set<string>;

  /** Timestamp when the connection was established */
  connectedAt: number;
}
