/**
 * User interface
 * Represents a user account with activity tracking
 */
export interface User {
  /** Unique user identifier */
  userId: string;

  /** Timestamp of the user's last activity */
  lastActive: number;

  /** Timestamp when the user account was created */
  createdAt: number;
}
