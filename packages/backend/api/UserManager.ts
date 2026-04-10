/**
 * UserManager - Manages user accounts and their profile data
 *
 * Design: Database-ready abstraction layer
 * - Currently uses in-memory Map
 * - TODO: Migrate to MongoDB/PostgreSQL/Redis for persistence
 */

import { rootLogger } from "../logging/index.js";
import type { User } from "./types/index.js";

const logger = rootLogger.child({ module: "UserManager" });

export type { User };

export class UserManager {
  // TODO: Replace with database connection
  // private db: MongoDB | PostgreSQL | Redis;
  private users: Map<string, User>;

  constructor() {
    // TODO: Initialize database connection
    // this.db = await connectToDatabase();
    this.users = new Map();
    logger.info("[UserManager] Initialized with in-memory storage");
  }

  /**
   * Create or update user
   */
  createOrUpdateUser(userId: string, timestamp: number = Date.now()): User {
    // TODO: Database implementation
    // const user = await this.db.users.findOneAndUpdate(
    //   { userId },
    //   {
    //     $set: { lastActive: timestamp },
    //     $setOnInsert: { createdAt: timestamp }
    //   },
    //   { upsert: true, returnDocument: 'after' }
    // );

    let user = this.users.get(userId);

    if (user) {
      // User exists, update last active
      user.lastActive = timestamp;
      logger.debug(`[UserManager] User ${userId} updated`);
    } else {
      // New user
      user = {
        userId,
        lastActive: timestamp,
        createdAt: timestamp,
      };
      this.users.set(userId, user);
      logger.info(`[UserManager] New user created: ${userId}`);
    }

    return user;
  }

  /**
   * Get user by userId
   */
  getUser(userId: string): User | undefined {
    // TODO: Database implementation
    // return await this.db.users.findOne({ userId });

    return this.users.get(userId);
  }

  /**
   * Delete user
   */
  deleteUser(userId: string): boolean {
    // TODO: Database implementation
    // return await this.db.users.deleteOne({ userId });

    return this.users.delete(userId);
  }

  // /**
  //  * Get all active users (last active within timeframe)
  //  */
  // getActiveUsers(withinMs: number = 24 * 60 * 60 * 1000): User[] {
  //   // TODO: Database implementation
  //   // return await this.db.users.find({
  //   //   lastActive: { $gte: Date.now() - withinMs }
  //   // }).toArray();

  //   const now = Date.now();
  //   const activeUsers: User[] = [];

  //   for (const user of this.users.values()) {
  //     if (now - user.lastActive <= withinMs) {
  //       activeUsers.push(user);
  //     }
  //   }

  //   return activeUsers;
  // }

  // /**
  //  * Get user statistics
  //  */
  // getStatistics() {
  //   // TODO: Database implementation
  //   // const stats = await this.db.users.aggregate([
  //   //   { $group: { _id: null, total: { $sum: 1 }, ... } }
  //   // ]);

  //   const now = Date.now();
  //   let activeCount = 0;

  //   for (const user of this.users.values()) {
  //     if (now - user.lastActive <= 24 * 60 * 60 * 1000) {
  //       activeCount++;
  //     }
  //   }

  //   return {
  //     totalUsers: this.users.size,
  //     activeUsers: activeCount,
  //   };
  // }

  /**
   * Clear all users (for testing/reset)
   */
  clearAll(): void {
    // TODO: Database implementation
    // await this.db.users.deleteMany({});

    this.users.clear();
    logger.warn("[UserManager] All users cleared");
  }
}

// Singleton instance
export const userManager = new UserManager();
