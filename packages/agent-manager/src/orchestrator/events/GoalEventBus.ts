/**
 * GoalEventBus — Publishes domain events AFTER MongoDB writes succeed.
 *
 * Two tiers of handlers:
 * 1. Projection handlers (best-effort) — CRDT sync. Errors logged, never thrown.
 * 2. Notification handlers (fire-and-forget) — Socket.IO. Errors swallowed.
 *
 * Handlers within a tier run concurrently via Promise.allSettled.
 * A CRDT handler failure does NOT affect Socket.IO or other handlers.
 *
 * @see docs/features/crdt-first-architecture/feature_architecture.md — "Domain Events + Message Bus"
 */

import { rootLogger } from "../../logging.js";
import type { AnyGoalEvent, GoalEvent } from "./GoalEvents.js";

const log = rootLogger.child({ module: "GoalEventBus" });

export type EventHandler<T extends GoalEvent = AnyGoalEvent> = (event: T) => Promise<void>;

export class GoalEventBus {
  private projectionHandlers = new Map<string, EventHandler[]>();
  private notificationHandlers = new Map<string, EventHandler[]>();

  /** Subscribe a CRDT projection handler (best-effort, errors logged). */
  onProjection<T extends AnyGoalEvent>(eventType: T["type"], handler: EventHandler<T>): void {
    const handlers = this.projectionHandlers.get(eventType) || [];
    handlers.push(handler as EventHandler);
    this.projectionHandlers.set(eventType, handlers);
  }

  /** Subscribe a notification handler (fire-and-forget, errors swallowed). */
  onNotification<T extends AnyGoalEvent>(eventType: T["type"], handler: EventHandler<T>): void {
    const handlers = this.notificationHandlers.get(eventType) || [];
    handlers.push(handler as EventHandler);
    this.notificationHandlers.set(eventType, handlers);
  }

  /**
   * Publish events. Called AFTER MongoDB write succeeded.
   * Events represent facts that already happened.
   */
  async publish(events: AnyGoalEvent[]): Promise<void> {
    for (const event of events) {
      // Tier 1: Projection handlers — best-effort, errors logged
      const projections = this.projectionHandlers.get(event.type) || [];
      if (projections.length > 0) {
        const results = await Promise.allSettled(projections.map(h => h(event)));
        for (const r of results) {
          if (r.status === "rejected") {
            log.warn({ err: r.reason, eventType: event.type, goalId: event.goalId }, "Projection handler failed");
          }
        }
      }

      // Tier 2: Notification handlers — fire-and-forget
      const notifications = this.notificationHandlers.get(event.type) || [];
      for (const h of notifications) {
        h(event).catch(err =>
          log.debug({ err, eventType: event.type }, "Notification handler failed")
        );
      }
    }
  }

  /** Remove all handlers. Useful for testing. */
  clear(): void {
    this.projectionHandlers.clear();
    this.notificationHandlers.clear();
  }
}
